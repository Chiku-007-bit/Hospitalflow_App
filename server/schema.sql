CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS departments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE CHECK (char_length(code) BETWEEN 2 AND 20),
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS departments_name_lower_idx ON departments (lower(name));

CREATE TABLE IF NOT EXISTS staff_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'clinician', 'receptionist')),
  department_id UUID REFERENCES departments(id),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE staff_users ADD COLUMN IF NOT EXISTS department_id UUID REFERENCES departments(id);
CREATE UNIQUE INDEX IF NOT EXISTS staff_users_email_lower_idx ON staff_users (lower(email));

CREATE TABLE IF NOT EXISTS patients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  record_number TEXT NOT NULL UNIQUE DEFAULT ('PT-' || upper(substr(encode(gen_random_bytes(8), 'hex'), 1, 8))),
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  date_of_birth DATE,
  phone TEXT,
  email TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'follow_up', 'archived')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS patients_name_idx ON patients (lower(last_name), lower(first_name));

CREATE TABLE IF NOT EXISTS appointments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL REFERENCES patients(id),
  clinician_id UUID REFERENCES staff_users(id),
  starts_at TIMESTAMPTZ NOT NULL,
  department TEXT NOT NULL,
  department_id UUID REFERENCES departments(id),
  appointment_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'waiting', 'checked_in', 'completed', 'cancelled')),
  created_by UUID NOT NULL REFERENCES staff_users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS department_id UUID REFERENCES departments(id);
INSERT INTO departments(code,name)
SELECT DISTINCT ON (lower(trim(department))) 'LEGACY_' || substr(md5(lower(trim(department))),1,8), trim(department)
FROM appointments WHERE trim(department) <> '' ORDER BY lower(trim(department))
ON CONFLICT DO NOTHING;
UPDATE appointments a SET department_id=d.id FROM departments d WHERE a.department_id IS NULL AND lower(trim(a.department))=lower(d.name);
CREATE INDEX IF NOT EXISTS appointments_department_idx ON appointments (department_id, starts_at DESC);
CREATE INDEX IF NOT EXISTS appointments_starts_at_idx ON appointments (starts_at);
CREATE INDEX IF NOT EXISTS appointments_patient_idx ON appointments (patient_id, starts_at DESC);

CREATE TABLE IF NOT EXISTS audit_events (
  id BIGSERIAL PRIMARY KEY,
  actor_id UUID REFERENCES staff_users(id),
  action TEXT NOT NULL,
  resource TEXT NOT NULL,
  resource_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_events_created_at_idx ON audit_events (created_at DESC);

CREATE TABLE IF NOT EXISTS wards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS beds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ward_id UUID NOT NULL REFERENCES wards(id),
  bed_number TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'maintenance')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (ward_id, bed_number)
);
CREATE INDEX IF NOT EXISTS beds_ward_idx ON beds (ward_id, bed_number);

CREATE TABLE IF NOT EXISTS admissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL REFERENCES patients(id),
  bed_id UUID NOT NULL REFERENCES beds(id),
  admitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  admitted_by UUID NOT NULL REFERENCES staff_users(id),
  discharged_at TIMESTAMPTZ,
  discharged_by UUID REFERENCES staff_users(id),
  status TEXT NOT NULL DEFAULT 'admitted' CHECK (status IN ('admitted', 'discharged')),
  CHECK ((status = 'admitted' AND discharged_at IS NULL) OR (status = 'discharged' AND discharged_at IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS admissions_one_active_bed_idx ON admissions (bed_id) WHERE status = 'admitted';
CREATE UNIQUE INDEX IF NOT EXISTS admissions_one_active_patient_idx ON admissions (patient_id) WHERE status = 'admitted';
CREATE INDEX IF NOT EXISTS admissions_active_idx ON admissions (admitted_at DESC) WHERE status = 'admitted';
