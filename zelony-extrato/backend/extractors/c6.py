from __future__ import annotations

import re
import unicodedata
from datetime import datetime
from typing import Any, Optional

import pandas as pd

_MONEY = r"(?:\d{1,3}(?:\.\d{3})+|\d+),\d{2}"


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


def _parse_br_money(value: Any) -> Optional[float]:
    if value is None:
        return None
    s = str(value).replace("\u00a0", " ").strip()
    neg = bool(re.search(r"-\s*R?\$", s, re.I)) or s.startswith("-")
    s = re.sub(r"[^\d,.\-]", "", s)
    if not re.search(r"\d", s):
        return None
    s = s.lstrip("-")
    s = s.replace(".", "").replace(",", ".")
    try:
        v = float(s)
    except Exception:
        return None
    return -abs(v) if neg else v


def _extract_period_years(pdf_text: str) -> tuple[Optional[int], Optional[int]]:
    t = pdf_text or ""
    m = re.search(
        r"(?i)(?:janeiro|fevereiro|mar[cç]o|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\s+de\s+(\d{4})\s+at[eé]\s+(?:\d{1,2}\s+de\s+)?(?:janeiro|fevereiro|mar[cç]o|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\s+de\s+(\d{4})",
        t,
    )
    if m:
        return int(m.group(1)), int(m.group(2))
    m2 = re.search(r"(?i)extrato\s+per[ií]odo.*?(\d{4})", t)
    if m2:
        y = int(m2.group(1))
        return y, y
    return None, None


def extract_c6_holder(pdf_text: str) -> Optional[str]:
    for ln in (pdf_text or "").splitlines()[:8]:
        s = ln.strip()
        if not s or re.search(r"(?i)^extrato\s+exportado", s):
            continue
        # "65.670.716 NOME ... 65.670.716/0001-41" (separador pode vir corrompido no PDF)
        m = re.match(
            r"^[\d.]+\s+(.+?)\s+(?:[-–—]|\S{0,3})\s*[\d]{2,3}\.[\d]{3}\.[\d]{3}/",
            s,
        )
        if m:
            name = m.group(1).strip()
            if len(name.split()) >= 2:
                return name[:120]
        m2 = re.match(r"^[\d.]+\s+([A-ZÀ-Ü][A-ZÀ-Üa-zà-ü\s]{4,}?)\s+[\d./]", s)
        if m2:
            name = m2.group(1).strip()
            if len(name.split()) >= 2:
                return name[:120]
    return None


def extract_c6_from_text(pdf_text: str) -> pd.DataFrame:
    """
    Extrato C6 (app / exportado):
    DD/MM DD/MM Tipo Descrição Valor
    Ex.: 01/04 01/04 Entrada PIX Pix recebido de SWIFT SOFT LTDA R$ 2.304,00
    """
    lines = [ln.strip() for ln in (pdf_text or "").splitlines() if ln.strip()]
    rows: list[dict[str, Any]] = []

    year_start, year_end = _extract_period_years(pdf_text)
    default_year = year_end or year_start or datetime.now().year
    current_year = default_year

    tx_re = re.compile(
        rf"^(\d{{2}}/\d{{2}})\s+(\d{{2}}/\d{{2}})\s+(.+?)\s+(-?R?\$?\s*{_MONEY})\s*$",
        flags=re.IGNORECASE,
    )
    month_hdr_re = re.compile(
        r"^(Janeiro|Fevereiro|Mar[cç]o|Abril|Maio|Junho|Julho|Agosto|Setembro|Outubro|Novembro|Dezembro)\s+(\d{4})\s*\(",
        flags=re.IGNORECASE,
    )

    junk = (
        "extrato exportado",
        "extrato per",
        "saldo do dia",
        "sem lançamentos",
        "sem lancamentos",
        "data data",
        "tipo descri",
        "lançamento contábil",
        "lancamento contabil",
        "entradas: r$",
        "saídas: r$",
        "saidas: r$",
        "informações sujeitas",
        "atendimento 24",
        "ouvidoria",
    )

    for ln in lines:
        low = ln.lower()

        mh = month_hdr_re.match(ln)
        if mh:
            current_year = int(mh.group(2))
            continue

        if any(j in low for j in junk):
            continue
        if re.match(r"^\d+/\d+$", ln):
            continue

        m = tx_re.match(ln)
        if not m:
            continue

        # data contábil = segunda coluna (DD/MM)
        dd, mm = (int(x) for x in m.group(2).split("/"))
        yy = current_year
        if year_start and year_end and year_start != year_end:
            # virada de ano no período do extrato
            if mm <= 2 and default_year == year_end:
                yy = year_end
            elif mm >= 11 and default_year == year_start:
                yy = year_start

        try:
            dt = datetime(yy, mm, dd).strftime("%d/%m/%Y")
        except Exception:
            continue

        amt = _parse_br_money(m.group(4))
        if amt is None or float(amt) == 0:
            continue

        desc = re.sub(r"\s+", " ", m.group(3).strip())
        rows.append({"date": dt, "description": desc, "amount": float(amt)})

    return pd.DataFrame(rows)


def try_extract(pdf_text: str, pdf_path: Optional[str] = None) -> Optional[pd.DataFrame]:
    _ = pdf_path
    df = extract_c6_from_text(pdf_text or "")
    if df is None or df.empty:
        return None

    holder = extract_c6_holder(pdf_text or "")
    out = df.copy()
    out["_source"] = "c6"
    out["holder"] = holder

    cols = ["date", "description", "amount", "debit", "credit", "balance", "_source", "holder"]
    for c in cols:
        if c not in out.columns:
            out[c] = None
    return out[cols].copy()
