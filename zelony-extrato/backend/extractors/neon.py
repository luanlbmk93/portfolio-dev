from __future__ import annotations

import re
import unicodedata
from typing import Any, Optional

import pandas as pd

# Descrição … DD/MM/AAAA HH?MM R$ valor R$ saldo (PDF Neon às vezes insere \x00 entre hora e "R$")
_ROW_RE = re.compile(
    r"^(.+?)\s+(\d{2}/\d{2}/\d{4})\s+(\d{2})[^\d](\d{2})\s+R\$\s*([\d.]+,\d{2})\s+R\$\s*([\d.]+,\d{2})\s*(?:-\s*)?$",
    flags=re.UNICODE,
)


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


def _valor_abs_from_groups(br: str) -> Optional[float]:
    v = _parse_br_money(br)
    if v is None:
        return None
    return abs(float(v))


def _first_row_signed_amount(desc: str, valor_abs: float) -> float:
    """Primeira linha do extrato: sem saldo anterior, infere sinal pelo texto Neon."""
    d = _fold(desc)
    if "para pix via" in d or "credito para pix" in d or "crdito para pix" in d:
        return valor_abs
    if "pix recebido" in d:
        return valor_abs
    if "pix enviado" in d:
        return -valor_abs
    if "pagamento fatura" in d:
        return -valor_abs
    if "aplica" in d and "poupa" in d:
        return -valor_abs
    if re.match(r"^pix cr", d) or "pix credito" in d or "pix cred" in d:
        return -valor_abs
    # compras no débito / estabelecimento sem prefixo PIX
    return -valor_abs


def extract_neon_holder(pdf_text: str) -> Optional[str]:
    text = pdf_text or ""
    m = re.search(
        r"(?i)cliente\s+ag[eê]ncia[^\n]*\n\s*([^\n]+)",
        text,
    )
    if not m:
        return None
    ln = re.sub(r"[\x00\u200b]+", " ", m.group(1).strip())
    # Nome antes de agência (4 dígitos) + conta
    ln = re.sub(r"\s+\d{4}\s+[\d\-\s.]+\s*$", "", ln).strip()
    ln = re.sub(r"\s+", " ", ln)
    return ln or None


def _is_junk(line: str) -> bool:
    s = (line or "").strip()
    if not s:
        return True
    low = _fold(s)
    if low.startswith("conta digital"):
        return True
    if "neon pagamentos" in low:
        return True
    if low.startswith("extrato por"):
        return True
    if low.startswith("cliente ag"):
        return True
    if low.startswith("ano base"):
        return True
    if low.startswith("periodo de") or low.startswith("perodo de"):
        return True
    if "descricao data hora valor saldo" in low.replace(" ", "") or "data hora valor saldo" in low:
        return True
    if low.startswith("chat do app") or "ouvidoria" in low:
        return True
    if "timeneon" in low or "/timeneon" in low:
        return True
    if re.search(r"\b0800\b", low) and re.search(r"\d{4}", low):
        return True
    return False


def extract_neon_from_text(pdf_text: str) -> pd.DataFrame:
    lines = [ln.rstrip() for ln in (pdf_text or "").splitlines()]
    rows: list[dict[str, Any]] = []
    prev_saldo: Optional[float] = None

    for raw in lines:
        line = re.sub(r"[\x00\u200b\u200c\u200d\ufeff]+", " ", (raw or "").strip())
        line = re.sub(r"\s+", " ", line).strip()
        if _is_junk(line):
            continue
        m = _ROW_RE.match(line)
        if not m:
            continue
        desc = re.sub(r"\s+", " ", m.group(1).strip())
        d_raw = m.group(2)
        valor_abs = _valor_abs_from_groups(m.group(5))
        saldo = _parse_br_money(m.group(6))
        if valor_abs is None or saldo is None:
            continue

        if prev_saldo is not None:
            amt = float(saldo) - float(prev_saldo)
        else:
            amt = float(_first_row_signed_amount(desc, float(valor_abs)))

        prev_saldo = float(saldo)
        rows.append(
            {
                "date": d_raw,
                "description": desc,
                "amount": float(amt),
                "balance": float(saldo),
            }
        )

    return pd.DataFrame(rows)


def try_extract(pdf_text: str) -> Optional[pd.DataFrame]:
    df = extract_neon_from_text(pdf_text or "")
    if df is None or df.empty:
        return None

    holder = extract_neon_holder(pdf_text or "")
    out = df.copy()
    out["_source"] = "neon"

    cols = ["date", "description", "amount", "debit", "credit", "balance", "_source", "holder"]
    for c in cols:
        if c not in out.columns:
            out[c] = None
    out["holder"] = holder
    return out[cols].copy()
