export interface Lead {
  id: number;
  fullName: string;
  firstName: string;
  phone: string;
  email: string;
}

const DEFAULT_TEMPLATE =
  "Olá, [nome] tudo bem? Aqui no meu sistema consta um interesse seu na aquisição do imóvel próprio 100% financiado. Correto?";

const TEMPLATE_KEY = "whatsapp-leads-template";
const CLICKED_KEY = "whatsapp-leads-clicked";

export function getDefaultTemplate(): string {
  return DEFAULT_TEMPLATE;
}

export function loadTemplate(): string {
  return localStorage.getItem(TEMPLATE_KEY) ?? DEFAULT_TEMPLATE;
}

export function saveTemplate(template: string): void {
  localStorage.setItem(TEMPLATE_KEY, template);
}

export function getFirstName(fullName: string): string {
  const trimmed = fullName.trim();
  if (!trimmed) return "Cliente";
  return trimmed.split(/\s+/)[0];
}

export function formatPhoneForWhatsApp(phone: string | number): string | null {
  const digits = String(phone).replace(/\D/g, "");
  if (!digits) return null;

  if (digits.startsWith("55") && digits.length >= 12) {
    return digits;
  }

  if (digits.length === 10 || digits.length === 11) {
    return `55${digits}`;
  }

  if (digits.length >= 12) {
    return digits;
  }

  return null;
}

export function buildMessage(template: string, firstName: string): string {
  return template.replace(/\[nome\]/gi, firstName);
}

export function buildWhatsAppUrl(phone: string, message: string): string {
  return `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
}

export function previewMessage(template: string, sampleName = "Maria"): string {
  return buildMessage(template, sampleName);
}

export function loadClickedPhones(): Set<string> {
  try {
    const raw = localStorage.getItem(CLICKED_KEY);
    if (!raw) return new Set();
    return new Set(JSON.parse(raw) as string[]);
  } catch {
    return new Set();
  }
}

export function saveClickedPhones(phones: Set<string>): void {
  localStorage.setItem(CLICKED_KEY, JSON.stringify([...phones]));
}

export function markPhoneClicked(
  phones: Set<string>,
  phone: string,
): Set<string> {
  const next = new Set(phones);
  next.add(phone);
  saveClickedPhones(next);
  return next;
}
