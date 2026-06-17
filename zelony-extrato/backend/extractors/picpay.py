from __future__ import annotations

import re
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


def _parse_picpay_day_header(line: str) -> Optional[str]:
    """Ex.: '02 de maio 2026 Saldo ao final do dia: R$ 351,17' -> DD/MM/AAAA."""
    s = re.sub(r"\s+", " ", (line or "").strip()).lower()
    # PicPay: "DD de mês AAAA" (sem segundo "de" antes do ano)
    m = re.match(
        r"^(\d{1,2})\s+de\s+([a-zçãõáéíóúâêô]+)\s+(\d{4})\s+saldo ao final do dia\s*:?",
        s,
    )
    if not m:
        return None
    day = int(m.group(1))
    month_name = m.group(2)
    year = int(m.group(3))
    month = _MONTHS.get(month_name)
    if not month:
        return None
    try:
        dt = datetime(year, month, day)
        return dt.strftime("%d/%m/%Y")
    except Exception:
        return None


TX_RE = re.compile(
    r"^(\d{1,2}):(\d{2})\s+(.+?)(?:\s+com\s+saldo)?\s+([+\u2212\-−])\s*R\$\s*([\d.]+,\d{2})\s*(.*)$",
    re.IGNORECASE,
)


def _picpay_junk_line(line: str) -> bool:
    s = (line or "").strip()
    low = s.lower()
    if not s:
        return True
    if "hora tipo valor" in low and "origem" in low:
        return True
    if low.startswith("extrato de conta"):
        return True
    if "picpay serviços" in low or "picpay servicos" in low:
        return True
    if low.startswith("documento emitido em:"):
        return True
    if low.startswith("cnpj:"):
        return True
    if re.match(r"^--\s*\d+\s+(?:of|de)\s+\d+\s*--$", low):
        return True
    if "dias úteis" in low or "dias uteis" in low:
        return True
    if low.startswith("período") and "extrato" in low:
        return True
    if "saldo final do período" in low or "saldo final do periodo" in low:
        return True
    if re.match(r"^\d{1,2}\s+de\s+\w+\s+de\s+\d{4}\s+a\s*$", low):
        return True
    return False


def _continuation_stops(line: str) -> bool:
    s = (line or "").strip()
    if not s:
        return True
    if TX_RE.match(s):
        return True
    if _parse_picpay_day_header(s):
        return True
    if s.lower().startswith("cpf:"):
        return True
    if _picpay_junk_line(s):
        return True
    return False


def _strip_saldo_suffix(fragment: str) -> str:
    t = re.sub(r"\s+", " ", (fragment or "").strip())
    t = re.sub(r"\s*(bra\s+)?com\s+saldo\s*$", "", t, flags=re.IGNORECASE)
    return t.strip()


def extract_picpay_holder(pdf_text: str) -> Optional[str]:
    lines = [l.rstrip() for l in (pdf_text or "").splitlines()]
    for i, ln in enumerate(lines):
        s = ln.strip()
        if s.lower().startswith("cpf:") and i > 0:
            prev = lines[i - 1].strip()
            if (
                prev
                and not prev.lower().startswith("cpf:")
                and "agência:" not in prev.lower()
                and "agencia:" not in prev.lower()
            ):
                return prev
    return None


def extract_picpay_from_text(pdf_text: str) -> pd.DataFrame:
    lines = [l.rstrip() for l in (pdf_text or "").splitlines()]
    rows: list[dict[str, Any]] = []
    current_date: Optional[str] = None

    i = 0
    while i < len(lines):
        raw = lines[i]
        line = raw.strip()

        if _picpay_junk_line(line) and not _parse_picpay_day_header(line):
            i += 1
            continue

        d = _parse_picpay_day_header(line)
        if d:
            current_date = d
            i += 1
            continue

        m = TX_RE.match(line)
        if m and current_date:
            hh, mm, tipo, sign, br_val, tail = (
                m.group(1),
                m.group(2),
                m.group(3).strip(),
                m.group(4),
                m.group(5),
                (m.group(6) or "").strip(),
            )
            abs_amt = _parse_br_money(br_val)
            if abs_amt is None:
                i += 1
                continue
            sign_ch = sign.replace("−", "-").replace("\u2212", "-")
            amount = float(abs_amt) if sign_ch == "+" else -float(abs_amt)

            tail_clean = _strip_saldo_suffix(tail) if tail else ""
            cont: list[str] = []
            i += 1
            while i < len(lines):
                nxt = lines[i].strip()
                if _continuation_stops(nxt):
                    if _picpay_junk_line(nxt) or nxt.lower().startswith("cpf:"):
                        pass
                    break
                cont.append(_strip_saldo_suffix(nxt))
                i += 1

            # PDF costuma trazer "Cidade Bra" antes do estabelecimento nas linhas seguintes.
            if len(cont) >= 2:
                cont = list(reversed(cont))

            merchant = " ".join(p for p in ([tail_clean] if tail_clean else []) + cont if p)
            merchant = re.sub(r"\s+", " ", merchant).strip()
            desc = f"[{hh}:{mm}] {tipo}"
            if merchant:
                desc = f"{desc} — {merchant}"

            rows.append(
                {
                    "date": current_date,
                    "description": desc,
                    "amount": amount,
                }
            )
            continue

        i += 1

    return pd.DataFrame(rows)


def try_extract(pdf_text: str) -> Optional[pd.DataFrame]:
    df = extract_picpay_from_text(pdf_text or "")
    if df is None or df.empty:
        return None

    holder = extract_picpay_holder(pdf_text or "")
    out = df.copy()
    out["_source"] = "picpay"
    out["holder"] = holder

    cols = ["date", "description", "amount", "debit", "credit", "balance", "_source", "holder"]
    for c in cols:
        if c not in out.columns:
            out[c] = None
    return out[cols].copy()
