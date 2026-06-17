import { PDFDocument } from "pdf-lib";
import { enrichCounterpartyFromDescription } from "../utils/counterparty";

const PROXY_URL = "/api/proxy-gemini";

/** Muitas retentativas: 429 do Gemini / Cloudflare costuma exigir espera longa */
const MAX_CHUNK_ATTEMPTS = 3;

function parseRetryAfterMs(res: Response): number | null {
  const h = res.headers.get("Retry-After");
  if (!h) return null;
  const sec = parseInt(h, 10);
  if (!Number.isNaN(sec) && sec > 0) return sec * 1000;
  const when = Date.parse(h);
  if (!Number.isNaN(when)) return Math.max(0, when - Date.now());
  return null;
}

function looksLikeRateLimit(status: number, body: unknown): boolean {
  if (status === 429 || status === 503) return true;
  const o = body as { error?: string; detail?: string; message?: string };
  const msg = String(o?.error ?? o?.detail ?? o?.message ?? "").toLowerCase();
  if (
    /rate limit|quota|resource exhausted|too many requests|exceeded|limite|cota|throttl/i.test(msg)
  )
    return true;
  if (/429|too many/.test(msg)) return true;
  // Alguns proxies / Nginx devolvem 502 com texto genérico — vale retentar poucas vezes no loop geral
  if ((status === 502 || status === 504) && /proxy|processamento|gateway|timeout|unavailable/i.test(msg))
    return true;
  return false;
}

const parseBrazilianNumber = (value: any): number => {
  if (typeof value === 'number') return value;
  if (!value) return 0;
  return Number(
    String(value)
      .replace(/\./g, '')
      .replace(',', '.')
      .replace(/[^\d.-]/g, '')
  );
};

// Função segura para converter PDF para Base64 sem estourar a memória
function arrayBufferToBase64(buffer: ArrayBuffer | Uint8Array): string {
  let binary = '';
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// Função de processamento com lógica de RETENTATIVA (Retry) integrada
async function processPdfChunk(
  base64Chunk: string,
  attempt = 1,
  onLog?: (message: string) => void,
  requestMeta?: {
    actorEmail?: string;
    actorRole?: string;
    statementOwner?: string;
    fileName?: string;
  }
): Promise<any> {
  const requestBody = {
    contents: [{
      parts: [
        {
          text: `
Atue como um analista financeiro especialista em bancos brasileiros.
Analise o PDF deste trecho de extrato bancário.

PRIMEIRO: identifique o nome do TITULAR. Se não estiver nesta página, retorne string vazia.

SEGUNDO: No campo "eb", gere um resumo técnico CURTO sobre:
- Entrada de dinheiro (origem)
- Saída (controle financeiro)
- Estabilidade
- Risco

Extraia TODAS as transações financeiras deste trecho.

REGRAS DE CLASSIFICAÇÃO:
1. Identifique entrada (c) ou saída (d).
2. Ignore cabeçalhos, saldos e rendimentos.

Para cada transação, use estritamente:
- d: data (YYYY-MM-DD)
- ds: TEXTO COMPLETO da linha no extrato. REGRA CRÍTICA: se no PDF a linha tiver várias colunas (histórico, nome do favorecido, detalhe, etc.), CONCATENE tudo em um único "ds" (ordem: esquerda→direita, separando trechos com espaço ou " | "). NUNCA devolva só "Transferência recebida pelo Pix" se existir QUALQUER outro texto na mesma linha.
- v: valor (número decimal)
- t: tipo ("c" ou "d")
- cp: só o NOME da pessoa ou RAZÃO SOCIAL de quem enviou/recebeu, sem banco, sem agência/conta, sem CPF/CNPJ.
  * Em PIX: o nome costuma vir logo após o tipo da transação; se houver " - " e depois CNPJ/banco, o nome em geral é o trecho ANTES do primeiro " - ".
  * Não use "cp" para produtos: Resgate RDB/CDB, rendimentos, etc.
  * Não coloque o titular da conta em cp.

Retorne APENAS o JSON.
`,
        },
        {
          inline_data: {
            mime_type: 'application/pdf',
            data: base64Chunk,
          },
        },
      ],
    }],
    generationConfig: {
      temperature: 0,
      response_mime_type: 'application/json',
      response_schema: {
        type: 'object',
        properties: {
          tt: { type: 'string' },
          eb: { type: 'string' },
          tx: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                d: { type: 'string' },
                ds: { type: 'string' },
                v: { type: 'number' },
                t: { type: 'string', enum: ['c', 'd'] },
                cp: { type: 'string' }
              },
              required: ['d', 'ds', 'v', 't'],
            },
          },
        },
        required: ['tt', 'eb', 'tx']
      },
    },
  };

  const response = await fetch(PROXY_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(requestMeta?.actorEmail ? { "x-actor-email": requestMeta.actorEmail } : {}),
      ...(requestMeta?.actorRole ? { "x-actor-role": requestMeta.actorRole } : {}),
      ...(requestMeta?.statementOwner ? { "x-statement-owner": requestMeta.statementOwner } : {}),
      ...(requestMeta?.fileName ? { "x-file-name": requestMeta.fileName } : {})
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errorJson = (await response.json().catch(() => ({}))) as {
      error?: string;
      detail?: string;
      message?: string;
    };

    if (looksLikeRateLimit(response.status, errorJson) && attempt < MAX_CHUNK_ATTEMPTS) {
      const fromHeader = parseRetryAfterMs(response);
      const exp = Math.min(180_000, 18_000 * Math.pow(1.45, attempt - 1));
      const backoff = fromHeader ?? exp;
      const jitter = Math.random() * 8_000;
      const waitMs = Math.round(backoff + jitter);
      console.warn(
        `[Gemini] Limite / fila (HTTP ${response.status}). Tentativa ${attempt}/${MAX_CHUNK_ATTEMPTS}. Esperando ${(waitMs / 1000).toFixed(0)}s... (não feche a aba)`
      );
      onLog?.(
        `[Gemini] Limite/fila (HTTP ${response.status}) na tentativa ${attempt}/${MAX_CHUNK_ATTEMPTS}. Aguardando ${(waitMs / 1000).toFixed(0)}s`
      );
      await new Promise((r) => setTimeout(r, waitMs));
      return processPdfChunk(base64Chunk, attempt + 1, onLog, requestMeta);
    }

    const msg =
      errorJson.error ||
      errorJson.detail ||
      errorJson.message ||
      `Erro no proxy (HTTP ${response.status}).`;
    if (response.status === 429 || looksLikeRateLimit(response.status, errorJson)) {
      throw new Error(
        `${msg} — Limite da API atingido após várias esperas. Aguarde 5–15 minutos e confira se o site foi atualizado (Ctrl+F5). Opcional: várias chaves em GEMINI_API_KEYS no servidor reduzem 429.`
      );
    }
    throw new Error(msg);
  }

  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  
  if (!text) return { tt: '', tx: [], eb: '' };

  try {
    return JSON.parse(text);
  } catch (err) {
    console.warn("Falha ao processar JSON da IA. Pulando este pedaço do PDF.");
    return { tt: '', tx: [], eb: '' };
  }
}

type AnalyzeStatementProgress = {
  startPage: number;
  endPage: number;
  totalPages: number;
  chunkIndex: number;
  totalChunks: number;
};

export async function analyzeStatement(
  file: File,
  onProgress?: (progress: AnalyzeStatementProgress) => void,
  onLog?: (message: string) => void,
  requestMeta?: {
    actorEmail?: string;
    actorRole?: string;
    statementOwner?: string;
    fileName?: string;
  }
) {
  try {
    const arrayBuffer = await file.arrayBuffer();
    const originalPdf = await PDFDocument.load(arrayBuffer);
    const totalPages = originalPdf.getPageCount();
    onLog?.(`[Arquivo] ${file.name} carregado (${totalPages} páginas)`);

    let titularFinal = '';
    let todasTransacoes: any[] = [];
    let analiseAcumulada: string[] = [];

    // 2 páginas por chamada: reduz pico de tokens por request (menos 429 por TPM)
    const PAGES_PER_CHUNK = 2;

    const totalChunks = Math.ceil(totalPages / PAGES_PER_CHUNK);

    for (let i = 0; i < totalPages; i += PAGES_PER_CHUNK) {
      const chunkPdf = await PDFDocument.create();
      const endIndex = Math.min(i + PAGES_PER_CHUNK, totalPages);
      const chunkIndex = Math.floor(i / PAGES_PER_CHUNK) + 1;
      
      const pagesToCopy = Array.from({ length: endIndex - i }, (_, idx) => i + idx);
      const copiedPages = await chunkPdf.copyPages(originalPdf, pagesToCopy);
      copiedPages.forEach((page) => chunkPdf.addPage(page));

      const chunkBytes = await chunkPdf.save();
      const base64Chunk = arrayBufferToBase64(chunkBytes);

      console.log(`Analisando páginas ${i + 1} a ${endIndex} de ${totalPages}...`);
      onProgress?.({
        startPage: i + 1,
        endPage: endIndex,
        totalPages,
        chunkIndex,
        totalChunks
      });
      onLog?.(
        `[Processamento] Bloco ${chunkIndex}/${totalChunks}: páginas ${i + 1} a ${endIndex} de ${totalPages}`
      );
      
      const result = await processPdfChunk(base64Chunk, 1, onLog, {
        ...requestMeta,
        fileName: requestMeta?.fileName || file.name
      });

      if (!titularFinal && result.tt) titularFinal = result.tt;
      if (result.tx && Array.isArray(result.tx)) todasTransacoes.push(...result.tx);
      if (result.eb) analiseAcumulada.push(result.eb);

      // Evita travar a UI sem adicionar pausa artificial longa entre blocos.
      await new Promise((r) => setTimeout(r, 120));
    }

    return { 
      titular: titularFinal.trim(),
      analiseBancaria: analiseAcumulada.join(' '), 
      transacoes: todasTransacoes.map(t => ({
        id: crypto.randomUUID(),
        date: t.d || '',
        description: t.ds || '',
        amount: parseBrazilianNumber(t.v),
        type: t.t === 'c' ? 'credito' : 'debito',
        isManuallyExcluded: false,
        counterparty: enrichCounterpartyFromDescription(
          t.ds || "",
          typeof t.cp === "string" ? t.cp.trim() : ""
        )
      }))
    };

  } catch (error: any) {
    console.error('Erro fatal no processamento:', error.message);
    throw error;
  }
}
