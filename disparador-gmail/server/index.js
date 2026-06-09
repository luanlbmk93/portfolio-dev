import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

import cookieParser from 'cookie-parser';
import cors from 'cors';
import dotenv from 'dotenv';
import express from 'express';
import session from 'express-session';

import { parseRecipients } from './lib/parseRecipients.js';
import {
  exchangeCodeForTokens,
  getAuthUrl,
  getUserEmail,
  sendBulkEmails,
} from './lib/gmail.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const PORT = Number(process.env.PORT || 3100);
const BASE_PATH = (process.env.BASE_PATH || '/disparador-gmail').replace(/\/$/, '');
const SESSION_SECRET = process.env.SESSION_SECRET || 'troque-isso-em-producao';
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || '';
const CLIENT_DIST = path.resolve(__dirname, '../client/dist');

const app = express();

app.set('trust proxy', 1);

app.use(
  cors({
    origin: CLIENT_ORIGIN || true,
    credentials: true,
  }),
);
app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());
app.use(
  session({
    name: 'disparador.sid',
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: BASE_PATH || '/',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    },
  }),
);

function requireAuth(req, res, next) {
  if (!req.session.tokens) {
    return res.status(401).json({ error: 'Conecte sua conta Google primeiro.' });
  }
  next();
}

const api = express.Router();

api.get('/health', (_req, res) => {
  res.json({ ok: true, basePath: BASE_PATH });
});

api.get('/auth/status', async (req, res) => {
  if (!req.session.tokens) {
    return res.json({ connected: false });
  }

  try {
    const email = req.session.userEmail ?? (await getUserEmail(req.session.tokens));
    req.session.userEmail = email;
    res.json({ connected: true, email });
  } catch {
    req.session.tokens = null;
    req.session.userEmail = null;
    res.json({ connected: false });
  }
});

api.get('/auth/google', (_req, res) => {
  try {
    const url = getAuthUrl();
    res.json({ url });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

api.get('/auth/callback', async (req, res) => {
  const { code, error } = req.query;

  if (error) {
    return res.redirect(`${BASE_PATH}/?auth=error`);
  }

  if (!code || typeof code !== 'string') {
    return res.redirect(`${BASE_PATH}/?auth=missing_code`);
  }

  try {
    const tokens = await exchangeCodeForTokens(code);
    req.session.tokens = tokens;
    req.session.userEmail = await getUserEmail(tokens);
    res.redirect(`${BASE_PATH}/?auth=success`);
  } catch {
    res.redirect(`${BASE_PATH}/?auth=error`);
  }
});

api.post('/auth/logout', (req, res) => {
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});

api.post('/send', requireAuth, async (req, res) => {
  const { subject, htmlTemplate, recipientsText, delayMs } = req.body ?? {};

  if (!subject?.trim()) {
    return res.status(400).json({ error: 'Informe o assunto do email.' });
  }

  if (!htmlTemplate?.trim()) {
    return res.status(400).json({ error: 'Informe o HTML do email.' });
  }

  if (!recipientsText?.trim()) {
    return res.status(400).json({ error: 'Informe a lista de destinatários.' });
  }

  const { recipients, errors } = parseRecipients(recipientsText);

  if (errors.length) {
    return res.status(400).json({ error: errors.join('\n') });
  }

  if (!recipients.length) {
    return res.status(400).json({ error: 'Nenhum destinatário válido encontrado.' });
  }

  const delay = Number.isFinite(Number(delayMs)) ? Math.max(0, Number(delayMs)) : 5000;

  try {
    const results = await sendBulkEmails({
      tokens: req.session.tokens,
      recipients,
      subjectTemplate: subject.trim(),
      htmlTemplate: htmlTemplate.trim(),
      delayMs: delay,
    });

    const sent = results.filter((r) => r.ok).length;
    const failed = results.length - sent;

    res.json({
      total: results.length,
      sent,
      failed,
      results,
    });
  } catch (err) {
    res.status(500).json({ error: err.message ?? 'Falha ao enviar emails.' });
  }
});

app.use(`${BASE_PATH}/api`, api);

if (fs.existsSync(CLIENT_DIST)) {
  app.use(BASE_PATH, express.static(CLIENT_DIST));
  app.get(`${BASE_PATH}/*`, (_req, res) => {
    res.sendFile(path.join(CLIENT_DIST, 'index.html'));
  });
}

app.get('/', (_req, res) => {
  res.type('text').send(
    `API do Disparador Gmail em ${BASE_PATH}/api/health\n` +
      'Portfolio e Separador são servidos pelo Nginx (estático).',
  );
});

app.listen(PORT, () => {
  console.log(`Disparador API: http://0.0.0.0:${PORT}${BASE_PATH}/api/health`);
  if (fs.existsSync(CLIENT_DIST)) {
    console.log(`Frontend dev/local: http://0.0.0.0:${PORT}${BASE_PATH}/`);
  }
});
