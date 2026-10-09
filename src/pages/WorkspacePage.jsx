import { useEffect, useState } from 'react';
import { Activity, BedDouble, Building2, Plus, Search } from 'lucide-react';
import { api } from '../data/api.js';

const descriptions = {
  Appointments: 'Schedule patient visits and update check-in status.',
  Patients: 'Search and maintain the hospital patient register.',
  Admissions: 'Manage inpatient stays, ward capacity, and bed assignments.',
  'Care team': 'Current active staff accounts in this workspace.',
  Departments: 'Maintain the hospital service directory used for staffing and appointments.',
  Reports: 'Appointment activity recorded in the database.',
  Settings: 'Account and workspace access.',
};

export default function WorkspacePage({ page, appointments = [], patients = [], staff = [], departments = [], user, onAddAppointment, onPatientAdded, onPatientUpdated, onPatientArchived, onStaffAdded, onDepartmentAdded, onStaffDepartmentChanged, onStatusChanged, onLogout }) {
  const [search, setSearch] = useState('');
  const [patientForm, setPatientForm] = useState(false);
  const [editingPatient, setEditingPatient] = useState(null);
  const [staffForm, setStaffForm] = useState(false);
  const [departmentForm, setDepartmentForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [days, setDays] = useState([]);
  const [wards, setWards] = useState([]);
  const [beds, setBeds] = useState([]);
  const [admissions, setAdmissions] = useState([]);
  const [inpatientForm, setInpatientForm] = useState('');
  const [message, setMessage] = useState('');
  useEffect(() => { if (page === 'Reports') api.activityReport().then(data => setDays(data.days)).catch(e => setError(e.message)); }, [page]);
  useEffect(() => {
    if (page !== 'Admissions') return;
    let mounted = true;
    Promise.all([api.wards(), api.beds(), api.admissions()]).then(([wardData, bedData, admissionData]) => {
      if (!mounted) return;
      setWards(wardData.wards); setBeds(bedData.beds); setAdmissions(admissionData.admissions);
    }).catch(e => { if (mounted) setError(e.message); });
    return () => { mounted = false; };
  }, [page]);
  const filteredPatients = patients.filter(p => `${p.firstName} ${p.lastName} ${p.recordNumber}`.toLowerCase().includes(search.toLowerCase()));
  const filteredAppointments = appointments.filter(a => `${a.name} ${a.doctor} ${a.type}`.toLowerCase().includes(search.toLowerCase()));
  const filteredStaff = staff.filter(s => `${s.fullName} ${s.role}`.toLowerCase().includes(search.toLowerCase()));
  const title = page;

  async function createPatient(event) {
    event.preventDefault(); setSaving(true); setError('');
    const form = new FormData(event.currentTarget);
    const value = Object.fromEntries(form.entries());
    try {
      await onPatientAdded({ firstName: value.firstName, lastName: value.lastName, dateOfBirth: value.dateOfBirth || null, phone: value.phone || null, email: value.email || null });
      setPatientForm(false);
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  }
  async function updatePatient(event) {
    event.preventDefault(); setSaving(true); setError('');
    const values = Object.fromEntries(new FormData(event.currentTarget).entries());
    try {
      await onPatientUpdated(editingPatient.id, {
        firstName: values.firstName,
        lastName: values.lastName,
        dateOfBirth: values.dateOfBirth || null,
        phone: values.phone || null,
        email: values.email || null,
      });
      setEditingPatient(null);
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  }
  async function archivePatient(patient) {
    const confirmed = window.confirm(`Archive the record for ${patient.firstName} ${patient.lastName} (${patient.recordNumber})? It will no longer appear in active patient lists.`);
    if (!confirmed) return;
    setSaving(true); setError('');
    try { await onPatientArchived(patient.id); }
    catch (e) { setError(e.message); }
    finally { setSaving(false); }
  }
  async function createStaff(event) {
    event.preventDefault(); setSaving(true); setError('');
    const values = Object.fromEntries(new FormData(event.currentTarget).entries());
    try { await onStaffAdded(values); setStaffForm(false); }
    catch (e) { setError(e.message); }
    finally { setSaving(false); }
  }
  async function createDepartment(event) {
    event.preventDefault(); setSaving(true); setError('');
    const values = Object.fromEntries(new FormData(event.currentTarget).entries());
    try { await onDepartmentAdded(values); setDepartmentForm(false); }
    catch (e) { setError(e.message); }
    finally { setSaving(false); }
  }
  async function assignDepartment(person, departmentId) {
    setSaving(true); setError('');
    try { await onStaffDepartmentChanged(person.id, departmentId || null); }
    catch (e) { setError(e.message); }
    finally { setSaving(false); }
  }
  async function refreshInpatient() {
    const [wardData, bedData, admissionData] = await Promise.all([api.wards(), api.beds(), api.admissions()]);
    setWards(wardData.wards); setBeds(bedData.beds); setAdmissions(admissionData.admissions);
  }
  async function saveInpatientForm(event) {
    event.preventDefault(); setSaving(true); setError(''); setMessage('');
    const values = Object.fromEntries(new FormData(event.currentTarget).entries());
    try {
      if (inpatientForm === 'ward') await api.createWard({ name: values.name, description: values.description });
      if (inpatientForm === 'bed') await api.createBed(values.wardId, { bedNumber: values.bedNumber });
      if (inpatientForm === 'admit') await api.admitPatient({ patientId: values.patientId, bedId: values.bedId });
      await refreshInpatient();
      setInpatientForm(''); setMessage(inpatientForm === 'ward' ? 'Ward created.' : inpatientForm === 'bed' ? 'Bed added to inventory.' : 'Patient admitted and bed assigned.');
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  }
  async function dischargePatient(admission) {
    const patientName = `${admission.firstName} ${admission.lastName}`;
    if (!window.confirm(`Record discharge for ${patientName} from ${admission.wardName}, bed ${admission.bedNumber}?`)) return;
    setSaving(true); setError(''); setMessage('');
    try { await api.dischargePatient(admission.id); await refreshInpatient(); setMessage(`${patientName} discharged; bed released.`); }
    catch (e) { setError(e.message); }
    finally { setSaving(false); }
  }
  async function changeBedStatus(bed, status) {
    setSaving(true); setError(''); setMessage('');
    try { await api.setBedStatus(bed.id, status); await refreshInpatient(); setMessage(`Bed ${bed.bedNumber} status updated.`); }
    catch (e) { setError(e.message); }
    finally { setSaving(false); }
  }

  return <div className="page-view">
    <div className="welcome-row"><div><p className="eyebrow">Hospital workspace</p><h1>{title}</h1><p className="subtitle">{descriptions[page]}</p></div>
      {page === 'Appointments' && <button className="primary-button" onClick={onAddAppointment}><Plus size={16}/> New appointment</button>}
      {page === 'Patients' && <button className="primary-button" onClick={() => {setPatientForm(true);setError('');}}><Plus size={16}/> Add patient</button>}
      {page === 'Admissions' && <div className="inpatient-actions">{user?.role === 'admin' && <><button className="secondary-button" onClick={() => {setInpatientForm('ward');setError('');setMessage('');}}>Add ward</button><button className="secondary-button" disabled={!wards.length} onClick={() => {setInpatientForm('bed');setError('');setMessage('');}}>Add bed</button></>}<button className="primary-button" disabled={!patients.some(p=>!admissions.some(a=>a.patientId===p.id))||!beds.some(b=>b.bedStatus==='available'&&!b.admissionId)} onClick={() => {setInpatientForm('admit');setError('');setMessage('');}}><Plus size={16}/> Admit patient</button></div>}
      {page === 'Care team' && user?.role === 'admin' && <button className="primary-button" onClick={() => {setStaffForm(true);setError('');}}><Plus size={16}/> Add staff</button>}
      {page === 'Departments' && user?.role === 'admin' && <button className="primary-button" onClick={() => {setDepartmentForm(true);setError('');}}><Plus size={16}/> Add department</button>}
    </div>
    {page === 'Patients' && error && <p className="form-error page-error" role="alert">{error}</p>}
    {page === 'Admissions' && error && <p className="form-error page-error" role="alert">{error}</p>}
    {page === 'Admissions' && message && <p className="success-message" role="status">{message}</p>}
    {page === 'Departments' && error && <p className="form-error page-error" role="alert">{error}</p>}

    {page === 'Departments' && <section className="panel data-panel"><div className="panel-heading"><div><h2>Hospital departments</h2><p className="panel-subtitle">Departments are used when assigning staff and scheduling appointments.</p></div><Building2 size={18} className="unit-icon"/></div><div className="table-wrap"><table><thead><tr><th>DEPARTMENT</th><th>CODE</th><th>DESCRIPTION</th><th>ACTIVE STAFF</th><th>APPOINTMENTS</th></tr></thead><tbody>{departments.map(department=><tr key={department.id}><td><strong>{department.name}</strong></td><td>{department.code}</td><td>{department.description || '—'}</td><td>{department.staffCount ?? '—'}</td><td>{department.appointmentCount ?? '—'}</td></tr>)}</tbody></table>{departments.length===0&&<Empty message={user?.role==='admin'?'No departments yet. Add the hospital departments before creating staff or appointments.':'No departments have been configured yet.'}/>}</div></section>}

    {page === 'Admissions' && <>
      <section className="admission-summary" aria-label="Inpatient capacity">
        <div className="panel"><span>Wards</span><strong>{wards.length}</strong></div>
        <div className="panel"><span>Total beds</span><strong>{beds.length}</strong></div>
        <div className="panel"><span>Occupied</span><strong>{beds.filter(b=>b.admissionId).length}</strong></div>
        <div className="panel"><span>Available</span><strong>{beds.filter(b=>b.bedStatus==='available'&&!b.admissionId).length}</strong></div>
      </section>
      <section className="panel data-panel inpatient-panel"><div className="panel-heading"><div><h2>Current inpatients</h2><p className="panel-subtitle">Active admissions and assigned beds</p></div><BedDouble size={18} className="unit-icon"/></div><div className="table-wrap"><table><thead><tr><th>PATIENT</th><th>RECORD NUMBER</th><th>LOCATION</th><th>ADMITTED</th><th>RECORDED BY</th><th>ACTIONS</th></tr></thead><tbody>{admissions.map(admission=><tr key={admission.id}><td><strong>{admission.firstName} {admission.lastName}</strong></td><td>{admission.recordNumber}</td><td>{admission.wardName} · {admission.bedNumber}</td><td>{new Date(admission.admittedAt).toLocaleString()}</td><td>{admission.admittedBy}</td><td>{['admin','clinician'].includes(user?.role)&&<button type="button" className="text-button archive-action" disabled={saving} onClick={()=>dischargePatient(admission)}>Discharge</button>}</td></tr>)}</tbody></table>{admissions.length===0&&<Empty message="No active inpatient admissions. Create wards and beds, then admit a registered patient."/>}</div></section>
      <section className="panel data-panel inpatient-panel"><div className="panel-heading"><div><h2>Bed inventory</h2><p className="panel-subtitle">Availability is calculated from active admissions</p></div></div><div className="table-wrap"><table><thead><tr><th>WARD</th><th>BED</th><th>STATUS</th><th>PATIENT</th><th>RECORD NUMBER</th></tr></thead><tbody>{beds.map(bed=><tr key={bed.id}><td>{bed.wardName}</td><td><strong>{bed.bedNumber}</strong></td><td>{bed.admissionId?<span className="status waiting">Occupied</span>:user?.role==='admin'?<select className="status-select" value={bed.bedStatus} disabled={saving} aria-label={`Set status for ${bed.wardName} bed ${bed.bedNumber}`} onChange={e=>changeBedStatus(bed,e.target.value)}><option value="available">Available</option><option value="maintenance">Maintenance</option></select>:<span className={`status ${bed.bedStatus==='available'?'confirmed':'cancelled'}`}>{bed.bedStatus==='available'?'Available':'Maintenance'}</span>}</td><td>{bed.admissionId?`${bed.firstName} ${bed.lastName}`:'—'}</td><td>{bed.recordNumber || '—'}</td></tr>)}</tbody></table>{beds.length===0&&<Empty message="No beds configured. An administrator can add a ward and then add its beds."/>}</div></section>
    </>}

    {page === 'Appointments' && <section className="panel data-panel"><PageTools search={search} setSearch={setSearch} placeholder="Search appointments..."/><div className="table-wrap"><table><thead><tr><th>DATE & TIME</th><th>PATIENT</th><th>VISIT</th><th>CLINICIAN</th><th>STATUS</th></tr></thead><tbody>{filteredAppointments.map(a=><tr key={a.id}><td>{a.time}</td><td><strong>{a.name}</strong></td><td>{a.type}</td><td>{a.doctor}</td><td><select className="status-select" aria-label={`Update appointment status for ${a.name}`} value={a.status} onChange={e=>onStatusChanged(a.id,e.target.value)}><option value="Confirmed">Confirmed</option><option value="Waiting">Waiting</option><option value="Checked in">Checked in</option><option value="Completed">Completed</option><option value="Cancelled">Cancelled</option></select></td></tr>)}</tbody></table>{filteredAppointments.length===0&&<Empty message="No appointments found. Add a patient, then schedule a visit."/>}</div></section>}

    {page === 'Patients' && <section className="panel data-panel"><PageTools search={search} setSearch={setSearch} placeholder="Search name or record number..."/><div className="table-wrap"><table><thead><tr><th>PATIENT</th><th>RECORD NUMBER</th><th>DATE OF BIRTH</th><th>PHONE</th><th>EMAIL</th><th>STATUS</th><th>ACTIONS</th></tr></thead><tbody>{filteredPatients.map(p=><tr key={p.id}><td><strong>{p.firstName} {p.lastName}</strong></td><td>{p.recordNumber}</td><td>{p.dateOfBirth ? new Date(`${String(p.dateOfBirth).slice(0,10)}T00:00:00`).toLocaleDateString() : '—'}</td><td>{p.phone || '—'}</td><td>{p.email || '—'}</td><td><span className={`status ${p.status==='active'?'confirmed':'waiting'}`}>{p.status.replace('_',' ')}</span></td><td><div className="row-actions"><button type="button" className="text-button" onClick={()=>{setEditingPatient(p);setError('');}} aria-label={`Edit ${p.firstName} ${p.lastName}`}>Edit</button>{['admin','clinician'].includes(user?.role)&&<button type="button" className="text-button archive-action" disabled={saving} onClick={()=>archivePatient(p)} aria-label={`Archive ${p.firstName} ${p.lastName}`}>Archive</button>}</div></td></tr>)}</tbody></table>{filteredPatients.length===0&&<Empty message="No patient records found."/>}</div></section>}

    {page === 'Care team' && <section className="panel data-panel"><PageTools search={search} setSearch={setSearch} placeholder="Search staff..."/><div className="table-wrap"><table><thead><tr><th>STAFF MEMBER</th><th>ROLE</th><th>DEPARTMENT</th><th>ACCOUNT</th></tr></thead><tbody>{filteredStaff.map(person=><tr key={person.id}><td><div className="patient-cell"><div className="avatar lavender">{person.fullName.split(' ').map(part=>part[0]).slice(0,2).join('').toUpperCase()}</div><strong>{person.fullName}</strong></div></td><td>{person.role}</td><td>{user?.role==='admin'?<select className="status-select" value={person.departmentId || ''} disabled={saving} aria-label={`Assign department for ${person.fullName}`} onChange={e=>assignDepartment(person,e.target.value)}><option value="">Unassigned</option>{departments.map(department=><option key={department.id} value={department.id}>{department.name}</option>)}</select>:person.departmentName || 'Unassigned'}</td><td><span className="status confirmed">Active</span></td></tr>)}</tbody></table>{filteredStaff.length===0&&<Empty message="No active staff accounts found."/>}</div></section>}

    {page === 'Reports' && <section className="panel report-panel"><div className="panel-heading"><div><h2>Appointments by day</h2><p className="panel-subtitle">Saved appointment records, last 7 days</p></div><Activity size={18} className="unit-icon"/></div>{days.length===0?<Empty message="No appointment activity recorded yet."/>:<div className="chart-bars">{days.map(row=>{const count=Number(row.total);const max=Math.max(1,...days.map(d=>Number(d.total)));return <div className="chart-column" key={row.day}><span className="chart-value" title={`${count} appointments`} style={{height:`${Math.max(count ? 8 : 2,count/max*100)}%`}}/><small>{new Date(`${row.day.slice(0,10)}T00:00:00`).toLocaleDateString(undefined,{weekday:'short'})}</small></div>;})}</div>}</section>}

    {page === 'Settings' && <section className="panel settings-panel"><div><h2>Signed in account</h2><p className="panel-subtitle">Sign out when you finish using this shared hospital workstation.</p></div><button className="secondary-button logout-button" onClick={onLogout}>Sign out</button></section>}

    {patientForm && <div className="modal-backdrop" onClick={e=>e.target===e.currentTarget&&setPatientForm(false)}><form className="appointment-modal" onSubmit={createPatient}><div className="modal-title"><div><h2>Register patient</h2><p>Create a patient record in the hospital database.</p></div><button type="button" className="icon-button" onClick={()=>setPatientForm(false)} aria-label="Close">×</button></div><div className="form-row"><label>First name<input name="firstName" required maxLength="80" autoFocus/></label><label>Last name<input name="lastName" required maxLength="80"/></label></div><label>Date of birth<input type="date" name="dateOfBirth"/></label><label>Phone<input type="tel" name="phone" maxLength="40"/></label><label>Email<input type="email" name="email" maxLength="254"/></label>{error&&<p className="form-error">{error}</p>}<div className="modal-actions"><button type="button" className="secondary-button" onClick={()=>setPatientForm(false)}>Cancel</button><button className="primary-button" disabled={saving}>{saving?'Saving...':'Save patient'}</button></div></form></div>}
    {editingPatient && <div className="modal-backdrop" onClick={e=>e.target===e.currentTarget&&!saving&&setEditingPatient(null)}><form className="appointment-modal" onSubmit={updatePatient}><div className="modal-title"><div><h2>Edit patient record</h2><p>{editingPatient.recordNumber} · Update demographic and contact details.</p></div><button type="button" className="icon-button" onClick={()=>setEditingPatient(null)} aria-label="Close" disabled={saving}>×</button></div><div className="form-row"><label>First name<input name="firstName" required maxLength="80" defaultValue={editingPatient.firstName} autoFocus/></label><label>Last name<input name="lastName" required maxLength="80" defaultValue={editingPatient.lastName}/></label></div><label>Date of birth<input type="date" name="dateOfBirth" defaultValue={editingPatient.dateOfBirth ? String(editingPatient.dateOfBirth).slice(0,10) : ''}/></label><label>Phone<input type="tel" name="phone" maxLength="40" defaultValue={editingPatient.phone || ''}/></label><label>Email<input type="email" name="email" maxLength="254" defaultValue={editingPatient.email || ''}/></label>{error&&<p className="form-error">{error}</p>}<div className="modal-actions"><button type="button" className="secondary-button" disabled={saving} onClick={()=>setEditingPatient(null)}>Cancel</button><button className="primary-button" disabled={saving}>{saving?'Saving...':'Save changes'}</button></div></form></div>}
    {inpatientForm && <div className="modal-backdrop" onClick={e=>e.target===e.currentTarget&&!saving&&setInpatientForm('')}><form className="appointment-modal" onSubmit={saveInpatientForm}><div className="modal-title"><div><h2>{inpatientForm==='ward'?'Add ward':inpatientForm==='bed'?'Add bed':'Admit patient'}</h2><p>{inpatientForm==='ward'?'Create a ward or unit for your hospital.':inpatientForm==='bed'?'Add a bed to an existing ward.':'Assign an active patient to an available bed.'}</p></div><button type="button" className="icon-button" onClick={()=>setInpatientForm('')} aria-label="Close" disabled={saving}>×</button></div>
      {inpatientForm==='ward' && <><label>Ward name<input name="name" required minLength="2" maxLength="100" autoFocus placeholder="For example: Medical Ward A"/></label><label>Description<input name="description" maxLength="250" placeholder="Optional unit details"/></label></>}
      {inpatientForm==='bed' && <><label>Ward<select name="wardId" required defaultValue=""><option value="" disabled>Select a ward</option>{wards.map(ward=><option key={ward.id} value={ward.id}>{ward.name}</option>)}</select></label><label>Bed identifier<input name="bedNumber" required maxLength="30" autoFocus placeholder="For example: A-01"/></label></>}
      {inpatientForm==='admit' && <><label>Patient<select name="patientId" required defaultValue=""><option value="" disabled>Select a patient</option>{patients.filter(patient=>!admissions.some(admission=>admission.patientId===patient.id)).map(patient=><option key={patient.id} value={patient.id}>{patient.recordNumber} · {patient.firstName} {patient.lastName}</option>)}</select></label><label>Available bed<select name="bedId" required defaultValue=""><option value="" disabled>Select a bed</option>{beds.filter(bed=>bed.bedStatus==='available'&&!bed.admissionId).map(bed=><option key={bed.id} value={bed.id}>{bed.wardName} · {bed.bedNumber}</option>)}</select></label><p className="panel-subtitle">This records an administrative admission and bed assignment. Follow your hospital’s clinical admission and discharge procedures.</p></>}
      {error&&<p className="form-error" role="alert">{error}</p>}<div className="modal-actions"><button type="button" className="secondary-button" disabled={saving} onClick={()=>setInpatientForm('')}>Cancel</button><button className="primary-button" disabled={saving}>{saving?'Saving...':inpatientForm==='ward'?'Save ward':inpatientForm==='bed'?'Add bed':'Admit patient'}</button></div></form></div>}
    {staffForm && <div className="modal-backdrop" onClick={e=>e.target===e.currentTarget&&setStaffForm(false)}><form className="appointment-modal" onSubmit={createStaff}><div className="modal-title"><div><h2>Add staff account</h2><p>Give this staff member access to the hospital workspace.</p></div><button type="button" className="icon-button" onClick={()=>setStaffForm(false)} aria-label="Close">×</button></div><label>Full name<input name="fullName" required minLength="2" maxLength="120" autoFocus/></label><label>Email<input name="email" type="email" required maxLength="254"/></label><label>Role<select name="role"><option value="clinician">Clinician</option><option value="receptionist">Receptionist</option></select></label><label>Department<select name="departmentId" required defaultValue=""><option value="" disabled>Select a department</option>{departments.map(department=><option key={department.id} value={department.id}>{department.name}</option>)}</select></label><label>Temporary password<input name="password" type="password" minLength="14" required autoComplete="new-password"/><small>At least 14 characters. Share it through a hospital-approved secure channel.</small></label>{error&&<p className="form-error">{error}</p>}{departments.length===0&&<p className="form-error">Create a department before adding staff.</p>}<div className="modal-actions"><button type="button" className="secondary-button" onClick={()=>setStaffForm(false)}>Cancel</button><button className="primary-button" disabled={saving||!departments.length}>{saving?'Saving...':'Create account'}</button></div></form></div>}
    {departmentForm && <div className="modal-backdrop" onClick={e=>e.target===e.currentTarget&&!saving&&setDepartmentForm(false)}><form className="appointment-modal" onSubmit={createDepartment}><div className="modal-title"><div><h2>Add department</h2><p>Create a service line for staff and appointment scheduling.</p></div><button type="button" className="icon-button" onClick={()=>setDepartmentForm(false)} aria-label="Close" disabled={saving}>×</button></div><label>Department name<input name="name" required minLength="2" maxLength="100" autoFocus placeholder="Cardiology"/></label><label>Department code<input name="code" required minLength="2" maxLength="20" pattern="[A-Za-z0-9_-]{2,20}" placeholder="CARDIO"/><small>Use a short unique code with letters, numbers, hyphens, or underscores.</small></label><label>Description<input name="description" maxLength="250" placeholder="Optional service details"/></label>{error&&<p className="form-error">{error}</p>}<div className="modal-actions"><button type="button" className="secondary-button" disabled={saving} onClick={()=>setDepartmentForm(false)}>Cancel</button><button className="primary-button" disabled={saving}>{saving?'Saving...':'Save department'}</button></div></form></div>}
  </div>;
}

function PageTools({search,setSearch,placeholder}) { return <div className="page-tools"><label className="table-search"><Search size={16}/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder={placeholder}/></label></div>; }
function Empty({message}) { return <div className="empty-state">{message}</div>; }
