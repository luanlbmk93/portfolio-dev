import { useCallback, useEffect, useState } from 'react';
import {
  connectSmtp,
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
  const [oauthEnabled, setOauthEnabled] = useState(false);
  const [loadingAuth, setLoadingAuth] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [sending, setSending] = useState(false);
  const [alert, setAlert] = useState<Alert | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [sendSummary, setSendSummary] = useState<SendResult | null>(null);

  const [gmailEmail, setGmailEmail] = useState('');
  const [appPassword, setAppPassword] = useState('');

  const [subject, setSubject] = useState(DEFAULT_SUBJECT);
  const [htmlTemplate, setHtmlTemplate] = useState(DEFAULT_HTML);
  const [recipientsText, setRecipientsText] = useState(DEFAULT_RECIPIENTS);
  const [delayMs, setDelayMs] = useState(5000);

  const refreshAuth = useCallback(async (retries = 0) => {
    setLoadingAuth(true);
    try {
      for (let attempt = 0; attempt <= retries; attempt += 1) {
        const status = await getAuthStatus();
        setAuth(status);
        setOauthEnabled(Boolean(status.oauthEnabled));
        if (status.connected || attempt === retries) break;
        await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
      }
    } catch {
      setAuth({ connected: false });
    } finally {
      setLoadingAuth(false);
    }
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const authParam = params.get('auth');

    if (authParam === 'success') {
      setAlert({ type: 'success', message: 'Conta Google conectada com sucesso!' });
      window.history.replaceState({}, '', window.location.pathname);
      refreshAuth(4);
    } else if (authParam === 'error') {
      const reason = params.get('reason');
      setAlert({
        type: 'error',
        message: reason
          ? `OAuth falhou: ${decodeURIComponent(reason)}. Use o mesmo Gmail cadastrado em Usuários de teste.`
          : 'OAuth falhou. Entre com um Gmail que está em Usuários de teste no Google Cloud.',
      });
      window.history.replaceState({}, '', window.location.pathname);
      refreshAuth();
    } else {
      refreshAuth();
    }
  }, [refreshAuth]);

  async function handleSmtpConnect(e: React.FormEvent) {
    e.preventDefault();
    setConnecting(true);
    setAlert(null);
    try {
      const result = await connectSmtp({ email: gmailEmail, appPassword });
      setAuth({ connected: true, email: result.email });
      setAppPassword('');
      setAlert({ type: 'success', message: `Conectado: ${result.email}` });
    } catch (err) {
      setAlert({
        type: 'error',
        message: err instanceof Error ? err.message : 'Erro ao conectar.',
      });
    } finally {
      setConnecting(false);
    }
  }

  async function handleOAuthConnect() {
    setConnecting(true);
    setAlert(null);
    try {
      await startGoogleAuth();
    } catch (err) {
      setAlert({
        type: 'error',
        message: err instanceof Error ? err.message : 'Erro ao iniciar OAuth.',
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
          Cada pessoa conecta <strong>sua própria conta Gmail</strong> e envia com o limite dela
          (~500/dia). Cole a lista e o HTML do email.
        </p>
      </header>

      {alert && <div className={`alert alert-${alert.type}`}>{alert.message}</div>}

      <section className="card">
        <div className="auth-bar">
          <div>
            <h2>Sua conta Gmail</h2>
            <p className="hint">
              Modo teste Google: use <strong>Conectar com Google</strong> com um email que está em
              Usuários de teste no Console.
            </p>
          </div>
        </div>

        {loadingAuth ? (
          <p className="hint">Verificando...</p>
        ) : auth.connected ? (
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <span className="auth-status connected">Conectado: {auth.email}</span>
            <button type="button" className="btn-secondary" onClick={handleLogout}>
              Desconectar
            </button>
          </div>
        ) : (
          <>
            <div className="actions" style={{ marginTop: 0 }}>
              <button
                type="button"
                className="btn-google"
                onClick={handleOAuthConnect}
                disabled={connecting || !oauthEnabled}
              >
                Conectar com Google
              </button>
            </div>
            {!oauthEnabled && (
              <p className="hint" style={{ color: '#ffb4bb' }}>
                OAuth não configurado no servidor (.env com Client ID Web).
              </p>
            )}
            <details style={{ marginTop: 16 }}>
              <summary className="hint" style={{ cursor: 'pointer' }}>
                Alternativa: senha de app (sem OAuth)
              </summary>
              <form onSubmit={handleSmtpConnect} className="auth-form">
                <div className="field-row">
                  <label htmlFor="gmail">Seu Gmail</label>
                  <input
                    id="gmail"
                    type="email"
                    value={gmailEmail}
                    onChange={(e) => setGmailEmail(e.target.value)}
                    placeholder="seu@gmail.com"
                    required
                  />
                </div>
                <div className="field-row">
                  <label htmlFor="appPassword">Senha de app (16 caracteres)</label>
                  <input
                    id="appPassword"
                    type="password"
                    value={appPassword}
                    onChange={(e) => setAppPassword(e.target.value)}
                    placeholder="xxxx xxxx xxxx xxxx"
                    autoComplete="off"
                    required
                  />
                </div>
                <div className="actions">
                  <button type="submit" className="btn-primary" disabled={connecting}>
                    {connecting ? 'Conectando...' : 'Conectar com senha de app'}
                  </button>
                </div>
              </form>
            </details>
          </>
        )}
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
