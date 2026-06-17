"""
Banco Pan — extrato conta (PDF texto embutido).

Bloco por lançamento (7 linhas):
  DD/MM | doc (9 dígitos) | categoria | saldo R$ | descrição | valor R$ | +/-
"""
from __future__ import annotations

import re
import unicodedata
from datetime import datetime
from typing import Any, List, Optional

import pandas as pd

_MONTHS = {
    "janeiro": 1,
    "fevereiro": 2,
    "marco": 3,
    "março": 3,
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

_DATE_SHORT = re.compile(r"^(\d{2})/(\d{2})$")
_DOC_RE = re.compile(r"^\d{9}$")
_MONEY_RE = re.compile(r"^R\$\s*([\d.]+,\d{2})$")
_SIGN_RE = re.compile(r"^[\+\-]$")
_MONTH_HDR = re.compile(
    r"^(janeiro|fevereiro|mar[cç]o|abril|maio|junho|julho|agosto|"
    r"setembro|outubro|novembro|dezembro)\s+de\s+(\d{4})$",
    re.I,
)
_PERIOD_RE = re.compile(
    r"(?i)extrato de (\d{2})/(\d{2})/(\d{4}) a (\d{2})/(\d{2})/(\d{4})"
)
# pdfplumber (texto em linha): DD/MM doc desc +/- R$ valor R$ saldo
_INLINE_ROW = re.compile(
    r"^(\d{2})/(\d{2})\s+(\d{9})\s+(.+?)\s+([+\-])\s+R\$\s*([\d.]+,\d{2})\s+R\$\s*([\d.]+,\d{2})\s*$"
)
_CAT_LINE = re.compile(r"^(DEBITO(?:\s+PIX)?|CREDITO(?:\s+PIX)?|BOLETO|CREDITO)$", re.I)


def _fold(s: str) -> str:
    t = unicodedata.normalize("NFKD", s or "")
    t = "".join(c for c in t if not unicodedata.combining(c))
    return t.lower()


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
    except ValueError:
        return None


def _is_junk(line: str) -> bool:
    s = (line or "").strip()
    if not s:
        return True
    low = _fold(s)
    if low.startswith("agencia") or low.startswith("agência"):
        return True
    if low.startswith("suas moviment"):
        return True
    if "extrato de" in low and re.search(r"\d{2}/\d{2}/\d{4}", s):
        return True
    if low.startswith("ola,") or "conta pan" in low:
        return True
    if low.startswith("periodo do extrato"):
        return True
    if "saiu da sua conta" in low or "entrou na sua conta" in low:
        return True
    if low.startswith("pagamentos feitos") or low.startswith("transferencias feitas"):
        return True
    if low.startswith("saques feitos") or low.startswith("total em tarifas"):
        return True
    if re.match(r"^\d+\s+(pagamentos?|transferencia|saque)", low):
        return True
    if re.match(r"^r\$\s*[\d.,]+$", low) and len(s) < 20:
        # resumo da capa (saldo período)
        return True
    if re.match(r"^\d{2}/\d{2} a \d{2}/\d{2}$", low):
        return True
    return False


def extract_pan_holder(pdf_text: str) -> Optional[str]:
    text = pdf_text or ""
    for pat in (
        r"(?i)ag[eê]ncia\s+\d+\s*-\s*conta\s+[\d\-]+\s*\n\s*([A-Za-zÀ-ÿ][^\n]{2,80})",
        r"(?i)([A-ZÀ-Ý][A-Za-zÀ-ÿ\s]{4,60})\s*\n\s*ag[eê]ncia\s+\d+",
    ):
        m = re.search(pat, text)
        if not m:
            continue
        name = re.sub(r"\s+", " ", m.group(1).strip())
        low = _fold(name)
        if low.startswith("extrato") or low.startswith("suas moviment"):
            continue
        return name
    return None


def _period_defaults(text: str) -> tuple[Optional[int], Optional[int]]:
    m = _PERIOD_RE.search(text or "")
    if not m:
        return None, None
    try:
        return int(m.group(6)), int(m.group(2))
    except ValueError:
        return None, None


def _full_date(day: int, month: int, year: int) -> Optional[str]:
    try:
        return datetime(year, month, day).strftime("%d/%m/%Y")
    except ValueError:
        return None


def _build_description(category: str, desc: str) -> str:
    cat = re.sub(r"\s+", " ", (category or "").strip()).upper()
    d = re.sub(r"\s+", " ", (desc or "").strip()).upper()
    if not d:
        return cat
    if cat in {"", "DEBITO", "CREDITO"} or cat in d:
        return d
    return f"{cat} {d}".strip()


def _append_row(
    rows: list[dict[str, Any]],
    day: int,
    month: int,
    year: Optional[int],
    category: str,
    desc: str,
    sign: str,
    amount_br: str,
    balance_br: str,
) -> None:
    if not year:
        return
    date_s = _full_date(day, month, year)
    if not date_s:
        return
    val = _parse_br_money(amount_br)
    bal = _parse_br_money(balance_br)
    if val is None:
        return
    signed = abs(val) if sign == "+" else -abs(val)
    rows.append(
        {
            "date": date_s,
            "description": _build_description(category, desc),
            "amount": signed,
            "balance": bal,
            "counterparty": None,
        }
    )


def _extract_pan_inline(lines: List[str], pdf_text: str) -> pd.DataFrame:
    """Layout pdfplumber: uma linha por lançamento."""
    default_year, _ = _period_defaults(pdf_text)
    cur_year = default_year
    rows: list[dict[str, Any]] = []
    prev_cat = ""

    for line in lines:
        if _is_junk(line):
            continue
        mh = _MONTH_HDR.match(line)
        if mh:
            month_name = _fold(mh.group(1))
            try:
                cur_year = int(mh.group(2))
            except ValueError:
                pass
            prev_cat = ""
            continue
        if _CAT_LINE.match(line):
            prev_cat = line.strip()
            continue

        m = _INLINE_ROW.match(line)
        if not m:
            prev_cat = ""
            continue

        day, month = int(m.group(1)), int(m.group(2))
        desc = m.group(4).strip()
        sign = m.group(5)
        _append_row(rows, day, month, cur_year, prev_cat, desc, sign, m.group(6), m.group(7))
        prev_cat = ""

    return pd.DataFrame(rows)


def _extract_pan_vertical(lines: List[str], pdf_text: str) -> pd.DataFrame:
    """Layout PyMuPDF: 7 linhas por lançamento."""
    default_year, _ = _period_defaults(pdf_text)
    cur_year = default_year
    rows: list[dict[str, Any]] = []
    i = 0

    while i < len(lines):
        line = lines[i]
        if _is_junk(line):
            i += 1
            continue

        mh = _MONTH_HDR.match(line)
        if mh:
            month_name = _fold(mh.group(1))
            try:
                cur_year = int(mh.group(2))
            except ValueError:
                pass
            i += 1
            continue

        dm = _DATE_SHORT.match(line)
        if not dm or i + 6 >= len(lines):
            i += 1
            continue

        doc_ln = lines[i + 1]
        cat_ln = lines[i + 2]
        bal_ln = lines[i + 3]
        desc_ln = lines[i + 4]
        amt_ln = lines[i + 5]
        sign_ln = lines[i + 6]

        if not (
            _DOC_RE.match(doc_ln)
            and _MONEY_RE.match(bal_ln)
            and _MONEY_RE.match(amt_ln)
            and _SIGN_RE.match(sign_ln)
        ):
            i += 1
            continue

        day, month = int(dm.group(1)), int(dm.group(2))
        _append_row(
            rows,
            day,
            month,
            cur_year,
            cat_ln,
            desc_ln,
            sign_ln,
            _MONEY_RE.match(amt_ln).group(1),
            _MONEY_RE.match(bal_ln).group(1),
        )
        i += 7

    return pd.DataFrame(rows)


def extract_pan_from_text(pdf_text: str) -> pd.DataFrame:
    lines = [ln.strip() for ln in (pdf_text or "").splitlines() if ln.strip()]
    inline = _extract_pan_inline(lines, pdf_text)
    if len(inline) >= 3:
        return inline
    vertical = _extract_pan_vertical(lines, pdf_text)
    if len(vertical) >= len(inline):
        return vertical
    return inline


def try_extract(pdf_text: str) -> Optional[pd.DataFrame]:
    if not (pdf_text or "").strip():
        return None
    if not re.search(r"(?i)banco\s*pan|conta\s+pan", pdf_text):
        if not _PERIOD_RE.search(pdf_text):
            return None

    df = extract_pan_from_text(pdf_text)
    if df is None or df.empty:
        return None

    out = df.copy()
    out["_source"] = "pan"
    out["holder"] = extract_pan_holder(pdf_text)
    for col in ("date", "description", "amount", "balance", "counterparty", "_source", "holder"):
        if col not in out.columns:
            out[col] = None
    return out
