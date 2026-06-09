/**
 * Parseia linhas no formato: Nome Completo, email@dominio.com
 */
export function parseRecipients(text) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const recipients = [];
  const errors = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const commaIndex = line.lastIndexOf(',');

    if (commaIndex === -1) {
      errors.push(`Linha ${i + 1}: use "Nome, email@exemplo.com"`);
      continue;
    }

    const nome = line.slice(0, commaIndex).trim();
    const email = line.slice(commaIndex + 1).trim();

    if (!nome) {
      errors.push(`Linha ${i + 1}: nome vazio`);
      continue;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errors.push(`Linha ${i + 1}: email inválido (${email})`);
      continue;
    }

    recipients.push({ nome, email });
  }

  return { recipients, errors };
}
