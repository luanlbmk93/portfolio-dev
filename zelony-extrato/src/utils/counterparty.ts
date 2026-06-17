/** Extração de nome da contraparte em descrições de extratos BR (PIX, TED, etc.). */

const norm = (s: string) =>
  (s || "")
    .toString()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

/**
 * Depois de "pelo Pix", o banco costuma por NOME e depois " - CNPJ - BCO ...".
 * Também aparece "NOME.999.999-.." (CPF mascarado) antes do resto.
 */
function stripBankAndDocSuffixes(raw: string): string {
  let x = raw.replace(/\s+/g, " ").trim();
  if (!x) return "";

  // Parte antes de " - " quando o que vem depois é claramente banco/CNPJ/dados
  const dashIdx = x.search(/\s+-\s+/);
  if (dashIdx > 0) {
    const right = x.slice(dashIdx + 3);
    const looksLikeBankData =
      /\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}/.test(right) ||
      /\b(bco|banco|coop|sicredi|bradesco|santander|inter|99pay|c6)\b/i.test(right) ||
      /\b(ag[eê]ncia|conta:?)\b/i.test(right) ||
      /^\d{2}\.\d{3}\.\d{3}/.test(right.trim());
    if (looksLikeBankData) x = x.slice(0, dashIdx).trim();
  }

  // "GUILHERME FERAZZA.786.768-.." → corta antes do padrão de CPF
  x = x.replace(/\.\d{3}\.\d{3}-.*$/i, "").trim();
  x = x.replace(/\.\d{2,3}\.\d{3}-.*$/i, "").trim();

  return x.slice(0, 120);
}

/** Evita agrupar em frases genéricas do banco (“recebida pelo Pix”, etc.). */
export const isGenericCounterpartyLabel = (raw: string): boolean => {
  const rawTrim = (raw || "").trim();
  // Texto com REM:/DES:/Cp: traz nome — não é genérico (ex.: "TRANSFERENCIA PIX REM: JOÃO")
  if (/\b(?:REM|DES):\s*\S/i.test(rawTrim)) return false;
  if (/\b[Cc][Pp]\s*:?\s*[\d.\-]+\s*[-–]\s*\S/.test(rawTrim)) return false;

  const x = norm(rawTrim).replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
  if (x.length < 2 || x.length > 130) return true;
  if (/^(pix|ted|doc|saque|tarifa|juros|rendimento|aplica|emprestimo)$/i.test(x)) return true;
  if (/\b(recebida|recebido)\s+pelo\s+pix\b/i.test(raw)) return true;
  if (/^recebid[ao]\s+pelo\s+/i.test(x)) return true;
  // Só frases curtas/tipo de lançamento — NÃO "transferencia pix rem joao ..."
  if (/^(transferencia|transfer[eê]ncia|pagamento|valor|credito|cr[eé]dito|deposito|dep[oó]sito)$/i.test(x)) return true;
  // Produto / tipo de lançamento, não pessoa
  if (/^resgate\b/i.test(x)) return true;
  if (/\b(rdb|cdb|lci|lca|poupan[cç]a)\b/i.test(x) && x.length < 40) return true;
  if (/^cr[eé]dito\s+em\s+conta$/i.test(x)) return true;
  if (/^credito\s+salario$/i.test(x)) return true;
  if (/^saque\s+din/i.test(x)) return true;
  if (/^compra\s+cartao\s+debito$/i.test(x)) return true;
  if (/^deb[ií]to\s+transporte/i.test(x)) return true;
  if (/^pag\s+boleto/i.test(x)) return true;
  if (/^deposito\s+dinh/i.test(x)) return true;
  if (/^pag\s+boleto/i.test(x)) return true;
  if (/^pag\s+orgaos/i.test(x)) return true;
  if (/^pix\s+(recebido|enviado)?$/i.test(x)) return true;
  // Canais genéricos do banco (não é pessoa/empresa)
  if (/\bcentral\b.*\binternet\b/i.test(x) || /\bcentral\s*\/\s*internet\b/i.test(raw)) return true;
  if (/^transferencia\s+pix$/i.test(x) || /^transfer[eê]ncia\s+pix$/i.test(x)) return true;
  if (/^pix\s+qr\s+code/i.test(x)) return true;
  if (/^deposito\s+em\s+conta$/i.test(x)) return true;
  return false;
};

/** Bradesco: "REM: NOME" (entrada) / "DES: NOME" (saída) costuma vir na descrição montada pelo parser. */
function extractFromRemDes(desc: string): string {
  const s = (desc || "").replace(/\s+/g, " ").trim();
  if (!s) return "";
  const rem = s.match(/\bREM:\s*(.+?)(?:\s+\d{2}\/\d{2}(?:\/\d{4})?\s*$|\s+DES:|\s*$)/i);
  if (rem?.[1]) {
    const tail = rem[1].replace(/\s+DES:.*$/i, "").trim();
    const cleaned = cleanCounterpartyCandidate(tail);
    if (cleaned && !isGenericCounterpartyLabel(cleaned)) return cleaned;
  }
  const des = s.match(/\bDES:\s*(.+?)(?:\s+\d{2}\/\d{2}(?:\/\d{4})?\s*$|\s+REM:|\s*$)/i);
  if (des?.[1]) {
    const cleaned = cleanCounterpartyCandidate(des[1].trim());
    if (cleaned && !isGenericCounterpartyLabel(cleaned)) return cleaned;
  }
  return "";
}

/** C6: "Pix recebido de X" / "Pix enviado para X". */
function extractFromC6Pix(desc: string): string {
  const s = (desc || "").replace(/\s+/g, " ").trim();
  const m = s.match(
    /(?:entrada\s+pix\s+)?pix\s+recebido\s+de\s+(.+)$|(?:sa[ií]da\s+pix\s+)?pix\s+enviado\s+para\s+(.+)$/i
  );
  const tail = m?.[1] || m?.[2];
  if (tail) {
    const cleaned = cleanCounterpartyCandidate(tail.trim());
    if (cleaned && !isGenericCounterpartyLabel(cleaned)) return cleaned;
  }
  return "";
}

/** Caixa: "PIX RECEBIDO NOME" / "COMPRA CARTAO DEBITO NOME" na descrição. */
function extractFromCaixaHist(desc: string): string {
  const s = (desc || "").replace(/\s+/g, " ").trim();
  const patterns = [
    /^(?:pix\s+(?:enviado|recebido|devolvido))\s+(.+)$/i,
    /^compra\s+cart[aã]o\s+debito\.?\s+(.+)$/i,
    /^devolucao\s+pix\s+recebido\s+(.+)$/i,
  ];
  for (const re of patterns) {
    const m = s.match(re);
    if (m?.[1]) {
      const cleaned = cleanCounterpartyCandidate(m[1].trim());
      if (cleaned && !isGenericCounterpartyLabel(cleaned)) return cleaned;
    }
  }
  return "";
}

/** Santander: "PIX RECEBIDO NOME" / "PIX ENVIADO NOME" na descrição. */
function extractFromSantanderPix(desc: string): string {
  const s = (desc || "").replace(/\s+/g, " ").trim();
  const m = s.match(
    /^(?:pix\s+(?:recebido|enviado|devolvido)|pagamento\s+de\s+bonus|liquido\s+de\s+vencimento|adiantamento\s+de\s+salario)\s+(.+)$/i
  );
  if (m?.[1]) {
    let tail = m[1].trim();
    tail = tail.replace(/\s+cnpj\s+[\d./-]+$/i, "").trim();
    const cleaned = cleanCounterpartyCandidate(tail);
    if (cleaned && !isGenericCounterpartyLabel(cleaned)) return cleaned;
  }
  return "";
}

/** Banco Inter: "Cp :60701190-Tim S A" na mesma linha da transação. */
function extractFromInterCp(desc: string): string {
  const s = (desc || "").replace(/\s+/g, " ").trim();
  const m = s.match(/\b[Cc][Pp]\s*:?\s*[\d.\-]+\s*[-–]\s*(.+?)(?:\s+R\$\s|\s+[-+]?\s*R?\$|\s*$)/);
  if (m?.[1]) {
    const cleaned = cleanCounterpartyCandidate(m[1]);
    if (cleaned && !isGenericCounterpartyLabel(cleaned)) return cleaned;
  }
  return "";
}

export const cleanCounterpartyCandidate = (raw: string): string => {
  const stripped = stripBankAndDocSuffixes(raw);
  let x = stripped.replace(/\b(cpfcnpj|cpf|cnpj)\s*:?\s*[\d.*\-/]+\b/gi, "").trim();
  x = x.replace(/^[\d\s.*\-/]+$/, "").trim();
  x = x.replace(/^["'“”]+|["'“”]+$/g, "").trim();
  return x.slice(0, 120);
};

/**
 * Muitos bancos colocam o nome na MESMA linha após "Transferência recebida pelo Pix".
 * Outros só têm o texto genérico (nome veio em coluna que a IA não juntou em `ds`).
 */
export function extractBestCounterpartyFromDescription(desc: string): string {
  const s = (desc || "").trim();
  if (!s) return "";

  const firstLine = s.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)[0] || s;

  const fromRemDes = extractFromRemDes(s);
  if (fromRemDes) return fromRemDes;

  const fromCaixa = extractFromCaixaHist(firstLine) || extractFromCaixaHist(s);
  if (fromCaixa) return fromCaixa;

  const fromInter = extractFromInterCp(firstLine) || extractFromInterCp(s);
  if (fromInter) return fromInter;

  const fromSantander = extractFromSantanderPix(firstLine) || extractFromSantanderPix(s);
  if (fromSantander) return fromSantander;

  const fromC6 = extractFromC6Pix(firstLine) || extractFromC6Pix(s);
  if (fromC6) return fromC6;

  const tryTail = (tail: string): string | null => {
    const cleaned = cleanCounterpartyCandidate(tail);
    if (cleaned && !isGenericCounterpartyLabel(cleaned)) return cleaned;
    return null;
  };

  // 1) "Transferência recebida pelo Pix NOME ... - BANCO ..." (linha inteira)
  const mPixTail = firstLine.match(/^transfer[eê]ncia\s+recebida\s+pelo\s+pix\s+(.+)$/i);
  if (mPixTail?.[1]) {
    const got = tryTail(mPixTail[1]);
    if (got) return got;
  }

  // 2) Mesmo padrão, string completa
  const mPixTailLoose = s.match(/transfer[eê]ncia\s+recebida\s+pelo\s+pix\s+(.+?)(?:\s*[-–|]|$)/is);
  if (mPixTailLoose?.[1]) {
    const got = tryTail(mPixTailLoose[1].split(/[\n\r]/)[0]);
    if (got) return got;
  }

  const mFornecedor = firstLine.match(/recebimento\s+fornecedor\s+(.+)$/i);
  if (mFornecedor?.[1]) {
    const got = tryTail(mFornecedor[1]);
    if (got) return got;
  }

  // 3) "Recebida pelo Pix NOME"
  const mRecPix = firstLine.match(/^recebida\s+pelo\s+pix\s+(.+)$/i);
  if (mRecPix?.[1]) {
    const got = tryTail(mRecPix[1]);
    if (got) return got;
  }

  // Itaú: "PIX TRANSF FELIPE 02/05" ou "PIX TRANSF JOAO SILVA 02/05"
  const mItauPix = firstLine.match(/\bpix\s+transf\s+(.+?)(?:\s+\d{2}\/\d{2}(?:\/\d{4})?\s*$|\s+[-+]?\d)/i);
  if (mItauPix?.[1]) {
    const got = tryTail(mItauPix[1]);
    if (got) return got;
  }

  const tryPatterns: RegExp[] = [
    /\b(?:pix|PIX)\s+recebido\s+de\s+(.+?)(?:\s*[-–|]|$)/,
    /\b(?:pix|PIX)\s+recebido\s*[-–:]\s*(.+?)(?:\s*[-–|]|$)/,
    /\b(?:pix|PIX)\s+recebido\s*[-–]?\s*(?:de\s+)?(.+?)(?:\s*[-–|]|$)/i,
    /\b(?:pix|PIX)\s+enviado\s+(.+?)(?:\s*[-–|]|$)/i,
    /\bcompra\s+cart[aã]o\s+debito\.?\s+(.+?)(?:\s*[-–|]|$)/i,
    /recebido\s+de\s+(.+?)(?:\s*[-–|]|$)/i,
    /transfer[eê]ncia\s*(?:pix)?\s*(?:de|para)\s+(.+?)(?:\s*[-–|]|$)/i,
    /nome\s*[:\s]+\s*(.+?)(?:\s*[-–|]|$)/i,
    /benefici[aá]rio\s*[:\s]+\s*(.+?)(?:\s*[-–|]|$)/i,
    /contraparte\s*[:\s]+\s*(.+?)(?:\s*[-–|]|$)/i,
    /ted\s+(?:de\s+)?(.+?)(?:\s*[-–|]|$)/i,
    /doc\s+(?:de\s+)?(.+?)(?:\s*[-–|]|$)/i,
    /pagamento\s+de\s+(.+?)(?:\s*[-–|]|$)/i,
  ];

  for (const re of tryPatterns) {
    const m = s.match(re);
    if (m?.[1]) {
      const got = tryTail(m[1]);
      if (got) return got;
    }
  }

  const parts = s.split(/\s*[-–|]\s*/).map((p) => p.trim()).filter(Boolean);
  for (let i = parts.length - 1; i >= 0; i--) {
    const cand = cleanCounterpartyCandidate(parts[i]);
    if (cand && !isGenericCounterpartyLabel(cand)) {
      const words = cand.split(/\s+/).filter(Boolean);
      if (words.length >= 2 || /^[A-ZÀ-Ü]/.test(cand)) return cand;
    }
  }
  return "";
}

/** Preenche `cp` quando a IA deixou vazio mas o nome está na descrição. */
export function enrichCounterpartyFromDescription(description: string, cp: string): string {
  // Prioridade: nome na descrição (REM:, Pix, etc.) — o campo salvo pode vir só como "TRANSFERENCIA PIX"
  const fromDesc = extractBestCounterpartyFromDescription(description);
  if (fromDesc) return fromDesc;
  const c = (cp || "").trim();
  if (c && !isGenericCounterpartyLabel(c)) return cleanCounterpartyCandidate(c) || c;
  return "";
}
