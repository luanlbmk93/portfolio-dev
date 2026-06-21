import { useCallback, useEffect, useMemo, useState } from "react";
import { parseLeadsFromFile } from "./parseLeads";
import {
  buildMessage,
  buildWhatsAppUrl,
  getDefaultTemplate,
  loadClickedPhones,
  loadTemplate,
  markPhoneClicked,
  previewMessage,
  saveTemplate,
  type Lead,
} from "./utils";

function WhatsAppIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.435 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
    </svg>
  );
}

export default function App() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [fileName, setFileName] = useState("");
  const [template, setTemplate] = useState(loadTemplate);
  const [search, setSearch] = useState("");
  const [clickedPhones, setClickedPhones] = useState(loadClickedPhones);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    saveTemplate(template);
  }, [template]);

  const filteredLeads = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return leads;

    return leads.filter(
      (lead) =>
        lead.fullName.toLowerCase().includes(term) ||
        lead.firstName.toLowerCase().includes(term) ||
        lead.phone.includes(term) ||
        lead.email.toLowerCase().includes(term),
    );
  }, [leads, search]);

  const clickedCount = useMemo(
    () => leads.filter((lead) => clickedPhones.has(lead.phone)).length,
    [leads, clickedPhones],
  );

  const handleFile = useCallback(async (file: File | undefined) => {
    if (!file) return;

    setLoading(true);
    setError("");

    try {
      const parsed = await parseLeadsFromFile(file);
      setLeads(parsed);
      setFileName(file.name);
      setSearch("");
    } catch (err) {
      setLeads([]);
      setFileName("");
      setError(err instanceof Error ? err.message : "Erro ao importar arquivo.");
    } finally {
      setLoading(false);
    }
  }, []);

  const openWhatsApp = useCallback(
    (lead: Lead) => {
      setClickedPhones((current) => markPhoneClicked(current, lead.phone));

      const message = buildMessage(template, lead.firstName);
      const url = buildWhatsAppUrl(lead.phone, message);
      window.open(url, "_blank", "noopener,noreferrer");
    },
    [template],
  );

  return (
    <div className="app">
      <header className="header">
        <div className="header__brand">
          <span className="header__icon">
            <WhatsAppIcon />
          </span>
          <div>
            <h1>WhatsApp Leads</h1>
            <p>Importe o Excel e envie mensagens personalizadas com um clique.</p>
          </div>
        </div>
      </header>

      <main className="main">
        <section className="panel">
          <div className="panel__row">
            <label className="upload">
              <input
                type="file"
                accept=".xlsx,.xls,.csv"
                onChange={(e) => handleFile(e.target.files?.[0])}
                disabled={loading}
              />
              <span className="upload__button">
                {loading ? "Importando..." : "Importar planilha (.xlsx)"}
              </span>
            </label>

            {fileName && (
              <span className="badge">
                {fileName} · {leads.length} leads
                {clickedCount > 0 && ` · ${clickedCount} enviados`}
              </span>
            )}
          </div>

          {error && <p className="error">{error}</p>}

          <div className="template">
            <label htmlFor="template">Mensagem (use [nome] para o primeiro nome)</label>
            <textarea
              id="template"
              value={template}
              onChange={(e) => setTemplate(e.target.value)}
              rows={4}
              placeholder={getDefaultTemplate()}
            />
            <div className="template__footer">
              <p className="template__preview">
                <strong>Prévia:</strong> {previewMessage(template)}
              </p>
              <button
                type="button"
                className="btn btn--ghost"
                onClick={() => setTemplate(getDefaultTemplate())}
              >
                Restaurar padrão
              </button>
            </div>
          </div>
        </section>

        {leads.length > 0 && (
          <section className="leads">
            <div className="leads__toolbar">
              <input
                type="search"
                className="search"
                placeholder="Buscar por nome, telefone ou e-mail..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <div className="leads__stats">
                <span className="leads__count">
                  {filteredLeads.length} lead{filteredLeads.length !== 1 ? "s" : ""}
                </span>
                <span className="leads__legend">
                  <span className="leads__dot leads__dot--pending" />
                  Pendente
                  <span className="leads__dot leads__dot--sent" />
                  Clicado
                </span>
              </div>
            </div>

            <div className="grid">
              {filteredLeads.map((lead) => {
                const sent = clickedPhones.has(lead.phone);

                return (
                  <button
                    key={lead.id}
                    type="button"
                    className={`lead-card${sent ? " lead-card--sent" : ""}`}
                    onClick={() => openWhatsApp(lead)}
                    title={`${lead.fullName} · ${lead.phone}`}
                  >
                    <span className="lead-card__icon">
                      <WhatsAppIcon />
                    </span>
                    <span className="lead-card__name">{lead.firstName}</span>
                    <span className="lead-card__full">{lead.fullName}</span>
                  </button>
                );
              })}
            </div>

            {filteredLeads.length === 0 && (
              <p className="empty">Nenhum lead encontrado para essa busca.</p>
            )}
          </section>
        )}

        {leads.length === 0 && !loading && !error && (
          <section className="empty-state">
            <div className="empty-state__icon">
              <WhatsAppIcon />
            </div>
            <h2>Comece importando sua planilha</h2>
            <p>
              O sistema lê as colunas <strong>Nome Lead</strong> e{" "}
              <strong>Telefone</strong>. Cada botão abre o WhatsApp com a mensagem
              personalizada usando o primeiro nome.
            </p>
          </section>
        )}
      </main>
    </div>
  );
}
