from __future__ import annotations
import re
from typing import Any, Optional
import pandas as pd

def _parse_br_money(value: Any) -> Optional[float]:
    if value is None: return None
    s = str(value).replace("\u00a0", " ").strip()
    # Mantém apenas números, vírgula e ponto
    s = re.sub(r"[^\d,.]", "", s)
    if not re.search(r"\d", s): return None
    s = s.replace(".", "").replace(",", ".")
    try:
        return float(s)
    except ValueError:
        return None

def extract_bb_holder(pdf_text: str) -> Optional[str]:
    if not pdf_text: return None
    # "Cliente NOME SOBRENOME" (até o fim da linha)
    match = re.search(r"(?im)^\s*Cliente\s+([^\n\r]+)\s*$", pdf_text)
    return match.group(1).strip() if match else None

def _clean_bb_description(text: str) -> str:
    """Remove lotes, documentos e códigos numéricos inúteis do início/meio."""
    # Remove sequências de 4 a 6 dígitos (Lotes) ou Docs longos no início
    # Ex: '13149 880051000133688 Pgto' -> 'Pgto'
    text = re.sub(r"^\d{3,6}\s+\d{5,}\s*", "", text)
    text = re.sub(r"^\d{3,6}\s+", "", text)
    
    # Remove datas repetidas no meio do histórico (comum no BB)
    text = re.sub(r"\d{2}/\d{2}\s+\d{2}:\d{2}\s*", "", text)
    
    return text.strip()

def extract_bb_from_text(pdf_text: str) -> pd.DataFrame:
    lines = [l.strip() for l in (pdf_text or "").splitlines() if l.strip()]
    rows: list[dict[str, Any]] = []

    # BB via pdfplumber costuma “colar” colunas e quebrar descrições em linhas.
    # Estratégia: agrupa por blocos iniciados por data DD/MM/AAAA; dentro do bloco,
    # extrai valor/sinal e junta o resto como descrição.
    main_re_a = re.compile(r"^(\d{2}/\d{2}/\d{4})\s+([\d\.,]+)\s*\(([\+\-])\)\s*(.*)$")
    main_re_b = re.compile(r"^(\d{2}/\d{2}/\d{4})\s+(.*?)\s+([\d\.,]+)\s*\(([\+\-])\)\s*$")
    date_start = re.compile(r"^(\d{2}/\d{2}/\d{4})\b")

    ignore_terms = [
        "agência",
        "conta",
        "período",
        "periodo",
        "cliente",
        "lançamentos",
        "dia documento",
        "dia lote",
        "documento",
        "histórico",
        "valor",
        "extrato",
        "saldo do dia",
        "saldo anterior",
        "s a l d o",
        "total aplicações",
        "sujeitos a confirmação",
    ]

    current_block: list[str] = []
    pending_prefix: list[str] = []  # linhas que pertencem ao PRÓXIMO lançamento (ex.: "Pix - Recebido")
    pending_preblock: list[str] = []  # linhas imediatamente antes da data (ex.: "Pgto CDC Renovação")

    def flush_block(block: list[str]) -> None:
        if not block:
            return
        head = block[0]
        m = main_re_a.match(head) or main_re_b.match(head)
        if not m:
            return

        if m.re is main_re_a:
            date, val_str, sign, tail = m.groups()
        else:
            date, tail, val_str, sign = m.groups()

        val = _parse_br_money(val_str)
        if val is None:
            return
        amount = -abs(val) if sign == "-" else abs(val)

        desc_parts: list[str] = []
        if tail and tail.strip():
            desc_parts.append(tail.strip())
        for extra in block[1:]:
            low = extra.lower()
            if any(x in low for x in ignore_terms):
                continue
            # evita linhas só numéricas (lote/documento)
            if re.fullmatch(r"[\d\s\.\-]+", extra):
                continue
            desc_parts.append(extra)

        desc = _clean_bb_description(" ".join(desc_parts))
        if not desc:
            return
        rows.append({"date": date, "description": desc, "amount": amount})

    for line in lines:
        low = line.lower()
        if any(x in low for x in ignore_terms):
            continue

        is_main = bool(date_start.match(line) and (main_re_a.match(line) or main_re_b.match(line)))
        if is_main:
            flush_block(current_block)
            # monta novo bloco com prefixos coletados
            current_block = [line]
            if pending_prefix:
                current_block.extend(pending_prefix)
                pending_prefix = []
            if pending_preblock:
                current_block.extend(pending_preblock)
                pending_preblock = []
            continue

        # Marcadores que no BB aparecem ANTES da linha com data/valor (pertencem ao próximo lançamento)
        if line.strip() in {"Pix - Recebido", "Pix - Enviado"}:
            pending_prefix = [line.strip()]
            continue

        if current_block:
            current_block.append(line)
        else:
            # linhas imediatamente antes do lançamento (ex.: "Pgto CDC Renovação")
            # mas não carrega cabeçalho para o primeiro lançamento
            if any(x in low for x in ("extrato", "cliente", "período", "periodo", "agência", "agencia", "conta", "lançamentos", "dia lote", "dia documento")):
                pending_preblock = []
                continue
            pending_preblock.append(line)
            pending_preblock = pending_preblock[-3:]

    flush_block(current_block)

    return pd.DataFrame(rows)

def try_extract(pdf_text: str) -> Optional[pd.DataFrame]:
    df = extract_bb_from_text(pdf_text)
    if df is None or df.empty: return None

    holder = extract_bb_holder(pdf_text)
    df["_source"] = "banco_do_brasil"
    df["holder"] = holder

    # Padronização de colunas para o seu frontend
    cols = ["date", "description", "amount", "debit", "credit", "balance", "_source", "holder"]
    for col in cols:
        if col not in df.columns:
            df[col] = None

    return df[cols].copy()