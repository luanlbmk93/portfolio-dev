from __future__ import annotations

import re
from typing import Any, Optional

import pandas as pd

_DATE_REST = re.compile(r"^(\d{2}/\d{2}/\d{4})\s+(.+)$")
_VAL_TAIL = re.compile(r"(.+)\s+([+-])\s*R\$\s*([\d.]+,\d{2})\s*$")
_ORPHAN_VAL = re.compile(r"^(\d{2}/\d{2}/\d{4})\s+([+-])\s*R\$\s*([\d.]+,\d{2})\s*$")


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


def _money_from_groups(sign: str, br_value: str) -> Optional[float]:
    amt = _parse_br_money(br_value)
    if amt is None:
        return None
    v = abs(float(amt))
    if sign.strip() == "-":
        return -v
    return v


def extract_sicredi_holder(pdf_text: str) -> Optional[str]:
    text = pdf_text or ""
    m = re.search(r"(?i)titular\s*-\s*cpf[^\n]*\n\s*([^\n]+)", text)
    if m:
        ln = m.group(1).strip()
        if "Cooperativa:" in ln:
            part = ln.split("Cooperativa:")[0].strip()
            part = re.sub(r"\s*-\s*\d{3}\.\d{3}\.\d{3}-\d{2}\s*$", "", part).strip()
            part = re.sub(r"\s+", " ", part)
            if part:
                return part
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    for i, ln in enumerate(lines):
        if re.search(r"titular\s*-\s*cpf", ln, flags=re.IGNORECASE):
            if i + 1 < len(lines):
                nxt = lines[i + 1].strip()
                nxt = re.sub(r"\s*-\s*\d{3}\.\d{3}\.\d{3}-\d{2}.*$", "", nxt).strip()
                nxt = re.sub(r"\s+", " ", nxt)
                if nxt and "cooperativa" not in nxt.lower():
                    return nxt
    return None


def _is_junk(line: str) -> bool:
    s = (line or "").strip()
    if not s:
        return True
    low = s.lower()
    # Data de emissão do PDF ("05/03/2026 às 14:46:21 De ...") — não é lançamento
    if re.match(r"^\d{2}/\d{2}/\d{4}\s+às\s+\d", s, flags=re.IGNORECASE):
        return True
    if re.match(r"^R\$\s*[\d.,]+\s+R\$\s*[\d.,]+\s*$", s):
        return True
    if low.startswith("momento de emissão") or low.startswith("momento de emissao"):
        return True
    if low.startswith("extrato de conta corrente"):
        return True
    if re.search(r"titular\s*-\s*cpf", low):
        return True
    if low.startswith("dados da conta"):
        return True
    if "cooperativa:" in low and "conta:" in low:
        return True
    if low.startswith("saldo em conta") or low.startswith("saldo bloqueado"):
        return True
    if low.startswith("lançamento a conferir") or low.startswith("lancamento a conferir"):
        return True
    if low.startswith("bloqueio judicial"):
        return True
    if low.startswith("lançamentos futuros") or low.startswith("lancamentos futuros"):
        return True
    if low.startswith("movimentações de") or low.startswith("movimentacoes de"):
        return True
    if re.match(r"^data\s+descri", low):
        return True
    if low.startswith("saldo anterior"):
        return True
    if low.startswith("saldo do dia"):
        return True
    if low.startswith("cheque especial"):
        return True
    if "fim desse extrato" in low:
        return True
    if "central de atendimento" in low or "ouvidoria" in low and "0800" in s:
        return True
    if "ola@sicredi" in low:
        return True
    if re.match(r"^período das moviment", low) or re.match(r"^periodo das moviment", low):
        return True
    return False


def _parse_tx_line(rest: str) -> Optional[tuple[str, float]]:
    m = _VAL_TAIL.match(rest.strip())
    if not m:
        return None
    desc, sign, br = m.group(1).strip(), m.group(2), m.group(3)
    amt = _money_from_groups(sign, br)
    if amt is None:
        return None
    return desc, float(amt)


def _pending_is_trailing_suffix(pending: list[str]) -> bool:
    """Linhas curtas pós-lançamento (ex.: 'ONLINE S.A.') que fecham descrição do anterior, não prefixo do próximo."""
    if not pending or len(pending) > 3:
        return False
    joined = " ".join(pending).strip()
    if len(joined) > 72 or re.search(r"[+-]\s*R\$", joined):
        return False
    return True


def extract_sicredi_from_text(pdf_text: str) -> pd.DataFrame:
    lines = [ln.rstrip() for ln in (pdf_text or "").splitlines()]
    rows: list[dict[str, Any]] = []
    pending: list[str] = []

    for raw in lines:
        line = raw.strip()
        if _is_junk(line):
            continue

        m_or = _ORPHAN_VAL.match(line)
        if m_or:
            d_raw, sign, br = m_or.group(1), m_or.group(2), m_or.group(3)
            amt = _money_from_groups(sign, br)
            if amt is None:
                continue
            desc = " ".join(pending).strip()
            pending = []
            if not desc:
                continue
            rows.append({"date": d_raw, "description": desc, "amount": float(amt)})
            continue

        m_d = _DATE_REST.match(line)
        if not m_d:
            if line and not line.lower().startswith("de "):
                pending.append(line)
            continue

        d_raw, rest = m_d.group(1), m_d.group(2)
        parsed = _parse_tx_line(rest)
        if parsed is None:
            # Linhas com data de cabeçalho/resumo sem "R$" no padrão de valor não viram prefixo de lançamento
            if "r$" not in rest.lower():
                continue
            pending.append(line)
            continue

        if rows and _pending_is_trailing_suffix(pending):
            tail = " ".join(pending).strip()
            pending = []
            rows[-1]["description"] = f"{rows[-1]['description']} {tail}".strip()

        desc_part, amt = parsed
        desc = " ".join([*pending, desc_part]).strip()
        pending = []
        rows.append({"date": d_raw, "description": desc, "amount": float(amt)})

    return pd.DataFrame(rows)


def try_extract(pdf_text: str) -> Optional[pd.DataFrame]:
    df = extract_sicredi_from_text(pdf_text or "")
    if df is None or df.empty:
        return None

    holder = extract_sicredi_holder(pdf_text or "")
    out = df.copy()
    out["_source"] = "sicredi"

    cols = ["date", "description", "amount", "debit", "credit", "balance", "_source", "holder"]
    for c in cols:
        if c not in out.columns:
            out[c] = None
    out["holder"] = holder
    return out[cols].copy()
