const API = '/disparador-gmail/api';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    ...init,
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(data.error ?? `Erro ${res.status}`);
  }

  return data as T;
}

export type AuthStatus = { connected: boolean; email?: string };

export type SendResult = {
  total: number;
  sent: number;
  failed: number;
  results: Array<{
    index: number;
    nome: string;
    email: string;
    ok: boolean;
    error?: string;
  }>;
};

export function getAuthStatus() {
  return request<AuthStatus>('/auth/status');
}

export async function startGoogleAuth() {
  const { url } = await request<{ url: string }>('/auth/google');
  window.location.href = url;
}

export function logout() {
  return request<{ ok: boolean }>('/auth/logout', { method: 'POST' });
}

export function sendEmails(body: {
  subject: string;
  htmlTemplate: string;
  recipientsText: string;
  delayMs: number;
}) {
  return request<SendResult>('/send', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}
