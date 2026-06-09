import { google } from 'googleapis';

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/userinfo.email',
];

export function createOAuthClient() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;

  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error('Configure GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET e GOOGLE_REDIRECT_URI no .env');
  }

  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

export function getAuthUrl() {
  const oauth2Client = createOAuthClient();
  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: SCOPES,
  });
}

export async function exchangeCodeForTokens(code) {
  const oauth2Client = createOAuthClient();
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;
  const { tokens } = await oauth2Client.getToken({ code, redirect_uri: redirectUri });
  oauth2Client.setCredentials(tokens);
  return tokens;
}

export async function getUserEmail(tokens) {
  const oauth2Client = createOAuthClient();
  oauth2Client.setCredentials(tokens);
  const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
  const { data } = await oauth2.userinfo.get();
  return data.email ?? null;
}

function applyTemplate(template, nome) {
  return template.replaceAll('{nome}', nome);
}

function encodeSubject(subject) {
  return `=?utf-8?B?${Buffer.from(subject).toString('base64')}?=`;
}

function buildRawEmail({ to, subject, html }) {
  const emailLines = [
    `To: ${to}`,
    'Content-Type: text/html; charset=utf-8',
    'MIME-Version: 1.0',
    `Subject: ${encodeSubject(subject)}`,
    '',
    html,
  ];

  return Buffer.from(emailLines.join('\n'))
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export async function sendBulkEmails({
  tokens,
  recipients,
  subjectTemplate,
  htmlTemplate,
  delayMs = 5000,
  onProgress,
}) {
  const oauth2Client = createOAuthClient();
  oauth2Client.setCredentials(tokens);
  const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

  const results = [];

  for (let i = 0; i < recipients.length; i++) {
    const { nome, email } = recipients[i];
    const subject = applyTemplate(subjectTemplate, nome);
    const html = applyTemplate(htmlTemplate, nome);

    try {
      await gmail.users.messages.send({
        userId: 'me',
        requestBody: {
          raw: buildRawEmail({ to: email, subject, html }),
        },
      });

      const result = { index: i + 1, nome, email, ok: true };
      results.push(result);
      onProgress?.(result);
    } catch (err) {
      const result = {
        index: i + 1,
        nome,
        email,
        ok: false,
        error: err.message ?? 'Erro desconhecido',
      };
      results.push(result);
      onProgress?.(result);
    }

    if (i < recipients.length - 1 && delayMs > 0) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }

  return results;
}
