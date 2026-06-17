"""
PagBank (PagSeguro) — extrato da conta (PDF texto embutido).

Formatos:
  inline (pdfplumber): DD/MM/AAAA descrição -R$ valor  ou  R$ valor
  vertical (PyMuPDF):  data / descrição / valor (3 linhas)
"""
from __future__ import annotations

import re
import unicodedata
from typing import Any, List, Optional

import pandas as pd

_DATE_FULL = re.compile(r"^(\d{2}/\d{2}/\d{4})$")
_MONEY_TAIL = re.compile(r"(-?R\$\s*[\d.]+,\d{2})\s*$")
_MONEY_LINE = re.compile(r"^(-?R\$\s*[\d.]+,\d{2})$")
_INLINE_ROW = re.compile(
    r"^(\d{2}/\d{2}/\d{4})\s+(.+?)\s+(-?R\$\s*[\d.]+,\d{2})\s*$"
)
_PERIOD_RE = re.compile(
    r"(?i)periodo:\s*(\d{2}/\d{2}/\d{4})\s+a\s+(\d{2}/\d{2}/\d{4})"
)
_SALDO_DIA = re.compile(r"(?i)^saldo do dia\b")


def _fold(s: str) -> str:
    t = unicodedata.normalize("NFKD", s or "")
    t = "".join(c for c in t if not unicodedata.combining(c))
    return t.lower()


def _parse_signed_money(token: str) -> Optional[float]:
    if not token:
        return None
    s = (token or "").replace("\u00a0", " ").strip()
    neg = s.startswith("-")
    s = re.sub(r"[^\d,.]", "", s.replace("-", ""))
    if not s:
        return None
    s = s.replace(".", "").replace(",", ".")
    try:
        v = float(s)
    except ValueError:
        return None
    return -abs(v) if neg else abs(v)


def _is_junk(line: str) -> bool:
    s = (line or "").strip()
    if not s:
        return True
    low = _fold(s)
    if low in {"data", "descricao", "descrição", "valor"}:
        return True
    if low.startswith("data descricao") or low.startswith("data descri"):
        return True
    if low.startswith("extrato da conta"):
        return True
    if low.startswith("emitido em"):
        return True
    if low.startswith("periodo:"):
        return True
    if low.startswith("cnpj:"):
        return True
    if low.startswith("agencia") or low.startswith("agência"):
        return True
    if low.startswith("conta "):
        return True
    if "pagseguro internet" in low:
        return True
    if re.match(r"^\d{3}\s*-\s*pagseguro", low):
        return True
    return False


def _is_saldo_row(desc: str) -> bool:
    return bool(_SALDO_DIA.match((desc or "").strip()))


def extract_pagbank_holder(pdf_text: str) -> Optional[str]:
    text = pdf_text or ""
    for pat in (
        r"(?m)^\d{2}\.\d{3}\.\d{3}\s+([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ\s\.]{4,80})\s*$",
        r"(?i)extrato da conta\s*\n\s*emitido em:[^\n]+\n\s*periodo:[^\n]+\n\s*\d{2}\.\d{3}\.\d{3}\s+([^\n]+)",
    ):
        m = re.search(pat, text)
        if not m:
            continue
        name = re.sub(r"\s+", " ", m.group(1).strip())
        if _fold(name).startswith("cnpj"):
            continue
        return name
    return None


def _append_row(rows: List[dict[str, Any]], date_s: str, desc: str, money_tok: str) -> None:
    desc = re.sub(r"\s+", " ", (desc or "").strip())
    if not desc or _is_saldo_row(desc):
        return
    amt = _parse_signed_money(money_tok)
    if amt is None:
        return
    rows.append(
        {
            "date": date_s,
            "description": desc,
            "amount": amt,
            "balance": None,
            "counterparty": None,
        }
    )


def _extract_inline(lines: List[str]) -> pd.DataFrame:
    rows: list[dict[str, Any]] = []
    for line in lines:
        if _is_junk(line):
            continue
        m = _INLINE_ROW.match(line)
        if not m:
            continue
        _append_row(rows, m.group(1), m.group(2), m.group(3))
    return pd.DataFrame(rows)


def _extract_vertical(lines: List[str]) -> pd.DataFrame:
    rows: list[dict[str, Any]] = []
    i = 0
    while i < len(lines):
        line = lines[i]
        if _is_junk(line):
            i += 1
            continue
        if not _DATE_FULL.match(line):
            i += 1
            continue
        if i + 2 >= len(lines):
            break
        dt = line
        desc = lines[i + 1]
        money = lines[i + 2]
        if _MONEY_LINE.match(money):
            _append_row(rows, dt, desc, money)
            i += 3
            continue
        i += 1
    return pd.DataFrame(rows)


def extract_pagbank_from_text(pdf_text: str) -> pd.DataFrame:
    lines = [ln.strip() for ln in (pdf_text or "").splitlines() if ln.strip()]
    inline = _extract_inline(lines)
    if len(inline) >= 3:
        return inline
    vertical = _extract_vertical(lines)
    if len(vertical) >= len(inline):
        return vertical
    return inline


def _is_pagbank_text(text: str) -> bool:
    if not (text or "").strip():
        return False
    low = _fold(text)
    if "pagseguro internet" in low or "pagbank" in low:
        return True
    if "extrato da conta" in low and _PERIOD_RE.search(text):
        return True
    return False


def try_extract(pdf_text: str) -> Optional[pd.DataFrame]:
    if not _is_pagbank_text(pdf_text):
        return None

    df = extract_pagbank_from_text(pdf_text)
    if df is None or df.empty:
        return None

    out = df.copy()
    out["_source"] = "pagbank"
    out["holder"] = extract_pagbank_holder(pdf_text)
    for col in ("date", "description", "amount", "balance", "counterparty", "_source", "holder"):
        if col not in out.columns:
            out[col] = None
    return out
