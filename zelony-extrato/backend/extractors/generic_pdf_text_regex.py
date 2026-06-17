from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any, Dict, Iterable, List, Optional

import pandas as pd


def _to_text(x: Any) -> str:
    return "" if x is None else str(x).strip()


def normalize_word(w: str) -> str:
    return (
        _to_text(w)
        .lower()
        .replace("ç", "c")
        .replace("ã", "a")
        .replace("á", "a")
        .replace("à", "a")
        .replace("â", "a")
        .replace("é", "e")
        .replace("ê", "e")
        .replace("í", "i")
        .replace("ó", "o")
        .replace("ô", "o")
        .replace("õ", "o")
        .replace("ú", "u")
    )


def parse_br_money(value: Any) -> Optional[float]:
    if value is None:
        return None
    if isinstance(value, (int, float)) and pd.notna(value):
        return float(value)
    s = _to_text(value)
    if not s:
        return None
    s = s.replace("\u00a0", " ")
    s = re.sub(r"[^\d,.\-+]", "", s)
    if not re.search(r"\d", s):
        return None
    s = s.replace(".", "").replace(",", ".")
    s = re.sub(r"(?<=.)[+\-]+", "", s)
    try:
        return float(s)
    except ValueError:
        return None


@dataclass(frozen=True)
class ExtractedRow:
    date: Optional[str] = None
    description: Optional[str] = None
    amount: Optional[Any] = None
    debit: Optional[Any] = None
    credit: Optional[Any] = None
    balance: Optional[Any] = None


def _rows_to_df(rows: Iterable[ExtractedRow]) -> pd.DataFrame:
    data = [
        {
            "date": r.date,
            "description": r.description,
            "amount": r.amount,
            "debit": r.debit,
            "credit": r.credit,
            "balance": r.balance,
        }
        for r in rows
    ]
    return pd.DataFrame(data)


def try_extract(pdf_text: str) -> Optional[pd.DataFrame]:
    """
    Fallback genérico determinístico para PDF com texto:
    - Detecta data (DD/MM/YYYY, DD/MM, ou DD MMM YYYY)
    - Detecta valor no fim da linha
    - Ajusta o sinal por palavras-chave (saída/entrada) quando o valor é absoluto
    Retorna None se não encontrar nenhuma transação.
    """
    text = pdf_text or ""
    if not text.strip():
        return None

    # data "blindada": evita capturar pedaços de CNPJ
    regex_date = re.compile(
        r"(?:^|\s)(\d{2}\s+(?:JAN|FEV|MAR|ABR|MAI|JUN|JUL|AGO|SET|OUT|NOV|DEZ)\s+\d{4}|\d{2}/\d{2}/\d{4}|\d{2}/\d{2})(?=\s|$)",
        re.IGNORECASE,
    )
    regex_value_end = re.compile(r"([+-]?\s?(?:R\$\s?)?\d{1,3}(?:\.\d{3})*,\d{2})$")

    ignore_words = ("saldo", "total", "rendimento", "fechamento")
    out_words = (
        "enviad",
        "pagamento",
        "pagto",
        "compra",
        "tarifa",
        "debito",
        "débito",
        "saque",
        "saida",
        "saída",
        "tributo",
        "boleto",
        "fatura",
        "cartao",
        "cartão",
        "ted",
        "doc",
        "taxa",
        "iof",
        "juros",
        "multa",
    )
    in_words = (
        "recebid",
        "estorno",
        "resgate",
        "credito",
        "crédito",
        "entrada",
        "deposito",
        "depósito",
        "reembolso",
        "salario",
        "salário",
    )

    rows: List[ExtractedRow] = []
    current_date: Optional[str] = None

    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        lnorm = normalize_word(line)

        md = regex_date.search(line)
        if md:
            current_date = md.group(1).strip().upper()

        if any(w in lnorm for w in ignore_words):
            continue

        if not current_date:
            continue

        value_str: Optional[str] = None
        value_span_start: int = 0
        mv = regex_value_end.search(line)
        if mv:
            value_str = mv.group(1)
            value_span_start = mv.start(1)
        else:
            # Extratos em colunas (ex.: Caixa): valor pode não estar no último token da linha OCR
            monies = list(re.finditer(r"[+-]?\s*(?:R\$\s*)?\d{1,3}(?:\.\d{3})*,\d{2}\b", line))
            if monies:
                lastm = monies[-1]
                value_str = lastm.group(0)
                value_span_start = lastm.start()

        if not value_str:
            continue

        value = parse_br_money(value_str)
        if value is None or float(value) == 0:
            continue

        # descrição = tudo antes do valor (não confia em coluna “fim de linha”)
        desc = line[:value_span_start].strip() or line
        if not desc:
            desc = line

        # sinal determinístico por palavras-chave quando o valor é absoluto
        v = abs(float(value))
        is_out = any(w in lnorm for w in out_words)
        is_in = any(w in lnorm for w in in_words)

        if is_out and not is_in:
            v = -v
        elif is_in and not is_out:
            v = v
        else:
            # fallback: respeita sinal explícito se existir, senão mantém positivo
            if re.search(r"^[^\d]*-\s*\d", value_str):
                v = -abs(v)
            else:
                v = abs(v)

        rows.append(ExtractedRow(date=current_date, description=desc, amount=v))

    if not rows:
        return None

    df = _rows_to_df(rows)
    df["_source"] = "generic_pdf_text_regex"
    for col in ("date", "description", "amount", "debit", "credit", "balance", "_source"):
        if col not in df.columns:
            df[col] = None
    return df[["date", "description", "amount", "debit", "credit", "balance", "_source"]].copy()

