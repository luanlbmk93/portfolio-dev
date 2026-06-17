import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import bcrypt from 'bcrypt';
import pkg from 'pg';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '..', '.env') });

const { Pool } = pkg;

const email = process.env.SEED_ADMIN_EMAIL;
const password = process.env.SEED_ADMIN_PASSWORD;

if (!email || !password) {
  console.error('Defina SEED_ADMIN_EMAIL e SEED_ADMIN_PASSWORD no .env');
  process.exit(1);
}

const pool = new Pool({
  user: process.env.DB_USER || 'zelony',
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'zelony_extrato',
  password: process.env.DB_PASS || 'zelony',
  port: Number(process.env.DB_PORT || 5432),
});

const id = randomUUID();
const normalized = email.toLowerCase().trim();
const hash = await bcrypt.hash(password, 10);

await pool.query(
  `INSERT INTO auth.users (id, email, encrypted_password)
   VALUES ($1, $2, $3)
   ON CONFLICT (email) DO UPDATE SET encrypted_password = EXCLUDED.encrypted_password`,
  [id, normalized, hash],
);

const { rows } = await pool.query('SELECT id FROM auth.users WHERE email = $1', [normalized]);
const userId = rows[0]?.id || id;

await pool.query(
  `INSERT INTO platform_users (id, email, role, must_change_password)
   VALUES ($1, $2, 'admin', false)
   ON CONFLICT (email) DO UPDATE SET role = 'admin'`,
  [userId, normalized],
);

console.log(`Admin pronto: ${normalized}`);
await pool.end();
