from __future__ import annotations

import re
import unicodedata
from datetime import datetime
from typing import Any, Optional

import pandas as pd


def _parse_br_money(value: Any) -> Optional[float]:
    if value is None:
        return None
    s = str(value).replace("\u00a0", " ").strip()
    s = re.sub(r"[^\d,.\-]", "", s)
    if not re.search(r"\d", s):
        return None
    s = s.replace(".", "").replace(",", ".")
    try:
        return float(s)
    except Exception:
        return None


def _norm_token(s: str) -> str:
    s = unicodedata.normalize("NFD", (s or "").lower())
    return "".join(c for c in s if unicodedata.category(c) != "Mn")


_MONTHS = {
    "janeiro": 1,
    "fevereiro": 2,
    "marco": 3,
    "abril": 4,
    "maio": 5,
    "junho": 6,
    "julho": 7,
    "agosto": 8,
    "setembro": 9,
    "outubro": 10,
    "novembro": 11,
    "dezembro": 12,
}


def _parse_inter_day_header(line: str) -> Optional[str]:
    """
    Ex.: "1 de Outubro de 2025 Saldo do dia: R$ 152,69"
    Retorna data em DD/MM/AAAA.
    """
    s = re.sub(r"\s+", " ", (line or "").strip())
    m = re.search(r"(\d{1,2})\s+de\s+([A-Za-zçãõáéíóúÇÃÕÁÉÍÓÚ]+)\s+de\s+(\d{4})", s, flags=re.IGNORECASE)
    if not m:
        return None
    day = int(m.group(1))
    month_name = _norm_token(m.group(2))
    year = int(m.group(3))
    month = _MONTHS.get(month_name)
    if not month:
        return None
    try:
        dt = datetime(year, month, day)
        return dt.strftime("%d/%m/%Y")
    except Exception:
        return None


def _parse_inline_br_date(line: str) -> Optional[str]:
    m = re.search(r"\b(\d{2}/\d{2}/\d{4})\b", line or "")
    if not m:
        return None
    try:
        dt = datetime.strptime(m.group(1), "%d/%m/%Y")
        return dt.strftime("%d/%m/%Y")
    except Exception:
        return None


def extract_inter_holder(pdf_text: str) -> Optional[str]:
    lines = [l.strip() for l in (pdf_text or "").splitlines() if l.strip()]
    for i, ln in enumerate(lines[:25]):
        low = ln.lower()
        if "cpf/cnpj" in low or "cpf / cnpj" in low:
            if i > 0:
                prev = re.sub(r"^[\d\.\-]+\s+", "", lines[i - 1].strip()).strip()
                if prev and len(prev.split()) >= 2 and not re.fullmatch(r"[\d\s./-]+", prev):
                    return prev[:120]
        if "institui" in low and "banco inter" in low:
            if i > 0:
                prev = re.sub(r"^[\d\.\-]+\s+", "", lines[i - 1].strip()).strip()
                if prev and len(prev.split()) >= 2:
                    return prev[:120]
    # Linha 2 típica: nome do titular após "Solicitado em:"
    for ln in lines[:6]:
        if re.search(r"solicitado em", ln, re.I):
            continue
        if re.search(r"per[ií]odo\s*:", ln, re.I):
            continue
        if re.search(r"saldo\s+(total|dispon)", ln, re.I):
            continue
        cand = ln.strip()
        if len(cand.split()) >= 2 and not re.fullmatch(r"[\d\s./-]+", cand):
            if not re.search(r"cpf|cnpj|institui|ag[eê]ncia|conta", cand, re.I):
                return cand[:120]
    return None


def extract_inter_from_text(pdf_text: str) -> pd.DataFrame:
    lines = [l.strip() for l in (pdf_text or "").splitlines() if l.strip()]
    rows: list[dict[str, Any]] = []

    current_date: Optional[str] = None

    # Valor da transação + saldo após movimento (nunca confundir os dois)
    tx_re = re.compile(
        r"^(?P<desc>.+?)\s+(?P<val>[+\-]?\s*R?\$?\s*[\d\.\,]+)\s+(?P<saldo>R?\$?\s*[\d\.\,]+)\s*$",
        flags=re.IGNORECASE,
    )

    junk = (
        "solicitado em:",
        "cpf/cnpj:",
        "instituição:",
        "instituicao:",
        "agência:",
        "agencia:",
        "conta:",
        "período:",
        "periodo:",
        "saldo total",
        "saldo disponível",
        "saldo disponivel",
        "saldo bloqueado",
        "bloqueado + disponível",
        "bloqueado + disponivel",
        "saldo por transação",
        "saldo por transacao",
        "fale com a gente",
        "sac:",
        "ouvidoria:",
        "deficiência",
        "deficiencia",
        "--",
        "valor saldo por transação",
        "valor saldo por transacao",
    )

    for ln in lines:
        low = ln.lower()

        d = _parse_inter_day_header(ln)
        if d:
            current_date = d
            continue

        if any(j in low for j in junk):
            continue

        if "saldo do dia:" in low and not tx_re.match(ln):
            continue

        m = tx_re.match(ln)
        if not m:
            continue

        desc = re.sub(r"\s+", " ", m.group("desc").strip())
        amt = _parse_br_money(m.group("val"))
        bal = _parse_br_money(m.group("saldo"))
        if amt is None:
            continue

        tx_date = current_date or _parse_inline_br_date(ln)
        if not tx_date:
            continue

        rows.append(
            {
                "date": tx_date,
                "description": desc,
                "amount": float(amt),
                "balance": float(bal) if bal is not None else None,
            }
        )

    return pd.DataFrame(rows)


def try_extract(pdf_text: str) -> Optional[pd.DataFrame]:
    df = extract_inter_from_text(pdf_text or "")
    if df is None or df.empty:
        return None

    holder = extract_inter_holder(pdf_text or "")
    out = df.copy()
    out["_source"] = "inter"
    out["holder"] = holder

    cols = ["date", "description", "amount", "debit", "credit", "balance", "_source", "holder"]
    for c in cols:
        if c not in out.columns:
            out[c] = None
    return out[cols].copy()
