import express from "express";
import pkg from "pg";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import cors from "cors";
import dotenv from "dotenv";
import fetch from "node-fetch";
import path from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";

const { Pool } = pkg;
const app = express();

app.set('trust proxy', 1);

// ======== AUTH TABLE CONFIG (para Postgres "puro") ========
// Ajuste via .env (recomendado):
// AUTH_USERS_TABLE=public.users
// AUTH_USERS_ID_COL=id
// AUTH_USERS_EMAIL_COL=email
// AUTH_USERS_PASSWORD_COL=encrypted_password (ou password_hash)
//
// Importante: os nomes abaixo precisam ser identificadores simples (sem espaço, sem aspas).
const AUTH_USERS_TABLE = process.env.AUTH_USERS_TABLE || "auth.users";
const AUTH_USERS_ID_COL = process.env.AUTH_USERS_ID_COL || "id";
const AUTH_USERS_EMAIL_COL = process.env.AUTH_USERS_EMAIL_COL || "email";
const AUTH_USERS_PASSWORD_COL =
  process.env.AUTH_USERS_PASSWORD_COL || "encrypted_password";

function assertIdent(name) {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(String(name || ""))) {
    throw new Error(`Ident inválido: ${name}`);
  }
  return String(name);
}

function qIdent(v) {
  return `"${String(v).replace(/"/g, '""')}"`;
}

function parseSchemaTable(v) {
  const raw = String(v || "").trim();
  const parts = raw.split(".");
  if (parts.length !== 2) {
    throw new Error("AUTH_USERS_TABLE deve ser no formato schema.tabela");
  }
  const [schema, table] = parts;
  return { schema: assertIdent(schema), table: assertIdent(table) };
}

function usersTableSql() {
  const { schema, table } = parseSchemaTable(AUTH_USERS_TABLE);
  return `${qIdent(schema)}.${qIdent(table)}`;
}

function idColSql() {
  return qIdent(assertIdent(AUTH_USERS_ID_COL));
}

function emailColSql() {
  return qIdent(assertIdent(AUTH_USERS_EMAIL_COL));
}

function passwordColSql() {
  return qIdent(assertIdent(AUTH_USERS_PASSWORD_COL));
}

// ======== CORRIGE __dirname (ESM) ========
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, "..", ".env") });

console.log("[zelony-api] Iniciando...");

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || 'http://localhost:5173';
const SERVE_FRONTEND = String(process.env.SERVE_FRONTEND || 'false').toLowerCase() === 'true';

// ======== JSON GRANDE ========
app.use(express.json({ limit: "50mb" }));

// ======== CORS ========
app.use(
  cors({
    origin: CLIENT_ORIGIN.split(',').map((o) => o.trim()).filter(Boolean),
    methods: ["GET", "POST"],
    credentials: true,
  })
);

// ======== DATABASE ========
const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASS,
  port: Number(process.env.DB_PORT || 5432),
});

const AUDIT_ALLOWED_VIEWERS = new Set(
  String(process.env.AUDIT_VIEWERS || process.env.ADMIN_EMAILS || "luanbiagioni@gmail.com")
    .split(",")
    .map((e) => e.toLowerCase().trim())
    .filter(Boolean)
);

const normalizeEmail = (v) => String(v || "").trim().toLowerCase();

const ADMIN_EMAILS = new Set(
  String(process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((s) => normalizeEmail(s))
    .filter(Boolean)
);

async function ensureAuditTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS platform_audit_logs (
      id BIGSERIAL PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      actor_email TEXT NOT NULL,
      actor_role TEXT,
      action TEXT NOT NULL,
      statement_owner TEXT,
      details JSONB NOT NULL DEFAULT '{}'::jsonb,
      ip TEXT,
      user_agent TEXT
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_platform_audit_logs_created_at
    ON platform_audit_logs (created_at DESC)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_platform_audit_logs_actor_email
    ON platform_audit_logs (actor_email)
  `);
}

async function ensureUsersTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS platform_users (
      id UUID PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      role TEXT NOT NULL DEFAULT 'analyst',
      must_change_password BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_platform_users_role
    ON platform_users (role)
  `);
}

async function ensureAuthSchema() {
  await pool.query(`CREATE SCHEMA IF NOT EXISTS auth`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS auth.users (
      id UUID PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      encrypted_password TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function seedAdminIfConfigured() {
  const email = process.env.SEED_ADMIN_EMAIL?.trim();
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!email || !password) {
    console.log("[seed] SEED_ADMIN_* não definido — pulando criação de admin");
    return;
  }

  const normalized = normalizeEmail(email);
  const hash = await bcrypt.hash(String(password), 10);
  const id = randomUUID();

  await pool.query(
    `INSERT INTO auth.users (id, email, encrypted_password)
     VALUES ($1, $2, $3)
     ON CONFLICT (email) DO UPDATE SET encrypted_password = EXCLUDED.encrypted_password`,
    [id, normalized, hash],
  );

  const { rows } = await pool.query(
    "SELECT id FROM auth.users WHERE email = $1 LIMIT 1",
    [normalized],
  );
  const userId = rows[0]?.id || id;

  await pool.query(
    `INSERT INTO platform_users (id, email, role, must_change_password)
     VALUES ($1, $2, 'admin', false)
     ON CONFLICT (email) DO UPDATE SET role = 'admin', must_change_password = false`,
    [userId, normalized],
  );

  console.log("[seed] Admin pronto:", normalized);
}

async function ensurePlatformUser({ id, email }) {
  const normalized = normalizeEmail(email);
  if (!id || !normalized) return;
  const role = ADMIN_EMAILS.has(normalized) ? "admin" : "analyst";
  await pool.query(
    `
      INSERT INTO platform_users (id, email, role)
      VALUES ($1, $2, $3)
      ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email
    `,
    [id, normalized, role]
  );
}

function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET não definido no .env");
  return secret;
}

async function getRoleByUserId(userId) {
  const { rows } = await pool.query(
    "SELECT role FROM platform_users WHERE id = $1 LIMIT 1",
    [userId]
  );
  return rows?.[0]?.role || null;
}

function requireAuth(req, res, next) {
  try {
    const auth = req.headers.authorization || "";
    const token = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length) : "";
    if (!token) return res.status(401).json({ error: "Missing bearer token" });
    const decoded = jwt.verify(token, getJwtSecret());
    req.user = decoded;
    return next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

async function requireAdmin(req, res, next) {
  try {
    const userId = req.user?.user_id;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    const role = await getRoleByUserId(userId);
    if (role !== "admin") return res.status(403).json({ error: "Forbidden" });
    return next();
  } catch (err) {
    return res.status(500).json({ error: "Falha ao validar permissões" });
  }
}

async function writeAuditLog({
  actorEmail,
  actorRole = "",
  action,
  statementOwner = "",
  details = {},
  ip = "",
  userAgent = "",
}) {
  const email = normalizeEmail(actorEmail);
  if (!email || !action) return;
  await pool.query(
    `
      INSERT INTO platform_audit_logs
      (actor_email, actor_role, action, statement_owner, details, ip, user_agent)
      VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)
    `,
    [
      email,
      String(actorRole || "").slice(0, 40),
      String(action || "").slice(0, 80),
      String(statementOwner || "").slice(0, 160),
      JSON.stringify(details || {}),
      String(ip || "").slice(0, 120),
      String(userAgent || "").slice(0, 400),
    ]
  );
}

// ======== LOGIN ========
async function handleLogin(req, res) {
  const { email, senha } = req.body;

  try {
    const normalizedEmail = normalizeEmail(email);
    const { rows } = await pool.query(
      `SELECT
         ${idColSql()} as id,
         ${emailColSql()} as email,
         ${passwordColSql()} as password
       FROM ${usersTableSql()}
       WHERE ${emailColSql()} = $1
       LIMIT 1`,
      [normalizedEmail]
    );

    const user = rows[0];

    if (!user) {
      return res.status(401).json({ error: "Usuário não encontrado" });
    }

    const match = await bcrypt.compare(
      senha,
      user.password
    );

    if (!match) {
      return res.status(401).json({ error: "Senha inválida" });
    }

    await ensurePlatformUser({ id: user.id, email: user.email });
    const platformRole = await getRoleByUserId(user.id);

    const token = jwt.sign(
      {
        user_id: user.id,
        email: user.email,
        role: platformRole || "analyst",
      },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    return res.json({ token });
  } catch (err) {
    console.error("Erro no login:", err);
    const debug = String(process.env.DEBUG_ERRORS || "").toLowerCase() === "true";
    if (debug) {
      return res.status(500).json({
        error: "Erro no servidor",
        detail: err?.message || String(err),
      });
    }
    return res.status(500).json({ error: "Erro no servidor" });
  }
}

app.post("/login", handleLogin);
app.post("/api/login", handleLogin);

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "zelony-api" });
});

app.get("/api/me", requireAuth, async (req, res) => {
  try {
    const userId = req.user?.user_id;
    const email = req.user?.email;
    if (!userId || !email) return res.status(401).json({ error: "Unauthorized" });

    await ensurePlatformUser({ id: userId, email });
    const role = await getRoleByUserId(userId);

    return res.json({ user: { id: userId, email }, role });
  } catch (err) {
    return res.status(500).json({ error: "Falha ao carregar usuário" });
  }
});

app.post("/api/admin-users", requireAuth, async (req, res) => {
  const action = req.body?.action;

  try {
    // Qualquer usuário logado pode trocar a própria senha
    if (action === "update-password") {
      const userId = req.user?.user_id;
      const { new_password } = req.body || {};
      if (!userId) return res.status(401).json({ error: "Unauthorized" });
      if (!new_password || String(new_password).length < 8) {
        return res.status(400).json({ error: "Senha deve ter no mínimo 8 caracteres" });
      }

      const encrypted = await bcrypt.hash(String(new_password), 10);
      await pool.query(
        `UPDATE ${usersTableSql()}
         SET ${passwordColSql()} = $1
         WHERE ${idColSql()} = $2`,
        [encrypted, userId]
      );
      await pool.query(
        "UPDATE platform_users SET must_change_password = false WHERE id = $1",
        [userId]
      );

      return res.json({ ok: true });
    }

    // Ações abaixo exigem admin
    const userId = req.user?.user_id;
    const role = await getRoleByUserId(userId);
    if (role !== "admin") return res.status(403).json({ error: "Forbidden: Only admins can manage users" });

    if (action === "list") {
      const { rows } = await pool.query(
        `
          SELECT id, email, role, created_at, must_change_password
          FROM platform_users
          ORDER BY created_at DESC
        `
      );
      return res.json({ users: rows });
    }

    if (action === "create") {
      const email = normalizeEmail(req.body?.email);
      const password = String(req.body?.password || "");
      const newRole = req.body?.role === "admin" ? "admin" : "analyst";

      if (!email || !password || password.length < 8) {
        return res.status(400).json({ error: "Invalid email or short password (min 8)" });
      }

      const id = randomUUID();
      const encrypted = await bcrypt.hash(password, 10);

      // Inserção compatível com seu login (usa auth.users + bcrypt compare)
      await pool.query(
        `INSERT INTO ${usersTableSql()} (${idColSql()}, ${emailColSql()}, ${passwordColSql()})
         VALUES ($1, $2, $3)`,
        [id, email, encrypted]
      );

      await pool.query(
        `
          INSERT INTO platform_users (id, email, role, must_change_password)
          VALUES ($1, $2, $3, $4)
          ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, role = EXCLUDED.role
        `,
        [id, email, newRole, true]
      );

      return res.json({ ok: true, user: { id, email, role: newRole } });
    }

    if (action === "delete") {
      const targetId = req.body?.user_id;
      if (!targetId) return res.status(400).json({ error: "Missing user_id" });
      if (targetId === userId) return res.status(400).json({ error: "Cannot delete yourself" });

      await pool.query("DELETE FROM platform_users WHERE id = $1", [targetId]);
      await pool.query(
        `DELETE FROM ${usersTableSql()} WHERE ${idColSql()} = $1`,
        [targetId]
      );

      return res.json({ ok: true });
    }

    return res.status(400).json({ error: "Unknown action" });
  } catch (err) {
    console.error("Erro /api/admin-users:", err);
    return res.status(400).json({ error: err?.message || "Falha ao processar ação" });
  }
});

// ======== CONFIG GEMINI ========
const GEMINI_KEY = process.env.GEMINI_PAID_KEY;

const MAX_429_RETRIES = 5;
const MAX_429_WAIT_MS = 60_000;
const MAX_PROXY_REQUEST_MS = 300_000;

// ======== UTIL ========
function elapsedMs(startedAt) {
  return Date.now() - startedAt;
}

function parseRetryDelayMsFromGoogle(data) {
  const details = data?.error?.details;
  if (!Array.isArray(details)) return null;

  for (const d of details) {
    const type = String(d?.["@type"] || "");
    if (!type.includes("RetryInfo")) continue;

    const retryDelay = d?.retryDelay;
    if (!retryDelay) continue;

    const match = String(retryDelay).match(/^(\d+(?:\.\d+)?)s$/i);
    if (match) {
      return Math.min(180000, parseFloat(match[1]) * 1000);
    }
  }

  return null;
}

// ======== GEMINI PROXY (COMPATÍVEL COM SEU FRONT) ========
app.post("/api/proxy-gemini", async (req, res) => {
  const startedAt = Date.now();
  const actorEmail = req.headers["x-actor-email"];
  const actorRole = req.headers["x-actor-role"];
  const statementOwner = req.headers["x-statement-owner"];
  const fileName = req.headers["x-file-name"];
  const requestBytes = Buffer.byteLength(JSON.stringify(req.body || {}), "utf8");

  if (!GEMINI_KEY) {
    return res.status(500).json({
      error: "GEMINI_PAID_KEY não definida no .env",
    });
  }

  // 🔥 AQUI ESTÁ A CORREÇÃO PRINCIPAL
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}`;

  try {
    const retryMode = String(process.env.GEMINI_RETRY_MODE || "retry").toLowerCase();
    const maxAttempts = retryMode === "failfast" ? 1 : MAX_429_RETRIES;

    const isRetryable = (status, data) => {
      if (status === 429) return true;
      // 503/502/504 acontecem bastante quando a API está em fila ou instável
      if (status === 503 || status === 502 || status === 504) return true;
      const msg =
        typeof data?.error === "object" && data.error?.message
          ? String(data.error.message)
          : typeof data?.error === "string"
          ? data.error
          : "";
      return /unavailable|overloaded|timeout|gateway|temporar/i.test(String(msg).toLowerCase());
    };

    let lastStatus = 500;
    let lastMessage = "Erro Gemini";

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      await new Promise((r) => setTimeout(r, 500));

      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(req.body),
      });

      const data = await response.json().catch(() => ({}));

      if (response.ok) {
        writeAuditLog({
          actorEmail,
          actorRole,
          action: "gemini_proxy_call",
          statementOwner,
          details: {
            status: response.status,
            attempts: attempt + 1,
            duration_ms: elapsedMs(startedAt),
            request_bytes: requestBytes,
            file_name: fileName || "",
          },
          ip: req.ip,
          userAgent: req.headers["user-agent"] || "",
        }).catch((err) =>
          console.error("Falha ao gravar auditoria (proxy sucesso):", err?.message || err)
        );
        return res.json(data);
      }

      lastStatus = response.status;
      lastMessage =
        typeof data.error === "object" && data.error?.message
          ? data.error.message
          : typeof data.error === "string"
          ? data.error
          : "Erro Gemini";

      const shouldRetry = isRetryable(response.status, data);

      if (shouldRetry && attempt < maxAttempts - 1) {
        if (elapsedMs(startedAt) > MAX_PROXY_REQUEST_MS) {
          res.setHeader("Retry-After", "90");
          return res.status(response.status).json({
            error:
              "Fila/instabilidade da API Gemini. Tente novamente em 1-2 minutos.",
          });
        }

        const fromGoogle = parseRetryDelayMsFromGoogle(data);

        const suggested =
          fromGoogle ??
          Math.min(MAX_429_WAIT_MS, 9000 * Math.pow(1.7, attempt));

        const backoff = Math.min(MAX_429_WAIT_MS, suggested);
        const jitter = Math.random() * 4000;

        const remainingBudget = Math.max(
          0,
          MAX_PROXY_REQUEST_MS - elapsedMs(startedAt)
        );

        const waitMs = Math.max(
          0,
          Math.min(Math.round(backoff + jitter), remainingBudget)
        );

        if (waitMs <= 500) {
          res.setHeader("Retry-After", "90");
          return res.status(response.status).json({
            error:
              "Fila/limite temporário da API. Aguarde cerca de 90 segundos.",
          });
        }

        console.warn(
          `[proxy-gemini] ${response.status} tentativa ${
            attempt + 1
          }/${maxAttempts} - aguardando ${Math.round(
            waitMs / 1000
          )}s`
        );

        await new Promise((r) => setTimeout(r, waitMs));
        continue;
      }

      if (response.status === 429 || response.status === 503) {
        res.setHeader("Retry-After", "120");
      }

      return res.status(response.status).json({ error: lastMessage });
    }

    if (lastStatus === 429 || lastStatus === 503) {
      res.setHeader("Retry-After", "120");
    }

    return res.status(lastStatus).json({ error: lastMessage });
  } catch (err) {
    console.error("Erro no proxy Gemini:", err.message);
    writeAuditLog({
      actorEmail,
      actorRole,
      action: "gemini_proxy_error",
      statementOwner,
      details: {
        duration_ms: elapsedMs(startedAt),
        request_bytes: requestBytes,
        file_name: fileName || "",
        error: err.message,
      },
      ip: req.ip,
      userAgent: req.headers["user-agent"] || "",
    }).catch((auditErr) =>
      console.error("Falha ao gravar auditoria (proxy erro):", auditErr?.message || auditErr)
    );

    return res.status(500).json({
      error: "Erro interno no proxy",
      detail: err.message,
    });
  }
});

app.post("/api/audit-logs", async (req, res) => {
  try {
    const actorEmail = req.headers["x-actor-email"] || req.body?.actor_email;
    const actorRole = req.headers["x-actor-role"] || req.body?.actor_role;
    const action = req.body?.action;
    const statementOwner = req.body?.statement_owner;
    const details = req.body?.details || {};

    if (!actorEmail || !action) {
      return res.status(400).json({ error: "actor_email e action são obrigatórios." });
    }

    await writeAuditLog({
      actorEmail,
      actorRole,
      action,
      statementOwner,
      details,
      ip: req.ip,
      userAgent: req.headers["user-agent"] || "",
    });

    return res.json({ ok: true });
  } catch (err) {
    console.error("Erro ao gravar log de auditoria:", err.message);
    return res.status(500).json({ error: "Falha ao gravar auditoria." });
  }
});

app.get("/api/audit-logs", async (req, res) => {
  try {
    const viewerEmail = normalizeEmail(req.headers["x-user-email"] || req.query.viewer_email);
    if (!AUDIT_ALLOWED_VIEWERS.has(viewerEmail)) {
      return res.status(403).json({ error: "Acesso negado aos logs de auditoria." });
    }

    const rawLimit = Number(req.query.limit || 100);
    const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(rawLimit, 500)) : 100;

    const { rows } = await pool.query(
      `
        SELECT
          id,
          created_at,
          actor_email,
          actor_role,
          action,
          statement_owner,
          details,
          ip,
          user_agent
        FROM platform_audit_logs
        ORDER BY created_at DESC
        LIMIT $1
      `,
      [limit]
    );

    return res.json({ logs: rows });
  } catch (err) {
    console.error("Erro ao listar logs de auditoria:", err.message);
    return res.status(500).json({ error: "Falha ao buscar auditoria." });
  }
});

// ======== FRONTEND (opcional em produção) ========
if (SERVE_FRONTEND) {
  const distPath = path.join(__dirname, "dist");
  app.use(express.static(distPath));
  app.use((req, res) => {
    res.sendFile(path.join(distPath, "index.html"));
  });
}

// ======== SERVER ========
ensureAuthSchema()
  .then(() => ensureAuditTable())
  .then(() => ensureUsersTable())
  .then(() => seedAdminIfConfigured())
  .then(() => {
    app.listen(PORT, HOST, () => {
      console.log(`Zelony API: http://${HOST}:${PORT}`);
      console.log(`Auditoria: /api/audit-logs`);
    });
  })
  .catch((err) => {
    console.error("Falha ao iniciar API:", err.message);
    console.error(err);
    process.exit(1);
  });