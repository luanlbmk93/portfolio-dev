from __future__ import annotations

import re
from typing import Any, Optional

import pandas as pd

_TX_START_RE = re.compile(
    r"^(\d{2}/\d{2}/\d{2})\s+(Entrada|Saída|Saida)\s+(.*)$",
    flags=re.IGNORECASE,
)
_AMOUNT_TOKEN_RE = re.compile(r"(?:-\s*)?R\$\s*[\d\.,]+")


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


def _expand_dd_mm_yy(d: str) -> str:
    parts = (d or "").strip().split("/")
    if len(parts) != 3:
        return d
    dd, mm, yy = parts
    if len(yy) == 2 and yy.isdigit():
        y = int(yy)
        yyyy = 2000 + y if y < 70 else 1900 + y
        return f"{dd}/{mm}/{yyyy}"
    return d


def _split_valor_saldo(rest: str) -> Optional[tuple[str, str, str, str]]:
    """
    Bloco após o tipo: descrição inline, string valor, string saldo, sufixo na mesma linha (contraparte).
    """
    ms = list(_AMOUNT_TOKEN_RE.finditer(rest))
    if len(ms) < 2:
        return None
    v_m, s_m = ms[-2], ms[-1]
    inline = rest[: v_m.start()].strip()
    valor_s = rest[v_m.start() : v_m.end()]
    saldo_s = rest[s_m.start() : s_m.end()]
    tail = rest[s_m.end() :].strip()
    return inline, valor_s, saldo_s, tail


def _normalize_amount(tipo: str, valor_raw: str) -> Optional[float]:
    tipo_l = (tipo or "").strip().lower()
    amt = _parse_br_money(valor_raw)
    if amt is None:
        return None
    if "entrada" in tipo_l:
        return abs(float(amt))
    if amt > 0:
        return -abs(float(amt))
    return float(amt)


def extract_stone_holder(pdf_text: str) -> Optional[str]:
    lines = [ln.strip() for ln in (pdf_text or "").splitlines()]
    for i, ln in enumerate(lines):
        if re.match(r"^Nome\s+Documento\s*$", ln, flags=re.IGNORECASE):
            if i + 1 >= len(lines):
                return None
            cand = lines[i + 1].strip()
            cand = re.sub(r"\s+\d{2}\.\d{3}\.\d{3}/\S+$", "", cand).strip()
            cand = re.sub(r"\s+", " ", cand)
            return cand or None
    return None


def _is_suffix_continuation(line: str) -> bool:
    """
    Linhas que continuam o lançamento anterior (Pix, Automática, bloco Ag:, etc.).
    O que não casa aqui vira prefixo do próximo lançamento (ex.: nome do cliente antes de uma Entrada).
    """
    s = (line or "").strip()
    if not s:
        return False
    low = s.lower()
    if "|" in s:
        return True
    if low.startswith("ag:"):
        return True
    low_nc = (
        low.replace("ç", "c")
        .replace("ã", "a")
        .replace("õ", "o")
        .replace("á", "a")
        .replace("é", "e")
        .replace("í", "i")
        .replace("ó", "o")
        .replace("ú", "u")
    )
    if low_nc in {"automatica", "antecipacao"}:
        return True
    return False


def _is_junk_line(line: str) -> bool:
    s = (line or "").strip()
    if not s:
        return True
    low = s.lower()
    if low.startswith("extrato de conta corrente"):
        return True
    if low.startswith("emitido em"):
        return True
    if re.match(r"^p[áa]gina\s+\d+\s+de\s+\d+\s*$", low):
        return True
    if low.startswith("dados da conta"):
        return True
    if re.match(r"^nome\s+documento\s*$", low):
        return True
    if re.match(r"^institui[cç][aã]o\s+ag[eê]ncia\s+conta\s*$", low):
        return True
    if re.search(r"stone\s+institui[cç][aã]o\s+de\s+pagamento\s+s\.a\.", low) and re.search(
        r"\b0001\b", s
    ):
        return True
    if low.startswith("período:") or low.startswith("periodo:"):
        return True
    if "informações do comprovante" in low or "informacoes do comprovante" in low:
        return True
    if "ouvidoria@stone" in low:
        return True
    if "meajuda@stone" in low:
        return True
    if "fale com a gente" in low and "whatsapp" in low:
        return True
    if re.search(r"\bcnpj\b", low) and ("stone" in low or "9680" in low):
        return True
    return False


def _is_table_header(line: str) -> bool:
    s = re.sub(r"\s+", " ", (line or "").strip()).lower()
    return bool(
        re.match(
            r"^data\s+tipo\s+descri",
            s,
        )
    )


def extract_stone_from_text(pdf_text: str) -> pd.DataFrame:
    lines = [ln.rstrip() for ln in (pdf_text or "").splitlines()]
    rows: list[dict[str, Any]] = []

    pending_prefix: list[str] = []
    suffix: list[str] = []
    cur: Optional[dict[str, Any]] = None
    seen_header = False

    def flush_cur() -> None:
        nonlocal cur, suffix
        if cur is None:
            suffix = []
            return
        extra = " ".join(suffix).strip()
        if extra:
            cur["description"] = f"{cur['description']} {extra}".strip()
        rows.append(cur)
        cur = None
        suffix = []

    for raw in lines:
        line = raw.strip()
        if _is_junk_line(line):
            continue
        if _is_table_header(line):
            seen_header = True
            pending_prefix = []
            continue
        if not seen_header:
            continue

        m = _TX_START_RE.match(line)
        if not m:
            if cur is None:
                pending_prefix.append(line)
            elif _is_suffix_continuation(line):
                suffix.append(line)
            else:
                flush_cur()
                pending_prefix.append(line)
            continue

        flush_cur()
        d_raw, tipo, rest = m.group(1), m.group(2), m.group(3)
        split = _split_valor_saldo(rest)
        if split is None:
            pending_prefix = []
            continue
        inline, valor_s, saldo_s, tail = split
        amt = _normalize_amount(tipo, valor_s)
        bal = _parse_br_money(saldo_s)
        if amt is None:
            pending_prefix = []
            continue

        desc_parts = [*pending_prefix, inline]
        if tail:
            desc_parts.append(tail)
        pending_prefix = []
        desc = re.sub(r"\s+", " ", " ".join(x for x in desc_parts if x).strip())

        cur = {
            "date": _expand_dd_mm_yy(d_raw),
            "description": desc,
            "amount": float(amt),
            "balance": float(bal) if bal is not None else None,
        }

    flush_cur()

    return pd.DataFrame(rows)


def try_extract(pdf_text: str) -> Optional[pd.DataFrame]:
    df = extract_stone_from_text(pdf_text or "")
    if df is None or df.empty:
        return None

    holder = extract_stone_holder(pdf_text or "")
    out = df.copy()
    out["_source"] = "stone"

    cols = ["date", "description", "amount", "debit", "credit", "balance", "_source", "holder"]
    for c in cols:
        if c not in out.columns:
            out[c] = None
    out["holder"] = holder
    return out[cols].copy()
