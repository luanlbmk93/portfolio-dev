from __future__ import annotations

import re
from typing import Any, Dict, List, Optional

import pandas as pd


def _to_text(x: Any) -> str:
    return "" if x is None else str(x).strip()


def _cpf_only_digits(cpf: str) -> str:
    s = _to_text(cpf)
    s = re.sub(r"[^\d]", "", s)
    return s


def _iter_lines(text: str) -> List[str]:
    """
    Normaliza o texto extraído do PDF e tenta corrigir quebras comuns do pdfplumber:
    - valores monetários que aparecem sozinhos em uma linha (apenda na linha anterior)
    - espaços extras
    """
    lines_raw = [l.rstrip() for l in (text or "").splitlines()]
    lines: List[str] = []
    money_alone = re.compile(r"^\s*[-+]?\d{1,3}(?:\.\d{3})*,\d{2}\s*$")
    for raw in lines_raw:
        line = raw.strip()
        if not line:
            continue
        if lines and money_alone.match(line):
            # exemplo: "700,01" em linha separada
            lines[-1] = f"{lines[-1]} {line}".strip()
            continue
        lines.append(re.sub(r"\s+", " ", line).strip())
    return lines


def _extract_header(lines: List[str]) -> Dict[str, Optional[str]]:
    """
    Captura infos importantes no cabeçalho do Itaú:
    - holder, cpf, agency, account
    - period_start, period_end, issued_at
    """
    header: Dict[str, Optional[str]] = {
        "holder": None,
        "cpf": None,
        "agency": None,
        "account": None,
        "period_start": None,
        "period_end": None,
        "issued_at": None,
    }

    # Ex.: "LUANA ... 096.739.079-60 agência: 2924 conta: 057698-2"
    holder_re = re.compile(
        r"^(?P<holder>.+?)\s+(?P<cpf>\d{3}\.\d{3}\.\d{3}-\d{2}|\d{11})\s+ag(?:ê|e|�)ncia:\s*(?P<agency>\d+)\s+conta:\s*(?P<account>[\d\-]+)\b",
        flags=re.IGNORECASE,
    )

    # Ex.: "período de visualização: 01/01/2026 até 30/06/2026 emitido em: 05/05/2026 10:09:41"
    period_re = re.compile(
        r"per(?:i|í|�)odo de visualiza(?:c|ç|�)(?:a|ã|�)o:\s*(?P<start>\d{2}/\d{2}/\d{4})\s+at(?:e|é|�)\s+(?P<end>\d{2}/\d{2}/\d{4})\s+emitido em:\s*(?P<issued_date>\d{2}/\d{2}/\d{4})(?:\s+(?P<issued_time>\d{2}:\d{2}:\d{2}))?",
        flags=re.IGNORECASE,
    )

    for line in lines[:120]:
        if not header["holder"]:
            m = holder_re.search(line)
            if m:
                header["holder"] = _to_text(m.group("holder"))
                header["cpf"] = _cpf_only_digits(m.group("cpf")) or None
                header["agency"] = _to_text(m.group("agency")) or None
                header["account"] = _to_text(m.group("account")) or None

        if not header["period_start"]:
            m2 = period_re.search(line)
            if m2:
                header["period_start"] = _to_text(m2.group("start")) or None
                header["period_end"] = _to_text(m2.group("end")) or None
                issued_date = _to_text(m2.group("issued_date"))
                issued_time = _to_text(m2.group("issued_time"))
                header["issued_at"] = (issued_date + (" " + issued_time if issued_time else "")).strip() or None

        if header["holder"] and header["period_start"]:
            break

    return header


def try_extract(text: str) -> pd.DataFrame:
    """
    Extractor determinístico para extrato Itaú (PDF texto).

    Saída esperada pelo pipeline:
    - date (DD/MM/YYYY)
    - description
    - amount (string BR com sinal quando existir, ex: "-1.000,00" / "1.678,22")
    Campos extras (para meta): holder, cpf, agency, account, period_start, period_end, issued_at
    """
    lines = _iter_lines(text)
    if not lines:
        return pd.DataFrame()

    header = _extract_header(lines)

    # Linhas típicas:
    # "04/05/2026 PIX TRANSF FELIPE 02/05 -1.000,00"
    # "05/05/2026 SALDO DO DIA 0,21" (ignorar no nível de transações)
    tx_re = re.compile(r"^(?P<date>\d{2}/\d{2}/\d{4})\s+(?P<rest>.+)$")
    money_re = re.compile(r"[-+]?\d{1,3}(?:\.\d{3})*,\d{2}")

    rows: List[Dict[str, Any]] = []
    for line in lines:
        m = tx_re.match(line)
        if not m:
            continue
        dt = _to_text(m.group("date"))
        rest = _to_text(m.group("rest"))
        if not dt or not rest:
            continue

        # ignora "SALDO DO DIA" para não perder granularidade (saldo diário ≠ transação)
        if re.search(r"\bsaldo do dia\b", rest, flags=re.IGNORECASE):
            continue

        monies = money_re.findall(rest)
        if not monies:
            continue

        # melhor heurística: último valor monetário da linha é o valor da transação
        amount_raw = monies[-1]
        first_val_pos = rest.find(monies[0])
        desc = rest[:first_val_pos].strip() or rest

        rows.append(
            {
                "date": dt,
                "description": desc,
                "amount": amount_raw,
                "debit": None,
                "credit": None,
                "balance": None,
                "_source": "itau",
                "holder": header.get("holder"),
                "cpf": header.get("cpf"),
                "agency": header.get("agency"),
                "account": header.get("account"),
                "period_start": header.get("period_start"),
                "period_end": header.get("period_end"),
                "issued_at": header.get("issued_at"),
            }
        )

    df = pd.DataFrame(rows)
    if df.empty:
        return df
    # garante strings/None
    for c in ("date", "description", "amount", "holder", "cpf", "agency", "account", "period_start", "period_end", "issued_at"):
        if c in df.columns:
            df[c] = df[c].where(pd.notna(df[c]), None)
    return df

