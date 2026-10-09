import 'dotenv/config';
import pg from 'pg';
import bcrypt from 'bcryptjs';
import { z } from 'zod';

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: true } : undefined });
const input = z.object({ email: z.string().email().max(254), name: z.string().trim().min(2).max(120), password: z.string().min(14).max(200) }).safeParse({ email: process.env.ADMIN_EMAIL, name: process.env.ADMIN_NAME, password: process.env.ADMIN_PASSWORD });
if (!input.success) {
  console.error('Set ADMIN_EMAIL, ADMIN_NAME, and a unique ADMIN_PASSWORD of at least 14 characters in .env.');
  process.exitCode = 1;
} else {
  try {
    const hash = await bcrypt.hash(input.data.password, 12);
    await pool.query(`INSERT INTO staff_users(email,full_name,password_hash,role) VALUES(lower($1),$2,$3,'admin') ON CONFLICT(email) DO NOTHING`, [input.data.email,input.data.name,hash]);
    console.log('Admin account created if it did not already exist. Remove ADMIN_PASSWORD from .env now.');
  } catch { console.error('Could not create admin account. Run the database migration first.'); process.exitCode = 1; }
}
await pool.end();
