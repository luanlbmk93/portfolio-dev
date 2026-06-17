from __future__ import annotations

import re
from typing import Any, List, Optional, Tuple

import pandas as pd

_TRAIL_RE = re.compile(
    r"(\d{11,14})\s+R\$\s*(-?[\d.]+,\d{2})\s+R\$\s*(-?[\d.]+,\d{2})\s*$"
)
_DATE_LINE_RE = re.compile(r"^(\d{2}-\d{2}-\d{4})\b(?:\s+(.*))?$")
_DATE_ID_VALUES_RE = re.compile(
    r"^(\d{2}-\d{2}-\d{4})\s+(\d{11,14})\s+R\$\s*(-?[\d.]+,\d{2})\s+R\$\s*(-?[\d.]+,\d{2})\s*$"
)
_MASK_ONLY_RE = re.compile(r"^\${3,}$")


def _norm_money(s: str) -> float:
    t = (s or "").replace(" ", "").replace(".", "").replace(",", ".")
    try:
        return float(t)
    except ValueError:
        return 0.0


def _split_trail(text: str) -> Optional[Tuple[str, str, str, str]]:
    m = _TRAIL_RE.search(text)
    if not m:
        return None
    desc_prefix = text[: m.start()].strip()
    return desc_prefix, m.group(1), m.group(2), m.group(3)


def _to_pipeline_date(d: str) -> str:
    parts = (d or "").split("-")
    if len(parts) == 3:
        return f"{parts[0]}/{parts[1]}/{parts[2]}"
    return d


def _is_junk(line: str) -> bool:
    low = line.lower().strip()
    if not low:
        return True
    if re.match(r"^\d+/\d{2}$", line.strip()):
        return True
    if re.match(r"^\d/\d{2}$", line.strip()):
        return True
    if low == "extrato de conta":
        return True
    if "detalhe dos movimentos" in low:
        return True
    if re.match(r"^data\s+descri", low):
        return True
    if "cpf/cnpj:" in low:
        return True
    if low.startswith("de ") and " al " in low:
        return True
    if low.startswith("periodo:"):
        return True
    if "agência:" in low and "conta:" in low:
        return True
    if "saldo inicial:" in low or low.startswith("entradas:") or low.startswith("saidas:"):
        return True
    if re.match(r"^--\s*\d+\s+of\s+\d+\s*--$", line.strip()):
        return True
    if low.startswith("saldo final:"):
        return True
    return False


def _is_new_transaction_opener(line: str) -> bool:
    """
    Início de um novo bloco no texto reordenado pelo PDF (linha de “tipo” sem data na mesma linha).
    """
    low = line.lower().strip()
    if _MASK_ONLY_RE.match(line.strip()):
        return True
    if low.startswith("dinheiro "):
        return True
    if low.startswith("transferência ") or low.startswith("transferencia "):
        return True
    if low.startswith("pagamento "):
        return True
    if low.startswith("pix enviado") or low.startswith("pix recebido"):
        return True
    if low.startswith("liberação ") or low.startswith("liberacao "):
        return True
    if low.startswith("reserva por gastos"):
        return True
    if low.startswith("rendimentos"):
        return True
    if low.startswith("aprovação ") or low.startswith("aprovacao "):
        return True
    if "empréstimo" in low or "emprestimo" in low:
        return True
    if "antecipado" in low:
        return True
    return False


def extract_mercadopago_holder(pdf_text: str) -> Optional[str]:
    lines = [ln.rstrip() for ln in (pdf_text or "").splitlines()]
    for i, ln in enumerate(lines):
        if "EXTRATO DE CONTA" in ln.upper() and i + 1 < len(lines):
            cand = lines[i + 1].strip()
            if (
                cand
                and len(cand) > 2
                and "CPF/CNPJ" not in cand.upper()
                and not _DATE_LINE_RE.match(cand)
            ):
                return cand
    return None


def _holder_line(line: str, holder: Optional[str]) -> bool:
    if not holder:
        return False
    a = re.sub(r"\s+", " ", line.strip().lower())
    b = re.sub(r"\s+", " ", holder.strip().lower())
    return a == b


def _normalize_description(parts: List[str]) -> str:
    """Junta partes, remove máscara só-cifrão, compacta espaços."""
    cleaned: list[str] = []
    for p in parts:
        if not p or not p.strip():
            continue
        s = p.strip()
        if _MASK_ONLY_RE.match(s):
            continue
        cleaned.append(s)
    desc = re.sub(r"\s+", " ", " ".join(cleaned)).strip()
    return desc if desc else "(sem descrição)"


def extract_mercadopago_from_text(pdf_text: str) -> pd.DataFrame:
    holder = extract_mercadopago_holder(pdf_text or "")
    raw_lines = [ln.strip() for ln in (pdf_text or "").splitlines() if ln.strip()]

    rows: list[dict[str, Any]] = []
    carry: list[str] = []
    current_date: Optional[str] = None
    pending: list[str] = []

    def emit(date_raw: str, desc_parts: list[str], val_s: str) -> None:
        desc = _normalize_description(desc_parts)
        amt = _norm_money(val_s)
        rows.append(
            {
                "date": _to_pipeline_date(date_raw),
                "description": desc,
                "amount": amt,
                "balance": None,
            }
        )

    def consume_counterparty_lines(idx: int) -> Tuple[List[str], int]:
        """Após linha data+ID+valores, lê linhas de nome/contraparte até o próximo lançamento."""
        names: list[str] = []
        j = idx
        while j < len(raw_lines):
            ln = raw_lines[j]
            if _is_junk(ln):
                break
            if _DATE_ID_VALUES_RE.match(ln):
                break
            dm = _DATE_LINE_RE.match(ln)
            if dm:
                rest = (dm.group(2) or "").strip()
                if rest and _split_trail(rest):
                    break
                if rest and not _split_trail(rest):
                    if _is_new_transaction_opener(rest):
                        break
            if _is_new_transaction_opener(ln):
                break
            names.append(ln)
            j += 1
        return names, j

    i = 0
    while i < len(raw_lines):
        line = raw_lines[i]

        if holder and _holder_line(line, holder):
            i += 1
            continue
        if _is_junk(line):
            i += 1
            continue

        dm = _DATE_LINE_RE.match(line)
        if dm:
            d_raw = dm.group(1)
            rest = (dm.group(2) or "").strip()

            if current_date and pending:
                pass
            current_date = d_raw
            pending = list(carry)
            carry = []

            if rest:
                tr = _split_trail(rest)
                if tr:
                    desc_pre, _i2, vs, _ss = tr
                    name_lines, next_i = consume_counterparty_lines(i + 1)
                    emit( 
                        d_raw,
                        pending + ([desc_pre] if desc_pre else []) + name_lines,
                        vs,
                    )
                    current_date = None
                    pending = []
                    i = next_i
                    continue
                pending.append(rest)
            i += 1
            continue

        tr = _split_trail(line)
        if tr and current_date:
            desc_pre, _i3, vs, _ss = tr
            name_lines, next_i = consume_counterparty_lines(i + 1)
            emit(current_date, pending + ([desc_pre] if desc_pre else []) + name_lines, vs)
            current_date = None
            pending = []
            i = next_i
            continue

        if current_date is not None:
            pending.append(line)
        else:
            if _MASK_ONLY_RE.match(line.strip()):
                i += 1
                continue
            carry.append(line)
        i += 1

    return pd.DataFrame(rows)


def try_extract(pdf_text: str) -> Optional[pd.DataFrame]:
    df = extract_mercadopago_from_text(pdf_text or "")
    if df is None or df.empty:
        return None

    holder = extract_mercadopago_holder(pdf_text or "")
    out = df.copy()
    out["_source"] = "mercadopago"
    out["holder"] = holder

    cols = ["date", "description", "amount", "debit", "credit", "balance", "_source", "holder"]
    for c in cols:
        if c not in out.columns:
            out[c] = None
    return out[cols].copy()
