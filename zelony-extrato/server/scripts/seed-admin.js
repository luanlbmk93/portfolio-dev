import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import bcrypt from 'bcrypt';
import pkg from 'pg';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '..', '.env') });

const { Pool } = pkg;

async function main() {
  const email = process.env.SEED_ADMIN_EMAIL?.trim();
  const password = process.env.SEED_ADMIN_PASSWORD;

  console.log('[seed] DB_HOST=%s DB_NAME=%s', process.env.DB_HOST, process.env.DB_NAME);

  if (!email || !password) {
    console.error('[seed] ERRO: defina SEED_ADMIN_EMAIL e SEED_ADMIN_PASSWORD no .env');
    console.error('[seed] No container: docker compose exec api printenv SEED_ADMIN_EMAIL');
    process.exit(1);
  }

  const pool = new Pool({
    user: process.env.DB_USER || 'zelony',
    host: process.env.DB_HOST || 'postgres',
    database: process.env.DB_NAME || 'zelony_extrato',
    password: process.env.DB_PASS || 'zelony',
    port: Number(process.env.DB_PORT || 5432),
  });

  try {
    const normalized = email.toLowerCase();
    const hash = await bcrypt.hash(String(password), 10);
    const id = randomUUID();

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
       ON CONFLICT (email) DO UPDATE SET role = 'admin', must_change_password = false`,
      [userId, normalized],
    );

    console.log('[seed] OK — admin:', normalized);
  } catch (err) {
    console.error('[seed] ERRO:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
