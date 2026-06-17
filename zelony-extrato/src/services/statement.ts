import { enrichCounterpartyFromDescription } from "../utils/counterparty";

type AnalyzeStatementProgress = {
  startPage: number;
  endPage: number;
  totalPages: number;
  chunkIndex: number;
  totalChunks: number;
};

/** Base do Python (parse-statement). Não usar VITE_API_URL — esse costuma ser o Node. */
function statementApiBase(): string {
  const explicit = (import.meta as any).env?.VITE_STATEMENT_API_URL?.toString().trim();
  if (explicit) return explicit.replace(/\/$/, "");
  // Dev: URL relativa → proxy do Vite em vite.config.ts (/parse-statement → :8000)
  if (import.meta.env.DEV) return "";
  return "http://127.0.0.1:8000";
}

function formatBackendHttpError(status: number, data: Record<string, unknown>): string {
  const detail = data?.detail ? String(data.detail).trim() : "";
  const base = data?.error ? String(data.error).trim() : "";
  if (status === 502 || status === 504) {
    return (
      (base || `Falha no backend (HTTP ${status}).`) +
      " O proxy (Nginx) não alcançou o Python de extratos ou o processamento expirou no servidor. " +
      "Confira: `pm2 status` / `GET /health` no serviço da porta 8000; rota `/parse-statement` → Python (não Node); " +
      "para Caixa, `proxy_read_timeout` ≥ 600s." +
      (detail ? ` — ${detail}` : "")
    );
  }
  if (base && detail && detail !== base) return `${base} — ${detail}`;
  return detail || base || `Falha no backend (HTTP ${status}).`;
}

const parseBrazilianNumber = (value: any): number => {
  if (typeof value === "number") return value;
  if (!value) return 0;
  return Number(
    String(value)
      .replace(/\./g, "")
      .replace(",", ".")
      .replace(/[^\d.-]/g, "")
  );
};

export async function analyzeStatement(
  file: File,
  onProgress?: (progress: AnalyzeStatementProgress) => void,
  onLog?: (message: string) => void,
  _requestMeta?: {
    actorEmail?: string;
    actorRole?: string;
    statementOwner?: string;
    fileName?: string;
    /** Banco escolhido no front (ex.: nubank, caixa) — obrigatório no fluxo sem IA */
    bank?: string;
  }
) {
  onLog?.(`[Arquivo] Enviando ${file.name} para processamento local (sem IA)...`);
  onProgress?.({
    startPage: 1,
    endPage: 1,
    totalPages: 1,
    chunkIndex: 1,
    totalChunks: 1,
  });

  const fd = new FormData();
  fd.append("file", file, file.name);
  const bank = _requestMeta?.bank?.trim();
  if (bank) {
    fd.append("bank", bank);
  }

  const controller = new AbortController();
  const bankKey = bank?.toLowerCase() || "";
  const timeoutMs =
    bankKey === "caixa" ? 600_000 : 300_000; // Caixa OCR: até 10 min; demais: 5 min
  const t = window.setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    const base = statementApiBase();
    const url = base ? `${base}/parse-statement` : "/parse-statement";
    res = await fetch(url, {
      method: "POST",
      body: fd,
      signal: controller.signal,
    });
  } catch (e: any) {
    if (e?.name === "AbortError") {
      throw new Error(
        `Processamento demorou mais que ${(timeoutMs / 1000).toFixed(
          0
        )}s e foi cancelado. O backend pode estar travado ou o arquivo é pesado.`
      );
    }
    throw e;
  } finally {
    window.clearTimeout(t);
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.error) {
    throw new Error(formatBackendHttpError(res.status, data as Record<string, unknown>));
  }

  const tx = Array.isArray(data?.transactions) ? data.transactions : [];
  const meta = data?.meta && typeof data.meta === "object" ? data.meta : null;

  if (meta) {
    onLog?.(`[Meta] ${JSON.stringify(meta)}`);
  }
  onLog?.(`[Processamento] ${tx.length} transações extraídas/classificadas.`);
  if (tx.length === 0) {
    const metaText = meta ? ` Meta=${JSON.stringify(meta)}` : "";
    throw new Error(
      `Nenhuma transação extraída do PDF.${metaText} ` +
        `Se este PDF for escaneado (imagem), não há texto para extrair sem OCR.`
    );
  }

  const titularFromMeta =
    meta && typeof (meta as any).statement_holder === "string"
      ? String((meta as any).statement_holder).trim()
      : "";

  return {
    titular: titularFromMeta,
    analiseBancaria: "",
    transacoes: tx.map((t: any) => {
      const rawDate = String(t?.date || "").trim();
      const date = rawDate.match(/^(\d{4}-\d{2}-\d{2})/)?.[1] || rawDate;
      const description = String(t?.description || "").trim();
      const amount = parseBrazilianNumber(t?.amount);
      const rawType = String(t?.type || "").toLowerCase();
      const type =
        rawType === "entrada"
          ? "credito"
          : rawType === "saida"
            ? "debito"
            : amount > 0
              ? "credito"
              : "debito";
      return {
        id: crypto.randomUUID(),
        date,
        description,
        amount,
        type,
        isManuallyExcluded: false,
        counterparty: enrichCounterpartyFromDescription(
          description,
          String(t?.counterparty || "").trim()
        ),
      };
    }),
    meta,
  };
}

