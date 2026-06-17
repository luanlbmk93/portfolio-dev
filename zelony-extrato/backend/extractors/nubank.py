from __future__ import annotations
import re
from typing import Any, Optional
import pandas as pd


def _parse_br_money(value: Any) -> Optional[float]:
    if value is None: return None
    s = str(value).replace("\u00a0", " ")
    s = re.sub(r"[^\d,.\-]", "", s)
    if not re.search(r"\d", s): return None
    s = s.replace(".", "").replace(",", ".")
    try:
        return float(s)
    except ValueError:
        return None


def _nubank_holder_candidate_ok(line: str) -> bool:
    s = line.strip()
    if len(s) < 3 or not re.search(r"[A-Za-zÀ-ÿáéíóúãõç]", s):
        return False
    if re.search(r"\d{3}\.\d{3}\.\d{3}-\d{2}", s):
        return False
    if len(re.findall(r"\d", s)) > 5:
        return False
    low = s.lower()
    if any(
        x in low
        for x in (
            "cpf",
            "agência",
            "agencia",
            "conta",
            "período",
            "periodo",
            "extrato",
            "nubank",
            "valores em",
            "movimenta",
            "saldo inicial",
            "total de entradas",
        )
    ):
        return False
    return True


def extract_nubank_holder(pdf_text: str) -> Optional[str]:
    """
    Titular costuma estar na primeira linha; a linha seguinte traz CPF + agência + conta.
    """
    if not pdf_text:
        return None

    lines = [ln.strip() for ln in pdf_text.splitlines() if ln.strip()]

    # Layout típico: [NOME]\n[CPF ... Agência ... Conta ...]
    for i, line in enumerate(lines[:30]):
        low = line.lower()
        if i > 0 and re.search(r"\bcpf\b", low) and re.search(r"\d", line):
            cand = lines[i - 1].strip()
            if _nubank_holder_candidate_ok(cand):
                return cand

    for line in lines[:15]:
        if not _nubank_holder_candidate_ok(line):
            continue
        if len(line.split()) >= 2:
            return line.strip()
        if len(line) >= 6 and re.search(r"[A-Za-zÀ-ÿ]", line):
            return line.strip()

    return None


def extract_from_text(pdf_text: str) -> pd.DataFrame:
    lines = [ln.strip() for ln in (pdf_text or "").splitlines() if ln.strip()]
    
    date_re = re.compile(r"(\d{2}\s+[A-Z]{3}\s+\d{4})")
    money_re = re.compile(r"([-+]?\s*\d{1,3}(?:\.\d{3})*,\d{2})$")
    
    rows = []
    current_date = None
    desc_buffer = []

    saida_keywords = ["compra", "pagamento", "enviada", "aplicação", "saída", "débito", "fatura"]

    for line in lines:
        date_match = date_re.search(line.upper())
        if date_match:
            current_date = date_match.group(1)
            line = date_re.sub("", line).strip()

        norm_line = line.lower()
        resumo_terms = ["total de entradas", "total de saídas", "saldo final", "saldo inicial", "rendimento líquido"]
        if any(term in norm_line for term in resumo_terms):
            desc_buffer = []
            continue

        money_match = money_re.search(line)
        if money_match and current_date:
            val_str = money_match.group(1)
            raw_desc = line.replace(val_str, "").strip()
            
            full_desc = " ".join(desc_buffer + [raw_desc]).strip()
            desc_buffer = [] 

            val = _parse_br_money(val_str)
            if val is not None:
                is_saida = any(kw in full_desc.lower() for kw in saida_keywords)
                val = -abs(val) if is_saida else abs(val)
                
                rows.append({
                    "date": current_date,
                    "description": full_desc,
                    "amount": val
                })
        else:
            if line and not line.startswith("Extrato gerado") and "página" not in norm_line:
                desc_buffer.append(line)

    return pd.DataFrame(rows)


def try_extract(pdf_text: str) -> Optional[pd.DataFrame]:
    df = extract_from_text(pdf_text)
    if df is None or df.empty:
        return None

    holder = extract_nubank_holder(pdf_text)  # 👈 AQUI

    out = df.copy()
    out["_source"] = "nubank"
    out["holder"] = holder  # 👈 NOME

    for col in ("date", "description", "amount", "debit", "credit", "balance", "_source", "holder"):
        if col not in out.columns:
            out[col] = None

    return out[
        ["date", "description", "amount", "debit", "credit", "balance", "_source", "holder"]
    ].copy()