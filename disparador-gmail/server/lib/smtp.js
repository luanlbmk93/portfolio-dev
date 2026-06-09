import nodemailer from 'nodemailer';

function applyTemplate(template, nome) {
  return template.replaceAll('{nome}', nome);
}

export function createTransporter(email, appPassword) {
  return nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: {
      user: email,
      pass: appPassword.replace(/\s/g, ''),
    },
  });
}

export async function verifySmtpCredentials(email, appPassword) {
  const transporter = createTransporter(email, appPassword);
  await transporter.verify();
  return transporter;
}

export async function sendBulkEmailsSmtp({
  email,
  appPassword,
  recipients,
  subjectTemplate,
  htmlTemplate,
  delayMs = 5000,
}) {
  const transporter = createTransporter(email, appPassword);
  const results = [];

  for (let i = 0; i < recipients.length; i++) {
    const { nome, email: to } = recipients[i];
    const subject = applyTemplate(subjectTemplate, nome);
    const html = applyTemplate(htmlTemplate, nome);

    try {
      await transporter.sendMail({
        from: email,
        to,
        subject,
        html,
      });

      results.push({ index: i + 1, nome, email: to, ok: true });
    } catch (err) {
      results.push({
        index: i + 1,
        nome,
        email: to,
        ok: false,
        error: err.message ?? 'Erro desconhecido',
      });
    }

    if (i < recipients.length - 1 && delayMs > 0) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }

  return results;
}
