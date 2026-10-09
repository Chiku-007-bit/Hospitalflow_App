import { useEffect, useMemo, useState } from 'react';
import {
  Activity, Building2, CalendarDays, ChevronDown,
  Clock3, LayoutDashboard, Menu, MoreHorizontal, Plus, Search, Settings,
  ShieldCheck, Stethoscope, Users, BedDouble, ArrowUpRight, X,
} from 'lucide-react';
import WorkspacePage from './pages/WorkspacePage.jsx';
import StatCard from './components/StatCard.jsx';
import Login from './pages/Login.jsx';
import { api } from './data/api.js';

const navGroups = [
  { label: 'WORKSPACE', items: [{ name: 'Overview', icon: LayoutDashboard }, { name: 'Appointments', icon: CalendarDays }, { name: 'Patients', icon: Users }, { name: 'Admissions', icon: BedDouble }, { name: 'Care team', icon: Stethoscope }] },
  { label: 'MANAGEMENT', items: [{ name: 'Departments', icon: Building2 }, { name: 'Reports', icon: Activity }] },
];

function App() {
  const [active, setActive] = useState('Overview');
  const [query, setQuery] = useState('');
  const [appointments, setAppointments] = useState([]);
  const [patients, setPatients] = useState([]);
  const [staff, setStaff] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [dashboard, setDashboard] = useState({ totalPatients: 0, appointmentsToday: 0 });
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [modal, setModal] = useState(false);
  const [selectedDepartmentId, setSelectedDepartmentId] = useState('');
  const [mobileNav, setMobileNav] = useState(false);
  const [notice, setNotice] = useState('');
  const today = new Date();
  const filtered = useMemo(() => appointments.filter(a => `${a.name} ${a.type} ${a.doctor}`.toLowerCase().includes(query.toLowerCase())), [appointments, query]);

  useEffect(() => {
    api.me().then(({ user: current }) => setUser(current)).catch(() => setUser(null)).finally(() => setAuthLoading(false));
    const expired = () => setUser(null);
    window.addEventListener('careflow:session-expired', expired);
    return () => window.removeEventListener('careflow:session-expired', expired);
  }, []);

  useEffect(() => {
    if (!user) return;
    let mounted = true;
    Promise.all([api.dashboard(), api.patients(), api.staff(), api.appointments(), api.departments()]).then(([dashboardData, patientData, staffData, appointmentData, departmentData]) => {
      if (!mounted) return;
      setDashboard(dashboardData);
      setAppointments(appointmentData.appointments.map(toAppointment));
      setPatients(patientData.patients);
      setStaff(staffData.staff);
      setDepartments(departmentData.departments);
    }).catch(error => setNotice(error.message));
    return () => { mounted = false; };
  }, [user]);

  async function login(email, password) {
    const result = await api.login(email, password);
    setUser(result.user);
  }
  async function logout() {
    try { await api.logout(); } finally { setUser(null); setAppointments([]); setPatients([]); }
  }
  async function createPatient(patient) {
    const result = await api.createPatient(patient);
    setPatients(current => [result.patient, ...current]);
    setNotice(`Patient registered: ${result.patient.recordNumber}`);
  }
  async function updatePatient(id, patient) {
    const result = await api.updatePatient(id, patient);
    setPatients(current => current.map(item => item.id === id ? result.patient : item));
    setNotice(`Patient record updated: ${result.patient.recordNumber}`);
  }
  async function archivePatient(id) {
    await api.archivePatient(id);
    setPatients(current => current.filter(item => item.id !== id));
    const dashboardData = await api.dashboard();
    setDashboard(dashboardData);
    setNotice('Patient record archived');
  }
  async function createStaffMember(member) {
    const result = await api.createStaff(member);
    const staffMember = { ...result.staffMember, departmentName: departments.find(department => department.id === result.staffMember.departmentId)?.name || '' };
    setStaff(current => [...current, staffMember].sort((a,b)=>a.fullName.localeCompare(b.fullName)));
    setNotice(`Staff account created for ${result.staffMember.fullName}`);
  }
  async function createDepartment(department) {
    const result = await api.createDepartment(department);
    setDepartments(current => [...current, result.department].sort((a,b)=>a.name.localeCompare(b.name)));
    setNotice(`Department created: ${result.department.name}`);
  }
  async function assignStaffDepartment(id, departmentId) {
    await api.assignStaffDepartment(id, departmentId);
    const departmentName = departments.find(department => department.id === departmentId)?.name || '';
    setStaff(current => current.map(member => member.id === id ? { ...member, departmentId, departmentName } : member));
    setNotice('Staff department assignment saved');
  }
  async function changeAppointmentStatus(id, label) {
    const status = ({ 'Confirmed':'confirmed', 'Waiting':'waiting', 'Checked in':'checked_in', 'Completed':'completed', 'Cancelled':'cancelled' })[label];
    try { await api.setAppointmentStatus(id, status); const [dashboardData, appointmentData] = await Promise.all([api.dashboard(), api.appointments()]); setDashboard(dashboardData); setAppointments(appointmentData.appointments.map(toAppointment)); setNotice('Appointment status saved'); }
    catch (error) { setNotice(error.message); }
  }

  async function addAppointment(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      const localStart = `${form.get('date')}T${form.get('time')}`;
      await api.createAppointment({ patientId: form.get('patientId'), clinicianId: form.get('clinicianId') || null, departmentId: form.get('departmentId'), startsAt: new Date(localStart).toISOString(), appointmentType: form.get('type') });
      const [dashboardData, appointmentData] = await Promise.all([api.dashboard(), api.appointments()]);
      setDashboard(dashboardData); setAppointments(appointmentData.appointments.map(toAppointment)); setModal(false); setSelectedDepartmentId(''); setNotice('Appointment saved');
    } catch (error) { setNotice(error.message); }
  }

  if (authLoading) return <main className="login-screen"><div className="login-loading">Loading secure workspace...</div></main>;
  if (!user) return <Login onLogin={login}/>;

  return <div className="app-shell">
    <aside className={`sidebar ${mobileNav ? 'sidebar-open' : ''}`}>
      <div className="brand"><div className="brand-mark"><Activity size={20} strokeWidth={2.8}/></div><span>careflow</span><button className="mobile-close icon-button" onClick={() => setMobileNav(false)} aria-label="Close menu"><X size={19}/></button></div>
      <button className="hospital-switch"><div className="hospital-icon"><ShieldCheck size={18}/></div><span className="switch-copy"><strong>Hospital workspace</strong><small>Patient care operations</small></span><ChevronDown size={16}/></button>
      <div className="nav-scroll">{navGroups.map(group => <div className="nav-group" key={group.label}><p className="nav-label">{group.label}</p>{group.items.map(item => <button key={item.name} onClick={() => { setActive(item.name); setMobileNav(false); }} className={`nav-item ${active === item.name ? 'active' : ''}`}><item.icon size={18}/><span>{item.name}</span>{item.count && <span className="nav-count">{item.count}</span>}</button>)}</div>)}
        <div className="nav-group"><p className="nav-label">PREFERENCES</p><button className={`nav-item ${active === 'Settings' ? 'active' : ''}`} onClick={() => setActive('Settings')}><Settings size={18}/><span>Settings</span></button></div>
      </div>
      <div className="sidebar-bottom"><div className="profile"><div className="avatar user-avatar">{user.fullName.split(' ').map(part=>part[0]).slice(0,2).join('').toUpperCase()}</div><div className="profile-copy"><strong>{user.fullName}</strong><small>{user.role}</small></div><button className="more-button" onClick={logout} aria-label="Sign out"><MoreHorizontal size={19}/></button></div></div>
    </aside>
    {mobileNav && <button aria-label="Close navigation" className="scrim" onClick={() => setMobileNav(false)} />}
    <main className="main-area"><header className="topbar"><button className="mobile-menu icon-button" onClick={() => setMobileNav(true)} aria-label="Open menu"><Menu/></button><div className="breadcrumbs"><span>Workspace</span><span className="crumb-divider">/</span><strong>{active}</strong></div><div className="top-actions"><span className="signed-in-name">{user.fullName}</span><button className="top-avatar" onClick={() => setActive('Settings')} aria-label="Account settings">{user.fullName.split(' ').map(part=>part[0]).slice(0,2).join('').toUpperCase()}</button></div></header>
      <div className="content">{active === 'Overview' ? <><div className="welcome-row"><div><p className="eyebrow">{today.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</p><h1>Welcome, {user.fullName}</h1><p className="subtitle">Live patient and appointment records for your hospital.</p></div><button className="primary-button" onClick={() => {setSelectedDepartmentId('');setModal(true);}}><Plus size={17}/> New appointment</button></div>
        <section className="stats-grid" aria-label="Hospital statistics"><StatCard icon={Users} tint="purple" label="Active patients" value={dashboard.totalPatients} change="Live count" detail="from patient records" neutral/><StatCard icon={CalendarDays} tint="blue" label="Appointments today" value={dashboard.appointmentsToday} change="Live count" detail="from scheduled visits" neutral/><StatCard icon={BedDouble} tint="orange" label="Upcoming this week" value={dashboard.upcomingThisWeek || 0} change="Next 7 days" detail="excluding cancellations" neutral/><StatCard icon={Activity} tint="green" label="Completed today" value={dashboard.completedToday || 0} change="Live count" detail="marked completed" neutral/></section>
        <section className="middle-grid"><div className="panel schedule-panel"><div className="panel-heading"><div><h2>Today’s schedule</h2><p className="panel-subtitle">Your appointments for today</p></div><button className="text-button" onClick={() => setActive('Appointments')}>View all <ArrowUpRight size={15}/></button></div><div className="schedule-date"><div className="date-square"><strong>{today.getDate()}</strong><span>{today.toLocaleDateString('en-US', { month: 'short' })}</span></div><div className="date-text"><strong>{today.toLocaleDateString('en-US', { weekday: 'long' })}</strong><span>{dashboard.appointmentsToday} appointments scheduled</span></div></div><div className="appointment-list">{appointments.filter(a=>new Date(a.startsAt).toDateString()===today.toDateString()).slice(0, 4).map((a, i) => <div className="timeline-row" key={`${a.id}-${i}`}><div className="timeline-time">{a.time}</div><div className="timeline-line"><i/></div><div className="appointment-info"><div className={`avatar ${a.color}`}>{a.initials}</div><div className="appointment-copy"><strong>{a.name}</strong><span>{a.type}</span></div><span className={`status ${a.status.toLowerCase().replace(' ', '-')}`}>{a.status}</span></div></div>)}{!appointments.some(a=>new Date(a.startsAt).toDateString()===today.toDateString())&&<div className="empty-state">No appointments scheduled for today.</div>}</div></div>
          <div className="panel occupancy-panel"><div className="panel-heading"><div><h2>Care team accounts</h2><p className="panel-subtitle">Active staff with workspace access</p></div><Users size={19} className="unit-icon"/></div><div className="occupancy-number"><strong>{staff.length}</strong></div><p className="occupancy-caption">Active staff accounts</p><div className="department-list">{['admin','clinician','receptionist'].map(role=><div key={role}><span>{role}</span><b>{staff.filter(member=>member.role===role).length}</b></div>)}</div><button className="text-button" onClick={()=>setActive('Care team')}>View care team <ArrowUpRight size={15}/></button></div></section>
        <section className="panel appointments-panel"><div className="panel-heading appointment-heading"><div><h2>Appointment records</h2><p className="panel-subtitle">Visits currently stored in the hospital database</p></div><div className="table-tools"><label className="table-search"><Search size={16}/><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search patients..."/></label><button className="filter-button" onClick={() => setActive('Appointments')}>Manage visits <ArrowUpRight size={14}/></button></div></div><div className="table-wrap"><table><thead><tr><th>DATE & TIME</th><th>PATIENT</th><th>APPOINTMENT</th><th>CLINICIAN</th><th>STATUS</th><th></th></tr></thead><tbody>{filtered.map((a, i) => <tr key={`${a.id}-${i}`}><td className="time-cell"><Clock3 size={14}/>{a.time}</td><td><div className="patient-cell"><div className={`avatar ${a.color}`}>{a.initials}</div><strong>{a.name}</strong></div></td><td>{a.type}</td><td>{a.doctor}</td><td><span className={`status ${a.status.toLowerCase().replace(' ', '-')}`}><i/>{a.status}</span></td><td><button className="row-more" aria-label={`More options for ${a.name}`}><MoreHorizontal size={18}/></button></td></tr>)}</tbody></table>{filtered.length === 0 && <div className="empty-state">No appointment records found.</div>}</div><button className="mobile-view-all" onClick={() => setActive('Appointments')}>View appointment records <ArrowUpRight size={15}/></button></section>
        <footer className="footer"><span>© {today.getFullYear()} Careflow</span><span>Staff access only <ShieldCheck size={14}/></span></footer>
      </> : <WorkspacePage page={active} appointments={appointments} patients={patients} staff={staff} departments={departments} user={user} onAddAppointment={() => {setSelectedDepartmentId('');setModal(true);}} onPatientAdded={createPatient} onPatientUpdated={updatePatient} onPatientArchived={archivePatient} onStaffAdded={createStaffMember} onDepartmentAdded={createDepartment} onStaffDepartmentChanged={assignStaffDepartment} onStatusChanged={changeAppointmentStatus} onLogout={logout}/>}</div></main>
    {modal && <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && setModal(false)}><form className="appointment-modal" onSubmit={addAppointment}><div className="modal-title"><div><h2>New appointment</h2><p>Save a visit to the hospital schedule.</p></div><button type="button" className="icon-button" onClick={() => setModal(false)} aria-label="Close"><X size={19}/></button></div><label>Patient<select name="patientId" required defaultValue=""><option value="" disabled>Select a patient</option>{patients.map(patient=><option key={patient.id} value={patient.id}>{patient.recordNumber} · {patient.firstName} {patient.lastName}</option>)}</select></label><label>Appointment type<input name="type" required maxLength="120"/></label><div className="form-row"><label>Department<select name="departmentId" required value={selectedDepartmentId} onChange={e=>setSelectedDepartmentId(e.target.value)}><option value="" disabled>Select a department</option>{departments.map(department=><option key={department.id} value={department.id}>{department.name}</option>)}</select></label><label>Date<input name="date" type="date" required defaultValue={localDate(today)}/></label></div><div className="form-row"><label>Clinician<select name="clinicianId" defaultValue=""><option value="">Unassigned</option>{staff.filter(member=>member.role==='clinician'&&member.departmentId===selectedDepartmentId).map(member=><option key={member.id} value={member.id}>{member.fullName}</option>)}</select></label><label>Time<input name="time" type="time" defaultValue="12:00" required/></label></div><div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setModal(false)}>Cancel</button><button className="primary-button" type="submit" disabled={!patients.length||!departments.length}><Plus size={16}/> Add appointment</button></div>{!patients.length&&<p className="form-error">Register a patient before scheduling an appointment.</p>}{patients.length>0&&!departments.length&&<p className="form-error">An administrator must create a department first.</p>}</form></div>}
    {notice && <div className="toast"><ShieldCheck size={17}/>{notice}<button onClick={() => setNotice('')} aria-label="Dismiss"><X size={15}/></button></div>}
  </div>;
}

function toAppointment(row) {
  const statuses = { confirmed:'Confirmed', waiting:'Waiting', checked_in:'Checked in', completed:'Completed', cancelled:'Cancelled' };
  const name = `${row.firstName} ${row.lastName}`;
  return { ...row, name, time: new Date(row.startsAt).toLocaleString(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}), initials: name.split(/\s+/).map(x=>x[0]).join('').slice(0,2).toUpperCase(), color:'lavender', type:row.appointmentType, doctor:row.clinicianName || row.department, status:statuses[row.status] || row.status };
}
function localDate(date) { const adjusted = new Date(date.getTime() - date.getTimezoneOffset() * 60000); return adjusted.toISOString().slice(0,10); }

export default App;
