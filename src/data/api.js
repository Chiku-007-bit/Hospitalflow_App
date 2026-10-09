async function request(path, options = {}) {
  const response = await fetch(`/api${path}`, {
    credentials: 'same-origin',
    ...options,
    headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers },
  });
  if (response.status === 204) return null;
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401) window.dispatchEvent(new Event('careflow:session-expired'));
    throw new Error(body.error || 'The request could not be completed');
  }
  return body;
}

export const api = {
  me: () => request('/auth/me'),
  login: (email, password) => request('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  logout: () => request('/auth/logout', { method: 'POST' }),
  dashboard: () => request('/dashboard'),
  patients: (q = '') => request(`/patients${q ? `?q=${encodeURIComponent(q)}` : ''}`),
  createPatient: patient => request('/patients', { method: 'POST', body: JSON.stringify(patient) }),
  updatePatient: (id, patient) => request(`/patients/${id}`, { method: 'PATCH', body: JSON.stringify(patient) }),
  archivePatient: id => request(`/patients/${id}/archive`, { method: 'POST' }),
  appointments: () => request('/appointments'),
  staff: () => request('/staff'),
  createStaff: staff => request('/staff', { method: 'POST', body: JSON.stringify(staff) }),
  assignStaffDepartment: (id, departmentId) => request(`/staff/${id}/department`, { method: 'PATCH', body: JSON.stringify({ departmentId }) }),
  activityReport: () => request('/reports/activity'),
  createAppointment: appointment => request('/appointments', { method: 'POST', body: JSON.stringify(appointment) }),
  setAppointmentStatus: (id, status) => request(`/appointments/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }),
  wards: () => request('/wards'),
  createWard: ward => request('/wards', { method: 'POST', body: JSON.stringify(ward) }),
  createBed: (wardId, bed) => request(`/wards/${wardId}/beds`, { method: 'POST', body: JSON.stringify(bed) }),
  setBedStatus: (id, status) => request(`/beds/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }),
  departments: () => request('/departments'),
  createDepartment: department => request('/departments', { method: 'POST', body: JSON.stringify(department) }),
  beds: () => request('/beds'),
  admissions: () => request('/admissions'),
  admitPatient: admission => request('/admissions', { method: 'POST', body: JSON.stringify(admission) }),
  dischargePatient: id => request(`/admissions/${id}/discharge`, { method: 'POST' }),
};
