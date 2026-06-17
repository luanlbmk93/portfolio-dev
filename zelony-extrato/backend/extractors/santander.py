from __future__ import annotations

import re
import unicodedata
from datetime import datetime
from typing import Any, Optional

import pandas as pd

_MONEY = r"(?:\d{1,3}(?:\.\d{3})+|\d+),\d{2}"
_MONEY_SIGNED = rf"[-+]?{_MONEY}-?"

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


def _norm_token(s: str) -> str:
    s = unicodedata.normalize("NFD", (s or "").lower())
    return "".join(c for c in s if unicodedata.category(c) != "Mn")


def _parse_br_money(value: Any) -> Optional[float]:
    if value is None:
        return None
    s = str(value).replace("\u00a0", " ").strip()
    neg_trailing = s.endswith("-") and not s.startswith("-")
    if neg_trailing:
        s = s[:-1].strip()
    s = re.sub(r"[^\d,.\-+]", "", s)
    if not re.search(r"\d", s):
        return None
    neg_leading = s.startswith("-")
    s = s.lstrip("-+")
    s = s.replace(".", "").replace(",", ".")
    try:
        v = float(s)
    except Exception:
        return None
    if neg_trailing or neg_leading:
        return -abs(v)
    return v


def _detect_format(pdf_text: str) -> str:
    t = pdf_text or ""
    if re.search(r"(?i)extrato\s+de\s+conta\s+corrente", t):
        return "internet_banking"
    if re.search(r"(?i)extrato\s+consolidado\s+inteligente|santander\s+select", t):
        return "consolidado"
    if len(t.strip()) < 400:
        return "consolidado_image"
    return "unknown"


def _extract_holder_internet(pdf_text: str) -> Optional[str]:
    for ln in (pdf_text or "").splitlines():
        s = ln.strip()
        if not s or re.search(r"(?i)^per[ií]odo\s*:", s):
            continue
        m = re.match(
            r"^(?P<name>.+?)\s+ag[eê]ncia\s+e\s+conta\s*:",
            s,
            flags=re.IGNORECASE,
        )
        if m:
            name = m.group("name").strip()
            if len(name.split()) >= 2:
                return name[:120]
    return None


def _extract_holder_consolidado(pdf_text: str) -> Optional[str]:
    lines = [ln.strip() for ln in (pdf_text or "").splitlines() if ln.strip()]
    for i, ln in enumerate(lines[:120]):
        if re.match(r"(?i)^nome\s*$", ln) and i + 1 < len(lines):
            cand = lines[i + 1].strip()
            if len(cand.split()) >= 2 and not re.search(r"(?i)ag[eê]ncia|conta\s+corrente", cand):
                return cand[:120]
    m = re.search(r"(?i)prezad[oa]\s+([^,\n]+)", pdf_text or "")
    if m:
        return m.group(1).strip()[:120]
    return None


def _extract_period_year_month(pdf_text: str) -> tuple[Optional[int], Optional[int]]:
    t = pdf_text or ""
    m = re.search(
        r"(?i)\b(janeiro|fevereiro|mar[cç]o|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\s*/\s*(\d{4})\b",
        t,
    )
    if m:
        month = _MONTHS.get(_norm_token(m.group(1)))
        if month:
            return int(m.group(2)), month
    m = re.search(r"(?i)per[ií]odo\s*:\s*(\d{2}/\d{2}/\d{4})", t)
    if m:
        try:
            dt = datetime.strptime(m.group(1), "%d/%m/%Y")
            return dt.year, dt.month
        except Exception:
            pass
    return None, None


def extract_santander_internet_banking(pdf_text: str) -> pd.DataFrame:
    """
    Formato 1 — Internet Banking (texto embutido):
    DD/MM/AAAA DESC DOCTO VALOR SALDO
    """
    lines = [ln.strip() for ln in (pdf_text or "").splitlines() if ln.strip()]
    rows: list[dict[str, Any]] = []

    tx_re = re.compile(
        rf"^(\d{{2}}/\d{{2}}/\d{{4}})\s+(.+?)\s+(\d{{4,8}})\s+({_MONEY_SIGNED})\s+({_MONEY})\s*$"
    )

    junk = (
        "internet banking",
        "extrato de conta corrente",
        "data descri",
        "crédito (r$)",
        "credito (r$)",
        "débito (r$)",
        "debito (r$)",
        "saldo (r$)",
    )

    for ln in lines:
        low = ln.lower()
        if any(j in low for j in junk):
            continue
        if re.fullmatch(r"\d{1,2}/\d{1,2}", ln):
            continue

        m = tx_re.match(ln)
        if not m:
            continue

        amt = _parse_br_money(m.group(4))
        if amt is None or float(amt) == 0:
            continue

        bal = _parse_br_money(m.group(5))
        desc = re.sub(r"\s+", " ", m.group(2).strip())
        rows.append(
            {
                "date": m.group(1),
                "description": desc,
                "amount": float(amt),
                "balance": float(bal) if bal is not None else None,
            }
        )

    return pd.DataFrame(rows)


def _section_month_year(ln: str) -> Optional[tuple[int, int, bool]]:
    """Retorna (ano, mês, is_new_section). Só 'Resumo - mês/ano' inicia seção nova."""
    m = re.search(
        r"(?i)(?:^resumo\s*[-–]\s*)?(janeiro|fevereiro|mar[cç]o|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\s*/\s*(\d{4})\b",
        ln,
    )
    if not m:
        return None
    month = _MONTHS.get(_norm_token(m.group(1)))
    if not month:
        return None
    is_new = bool(re.search(r"(?i)^resumo\s*[-–]", ln.strip()))
    return int(m.group(2)), month, is_new


def _is_consolidado_junk(ln: str) -> bool:
    low = ln.lower()
    if re.search(r"(?i)pagina:\s*\d", ln):
        return True
    if re.match(r"^\d+/\d+$", ln):
        return True
    junk_bits = (
        "extrato consolidado",
        "extrato_pf",
        "fale conosco",
        "central de atendimento",
        "ouvidoria",
        "http://",
        "https://",
        "santander.com",
        "data descri",
        "movimento (r$)",
        "lançamento contábil",
        "lancamento contabil",
        "agência conta",
        "agencia conta",
        "prezada",
        "prezado",
        "segurança é importante",
        "golpe do presente",
        "workcaf",
        "chat no app",
        "movimentação",
        "movimentacao",
        "conta corrente",
        "total de créditos",
        "total de creditos",
        "total de débitos",
        "total de debitos",
        "depósitos /",
        "depositos /",
        "compras com cartão",
        "compras com cartao",
        "pagamentos / transfer",
        "outros créditos",
        "outros creditos",
        "saldo de conta corrente",
        "saldo em ",
        "pim -",
        "balp_",
    )
    if any(j in low for j in junk_bits):
        return True
    if re.match(r"(?i)^nome\s*$", ln) or re.match(r"(?i)^ag[eê]ncia\s", ln):
        return True
    if re.match(r"^\d{4}\s+[\d.\-]+$", ln):
        return True
    if re.match(r"^\d{2}\s+[\d.,\-]+\s+0,00\s+0,00", ln):
        return True
    if re.search(r"\b0800\s*\d", ln) or re.search(r"\b4004\s*\d", ln):
        return True
    return False


def _looks_like_counterparty_name(ln: str) -> bool:
    if re.search(r"(?i)(pix|debito|credito|pagamento|transferencia|visa|saldo|tar|remuneracao)", ln):
        return False
    if re.search(r",\d{2}", ln):
        return False
    if re.match(r"^\d{2}/\d{2}\s+", ln):
        return False
    words = [w for w in ln.split() if w]
    return 2 <= len(words) <= 12 and len(ln) <= 90


def _is_generic_pix_desc(desc: str) -> bool:
    d = re.sub(r"\s+-\s*$", "", (desc or "").strip())
    return bool(re.fullmatch(r"(?i)(?:entrada\s+pix\s+)?pix\s+(?:recebido|enviado|devolvido)\s*-?", d))


def _is_tx_description(desc: str) -> bool:
    if not desc or len(desc) < 4:
        return False
    return bool(
        re.search(
            r"(?i)(pix\s+(?:recebido|enviado|devolvido)|debito|credito|pagamento|transferencia|"
            r"saque|tar\b|remuneracao|mensalidade|entrada\s+pix|saida\s+pix|outros\s+gastos|"
            r"recarga|compra|ted\b|doc\b|boleto)",
            desc,
        )
    )


def extract_santander_consolidado(pdf_text: str) -> pd.DataFrame:
    """
    Formato 2 — Extrato Consolidado Inteligente (PDF texto / exportado).
    Colunas do PDF viram linhas separadas: valor numa linha, nome da contraparte na seguinte.
    """
    lines = [re.sub(r"\s+", " ", ln.strip()) for ln in (pdf_text or "").splitlines() if ln.strip()]
    section_year, section_month = _extract_period_year_month(pdf_text)
    if not section_year:
        section_year = datetime.now().year

    rows: list[dict[str, Any]] = []
    current_date: Optional[str] = None
    pending_name: Optional[str] = None
    in_movimentacao = False

    mov_end_re = re.compile(rf"({_MONEY_SIGNED})(?:\s+{_MONEY})?\s*$")
    date_prefix_re = re.compile(r"^(\d{2}/\d{2})\s+(.+)$")

    def append_row(dt: str, desc: str, amt: float) -> None:
        if not dt or not desc or amt == 0 or abs(amt) > 500_000:
            return
        rows.append({"date": dt, "description": desc, "amount": float(amt), "balance": None})

    def br_date(dd: int, mm: int, yy: int) -> Optional[str]:
        try:
            return datetime(yy, mm, dd).strftime("%d/%m/%Y")
        except Exception:
            return None

    i = 0
    while i < len(lines):
        ln = lines[i]

        sec = _section_month_year(ln)
        if sec:
            section_year, section_month, is_new_section = sec
            if is_new_section:
                in_movimentacao = False
                pending_name = None
            i += 1
            continue

        if re.search(r"(?i)^movimenta", ln):
            in_movimentacao = True
            pending_name = None
            i += 1
            continue

        if not in_movimentacao or _is_consolidado_junk(ln):
            i += 1
            continue

        work = ln
        dm = date_prefix_re.match(ln)
        if dm:
            dd, mm = (int(x) for x in dm.group(1).split("/"))
            yy = section_year or datetime.now().year
            current_date = br_date(dd, mm, yy)
            work = dm.group(2).strip()

        mmov = mov_end_re.search(work)
        if not mmov:
            if dm:
                # Detalhe de cartão: "02/03 POSTO REDE M7" (sem tipo/valor na mesma linha)
                i += 1
                continue
            if _looks_like_counterparty_name(work):
                pending_name = work
            i += 1
            continue

        amt = _parse_br_money(mmov.group(1))
        if amt is None or float(amt) == 0:
            pending_name = None
            i += 1
            continue

        body = work[: mmov.start()].strip()
        body = re.sub(r"\s+\d{4,8}\s*$", "", body).strip()
        body = re.sub(r"\s+-\s*$", "", body).strip()

        if _is_generic_pix_desc(body):
            if pending_name:
                body = f"{body} {pending_name}".strip()
                pending_name = None
            elif i + 1 < len(lines) and _looks_like_counterparty_name(lines[i + 1]):
                body = f"{body} {lines[i + 1]}".strip()
                i += 1

        if not _is_tx_description(body):
            pending_name = None
            i += 1
            continue

        if not current_date and dm:
            dd, mm = (int(x) for x in dm.group(1).split("/"))
            yy = section_year or datetime.now().year
            current_date = br_date(dd, mm, yy)

        if current_date:
            append_row(current_date, body, float(amt))
        pending_name = None
        i += 1

    return pd.DataFrame(rows)


def _ocr_pdf_pages(pdf_path: str, max_pages: int = 120) -> str:
    """OCR via pdfplumber + Tesseract (sem Poppler). Só quando Tesseract estiver instalado."""
    import pdfplumber

    try:
        import pytesseract  # type: ignore
    except Exception:
        return ""

    chunks: list[str] = []
    with pdfplumber.open(pdf_path) as pdf:
        for i, page in enumerate(pdf.pages):
            if i >= max_pages:
                break
            try:
                pil = page.to_image(resolution=200).original
                txt = pytesseract.image_to_string(pil, lang="por")
                if txt and txt.strip():
                    chunks.append(txt)
            except Exception:
                continue
    return "\n".join(chunks)


def _pdf_embedded_text(pdf_path: str) -> str:
    import pdfplumber

    parts: list[str] = []
    with pdfplumber.open(pdf_path) as pdf:
        for page in pdf.pages:
            t = page.extract_text() or ""
            if t.strip():
                parts.append(t)
    return "\n".join(parts)


def extract_santander_from_text(pdf_text: str) -> pd.DataFrame:
    fmt = _detect_format(pdf_text)
    if fmt == "internet_banking":
        return extract_santander_internet_banking(pdf_text)
    if fmt in {"consolidado", "consolidado_image", "unknown"}:
        df = extract_santander_consolidado(pdf_text)
        if not df.empty:
            return df
        if fmt == "internet_banking":
            return df
    return pd.DataFrame()


def try_extract(pdf_text: str, pdf_path: Optional[str] = None) -> Optional[pd.DataFrame]:
    text = pdf_text or ""
    fmt = _detect_format(text)

    # PDF só-imagem: tenta OCR antes de desistir
    if fmt == "consolidado_image" and pdf_path:
        embedded = _pdf_embedded_text(pdf_path)
        if len(embedded.strip()) > 400:
            text = embedded
            fmt = _detect_format(text)
        else:
            ocr = _ocr_pdf_pages(pdf_path)
            if ocr.strip():
                text = ocr
                fmt = _detect_format(text)

    df = extract_santander_from_text(text)
    if df is None or df.empty:
        return None

    holder = _extract_holder_internet(text) or _extract_holder_consolidado(text)
    out = df.copy()
    out["_source"] = "santander"
    out["holder"] = holder

    cols = ["date", "description", "amount", "debit", "credit", "balance", "_source", "holder"]
    for c in cols:
        if c not in out.columns:
            out[c] = None
    return out[cols].copy()
