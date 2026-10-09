# Careflow hospital workspace

This app stores patient and appointment records in PostgreSQL. It starts with an empty database; there are no seeded patient records.

## Local setup (Windows / VS Code)

Requirements: Node.js 20.19 or newer, npm, and PostgreSQL 15 or newer. Docker Desktop is an optional way to run PostgreSQL locally.

1. Copy `.env.example` to `.env`. Set a unique database password and a random `SESSION_SECRET` (at least 32 characters). Keep `.env` private and out of source control. Update the password in `DATABASE_URL` to match `POSTGRES_PASSWORD`.
2. Start PostgreSQL. With Docker Desktop installed, from PowerShell run `docker compose up -d db`. Otherwise, start your local PostgreSQL service and create a database and user matching `DATABASE_URL`.
3. In the project folder run `npm install`.
4. Run `npm run db:migrate` to create the tables.
5. Create the first administrator. In PowerShell, set temporary environment values and then run the script:

   ```powershell
   $env:ADMIN_EMAIL = 'your-admin@hospital.example'
   $env:ADMIN_NAME = 'Hospital Administrator'
   $env:ADMIN_PASSWORD = 'use-a-unique-password-of-14-or-more-characters'
   npm run db:create-admin
   Remove-Item Env:ADMIN_EMAIL, Env:ADMIN_NAME, Env:ADMIN_PASSWORD
   ```

6. Run `npm run dev` and open the Vite URL printed in the terminal. The first administrator can create clinician and receptionist accounts from **Care team**.

## What is connected

- Staff login uses a server-side PostgreSQL session and hashed passwords.
- Admins can maintain a department directory and assign staff to departments; appointment scheduling uses that directory and only offers clinicians assigned to the selected department.
- Patient registration and search, appointment creation and status changes, staff account listing, and reports use the database API.
- Inpatient operations include ward setup, bed inventory, patient admission, bed status management, and discharge records. Active admissions enforce one patient per bed and one bed per patient in PostgreSQL.
- Patient, appointment, bed, and admission reads or changes create audit events. API queries use parameterized SQL.
- The app never seeds fictional patient information.

After updating to a version that adds database tables, stop the development server and run `npm run db:migrate` before starting it again. For initial setup, sign in as an administrator and add departments first. Assign clinicians to departments under **Care team**; create additional staff there. Appointments then use the department directory. For inpatient setup, open **Admissions**, create a ward, add its beds, and admit an existing active patient. Admins and clinicians can record discharge; only admins can manage department and ward/bed inventory.

## Before entering real patient information

This source code is a starting implementation, not a certification or a complete hospital deployment. Use it only after the hospital’s IT/security team has reviewed authentication, access policies, backups and recovery, monitoring, encryption at rest, HTTPS, hosting, and the privacy requirements that apply in the hospital’s location. Use a managed PostgreSQL service with TLS for shared or hosted deployments; set `NODE_ENV=production`, `PGSSL=true`, `APP_ORIGIN` to the HTTPS origin, and use a strong secret. Configure `HOSPITAL_TIMEZONE` to the hospital’s IANA timezone. Do not put real patient data in source files, screenshots, logs, or support messages.
