import 'dotenv/config';
import express from 'express';
import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import pg from 'pg';
import { readFile } from 'node:fs/promises';

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: true } : undefined });
const app = express();
const PgSession = connectPgSimple(session);
const port = Number(process.env.PORT || 3000);
const origin = process.env.APP_ORIGIN || 'http://localhost:5173';
const hospitalTimezone = process.env.HOSPITAL_TIMEZONE || 'UTC';
try { new Intl.DateTimeFormat('en-US', { timeZone: hospitalTimezone }); } catch { throw new Error('HOSPITAL_TIMEZONE must be a valid IANA timezone.'); }

if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
  throw new Error('Set SESSION_SECRET to a random value with at least 32 characters.');
}
if (process.env.NODE_ENV === 'production' && process.env.PGSSL !== 'true') {
  throw new Error('Production requires PGSSL=true and a verified TLS PostgreSQL connection.');
}

app.disable('x-powered-by');
if (process.env.NODE_ENV === 'production') app.set('trust proxy', 1);
app.use(helmet());
app.use(express.json({ limit: '32kb' }));
app.use(session({
  store: new PgSession({ pool, tableName: 'user_sessions', createTableIfMissing: true }),
  name: 'careflow.sid',
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'strict', secure: process.env.NODE_ENV === 'production', maxAge: 8 * 60 * 60 * 1000 },
}));

const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: 'draft-8', legacyHeaders: false });
const patientSchema = z.object({
  firstName: z.string().trim().min(1).max(80), lastName: z.string().trim().min(1).max(80),
  dateOfBirth: z.string().date().nullable().optional(), phone: z.string().trim().max(40).nullable().optional(),
  email: z.string().trim().email().max(254).nullable().optional(),
}).strict();
const appointmentSchema = z.object({
  patientId: z.string().uuid(), clinicianId: z.string().uuid().nullable().optional(), departmentId: z.string().uuid(),
  startsAt: z.string().datetime({ offset: true }),
  appointmentType: z.string().trim().min(1).max(120),
}).strict();
const departmentSchema = z.object({ code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{2,20}$/), name: z.string().trim().min(2).max(100), description: z.string().trim().max(250).optional().default('') }).strict();
const wardSchema = z.object({ name: z.string().trim().min(2).max(100), description: z.string().trim().max(250).optional().default('') }).strict();
const bedSchema = z.object({ bedNumber: z.string().trim().min(1).max(30) }).strict();
const bedStatusSchema = z.object({ status: z.enum(['available', 'maintenance']) }).strict();
const admissionSchema = z.object({ patientId: z.string().uuid(), bedId: z.string().uuid() }).strict();

async function audit(userId, action, resource, resourceId = null) {
  await pool.query('INSERT INTO audit_events(actor_id, action, resource, resource_id) VALUES($1,$2,$3,$4)', [userId, action, resource, resourceId]);
}
function requireUser(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: 'Sign in required' });
  next();
}
function allowRoles(...roles) {
  return (req, res, next) => roles.includes(req.session.user.role) ? next() : res.status(403).json({ error: 'Insufficient permissions' });
}
function originGuard(req, res, next) {
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && req.get('origin') !== origin) return res.status(403).json({ error: 'Request origin not allowed' });
  next();
}

app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));
app.use('/api', originGuard);
app.post('/api/auth/login', loginLimiter, async (req, res, next) => {
  try {
    const input = z.object({ email: z.string().email().max(254), password: z.string().min(1).max(200) }).safeParse(req.body);
    if (!input.success) return res.status(400).json({ error: 'Enter a valid email and password' });
    const result = await pool.query('SELECT id, email, full_name, password_hash, role FROM staff_users WHERE lower(email)=lower($1) AND active=true', [input.data.email]);
    const user = result.rows[0];
    if (!user || !(await bcrypt.compare(input.data.password, user.password_hash))) return res.status(401).json({ error: 'Email or password is incorrect' });
    await new Promise((resolve, reject) => req.session.regenerate(err => err ? reject(err) : resolve()));
    req.session.user = { id: user.id, email: user.email, fullName: user.full_name, role: user.role };
    await audit(user.id, 'login', 'staff_user', user.id);
    res.json({ user: req.session.user });
  } catch (error) { next(error); }
});
app.post('/api/auth/logout', requireUser, async (req, res, next) => {
  try { await audit(req.session.user.id, 'logout', 'staff_user', req.session.user.id); req.session.destroy(error => error ? next(error) : res.clearCookie('careflow.sid').status(204).end()); }
  catch (error) { next(error); }
});
app.get('/api/auth/me', requireUser, (req, res) => res.json({ user: req.session.user }));

app.get('/api/departments', requireUser, async (_req, res, next) => {
  try {
    const result = await pool.query(`SELECT d.id,d.code,d.name,d.description,d.active,count(DISTINCT s.id)::int AS "staffCount",count(DISTINCT a.id)::int AS "appointmentCount" FROM departments d LEFT JOIN staff_users s ON s.department_id=d.id AND s.active=true LEFT JOIN appointments a ON a.department_id=d.id WHERE d.active=true GROUP BY d.id ORDER BY d.name`);
    res.json({ departments: result.rows });
  } catch (error) { next(error); }
});
app.post('/api/departments', requireUser, allowRoles('admin'), async (req, res, next) => {
  try {
    const parsed = departmentSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Enter a unique department code, name, and description under 250 characters' });
    const result = await pool.query('INSERT INTO departments(code,name,description) VALUES($1,$2,$3) RETURNING id,code,name,description,active', [parsed.data.code, parsed.data.name, parsed.data.description]);
    await audit(req.session.user.id, 'create', 'department', result.rows[0].id);
    res.status(201).json({ department: result.rows[0] });
  } catch (error) { next(error); }
});

app.get('/api/patients', requireUser, allowRoles('admin', 'clinician', 'receptionist'), async (req, res, next) => {
  try {
    const q = String(req.query.q || '').trim().slice(0, 100);
    const result = await pool.query(`SELECT id, record_number AS "recordNumber", first_name AS "firstName", last_name AS "lastName", date_of_birth AS "dateOfBirth", phone, email, status, created_at AS "createdAt" FROM patients WHERE status <> 'archived' AND ($1 = '' OR first_name ILIKE '%' || $1 || '%' OR last_name ILIKE '%' || $1 || '%' OR record_number ILIKE '%' || $1 || '%') ORDER BY last_name, first_name LIMIT 200`, [q]);
    await audit(req.session.user.id, 'read_list', 'patient');
    res.json({ patients: result.rows });
  } catch (error) { next(error); }
});
app.post('/api/patients', requireUser, allowRoles('admin', 'clinician', 'receptionist'), async (req, res, next) => {
  try {
    const parsed = patientSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Check the patient details and try again', details: parsed.error.flatten().fieldErrors });
    const p = parsed.data;
    const result = await pool.query(`INSERT INTO patients(first_name,last_name,date_of_birth,phone,email) VALUES($1,$2,$3,$4,$5) RETURNING id, record_number AS "recordNumber", first_name AS "firstName", last_name AS "lastName", date_of_birth AS "dateOfBirth", phone, email, status, created_at AS "createdAt"`, [p.firstName,p.lastName,p.dateOfBirth || null,p.phone || null,p.email || null]);
    const patient = result.rows[0];
    await audit(req.session.user.id, 'create', 'patient', patient.id);
    res.status(201).json({ patient });
  } catch (error) { next(error); }
});
app.patch('/api/patients/:id', requireUser, allowRoles('admin', 'clinician', 'receptionist'), async (req, res, next) => {
  try {
    const parsed = patientSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Check the patient details and try again' });
    const p = parsed.data;
    const result = await pool.query(`UPDATE patients SET first_name=$2,last_name=$3,date_of_birth=$4,phone=$5,email=$6,status=COALESCE($7,status),updated_at=now() WHERE id=$1 AND status <> 'archived' RETURNING id, record_number AS "recordNumber", first_name AS "firstName", last_name AS "lastName", date_of_birth AS "dateOfBirth", phone, email, status`, [req.params.id,p.firstName,p.lastName,p.dateOfBirth || null,p.phone || null,p.email || null,req.body.status === 'follow_up' ? 'follow_up' : null]);
    if (!result.rowCount) return res.status(404).json({ error: 'Patient not found' });
    await audit(req.session.user.id, 'update', 'patient', req.params.id);
    res.json({ patient: result.rows[0] });
  } catch (error) { next(error); }
});
app.post('/api/patients/:id/archive', requireUser, allowRoles('admin', 'clinician'), async (req, res, next) => {
  try {
    const result = await pool.query("UPDATE patients SET status='archived',updated_at=now() WHERE id=$1 AND status <> 'archived' AND NOT EXISTS(SELECT 1 FROM admissions WHERE patient_id=patients.id AND status='admitted')", [req.params.id]);
    if (!result.rowCount) {
      const active = await pool.query("SELECT EXISTS(SELECT 1 FROM patients WHERE id=$1 AND status<>'archived') AS patient_exists, EXISTS(SELECT 1 FROM admissions WHERE patient_id=$1 AND status='admitted') AS admitted", [req.params.id]);
      if (!active.rows[0]?.patient_exists) return res.status(404).json({ error: 'Patient not found' });
      if (active.rows[0].admitted) return res.status(409).json({ error: 'Discharge the patient before archiving their record.' });
      return res.status(404).json({ error: 'Patient not found' });
    }
    await audit(req.session.user.id, 'archive', 'patient', req.params.id);
    res.status(204).end();
  } catch (error) { next(error); }
});

app.get('/api/appointments', requireUser, async (req, res, next) => {
  try {
    const result = await pool.query(`SELECT a.id,a.patient_id AS "patientId",a.starts_at AS "startsAt",COALESCE(d.name,a.department) AS department,a.department_id AS "departmentId",a.appointment_type AS "appointmentType",a.status,p.first_name AS "firstName",p.last_name AS "lastName",u.full_name AS "clinicianName" FROM appointments a JOIN patients p ON p.id=a.patient_id LEFT JOIN departments d ON d.id=a.department_id LEFT JOIN staff_users u ON u.id=a.clinician_id WHERE a.status <> 'cancelled' ORDER BY a.starts_at ASC LIMIT 250`);
    await audit(req.session.user.id, 'read_list', 'appointment');
    res.json({ appointments: result.rows });
  } catch (error) { next(error); }
});
app.get('/api/staff', requireUser, allowRoles('admin','clinician','receptionist'), async (req, res, next) => {
  try {
    const result = await pool.query("SELECT s.id,s.full_name AS \"fullName\",s.role,s.active,s.department_id AS \"departmentId\",d.name AS \"departmentName\" FROM staff_users s LEFT JOIN departments d ON d.id=s.department_id WHERE s.active=true ORDER BY s.full_name");
    await audit(req.session.user.id, 'read_list', 'staff_user');
    res.json({ staff: result.rows });
  } catch (error) { next(error); }
});
app.patch('/api/staff/:id/department', requireUser, allowRoles('admin'), async (req, res, next) => {
  try {
    const parsed = z.object({ departmentId: z.string().uuid().nullable() }).strict().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Select a valid department' });
    const result = await pool.query(`UPDATE staff_users s SET department_id=$2 WHERE s.id=$1 AND s.active=true AND ($2::uuid IS NULL OR EXISTS(SELECT 1 FROM departments d WHERE d.id=$2 AND d.active=true)) RETURNING s.id,s.department_id AS "departmentId"`, [req.params.id, parsed.data.departmentId]);
    if (!result.rowCount) return res.status(404).json({ error: 'Staff account or active department not found' });
    await audit(req.session.user.id, 'assign_department', 'staff_user', req.params.id);
    res.json({ staffMember: result.rows[0] });
  } catch (error) { next(error); }
});
app.post('/api/staff', requireUser, allowRoles('admin'), async (req, res, next) => {
  try {
    const parsed = z.object({ email:z.string().email().max(254), fullName:z.string().trim().min(2).max(120), role:z.enum(['clinician','receptionist']), departmentId:z.string().uuid(), password:z.string().min(14).max(200) }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Enter a name, valid email, role, department, and a password of at least 14 characters' });
    const hash = await bcrypt.hash(parsed.data.password, 12);
    const result = await pool.query('INSERT INTO staff_users(email,full_name,password_hash,role,department_id) SELECT lower($1),$2,$3,$4,id FROM departments WHERE id=$5 AND active=true RETURNING id,email,full_name AS "fullName",role,active,department_id AS "departmentId"', [parsed.data.email,parsed.data.fullName,hash,parsed.data.role,parsed.data.departmentId]);
    if (!result.rowCount) return res.status(400).json({ error: 'Select an active department for this staff account' });
    await audit(req.session.user.id, 'create', 'staff_user', result.rows[0].id);
    res.status(201).json({ staffMember: result.rows[0] });
  } catch (error) { next(error); }
});
app.post('/api/appointments', requireUser, allowRoles('admin','clinician','receptionist'), async (req, res, next) => {
  try {
    const parsed = appointmentSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Check the appointment details and try again', details: parsed.error.flatten().fieldErrors });
    const a = parsed.data;
    const result = await pool.query(`INSERT INTO appointments(patient_id,clinician_id,starts_at,department_id,department,appointment_type,created_by) SELECT p.id,$2,$3,d.id,d.name,$5,$6 FROM patients p JOIN departments d ON d.id=$4 AND d.active=true WHERE p.id=$1 AND p.status<>'archived' AND ($2::uuid IS NULL OR EXISTS(SELECT 1 FROM staff_users clinician WHERE clinician.id=$2 AND clinician.active=true AND clinician.role='clinician' AND clinician.department_id=d.id)) RETURNING id,patient_id AS "patientId",starts_at AS "startsAt",department,department_id AS "departmentId",appointment_type AS "appointmentType",status`, [a.patientId,a.clinicianId || null,a.startsAt,a.departmentId,a.appointmentType,req.session.user.id]);
    if (!result.rowCount) return res.status(400).json({ error: 'Select an active patient, department, and clinician assigned to that department' });
    await audit(req.session.user.id, 'create', 'appointment', result.rows[0].id);
    res.status(201).json({ appointment: result.rows[0] });
  } catch (error) { next(error); }
});
app.patch('/api/appointments/:id/status', requireUser, allowRoles('admin','clinician','receptionist'), async (req, res, next) => {
  try {
    const parsed = z.object({ status: z.enum(['confirmed','waiting','checked_in','completed','cancelled']) }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid appointment status' });
    const result = await pool.query('UPDATE appointments SET status=$2,updated_at=now() WHERE id=$1 RETURNING id,status', [req.params.id,parsed.data.status]);
    if (!result.rowCount) return res.status(404).json({ error: 'Appointment not found' });
    await audit(req.session.user.id, 'update_status', 'appointment', req.params.id);
    res.json({ appointment: result.rows[0] });
  } catch (error) { next(error); }
});

app.get('/api/wards', requireUser, async (_req, res, next) => {
  try {
    const result = await pool.query(`SELECT w.id,w.name,w.description,count(b.id)::int AS "bedCount",count(b.id) FILTER (WHERE b.status='available' AND a.id IS NULL)::int AS "availableBeds",count(a.id)::int AS "occupiedBeds" FROM wards w LEFT JOIN beds b ON b.ward_id=w.id LEFT JOIN admissions a ON a.bed_id=b.id AND a.status='admitted' WHERE w.active=true GROUP BY w.id ORDER BY w.name`);
    res.json({ wards: result.rows });
  } catch (error) { next(error); }
});
app.post('/api/wards', requireUser, allowRoles('admin'), async (req, res, next) => {
  try {
    const parsed = wardSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Enter a ward name and a description under 250 characters' });
    const result = await pool.query('INSERT INTO wards(name,description) VALUES($1,$2) RETURNING id,name,description', [parsed.data.name, parsed.data.description]);
    await audit(req.session.user.id, 'create', 'ward', result.rows[0].id);
    res.status(201).json({ ward: result.rows[0] });
  } catch (error) { next(error); }
});
app.post('/api/wards/:id/beds', requireUser, allowRoles('admin'), async (req, res, next) => {
  try {
    const parsed = bedSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Enter a bed identifier under 30 characters' });
    const result = await pool.query(`INSERT INTO beds(ward_id,bed_number) SELECT id,$2 FROM wards WHERE id=$1 AND active=true RETURNING id,ward_id AS "wardId",bed_number AS "bedNumber",status`, [req.params.id, parsed.data.bedNumber]);
    if (!result.rowCount) return res.status(404).json({ error: 'Ward not found' });
    await audit(req.session.user.id, 'create', 'bed', result.rows[0].id);
    res.status(201).json({ bed: result.rows[0] });
  } catch (error) { next(error); }
});
app.get('/api/beds', requireUser, async (_req, res, next) => {
  try {
    const result = await pool.query(`SELECT b.id,b.ward_id AS "wardId",w.name AS "wardName",b.bed_number AS "bedNumber",b.status AS "bedStatus",a.id AS "admissionId",p.id AS "patientId",p.record_number AS "recordNumber",p.first_name AS "firstName",p.last_name AS "lastName",a.admitted_at AS "admittedAt" FROM beds b JOIN wards w ON w.id=b.ward_id AND w.active=true LEFT JOIN admissions a ON a.bed_id=b.id AND a.status='admitted' LEFT JOIN patients p ON p.id=a.patient_id ORDER BY w.name,b.bed_number`);
    await audit(_req.session.user.id, 'read_list', 'bed');
    res.json({ beds: result.rows });
  } catch (error) { next(error); }
});
app.patch('/api/beds/:id/status', requireUser, allowRoles('admin'), async (req, res, next) => {
  try {
    const parsed = bedStatusSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Select a valid bed status' });
    const result = await pool.query(`UPDATE beds SET status=$2 WHERE id=$1 AND NOT EXISTS(SELECT 1 FROM admissions WHERE bed_id=beds.id AND status='admitted') RETURNING id,status`, [req.params.id, parsed.data.status]);
    if (!result.rowCount) return res.status(409).json({ error: 'Bed not found or currently occupied. Discharge the current admission before changing bed status.' });
    await audit(req.session.user.id, 'update_status', 'bed', req.params.id);
    res.json({ bed: result.rows[0] });
  } catch (error) { next(error); }
});
app.get('/api/admissions', requireUser, async (_req, res, next) => {
  try {
    const result = await pool.query(`SELECT a.id,a.patient_id AS "patientId",p.record_number AS "recordNumber",p.first_name AS "firstName",p.last_name AS "lastName",a.bed_id AS "bedId",b.bed_number AS "bedNumber",w.name AS "wardName",a.admitted_at AS "admittedAt",u.full_name AS "admittedBy" FROM admissions a JOIN patients p ON p.id=a.patient_id JOIN beds b ON b.id=a.bed_id JOIN wards w ON w.id=b.ward_id JOIN staff_users u ON u.id=a.admitted_by WHERE a.status='admitted' ORDER BY a.admitted_at`);
    await audit(req.session.user.id, 'read_list', 'admission');
    res.json({ admissions: result.rows });
  } catch (error) { next(error); }
});
app.post('/api/admissions', requireUser, allowRoles('admin','clinician','receptionist'), async (req, res, next) => {
  try {
    const parsed = admissionSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Select a patient and an available bed' });
    const result = await pool.query(`INSERT INTO admissions(patient_id,bed_id,admitted_by) SELECT p.id,b.id,$3 FROM patients p CROSS JOIN beds b JOIN wards w ON w.id=b.ward_id WHERE p.id=$1 AND b.id=$2 AND p.status<>'archived' AND b.status='available' AND w.active=true RETURNING id,patient_id AS "patientId",bed_id AS "bedId",admitted_at AS "admittedAt"`, [parsed.data.patientId, parsed.data.bedId, req.session.user.id]);
    if (!result.rowCount) return res.status(409).json({ error: 'Patient or bed is unavailable. Refresh the list and try again.' });
    await audit(req.session.user.id, 'admit', 'admission', result.rows[0].id);
    res.status(201).json({ admission: result.rows[0] });
  } catch (error) { next(error); }
});
app.post('/api/admissions/:id/discharge', requireUser, allowRoles('admin','clinician'), async (req, res, next) => {
  try {
    const result = await pool.query(`UPDATE admissions SET status='discharged',discharged_at=now(),discharged_by=$2 WHERE id=$1 AND status='admitted' RETURNING id,patient_id AS "patientId",bed_id AS "bedId"`, [req.params.id, req.session.user.id]);
    if (!result.rowCount) return res.status(404).json({ error: 'Active admission not found' });
    await audit(req.session.user.id, 'discharge', 'admission', result.rows[0].id);
    res.json({ admission: result.rows[0] });
  } catch (error) { next(error); }
});

app.get('/api/dashboard', requireUser, async (req, res, next) => {
  try {
    const [patientsResult, todayResult, appointmentsResult, weekResult, completedResult] = await Promise.all([
      pool.query("SELECT count(*)::int AS total FROM patients WHERE status<>'archived'"),
      pool.query("SELECT count(*)::int AS total FROM appointments WHERE starts_at >= (date_trunc('day',now() AT TIME ZONE $1) AT TIME ZONE $1) AND starts_at < ((date_trunc('day',now() AT TIME ZONE $1) + interval '1 day') AT TIME ZONE $1) AND status<>'cancelled'", [hospitalTimezone]),
      pool.query(`SELECT a.id,a.patient_id AS "patientId",a.starts_at AS "startsAt",a.department,a.appointment_type AS "appointmentType",a.status,p.first_name AS "firstName",p.last_name AS "lastName",u.full_name AS "clinicianName" FROM appointments a JOIN patients p ON p.id=a.patient_id LEFT JOIN staff_users u ON u.id=a.clinician_id WHERE a.starts_at >= (date_trunc('day',now() AT TIME ZONE $1) AT TIME ZONE $1) AND a.starts_at < ((date_trunc('day',now() AT TIME ZONE $1) + interval '1 day') AT TIME ZONE $1) AND a.status<>'cancelled' ORDER BY a.starts_at LIMIT 8`, [hospitalTimezone]),
      pool.query("SELECT count(*)::int AS total FROM appointments WHERE starts_at >= (date_trunc('day',now() AT TIME ZONE $1) AT TIME ZONE $1) AND starts_at < ((date_trunc('day',now() AT TIME ZONE $1) + interval '7 days') AT TIME ZONE $1) AND status<>'cancelled'", [hospitalTimezone]),
      pool.query("SELECT count(*)::int AS total FROM appointments WHERE starts_at >= (date_trunc('day',now() AT TIME ZONE $1) AT TIME ZONE $1) AND starts_at < ((date_trunc('day',now() AT TIME ZONE $1) + interval '1 day') AT TIME ZONE $1) AND status='completed'", [hospitalTimezone]),
    ]);
    await audit(req.session.user.id, 'read', 'dashboard');
    res.json({ totalPatients: patientsResult.rows[0].total, appointmentsToday: todayResult.rows[0].total, upcomingThisWeek: weekResult.rows[0].total, completedToday: completedResult.rows[0].total, appointments: appointmentsResult.rows });
  } catch (error) { next(error); }
});
app.get('/api/reports/activity', requireUser, async (req, res, next) => {
  try {
    const result = await pool.query(`SELECT d.day::date AS day, count(a.id)::int AS total FROM generate_series(date_trunc('day', now() AT TIME ZONE $1) - interval '6 days', date_trunc('day', now() AT TIME ZONE $1), interval '1 day') AS d(day) LEFT JOIN appointments a ON a.starts_at >= (d.day AT TIME ZONE $1) AND a.starts_at < ((d.day + interval '1 day') AT TIME ZONE $1) AND a.status <> 'cancelled' GROUP BY d.day ORDER BY d.day`, [hospitalTimezone]);
    await audit(req.session.user.id, 'read', 'activity_report');
    res.json({ days: result.rows });
  } catch (error) { next(error); }
});

app.use('/api', (_req, res) => res.status(404).json({ error: 'API endpoint not found' }));
app.use((error, _req, res, _next) => {
  console.error('Request failed:', error?.code || error?.name || 'Error');
  if (error?.code === '23505') return res.status(409).json({ error: 'A record with those details already exists' });
  res.status(500).json({ error: 'The request could not be completed' });
});

if (process.env.NODE_ENV === 'production') {
  app.use(express.static('dist', { index: false, maxAge: '1h' }));
  app.get(/.*/, (_req, res) => res.sendFile('index.html', { root: 'dist' }));
}

if (process.argv.includes('--migrate')) {
  try { await pool.query(await readFile(new URL('./schema.sql', import.meta.url), 'utf8')); console.log('Database schema is ready.'); }
  finally { await pool.end(); }
} else {
  app.listen(port, () => console.log(`Careflow API listening on port ${port}`));
}
