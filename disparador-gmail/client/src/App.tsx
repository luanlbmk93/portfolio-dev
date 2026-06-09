import { useCallback, useEffect, useState } from 'react';
import {
  getAuthStatus,
  logout,
  sendEmails,
  startGoogleAuth,
  type SendResult,
} from './api';
import { DEFAULT_HTML, DEFAULT_RECIPIENTS, DEFAULT_SUBJECT } from './defaults';

type Alert = { type: 'error' | 'success' | 'info'; message: string };

export default function App() {
  const [auth, setAuth] = useState<{ connected: boolean; email?: string }>({
    connected: false,
  });
  const [loadingAuth, setLoadingAuth] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [sending, setSending] = useState(false);
  const [alert, setAlert] = useState<Alert | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [sendSummary, setSendSummary] = useState<SendResult | null>(null);

  const [subject, setSubject] = useState(DEFAULT_SUBJECT);
  const [htmlTemplate, setHtmlTemplate] = useState(DEFAULT_HTML);
  const [recipientsText, setRecipientsText] = useState(DEFAULT_RECIPIENTS);
  const [delayMs, setDelayMs] = useState(5000);

  const refreshAuth = useCallback(async () => {
    setLoadingAuth(true);
    try {
      const status = await getAuthStatus();
      setAuth(status);
    } catch {
      setAuth({ connected: false });
    } finally {
      setLoadingAuth(false);
    }
  }, []);

  useEffect(() => {
    refreshAuth();

    const params = new URLSearchParams(window.location.search);
    const authParam = params.get('auth');

    if (authParam === 'success') {
      setAlert({ type: 'success', message: 'Conta Google conectada com sucesso!' });
      window.history.replaceState({}, '', window.location.pathname);
      refreshAuth();
    } else if (authParam === 'error') {
      setAlert({ type: 'error', message: 'Falha ao conectar com o Google. Tente novamente.' });
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, [refreshAuth]);

  async function handleConnect() {
    setConnecting(true);
    setAlert(null);
    try {
      await startGoogleAuth();
    } catch (err) {
      setAlert({
        type: 'error',
        message: err instanceof Error ? err.message : 'Erro ao iniciar login.',
      });
      setConnecting(false);
    }
  }

  async function handleLogout() {
    await logout();
    setAuth({ connected: false });
    setSendSummary(null);
    setLogs([]);
    setAlert({ type: 'info', message: 'Desconectado.' });
  }

  async function handleSend() {
    setSending(true);
    setAlert(null);
    setLogs([]);
    setSendSummary(null);

    try {
      const result = await sendEmails({
        subject,
        htmlTemplate,
        recipientsText,
        delayMs,
      });

      setSendSummary(result);
      setLogs(
        result.results.map((r) =>
          r.ok
            ? `[${r.index}] OK — ${r.nome} <${r.email}>`
            : `[${r.index}] ERRO — ${r.email}: ${r.error}`,
        ),
      );
      setAlert({
        type: result.failed ? 'error' : 'success',
        message: `Envio concluído: ${result.sent}/${result.total} enviados${result.failed ? `, ${result.failed} falharam` : ''}.`,
      });
    } catch (err) {
      setAlert({
        type: 'error',
        message: err instanceof Error ? err.message : 'Erro ao enviar.',
      });
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="layout">
      <header className="header">
        <h1>Disparador Gmail</h1>
        <p>
          Conecte sua conta Google, cole a lista de destinatários e o HTML do email.
          Cada pessoa envia pela própria conta — sem usar credencial fixa no servidor.
        </p>
      </header>

      {alert && <div className={`alert alert-${alert.type}`}>{alert.message}</div>}

      <section className="card">
        <div className="auth-bar">
          <div>
            <h2>Conta Google</h2>
            <p className="hint">OAuth 2.0 — o email sai da conta conectada.</p>
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {loadingAuth ? (
              <span className="auth-status">Verificando...</span>
            ) : auth.connected ? (
              <>
                <span className="auth-status connected">Conectado: {auth.email}</span>
                <button type="button" className="btn-secondary" onClick={handleLogout}>
                  Desconectar
                </button>
              </>
            ) : (
              <button
                type="button"
                className="btn-google"
                onClick={handleConnect}
                disabled={connecting}
              >
                Conectar com Google
              </button>
            )}
          </div>
        </div>
      </section>

      <div className="field-row">
        <label htmlFor="subject">Assunto (use {'{nome}'} para personalizar)</label>
        <input
          id="subject"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder="Assunto do email"
        />
      </div>

      <div className="grid-2">
        <section className="card">
          <h2>HTML do email</h2>
          <p className="hint">
            Cole o HTML completo. Use <code>{'{nome}'}</code> onde quiser o nome da pessoa.
          </p>
          <textarea
            value={htmlTemplate}
            onChange={(e) => setHtmlTemplate(e.target.value)}
            spellCheck={false}
            rows={22}
          />
        </section>

        <section className="card">
          <h2>Lista de destinatários</h2>
          <p className="hint">Um por linha: Nome, email@exemplo.com</p>
          <textarea
            value={recipientsText}
            onChange={(e) => setRecipientsText(e.target.value)}
            spellCheck={false}
            rows={22}
            placeholder={'Maria Silva, maria@gmail.com\nJoão Souza, joao@gmail.com'}
          />
        </section>
      </div>

      <div className="field-row">
        <label htmlFor="delay">Intervalo entre envios (ms)</label>
        <input
          id="delay"
          type="number"
          min={0}
          step={500}
          value={delayMs}
          onChange={(e) => setDelayMs(Number(e.target.value))}
        />
      </div>

      <div className="actions">
        <button
          type="button"
          className="btn-primary"
          onClick={handleSend}
          disabled={!auth.connected || sending}
        >
          {sending ? 'Enviando...' : 'Disparar emails'}
        </button>
      </div>

      {(logs.length > 0 || sendSummary) && (
        <section className="card" style={{ marginTop: 18 }}>
          <h2>Log de envio</h2>
          <div className="log-box">
            {logs.map((line) => (
              <div
                key={line}
                className={`log-line ${line.includes('OK') ? 'ok' : line.includes('ERRO') ? 'fail' : ''}`}
              >
                {line}
              </div>
            ))}
          </div>
        </section>
      )}

      <div className="footer-links">
        <a href="/">Portfolio</a>
        {' · '}
        <a href="/separadorpdf/">PDF Tools</a>
      </div>
    </div>
  );
}
