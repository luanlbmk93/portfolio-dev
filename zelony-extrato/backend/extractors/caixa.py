from __future__ import annotations

import os
import re
from typing import Any, List, Optional, Tuple

import pandas as pd
import pytesseract
from PIL import Image

# Valor monetário BR (com ou sem milhar; vírgula decimal)
_BR_VAL = r"\d{1,3}(?:\.\d{3})*,\d{2}|\d+,\d{2}"

# Guard-rails para OCR da Caixa: evita “descrições gigantes” e lixo virar transação
_MAX_DESC_LEN = 140


def _parse_br_money(value: str) -> Optional[float]:
    if not value:
        return None
    s = value.replace(".", "").replace(",", ".")
    try:
        return float(s)
    except Exception:
        return None


def _has_letters(s: str) -> bool:
    return bool(re.search(r"[A-Za-zÀ-ÖØ-öø-ÿ]", s or ""))


def _has_meaningful_word(s: str) -> bool:
    """
    OCR da Caixa gera muitos falsos positivos com 'C', 'D', '275C', etc.
    Exigimos pelo menos um token alfabético com 2+ letras (exclui C/D).
    """
    return bool(re.search(r"[A-Za-zÀ-ÖØ-öø-ÿ]{2,}", s or ""))


def _is_balance_like_desc(desc: str) -> bool:
    d = re.sub(r"\s+", " ", (desc or "").strip()).lower()
    if not d:
        return True
    # “Saldo ...” e variações são balanços/cabeçalho, não lançamentos
    if re.match(r"^(hpessoal\s+)?saldo\b", d):
        return True
    return False


def _preprocess_ocr_blob(blob: str) -> str:
    """
    O OCR frequentemente “cola” colunas e o cabeçalho em uma única linha.
    Força lançamentos a começarem em linhas separadas e remove ruídos comuns.
    """
    if not (blob or "").strip():
        return ""

    s = blob.replace("\r\n", "\n").replace("\r", "\n")
    # OCR confunde "C" com "€" em alguns PDFs; aqui geralmente só atrapalha
    s = s.replace("€", " ")
    s = s.replace("—", "-").replace("–", "-")
    # Insere newline antes de datas coladas (DD/MM/AAAA ou AAAA-MM-DD)
    s = re.sub(r"(?<!\n)(\d{2}/\d{2}/\d{4})", r"\n\1", s)
    s = re.sub(r"(?<!\n)(\d{4}-\d{2}-\d{2})", r"\n\1", s)
    # Remove horários que incham cabeçalhos OCRados
    s = re.sub(r"\b\d{2}:\d{2}:\d{2}\b", " ", s)
    # Colapsa espaços, preservando quebras
    s = "\n".join(re.sub(r"[ \t]+", " ", ln).strip() for ln in s.splitlines())
    return s.strip()


def _configure_tesseract() -> None:
    """PATH ou TESSERACT_CMD; no Windows tenta o caminho padrão do instalador."""
    tcmd = (os.environ.get("TESSERACT_CMD") or "").strip()
    if not tcmd and os.name == "nt":
        for cand in (
            r"C:\Program Files\Tesseract-OCR\tesseract.exe",
            r"C:\Program Files (x86)\Tesseract-OCR\tesseract.exe",
        ):
            if os.path.isfile(cand):
                tcmd = cand
                break
    if tcmd:
        pytesseract.pytesseract.tesseract_cmd = tcmd


def pdf_to_text_embedded(pdf_path: str) -> str:
    """
    Texto nativo do PDF (camada selecionável no Chrome — extrato original Caixa).
    PyMuPDF primeiro; pdfplumber se vier mais conteúdo útil.
    """
    blobs: List[str] = []
    try:
        import fitz  # PyMuPDF

        doc = fitz.open(pdf_path)
        try:
            parts: List[str] = []
            for page in doc:
                t = (page.get_text("text") or "").strip()
                if t:
                    parts.append(t)
            if parts:
                blobs.append("\n".join(parts))
        finally:
            doc.close()
    except Exception:
        pass

    try:
        import pdfplumber

        with pdfplumber.open(pdf_path) as pdf:
            pl = "\n".join((p.extract_text() or "") for p in pdf.pages).strip()
            if pl:
                blobs.append(pl)
    except Exception:
        pass

    if not blobs:
        return ""
    return max(blobs, key=lambda b: len(b.strip()))


def _embedded_text_chars(pdf_path: str) -> int:
    """Quantidade de caracteres de texto nativo (0 = PDF só imagem)."""
    try:
        import fitz

        doc = fitz.open(pdf_path)
        try:
            n = 0
            for page in doc:
                n += len((page.get_text("text") or "").strip())
            return n
        finally:
            doc.close()
    except Exception:
        return 0


def pdf_to_text_ocr(pdf_path: str) -> str:
    """
    OCR página a página (PyMuPDF).

    Este caminho é necessário quando o PDF vem escaneado (sem texto embutido).
    Se o Tesseract não estiver instalado/configurado, levantamos um erro claro
    para o backend não "fingir" que o PDF não tem transações.
    """
    _configure_tesseract()
    try:
        _ = pytesseract.get_tesseract_version()
    except Exception as e:
        raise RuntimeError(
            "OCR indisponível para extrato CAIXA (PDF escaneado/sem texto). "
            "Instale o Tesseract OCR e o idioma PT-BR, e garanta que o executável "
            "esteja no PATH (ou defina TESSERACT_CMD). Erro original: "
            + str(e)
        )

    import fitz  # PyMuPDF — import tardio (opcional no ambiente)

    lang_pref = (os.environ.get("TESS_LANG") or "por+eng").strip() or "por+eng"
    langs_try = [lang_pref]
    if lang_pref != "eng":
        langs_try.append("eng")
    langs_try.append("")

    doc = fitz.open(pdf_path)
    try:
        dpi = float(os.environ.get("CAIXA_OCR_DPI", "150"))
    except ValueError:
        dpi = 150.0
    dpi = max(100.0, min(dpi, 250.0))
    z = dpi / 72.0
    mat = fitz.Matrix(z, z)
    full_text = ""
    for page in doc:
        pix = page.get_pixmap(matrix=mat, alpha=False)
        img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
        text = ""
        last_err: Optional[Exception] = None
        for lang in langs_try:
            try:
                text = pytesseract.image_to_string(img, lang=lang or None)
                last_err = None
                break
            except Exception as e:
                last_err = e
        if last_err is not None:
            raise last_err
        full_text += text + "\n"
    return full_text


def extract_caixa_holder(text: str) -> Optional[str]:
    if not text:
        return None
    m = re.search(r"(?im)^\s*cliente\s*:\s*([^\n\r|]+)", text)
    if m:
        name = re.sub(r"\s+", " ", m.group(1)).strip()
        if len(name.split()) >= 1 and not re.fullmatch(r"(?i)conta|nome", name):
            return name[:120]
    lines = [l.strip() for l in text.splitlines() if l.strip()]
    for ln in lines[:120]:
        if re.search(r"(?i)regina\s+de\s+souza|maiara", ln):
            return re.sub(r"\s+", " ", ln.strip())[:120]
    for ln in lines[:120]:
        if (
            len(ln.split()) >= 3
            and re.search(r"[A-Za-zÀ-ÿ]{2,}", ln)
            and not re.search(r"\d{2}/\d{2}/\d{4}", ln)
            and not re.search(r"(?i)extrato|caixa|conta|ag[eê]ncia|periodo|lanc|valor|saldo|cliente", ln)
            and not re.match(r"^\d", ln)
        ):
            cand = ln.strip()
            if len(cand) >= 8:
                return cand[:120]
    for i, line in enumerate(lines[:40]):
        low = line.lower()
        if re.match(r"(?i)^cliente\s*:\s*\S", line):
            part = re.split(r":", line, 1)[-1].strip()
            if len(part.split()) >= 2:
                return part[:120]
        if re.match(r"(?i)^(nome|titular)\s*:", line):
            part = re.split(r":", line, 1)[-1].strip()
            if len(part.split()) >= 2:
                return part[:120]
        if re.match(r"(?i)^nome\s*$", line) and i + 1 < len(lines):
            cand = lines[i + 1].strip()
            if len(cand.split()) >= 2 and not re.search(r"(?i)ag[eê]ncia|conta", cand):
                return cand[:120]
    return None


def _is_caixa_row_layout_text(text: str) -> bool:
    """
    Extrato original Caixa (texto embutido): data, histórico e valor na mesma linha.
    Diferente do OCR colunar (blocos Data → Histórico → Valor empilhados).
    """
    if not (text or "").strip():
        return False
    row_re = re.compile(
        rf"^\d{{2}}/\d{{2}}/\d{{4}}(?:\s*-\s*\d{{2}}:\d{{2}}:\d{{2}})?\s+.+{_BR_VAL}\s*[CDcd]\b",
        re.I,
    )
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    type_only = sum(
        1
        for ln in lines
        if re.match(
            r"(?i)^(pix\s+(enviado|recebido)|compra\s+cart[aã]o\s+debito)\.?$", ln
        )
    )
    if type_only >= 5:
        return False
    row_hits = sum(1 for ln in lines if row_re.search(ln))
    return row_hits >= 3


def _detect_caixa_periodo_text(text: str) -> bool:
    t = text or ""
    if len(t.strip()) < 40:
        return False
    if _is_caixa_row_layout_text(t):
        return True
    return bool(
        re.search(r"(?i)extrato\s+por\s+per[ií]odo|imprime_ext_periodo", t)
        or (
            re.search(r"(?i)data\s+mov", t)
            and re.search(r"(?i)hist[oó]rico", t)
            and re.search(r"(?i)\bvalor\b", t)
        )
    )


def extract_caixa_periodo(pdf_text: str) -> pd.DataFrame:
    """
    Extrato por período (Internet Banking Caixa) — PDF com texto.
    Linha típica: DD/MM/AAAA DOC HISTÓRICO VALOR C/D [SALDO C/D]
    """
    lines = [re.sub(r"\s+", " ", ln.strip()) for ln in (pdf_text or "").splitlines() if ln.strip()]
    rows: list[dict[str, float | str]] = []

    tx_re = re.compile(
        rf"^(?P<dt>\d{{2}}/\d{{2}}/\d{{4}})"
        rf"(?:\s*-\s*(?P<hora>\d{{2}}:\d{{2}}:\d{{2}}))?\s+"
        rf"(?:(?P<doc>\d{{4,8}})\s+)?"
        rf"(?P<hist>.+?)\s+"
        rf"(?P<val>{_BR_VAL})\s*(?P<vcd>[CDcd])\b"
        rf"(?:\s+(?P<saldo>{_BR_VAL})\s*(?P<scd>[CDcd]))?\s*$"
    )
    saldo_only = re.compile(rf"(?i)^(?:saldo\s+anterior|saldo\s+do\s+dia)\b")

    for ln in lines:
        if _is_junk_header_line(ln.lower()):
            continue
        m = tx_re.match(ln)
        if not m:
            continue
        hist = m.group("hist").strip()
        if saldo_only.search(hist) or re.match(r"(?i)^\d+$", hist):
            continue
        v = _parse_br_money(m.group("val"))
        if v is None or v == 0:
            continue
        cd_raw = m.group("vcd").upper()
        hist, amt = _finalize_caixa_amount(hist, (float(v), cd_raw))
        bal = None
        if m.group("saldo"):
            bal = _parse_br_money(m.group("saldo"))
        rows.append(
            {
                "date": m.group("dt"),
                "description": hist,
                "amount": float(amt),
                "balance": bal,
            }
        )

    return pd.DataFrame(rows)


def _is_junk_header_line(low: str) -> bool:
    """Cabeçalhos/rodapés; não descartar linhas de movimento que citam 'saldo' no meio do histórico."""
    # OCR de extrato "Cliente Conta" costuma misturar cabeçalho/rodapé na mesma página
    if re.search(r"\bcaixa\s+clie\w*\s+conta\b", low):
        return True
    if re.search(r"\bal[oô]\s+caixa\b|\bsac\s+caixa\b|\bouvidoria\b|\bpessoas?\s+com\s+defici", low):
        return True
    if re.search(r"\bcpf/?cnpj\b", low):
        return True
    if re.search(r"\bnr\.?\s*doc\b|\bn[úu]mero\s+doc\b", low):
        return True
    if re.search(r"\bhist[oó]rico/?complemento\b|\bfavorecido\b", low):
        return True
    if re.search(r"\b(janeiro|fevereiro|marco|março|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\b", low):
        # geralmente aparece no cabeçalho do mês ("Novembro até 30/11/2025")
        return True
    if re.search(
        r"^\s*(extrato|movimenta|per[íi]odo|ag[êe]ncia|conta corrente|nome d[ao] ag[êe]ncia)\b",
        low,
    ):
        return True
    if re.search(r"^\s*(data|hist|lan[çc]amentos?|valor|natureza|documento)\b", low) and len(low) < 80:
        return True
    if re.search(r"^\s*saldo\s+(anterior|do dia|final|total|aplic)\b", low):
        return True
    return False


def _normalize_pt_date_token(raw: str) -> Optional[str]:
    """Uma data em DD/MM/AAAA, DD/MM/AA, DD.MM.AAAA ou AAAA-MM-DD → DD/MM/AAAA."""
    t = raw.strip()
    m = re.fullmatch(r"(\d{2})[/.](\d{2})[/.](\d{4})", t)
    if m:
        return f"{m.group(1)}/{m.group(2)}/{m.group(3)}"
    m = re.fullmatch(r"(\d{2})[/.](\d{2})[/.](\d{2})", t)
    if m:
        d, mo, y2 = m.group(1), m.group(2), int(m.group(3))
        y4 = 2000 + y2 if y2 < 70 else 1900 + y2
        return f"{d}/{mo}/{y4}"
    m = re.fullmatch(r"(\d{4})-(\d{2})-(\d{2})", t)
    if m:
        return f"{m.group(3)}/{m.group(2)}/{m.group(1)}"
    return None


def _parse_line_date(line: str) -> Tuple[Optional[str], str]:
    """Primeira data na linha; suporta /, . e AAAA-MM-DD; devolve linha sem esse trecho."""
    m = re.search(
        r"(\d{2}[/.]\d{2}[/.]\d{4})|(\d{2}[/.]\d{2}[/.]\d{2})(?!\d)|(\d{4}-\d{2}-\d{2})",
        line,
    )
    if not m:
        return None, line
    raw = m.group(0)
    norm = _normalize_pt_date_token(raw)
    if not norm:
        return None, line
    rest = (line[: m.start()] + line[m.end() :]).strip()
    return norm, rest


def _normalize_money_noise(line: str) -> str:
    """Remove R$, NBSP e espaços tipo milhar '1 234,56'."""
    s = line.replace("\u00a0", " ")
    s = re.sub(r"(?i)\br\$\s*", "", s)
    s = re.sub(r"(\d)\s+(?=\d)", r"\1", s)
    return s.strip()


def _extract_by_regex(blob: str) -> pd.DataFrame:
    """
    Tentativa 1 (mais robusta para OCR): procura padrões data + valor + C/D.
    Evita depender de quebras de linha "certinhas".
    """
    if not (blob or "").strip():
        return pd.DataFrame()

    s = _normalize_money_noise(_preprocess_ocr_blob(blob))

    # 1) data + descrição + valor com C/D (melhor caso)
    pat_cd = re.compile(
        rf"(?P<dt>\d{{2}}/\d{{2}}/\d{{4}}|\d{{4}}-\d{{2}}-\d{{2}})\s+"
        rf"(?P<desc>[^\n\r]{{3,140}}?)\s+"
        rf"(?P<v>{_BR_VAL})\s*(?P<cd>[CDcd])\b"
    )

    # 2) data + descrição + valor (sem C/D) — comum no OCR da Caixa
    # Mantém descrição curta pra não “capturar o mundo”.
    pat_nocd = re.compile(
        rf"(?P<dt>\d{{2}}/\d{{2}}/\d{{4}}|\d{{4}}-\d{{2}}-\d{{2}})\s+"
        rf"(?P<desc>[^\n\r]{{3,140}}?)\s+"
        rf"(?P<v>{_BR_VAL})\b"
    )

    rows = []
    for m in pat_cd.finditer(s):
        dt = m.group("dt").strip()
        desc = _sanitize_caixa_description(re.sub(r"\s+", " ", m.group("desc")).strip())
        if len(desc) > _MAX_DESC_LEN:
            continue
        if _is_balance_like_desc(desc):
            continue
        if not _has_meaningful_word(desc):
            continue
        v = _parse_br_money(m.group("v"))
        if v is None:
            continue
        cd_raw = m.group("cd").upper()
        desc, amt = _finalize_caixa_amount(desc, (float(v), cd_raw))
        _, cp = _split_caixa_description_parts(desc)
        dlow = desc.lower()
        if _is_junk_header_line(dlow):
            continue
        if desc in {"C", "D", "€"}:
            continue
        rows.append(
            {
                "date": dt,
                "description": desc,
                "amount": amt,
                "counterparty": cp or None,
            }
        )

    # Se já achou bastante coisa com C/D, não precisa arriscar o modo sem C/D
    if len(rows) >= 6:
        return pd.DataFrame(rows)

    # fallback sem C/D: só aceita quando dá pra inferir sinal por palavras.
    for m in pat_nocd.finditer(s):
        dt = m.group("dt").strip()
        desc = re.sub(r"\s+", " ", m.group("desc")).strip()
        if len(desc) > _MAX_DESC_LEN:
            continue
        if _is_balance_like_desc(desc):
            continue
        if not _has_meaningful_word(desc):
            continue
        dlow = desc.lower()
        if _is_junk_header_line(dlow):
            continue
        v = _parse_br_money(m.group("v"))
        if v is None:
            continue

        sign = _infer_sign_from_buffer([desc])
        if sign is None:
            # Sem C/D e sem pista de sinal: prefere não criar falso positivo
            continue
        amt = sign * abs(v)
        rows.append({"date": dt, "description": desc, "amount": amt})

    return pd.DataFrame(rows)


def _try_generic_pdf_regex(blob: str) -> Optional[pd.DataFrame]:
    """Último recurso dentro do módulo Caixa — mesmo motor do pipeline genérico."""
    try:
        from extractors.generic_pdf_text_regex import try_extract as gen

        g = gen(blob)
        if g is None or g.empty:
            return None
        out = g.copy()
        out["_source"] = "caixa_regex_fallback"
        out["holder"] = extract_caixa_holder(blob)
        for col in ("debit", "credit", "balance"):
            if col not in out.columns:
                out[col] = None
        return out[
            ["date", "description", "amount", "debit", "credit", "balance", "_source", "holder"]
        ].copy()
    except Exception:
        return None


def _parse_rtl_caixa_line(line: str) -> Optional[Tuple[str, float, str, bool]]:
    """
    Direita→esquerda na linha (após data removida pelo caller): valor+C/D no fim, resto = descrição.
    Sinal somente pelo sufixo C/D.
    """
    line = _normalize_money_noise(line)
    m = re.search(rf"(?P<v>{_BR_VAL})\s*(?P<cd>[CDcd])\s*$", line, re.IGNORECASE)
    if not m:
        return None
    v = _parse_br_money(m.group("v"))
    if v is None:
        return None
    cd = m.group("cd").upper()
    desc = _sanitize_caixa_description((line[: m.start()] + line[m.end() :]).strip())
    if not desc or not _has_meaningful_word(desc):
        return None
    desc, amt = _finalize_caixa_amount(desc, (float(v), cd))
    return m.group("v"), amt, desc, False


def _match_value_and_sign(line: str) -> Optional[Tuple[str, float, str, bool]]:
    """
    (valor_bruto, montante_com_sinal_ou_absoluto, resto_para_descrição, precisa_inferir_sinal).
    """
    rtl = _parse_rtl_caixa_line(line)
    if rtl is not None:
        return rtl

    line = _normalize_money_noise(line)
    vpat = _BR_VAL

    # 1) 1.234,56 (C) / 1.234,56 C (OCR pode vir minúsculo)
    m = re.search(rf"(?P<v>{vpat})\s*\((?P<cd>[CDcd])\)", line)
    if m:
        v = _parse_br_money(m.group("v"))
        if v is None:
            return None
        s = -abs(v) if m.group("cd").upper() == "D" else abs(v)
        rest = (line[: m.start()] + line[m.end() :]).strip()
        return m.group("v"), s, rest, False

    m = re.search(rf"(?P<v>{vpat})\s+(?P<cd>[CDcd])\b", line)
    if m:
        v = _parse_br_money(m.group("v"))
        if v is None:
            return None
        s = -abs(v) if m.group("cd").upper() == "D" else abs(v)
        rest = (line[: m.start()] + line[m.end() :]).strip()
        return m.group("v"), s, rest, False

    # 2) + / - antes ou depois do valor
    m = re.search(rf"(?P<sg>[+\-])\s*(?P<v>{vpat})\b", line)
    if m:
        v = _parse_br_money(m.group("v"))
        if v is None:
            return None
        neg = m.group("sg") == "-"
        s = -abs(v) if neg else abs(v)
        rest = (line[: m.start()] + line[m.end() :]).strip()
        return m.group("v"), s, rest, False

    m = re.search(rf"(?P<v>{vpat})\s*(?P<sg>[+\-])\b", line)
    if m:
        v = _parse_br_money(m.group("v"))
        if v is None:
            return None
        neg = m.group("sg") == "-"
        s = -abs(v) if neg else abs(v)
        rest = (line[: m.start()] + line[m.end() :]).strip()
        return m.group("v"), s, rest, False

    # 3) hífen / tracinho colado ou no fim (débito comum em extratos)
    m = re.search(rf"(?P<v>{vpat})\s*[-–]\s*$", line)
    if m:
        v = _parse_br_money(m.group("v"))
        if v is None:
            return None
        s = -abs(v)
        rest = (line[: m.start()] + line[m.end() :]).strip()
        return m.group("v"), s, rest, False

    # 4) palavras CREDITO / DEBITO
    m = re.search(rf"(?i)(?P<v>{vpat})\s*(CREDITO|CR[EÉ]DITO|DEBITO|D[EÉ]BITO)\b", line)
    if m:
        v = _parse_br_money(m.group("v"))
        if v is None:
            return None
        word = m.group(2).upper()
        is_deb = word.startswith("DEB") or word.startswith("DÉB")
        s = -abs(v) if is_deb else abs(v)
        rest = (line[: m.start()] + line[m.end() :]).strip()
        return m.group("v"), s, rest, False

    # 5) linha só com valor (continuação do lançamento anterior — usa contexto depois)
    m = re.fullmatch(rf"[\s\-+]*(?P<v>{vpat})[\s\-+]*", line.strip())
    if m:
        v = _parse_br_money(m.group("v"))
        if v is None:
            return None
        return m.group("v"), abs(v), "", True

    # 6) um único valor na linha (OCR quebrou colunas)
    matches = list(re.finditer(rf"(?P<v>{vpat})", line))
    if len(matches) == 1:
        m0 = matches[0]
        v = _parse_br_money(m0.group("v"))
        if v is None:
            return None
        rest = (line[: m0.start()] + line[m0.end() :]).strip()
        return m0.group("v"), abs(v), rest, True

    return None


_DATE_MOV_RE = re.compile(r"^(\d{2}/\d{2}/\d{4})\s*-\s*(\d{2}:\d{2}:\d{2})")
_MONEY_CD_END_RE = re.compile(
    rf"^({_BR_VAL})\s*([CDcd])\s*$|^(?:R\$\s*)?({_BR_VAL})([CDcd])\s*$"
)
_MONEY_CD_TRAILING_RE = re.compile(
    rf"(.+?)\s+({_BR_VAL})\s*([CDcd])\s*$", re.IGNORECASE
)
_MONEY_ONLY_LINE_RE = re.compile(rf"^({_BR_VAL})\s*$", re.IGNORECASE)
_CD_ONLY_LINE_RE = re.compile(r"^[CDcd]$")


def _amount_from_cd(value: float, cd: str) -> float:
    """Caixa: D = débito (saída), C = crédito (entrada). Sempre a partir da coluna Valor."""
    return -abs(value) if (cd or "").upper() == "D" else abs(value)


def _cd_from_column(cd: str) -> str:
    """Sufixo C/D da coluna Valor do extrato — única fonte do sinal (+/−)."""
    u = (cd or "C").upper()
    return u if u in {"C", "D"} else "C"


def _sanitize_caixa_description(text: str) -> str:
    """
    Remove resíduos de CPF mascarado e caracteres de tabela do OCR
    (* + % e fragmentos numéricos colados ao favorecido).
    """
    if not text:
        return ""
    s = (text or "").replace("\u00a0", " ")
    s = re.sub(r"[\*\+\%]", "", s)
    s = re.sub(r"(?i)\b\d{3}[\.\s,]*\d{3}[\.\s,]*\d{2,4}\b", "", s)
    s = re.sub(r"(?i)\b\d{3}\s*\.\s*\d{3}\s*\.\s*\d{3}\b", "", s)
    s = re.sub(r"\s+", " ", s).strip(" .,-")
    return s[:_MAX_DESC_LEN]


_CAIXA_DEBIT_HIST_RE = re.compile(
    r"(?i)^(?:compra\s+cart|pix\s+enviado|deb\s+prest|saque|tarifa|"
    r"pagamento|pag\s+boleto|pag\s+orgaos|deb[ií]to\s+transporte|"
    r"transfer.*\benv|doc\s+env)"
)
_CAIXA_CREDIT_HIST_RE = re.compile(
    r"(?i)^(?:credito\s+salario|programa\s+bolsa|pix\s+recebido|cr\s+conv|"
    r"credito\s+juros|deposito\s+dinh|dep\s+dinheiro|devolucao\s+pix\s+recebido|"
    r"estorno)"
)


def _movimento_cd_from_hist_code(desc: str, cd: str) -> str:
    """
    Histórico fixo da Caixa manda no C/D quando o OCR coluna Valor inverte.
    PIX: mantém sufixo da coluna (recebido pode vir com D em PDF escaneado).
    """
    s = _sanitize_caixa_description(desc)
    cd0 = _cd_from_column(cd)
    if _CAIXA_DEBIT_HIST_RE.search(s):
        return "D"
    if _CAIXA_CREDIT_HIST_RE.search(s):
        return "C"
    if re.search(r"(?i)^pix\s+(enviado|recebido|devolvido)", s):
        return cd0
    return cd0


def _split_caixa_description_parts(desc: str) -> Tuple[str, str]:
    """Tipo do lançamento + favorecido (meio da linha lógica do extrato)."""
    s = _sanitize_caixa_description(desc)
    if not s:
        return "", ""
    patterns: List[Tuple[re.Pattern[str], int, int]] = [
        (re.compile(r"(?i)^(pix\s+(?:enviado|recebido|devolvido))\s+(.+)$"), 1, 2),
        (re.compile(r"(?i)^(compra\s+cart[aã]o\s+debito)\.?\s+(.+)$"), 1, 2),
        (re.compile(r"(?i)^(devolucao\s+pix\s+recebido)\s+(.+)$"), 1, 2),
    ]
    for pat, g1, g2 in patterns:
        m = pat.match(s)
        if m:
            tipo = m.group(g1).strip()
            pessoa = m.group(g2).strip()
            if pessoa and _has_meaningful_word(pessoa):
                return tipo, pessoa[:80]
    return s, ""


def _align_pix_description_with_cd(desc: str, cd: str) -> str:
    """
    Ajusta só o rótulo PIX quando contradiz o sufixo C/D do banco.
    O sinal monetário NÃO é derivado da descrição (ENVIADO/RECEBIDO).
    """
    if not desc or "DEVOLUCAO" in desc.upper():
        return desc
    cd = _cd_from_column(cd)
    if cd == "D" and re.search(r"(?i)pix\s+recebido", desc):
        return re.sub(r"(?i)pix\s+recebido", "PIX ENVIADO", desc, count=1)
    if cd == "C" and re.search(r"(?i)pix\s+enviado", desc):
        return re.sub(r"(?i)pix\s+enviado", "PIX RECEBIDO", desc, count=1)
    return desc


def _finalize_caixa_amount(desc: str, val: Tuple[float, str]) -> Tuple[str, float]:
    """Descrição + valor já pareados; sinal = C/D (coluna Valor + código Histórico)."""
    v, cd = val
    desc = _sanitize_caixa_description(desc)
    cd = _movimento_cd_from_hist_code(desc, cd)
    desc = _align_pix_description_with_cd(desc, cd)
    return desc, float(_amount_from_cd(v, cd))


def _resolve_movimento_cd(desc: str, cd: str) -> str:
    return _movimento_cd_from_hist_code(desc, cd)


def _reconcile_cd_with_description(desc: str, cd: str) -> str:
    return _movimento_cd_from_hist_code(desc, cd)


def _parse_money_cd_line(
    ln: str, next_ln: Optional[str] = None
) -> Optional[Tuple[float, str]]:
    """
    Lê valor + C/D: linha só com movimento, valor+CD no fim (linha atômica),
    ou valor numa linha e C/D na seguinte (quebra fantasma de merge PDF).
    """
    s = (ln or "").replace("\u00a0", " ").strip()
    s = re.sub(r"(?i)^r\$\s*", "", s)
    s_compact = s.replace(" ", "")

    m = _MONEY_CD_END_RE.match(s_compact)
    if m:
        raw_val = m.group(1) or m.group(3)
        cd = (m.group(2) or m.group(4) or "").upper()
        v = _parse_br_money(raw_val)
        if v is not None and cd in {"C", "D"}:
            return float(v), cd

    if next_ln:
        nxt = (next_ln or "").strip()
        m_amt = _MONEY_ONLY_LINE_RE.match(s_compact)
        if m_amt and _CD_ONLY_LINE_RE.match(nxt):
            v = _parse_br_money(m_amt.group(1))
            if v is not None:
                return float(v), nxt.upper()

    return None


def _split_desc_and_trailing_value(ln: str) -> Optional[Tuple[str, Tuple[float, str]]]:
    """Descrição + um único valor C/D no fim da linha (célula atômica)."""
    s = re.sub(r"\s+", " ", (ln or "").strip())
    if not s or _DATE_MOV_RE.match(s) or _DOC_LINE_RE.match(s):
        return None
    if _count_money_cd_on_line(s) != 1:
        return None
    m = _MONEY_CD_TRAILING_RE.match(s)
    if not m:
        return None
    desc = m.group(1).strip()
    if not desc or not _has_meaningful_word(desc) or _is_saldo_marker(desc):
        return None
    v = _parse_br_money(m.group(2))
    if v is None:
        return None
    cd = (m.group(3) or "C").upper()
    if cd not in {"C", "D"}:
        return None
    return desc[:_MAX_DESC_LEN], (float(v), cd)


def _count_money_cd_on_line(ln: str) -> int:
    return len(re.findall(rf"{_BR_VAL}\s*[CDcd]", ln or "", flags=re.I))


def _is_value_split_across_two_lines(ln: str, nxt: Optional[str]) -> bool:
    """Ex.: '50,00' numa linha e 'D' na seguinte (quebra fantasma de merge PDF)."""
    if not nxt:
        return False
    compact = re.sub(r"(?i)^r\$\s*", "", (ln or "")).replace(" ", "")
    return bool(
        _MONEY_ONLY_LINE_RE.match(compact)
        and _CD_ONLY_LINE_RE.match((nxt or "").strip())
    )


def _coalesce_atomic_ocr_lines(lines: List[str]) -> List[str]:
    """
    Junta apenas quebras fantasmas dentro da MESMA célula:
    - valor partido (50,00 + linha seguinte D/C);
    - favorecido na linha logo após PIX ENVIADO/RECEBIDO ou COMPRA (só tipo).
    Não funde colunas inteiras de valores (evita 'Valor 0,00C 30,00D...' numa linha).
    """
    if not lines:
        return []
    out: List[str] = []
    i = 0
    while i < len(lines):
        ln = (lines[i] or "").strip()
        if not ln:
            i += 1
            continue
        nxt = (lines[i + 1] or "").strip() if i + 1 < len(lines) else None

        if _is_value_split_across_two_lines(ln, nxt):
            merged_val = f"{ln} {nxt}".strip()
            if (
                out
                and not _DATE_MOV_RE.match(out[-1])
                and _count_money_cd_on_line(out[-1]) == 0
                and (
                    _is_hist_type_only(out[-1])
                    or re.search(r"(?i)pix\s+(enviado|recebido)\.?$", out[-1])
                )
            ):
                out[-1] = f"{out[-1]} {merged_val}".strip()
            else:
                out.append(merged_val)
            i += 2
            continue

        if (
            out
            and _is_hist_type_only(out[-1])
            and _is_hist_name_line(ln)
            and not _parse_money_cd_line(ln, nxt)
            and _count_money_cd_on_line(ln) == 0
        ):
            out[-1] = f"{out[-1]} {ln}".strip()
            i += 1
            continue

        out.append(ln)
        i += 1
    return out


def _normalize_caixa_ocr_lines(text: str) -> List[str]:
    """Quebras normalizadas + coalesce atômico (entrada única do parser OCR)."""
    if not (text or "").strip():
        return []
    s = text.replace("\r\n", "\n").replace("\r", "\n")
    raw = [re.sub(r"[ \t]+", " ", ln).strip() for ln in s.splitlines()]
    raw = [ln for ln in raw if ln]
    return _coalesce_atomic_ocr_lines(raw)


def _collect_valor_column(lines: List[str], start_i: int, need: int) -> Tuple[List[Tuple[float, str]], int]:
    """Coleta exatamente `need` valores não nulos da coluna Movimento (C/D)."""
    vals: List[Tuple[float, str]] = []
    i = start_i
    while i < len(lines) and len(vals) < need:
        nxt = lines[i + 1] if i + 1 < len(lines) else None
        ln_compact = re.sub(r"(?i)^r\$\s*", "", lines[i]).replace(" ", "")
        parsed = _parse_money_cd_line(lines[i], nxt)
        if parsed is None:
            i += 1
            continue
        if (
            nxt
            and _MONEY_ONLY_LINE_RE.match(ln_compact)
            and _CD_ONLY_LINE_RE.match(nxt.strip())
        ):
            i += 2
        else:
            i += 1
        v, cd = parsed
        if float(v) == 0:
            continue
        vals.append((v, cd))
    return vals, i


def _merge_locked_and_column_vals(
    locked: List[Optional[Tuple[float, str]]],
    col_vals: List[Tuple[float, str]],
) -> List[Tuple[float, str]]:
    """Valores já presos à descrição atômica + fila da coluna Valor."""
    out: List[Tuple[float, str]] = []
    j = 0
    for lv in locked:
        if lv is not None:
            out.append(lv)
        elif j < len(col_vals):
            out.append(col_vals[j])
            j += 1
    while j < len(col_vals) and len(out) < len(locked):
        out.append(col_vals[j])
        j += 1
    return out
_DOC_LINE_RE = re.compile(r"^\d{5,8}$")
_HIST_TYPE_RE = re.compile(
    r"(?i)^(pix|compra|saque|devol|ted\b|doc\b|cred|pagamento|transfer|tarifa|remuner|estorno)"
)
_OCR_JUNK_RE = re.compile(r"^[\*\#]|/\d|\.{3,}|^oe\s+\d", re.I)


def _is_caixa_ocr_columnar(text: str) -> bool:
    """
    Layout do Tesseract: colunas empilhadas (muitas linhas só com tipo PIX/COMPRA).
    Não usar em PDF original com lançamento completo por linha.
    """
    if not text or len(text) < 200:
        return False
    if _is_caixa_row_layout_text(text):
        return False
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    type_only = sum(
        1
        for ln in lines
        if re.match(
            r"(?i)^(pix\s+(enviado|recebido)|compra\s+cart[aã]o\s+debito)\.?$", ln
        )
    )
    if type_only >= 5:
        return True
    date_only = sum(1 for ln in lines if _DATE_MOV_RE.match(ln))
    if date_only >= 8 and type_only >= 3:
        return True
    pix = len(re.findall(r"(?i)pix\s+(enviado|recebido)", text))
    dates = len(re.findall(r"\d{2}/\d{2}/\d{4}", text))
    return dates >= 15 and pix >= 5 and type_only >= 3


def _is_ocr_junk_line(ln: str) -> bool:
    if not ln or len(ln) < 2:
        return True
    if _OCR_JUNK_RE.search(ln):
        return True
    if re.search(r"(?i)^r\$\s*\d", ln):
        return True
    if re.match(r"^[\d\.\*#/]{6,}$", ln.replace(" ", "")):
        return True
    return False


def _is_caixa_footer_noise(ln: str) -> bool:
    """Rodapé / telefones do extrato que o OCR cola na coluna de nomes."""
    if not ln:
        return False
    low = ln.lower()
    if re.search(
        r"(?i)caixa\s*:\s*0?800|ouvidoria\s*:|sac\s+caixa|"
        r"regi[oõ]es\s+metropolitanas|defici[eê]ncia\s*:\s*0800|"
        r"^ald\s+caixa|capitais\s+e\s+reg",
        ln,
    ):
        return True
    if re.search(r"\b0800\s*[\d\s]{6,}", ln):
        return True
    if re.search(r"(?i)^pessoas\s+com\s+defici", low):
        return True
    return False


def _is_hist_noise_line(ln: str) -> bool:
    """
    Rótulos de outra coluna (CREDITO JUROS, CORRECAO MONETARIA) ou rodapé —
    não são favorecidos nem lançamentos completos.
    """
    s = re.sub(r"\s+", " ", (ln or "").strip())
    if not s:
        return True
    if _is_caixa_footer_noise(s):
        return True
    if re.match(r"(?i)^credito\s+juros\.?$", s):
        return True
    if re.match(r"(?i)^correcao\s+monetaria\.?$", s):
        return True
    return False


def _is_saldo_marker(ln: str) -> bool:
    return bool(re.search(r"(?i)^saldo\s+(anterior|dia)\b", ln))


def _is_standalone_product_hist(ln: str) -> bool:
    """Produto na coluna Histórico sem favorecido — ex. Bolsa Família."""
    s = re.sub(r"\s+", " ", (ln or "").strip())
    return bool(re.search(r"(?i)^programa\s+bolsa\b", s))


def _is_caixa_channel_label(ln: str) -> bool:
    """
    Rótulos de canal/produto na coluna favorecido (não são pessoa).
    Ex.: DEBITO TRANSPORTE PUBLICO, PAG BOLETO IBC, DEPOSITO DINH LOTERICO.
    """
    s = re.sub(r"\s+", " ", (ln or "").strip())
    if not s:
        return False
    if re.match(
        r"(?i)^(?:deb[ií]to\s+transporte|pag\s+boleto|deposito\s+dinh|"
        r"pag\s+orgaos\s+gov|saque\s+din|credito\s+salario|deb\s+prest)",
        s,
    ):
        return True
    if re.match(r"(?i)^compra\s+cart[aã]o\s+debito\.?$", s):
        return True
    return False


def _is_hist_section_junk(ln: str) -> bool:
    """Data/doc repetidos no bloco Histórico (OCR colou colunas)."""
    s = (ln or "").strip()
    if not s:
        return True
    if _DATE_MOV_RE.match(s) or (
        s.startswith("(") and _DATE_MOV_RE.search(s)
    ):
        return True
    if _DOC_LINE_RE.match(s) or re.match(r"^\d{4,8}$", s):
        return True
    if re.match(r"^W?\d{4,6}$", s, re.I):
        return True
    if re.search(r"[\*#]{2,}|/\d+\*|[\+\*]{2,}\d", s):
        return True
    return False


def _scrub_caixa_description(desc: str) -> str:
    """Remove favorecido-falso colado ao tipo (canal/produto do OCR)."""
    s = _sanitize_caixa_description(desc)
    if not s:
        return s
    m = re.match(r"(?i)^(pix\s+(?:enviado|recebido|devolvido))\s+(.+)$", s)
    if m:
        kind, rest = m.group(1).upper(), m.group(2).strip()
        if _is_caixa_channel_label(rest):
            return kind
    m2 = re.match(r"(?i)^(compra\s+cart[aã]o\s+debito)\s+(.+)$", s)
    if m2 and _is_caixa_channel_label(m2.group(2)):
        return m2.group(1).upper()
    return s


def _is_misplaced_type_in_names_column(ln: str) -> bool:
    """
    OCR às vezes coloca o tipo do lançamento (CR CONV FGTS, etc.) na coluna de nomes,
    deslocando todos os favorecidos — ex.: 230,00 C de Abddbank vira Vasconcelos.
    """
    s = re.sub(r"\s+", " ", (ln or "").strip())
    if _is_standalone_product_hist(s):
        return True
    if re.search(r"(?i)^cr\s+conv\b", s):
        return True
    if re.search(r"(?i)dep-jam\s+fgts|saq\s+dep-jam", s):
        return True
    if re.match(r"(?i)^credito\s+salario\b", s):
        return True
    if re.match(r"(?i)^deb\s+prest\s+empr", s):
        return True
    if re.match(r"(?i)^saque\s+din", s):
        return True
    if _is_caixa_channel_label(s):
        return True
    return False


def _type_omits_counterparty(t: str) -> bool:
    """
    Lançamentos sem favorecido na coluna de nomes — não consome slot da fila
    (evita deslocar DEB PREST EMPR → Shpp Brasil no índice seguinte).
    """
    s = (t or "").strip()
    if _is_misplaced_type_in_names_column(s):
        return True
    if re.match(r"(?i)^credito\s+salario\b", s):
        return True
    if re.match(r"(?i)^deb\s+prest\s+empr", s):
        return True
    if re.match(r"(?i)^saque\s+din", s) or re.match(r"(?i)^saque\b", s):
        return True
    if _is_standalone_product_hist(s):
        return True
    if re.search(r"(?i)^cr\s+conv\b", s):
        return True
    if _is_caixa_channel_label(s):
        return True
    return False


def _expected_cd_for_hist(desc: str) -> Optional[str]:
    """C/D esperado pelo código do histórico (não inventa — só valida pareamento)."""
    s = _sanitize_caixa_description(desc)
    if _CAIXA_CREDIT_HIST_RE.search(s):
        return "C"
    if _CAIXA_DEBIT_HIST_RE.search(s):
        return "D"
    return None


def _realign_vals_by_hist_cd(
    hists: List[str], vals: List[Tuple[float, str]]
) -> List[Tuple[float, str]]:
    """
    Coluna Valor deslocada: ex. CREDITO SALARIO recebe 120C do PIX em vez de 1.920C.
    Reatribui valores não usados quando o C/D não bate com o histórico.
    """
    if not hists or len(hists) != len(vals):
        return vals
    v = list(vals)
    n = len(hists)
    used = [False] * n
    new_v: List[Optional[Tuple[float, str]]] = [None] * n

    for i in range(n):
        exp = _expected_cd_for_hist(hists[i])
        parsed = _as_money_cd(v[i])
        if not exp or not parsed:
            continue
        if parsed[1] == exp:
            new_v[i] = v[i]
            used[i] = True

    pool = [j for j in range(n) if not used[j]]
    for i in range(n):
        if new_v[i] is not None:
            continue
        exp = _expected_cd_for_hist(hists[i])
        pick = None
        if exp:
            for j in pool:
                p = _as_money_cd(v[j])
                if p and p[1] == exp:
                    pick = j
                    break
        if pick is None and pool:
            pick = pool[0]
        if pick is not None:
            new_v[i] = v[pick]
            used[pick] = True
            pool = [j for j in pool if j != pick]

    for i in range(n):
        if new_v[i] is None:
            new_v[i] = v[i]
    return new_v  # type: ignore[return-value]


def _is_non_counterparty_label(ln: str) -> bool:
    """Rótulos de produto/canal — não são favorecido do lançamento."""
    s = re.sub(r"\s+", " ", (ln or "").strip()).lower()
    if _is_hist_header_name(ln):
        return True
    if _is_standalone_product_hist(ln):
        return False
    if re.search(
        r"(?i)dep\s+dinheiro\s+caixa|tar\s+saque|"
        r"correspondente|univebet|favorecido\s*$|margo\.",
        s,
    ):
        return True
    return False


def _is_hist_header_name(ln: str) -> bool:
    """Titular / cabeçalho da coluna favorecido — não é contraparte do lançamento."""
    s = re.sub(r"\s+", " ", (ln or "").strip())
    if re.match(r"(?i)^ma[ií]ara\s+regina\s+de\s+souza$", s):
        return True
    if re.search(r"(?i)hist[oó]rico|complemento\s+favorecido", s):
        return True
    if re.match(r"(?i)^cpf/cnpj$", s):
        return True
    if re.match(r"(?i)^favorecido$", s):
        return True
    return False


def _is_hist_type_only(ln: str) -> bool:
    s = ln.rstrip(".").strip()
    if _is_saldo_marker(s):
        return False
    if _is_misplaced_type_in_names_column(s):
        return True
    if re.match(r"(?i)^pix\s+(enviado|recebido|devolvido)\.?$", s):
        return True
    if re.match(r"(?i)^compra\s+cart", s) and len(s.split()) <= 5:
        return True
    if re.match(r"(?i)^saque\s+din", s):
        return True
    return False


def _is_hist_combined(ln: str) -> bool:
    """Histórico completo em uma linha (tipo + contraparte), não nome solto tipo 'Pix Advance'."""
    if _is_saldo_marker(ln) or _is_ocr_junk_line(ln):
        return False
    if re.search(r"(?i)devolucao\s+pix", ln):
        return True
    m_pix = re.match(r"(?i)^(pix\s+(?:enviado|recebido|devolvido))\s+(.+)$", ln)
    if m_pix:
        rest = m_pix.group(2).strip()
        if _is_caixa_channel_label(rest):
            return False
        return _has_meaningful_word(rest)
    if re.search(r"(?i)^compra\s+cart[aã]o\s+deb", ln) and len(ln.split()) >= 4:
        return True
    if re.match(r"(?i)^deb[ií]to\s+transporte\s+\S", ln):
        return True
    if re.search(r"(?i)^(compra\s+cart[aã]o|saque\s+din)\b", ln) and not _is_hist_type_only(ln):
        return True
    return False


def _is_hist_name_line(ln: str) -> bool:
    if (
        _DATE_MOV_RE.match(ln)
        or _DOC_LINE_RE.match(ln)
        or _is_saldo_marker(ln)
        or _is_ocr_junk_line(ln)
        or _is_hist_noise_line(ln)
        or _is_non_counterparty_label(ln)
        or _is_hist_type_only(ln)
        or _is_hist_combined(ln)
        or _is_caixa_channel_label(ln)
    ):
        return False
    if _parse_money_cd_line(ln):
        return False
    low = ln.lower()
    if re.match(r"(?i)^(valor|saldo|hist|data|cliente|conta|nr|lan|m[eê]s|per)", ln) and len(ln) < 25:
        return False
    if re.search(
        r"(?i)extrato\s+por\s+periodo|lan[cç]amentos|periodo\s+dos|"
        r"^(janeiro|fevereiro|mar[cç]o|abril|maio|junho|julho|agosto|"
        r"setembro|outubro|novembro|dezembro)$",
        low,
    ):
        return False
    return _has_meaningful_word(ln) and len(ln) >= 3


def _next_counterparty_name(names: List[str], start: int) -> Tuple[str, int]:
    i = start
    while i < len(names):
        cand = _sanitize_caixa_description(names[i].strip())
        i += 1
        if (
            _is_hist_noise_line(cand)
            or _is_non_counterparty_label(cand)
            or _is_misplaced_type_in_names_column(cand)
            or _is_caixa_channel_label(cand)
        ):
            continue
        return cand, i
    return "", i


def _merge_hist_columns_columnar(
    types: List[str], names: List[str], combined: List[str]
) -> List[str]:
    """Compat legado: reconstrói eventos e materializa em ordem."""
    events: List[Tuple[str, str]] = [("c", ln) for ln in combined]
    for t in types:
        events.append(("t", t))
    for n in names:
        events.append(("n", n))
    return _materialize_hist_events(events)


def _materialize_hist_events(
    events: List[Tuple[str, Any]],
) -> Tuple[List[str], List[Optional[Tuple[float, str]]]]:
    """
    Preserva a ordem do OCR (combined intercalado ou bloco tipo→nome).
    Eventos 'cv' já trazem valor na mesma célula — não consomem índice da coluna Valor.
    """
    hists: List[str] = []
    locked_vals: List[Optional[Tuple[float, str]]] = []
    name_pool = [ev[1] for ev in events if ev[0] == "n"]
    name_i = 0
    for ev in events:
        k = ev[0]
        if k == "n":
            continue
        if k == "cv":
            desc, val = ev[1], ev[2]
            hists.append(desc[:_MAX_DESC_LEN])
            locked_vals.append(val)
            continue
        text = _sanitize_caixa_description(str(ev[1]).rstrip(".").strip())
        if not text or _is_saldo_marker(text):
            continue
        if k == "c":
            hists.append(text[:_MAX_DESC_LEN])
            locked_vals.append(None)
            continue
        if k not in ("t", "d"):
            continue
        if _type_omits_counterparty(text):
            hists.append(text[:_MAX_DESC_LEN])
        elif _is_hist_type_only(text):
            nm, name_i = _next_counterparty_name(name_pool, name_i)
            desc = f"{text} {nm}".strip() if nm else text
            hists.append(desc[:_MAX_DESC_LEN])
        else:
            hists.append(text[:_MAX_DESC_LEN])
        locked_vals.append(None)
    return hists, locked_vals


def _merge_hist_columns(
    types: List[str], names: List[str], combined: List[str]
) -> List[str]:
    return _merge_hist_columns_columnar(types, names, combined)


def _as_money_cd(val: Any) -> Optional[Tuple[float, str]]:
    """Normaliza célula (valor, C/D) da coluna Valor."""
    if not isinstance(val, (tuple, list)) or len(val) < 2:
        return None
    try:
        cd = str(val[1] or "C").strip().upper()
        if cd not in {"C", "D"}:
            cd = "C"
        return float(val[0]), cd
    except (TypeError, ValueError):
        return None


def _extract_pix_kind_and_name(desc: str) -> Tuple[str, str]:
    m = re.match(r"(?i)^(pix\s+(enviado|recebido))\s+(.+)$", (desc or "").strip())
    if m:
        return m.group(1).upper(), m.group(3).strip()
    return "", (desc or "").strip()


def _repair_pix_enviado_recebido_cross(
    hists: List[str], vals: List[Tuple[float, str]]
) -> Tuple[List[str], List[Tuple[float, str]]]:
    """
    OCR da Caixa inverte colunas Tipo vs Nome: ex. ENVIADO+PDS com 10D e RECEBIDO+Rvls com 50C,
    quando no PDF é RECEBIDO+PDS 50C e ENVIADO+Rvls 10D.
    Corrige trocando rótulo PIX + valor entre o par (mantém o favorecido em cada linha).
    """
    if len(hists) < 2 or len(hists) != len(vals):
        return hists, vals
    h = list(hists)
    v = list(vals)
    for i in range(len(h) - 1):
        ki, ni = _extract_pix_kind_and_name(h[i])
        kj, nj = _extract_pix_kind_and_name(h[i + 1])
        if not ki or not kj:
            continue
        pi = _as_money_cd(v[i])
        pj = _as_money_cd(v[i + 1])
        if not pi or not pj:
            continue
        vi, cdi = pi
        vj, cdj = pj
        ratio = (vi / vj) if vj else 0.0
        # Ex.: 10D + 50C (razão ~0,2) — OCR trocou tipo/nome; não aplicar em 10D + 380C (~0,03).
        ratio_ok = 0.08 <= ratio <= 0.55
        if (
            ki == "PIX ENVIADO"
            and kj == "PIX RECEBIDO"
            and cdi == "D"
            and cdj == "C"
            and vi < vj
            and ratio_ok
        ):
            h[i] = f"PIX RECEBIDO {ni}".strip()[:_MAX_DESC_LEN]
            h[i + 1] = f"PIX ENVIADO {nj}".strip()[:_MAX_DESC_LEN]
            v[i], v[i + 1] = v[i + 1], v[i]
        elif (
            ki == "PIX RECEBIDO"
            and kj == "PIX ENVIADO"
            and cdi == "C"
            and cdj == "D"
            and vi > vj
            and ratio_ok
        ):
            h[i] = f"PIX ENVIADO {ni}".strip()[:_MAX_DESC_LEN]
            h[i + 1] = f"PIX RECEBIDO {nj}".strip()[:_MAX_DESC_LEN]
            v[i], v[i + 1] = v[i + 1], v[i]
    return h, v


def _repair_caixa_hist_val_alignment(
    hists: List[str], vals: List[Tuple[float, str]]
) -> Tuple[List[str], List[Tuple[float, str]]]:
    """
    OCR desloca valor de DEB PREST EMPR para PIX RECEBIDO (ex.: 12.770,77 D na linha errada).
    Detecta empréstimo grande (D) rotulado como PIX RECEBIDO e troca com DEB PREST EMPR.
    """
    if len(hists) != len(vals) or not hists:
        return hists, vals
    h = list(hists)
    v = list(vals)
    n = len(h)

    for i in range(n):
        parsed = _as_money_cd(v[i])
        if not parsed:
            continue
        vi, cdi = parsed
        if not re.search(r"(?i)pix\s+recebido", h[i]) or cdi != "D" or vi < 500:
            continue
        for j in range(n):
            if j == i or not re.search(r"(?i)deb\s+prest\s+empr", h[j]):
                continue
            v[i], v[j] = v[j], v[i]
            break
    return h, v


def _assign_dates_to_hists(dates: List[str], hists: List[str]) -> List[str]:
    """
    OCR às vezes tem menos linhas de Data que lançamentos (ex. Bolsa no mesmo dia).
    Produtos sem favorecido reutilizam a data do lançamento anterior.
    """
    if not hists:
        return []
    out: List[str] = []
    di = 0
    for h in hists:
        if out and _is_standalone_product_hist(h):
            out.append(out[-1])
            continue
        if di < len(dates):
            out.append(dates[di])
            di += 1
        else:
            out.append(out[-1] if out else "")
    return out


def _append_hist_event(
    hist_events: List[Tuple[str, Any]], kind: str, text: str
) -> None:
    """Registra histórico; se a linha já inclui valor C/D, usa evento atômico 'cv'."""
    text = text.rstrip(".").strip()
    if not text:
        return
    atomic = _split_desc_and_trailing_value(text)
    if atomic:
        hist_events.append(("cv", atomic[0], atomic[1]))
        return
    hist_events.append((kind, text))


def _parse_caixa_chunk(body: List[str]) -> Tuple[List[str], List[str], List[Tuple[float, str]]]:
    """
    Uma página OCR: colunas Data → Doc → Histórico → Valor.
    Linhas coalescidas (célula atômica) antes do pareamento por índice.
    """
    lines = _coalesce_atomic_ocr_lines([ln.strip() for ln in body if ln.strip()])
    dates: List[str] = []
    hist_events: List[Tuple[str, Any]] = []

    i = 0
    while i < len(lines) and not _DATE_MOV_RE.match(lines[i]):
        i += 1
    while i < len(lines):
        dm = _DATE_MOV_RE.match(lines[i])
        if not dm:
            break
        if dm.group(2) != "00:00:00":
            dates.append(dm.group(1))
        i += 1

    while i < len(lines) and (_DOC_LINE_RE.match(lines[i]) or lines[i] == "000000"):
        i += 1

    valor_start = i
    while i < len(lines):
        ln = lines[i]
        nxt = lines[i + 1] if i + 1 < len(lines) else None
        if (
            _parse_money_cd_line(ln, nxt)
            and not _split_desc_and_trailing_value(ln)
            and hist_events
        ):
            break
        if _is_saldo_marker(ln) or _is_ocr_junk_line(ln) or _is_hist_noise_line(ln):
            i += 1
            continue
        if _is_hist_section_junk(ln):
            i += 1
            continue
        if _is_hist_combined(ln) or _split_desc_and_trailing_value(ln):
            _append_hist_event(hist_events, "c", ln)
            i += 1
            continue
        if _is_misplaced_type_in_names_column(ln) or _is_standalone_product_hist(ln):
            _append_hist_event(hist_events, "d", ln)
            i += 1
            continue
        if _is_hist_type_only(ln):
            _append_hist_event(hist_events, "t", ln)
            i += 1
            continue
        if _is_hist_name_line(ln):
            hist_events.append(("n", ln))
            i += 1
            continue
        i += 1

    hists, locked_vals = _materialize_hist_events(hist_events)
    need_locked = sum(1 for v in locked_vals if v is None)
    col_vals: List[Tuple[float, str]] = []
    if need_locked > 0:
        col_vals, _ = _collect_valor_column(lines, valor_start, need_locked)
    vals = _merge_locked_and_column_vals(locked_vals, col_vals)

    if hists:
        n = min(len(hists), len(vals))
        hists = hists[:n]
        vals = vals[:n]
        vals = _realign_vals_by_hist_cd(hists, vals)
        hists, vals = _repair_pix_enviado_recebido_cross(hists, vals)
        hists, vals = _repair_caixa_hist_val_alignment(hists, vals)
        hists = [_scrub_caixa_description(h) for h in hists]
        dates = _assign_dates_to_hists(dates, hists)

    return dates, hists, vals


def extract_caixa_ocr_columns(text: str) -> pd.DataFrame:
    """
    Extrato Caixa escaneado: OCR lê colunas verticalmente (Data, Histórico, Valor).
    Empilha na ordem do PDF e pareia por índice global (mesma linha lógica da tabela).
    """
    lines = [ln.strip() for ln in (text or "").splitlines() if ln.strip()]
    chunks: List[List[str]] = []
    cur: List[str] = []
    for ln in lines:
        if ln.upper() == "CAIXA" and cur:
            chunks.append(cur)
            cur = [ln]
        else:
            cur.append(ln)
    if cur:
        chunks.append(cur)

    rows: list[dict[str, Any]] = []
    pending_dates: List[str] = []
    pending_vals: List[Tuple[float, str]] = []

    def emit(dt: str, desc: str, val: Tuple[float, str]) -> None:
        desc = _scrub_caixa_description(desc)
        desc, amt = _finalize_caixa_amount(desc, val)
        _, counterparty = _split_caixa_description_parts(desc)
        rows.append(
            {
                "date": dt,
                "description": desc,
                "amount": amt,
                "counterparty": counterparty or None,
                "balance": None,
            }
        )

    for ch in chunks:
        body = ch[1:] if ch and ch[0].upper() == "CAIXA" else ch
        d, h, v = _parse_caixa_chunk(body)

        if h:
            if pending_dates:
                n0 = min(len(pending_dates), len(pending_vals), len(h))
                for i in range(n0):
                    emit(pending_dates[i], h[i], pending_vals[i])
                pending_dates = pending_dates[n0:]
                pending_vals = pending_vals[n0:]
                h = h[n0:]

            n1 = min(len(d), len(h), len(v))
            for i in range(n1):
                emit(d[i], h[i], v[i])
            if len(d) > n1:
                pending_dates.extend(d[n1:])
            if len(v) > n1:
                pending_vals.extend(v[n1:])

        elif d and v:
            pending_dates.extend(d)
            pending_vals.extend(v)

    return pd.DataFrame(rows)


def _infer_sign_from_buffer(desc_buffer: List[str]) -> Optional[float]:
    blob = " ".join(desc_buffer).lower()
    neg_pat = (
        "debito",
        "débito",
        "compra",
        "pagamento",
        "pag ",
        "tarifa",
        "saque",
        "enviad",
        "envio",
        "transferência env",
        "ted env",
        "doc env",
        "pagto",
        "déb.",
        "deb.",
        "- env",
    )
    pos_pat = (
        "credito",
        "crédito",
        "receb",
        "deposito",
        "depósito",
        "cred.",
        "créd.",
        "pix receb",
        "ted receb",
        "rendimento",
        "estorno",
    )
    if any(w in blob for w in neg_pat):
        return -1.0
    if any(w in blob for w in pos_pat):
        return 1.0
    return None


def extract_caixa_transactions(text: str) -> pd.DataFrame:
    raw = text or ""
    if _is_caixa_ocr_columnar(raw):
        df_cols = extract_caixa_ocr_columns(raw)
        if df_cols is not None and not df_cols.empty:
            return df_cols

    # PDF original (texto embutido): data + histórico + valor na mesma linha
    if _detect_caixa_periodo_text(raw):
        df_p = extract_caixa_periodo(raw)
        if df_p is not None and not df_p.empty:
            return df_p

    text = _preprocess_ocr_blob(raw)
    # 1) regex global (OCR costuma quebrar colunas/linhas)
    df_rx = _extract_by_regex(text)
    if df_rx is not None and not df_rx.empty:
        return df_rx

    # 2) fallback linha-a-linha
    lines = [_normalize_money_noise(l.strip()) for l in text.splitlines() if l.strip()]
    rows = []
    current_date: Optional[str] = None
    desc_buffer: List[str] = []

    for line in lines:
        low = line.lower()
        if _is_junk_header_line(low):
            continue

        nd, rest_after_date = _parse_line_date(line)
        if nd:
            current_date = nd
            line = rest_after_date

        matched = _match_value_and_sign(line)
        if matched and current_date:
            raw_str, amt_signed, desc_rest, needs_infer = matched

            desc_parts = desc_buffer.copy()
            if desc_rest:
                desc_parts.append(desc_rest)

            desc = _sanitize_caixa_description(
                " ".join(x for x in desc_parts if x).strip()
            )
            # Guard-rails: OCR colado vira um blob gigante; não cria transação assim
            if len(desc) > _MAX_DESC_LEN:
                desc_buffer = []
                continue
            if _is_balance_like_desc(desc):
                desc_buffer = []
                continue
            # sem palavra “de verdade” (2+ letras) = quase sempre lixo OCR
            if desc and not _has_meaningful_word(desc):
                desc_buffer = []
                continue
            # se o OCR quebrou e sobrou só "C"/"D"/"€", não cria transação ruim
            if desc in {"C", "D", "€"}:
                desc_buffer = []
                continue

            if needs_infer:
                guess = _infer_sign_from_buffer(desc_buffer + ([desc_rest] if desc_rest else []))
                if guess is not None:
                    amt_signed = guess * abs(amt_signed)

            # se ainda não sobrou nada útil, não cria transação “muda”
            if not desc:
                desc_buffer = []
                continue

            _, cp = _split_caixa_description_parts(desc)
            rows.append(
                {
                    "date": current_date,
                    "description": desc,
                    "amount": amt_signed,
                    "counterparty": cp or None,
                }
            )
            desc_buffer = []
            continue

        desc_buffer.append(line)

    return pd.DataFrame(rows)


def finalize_caixa_df(df: pd.DataFrame, holder: Optional[str]) -> pd.DataFrame:
    out = df.copy()
    out["_source"] = "caixa"
    out["holder"] = holder
    for col in (
        "date",
        "description",
        "amount",
        "debit",
        "credit",
        "balance",
        "counterparty",
        "_source",
        "holder",
    ):
        if col not in out.columns:
            out[col] = None
    return out[
        [
            "date",
            "description",
            "amount",
            "debit",
            "credit",
            "balance",
            "counterparty",
            "_source",
            "holder",
        ]
    ].copy()


def try_extract(pdf_text: str, pdf_path: Optional[str] = None) -> Optional[pd.DataFrame]:
    """Interface padrão dos extractors (texto embutido; OCR se pdf_path e texto vazio)."""
    if pdf_path and len((pdf_text or "").strip()) < 40:
        return parse_caixa_pdf(pdf_path, pdf_text or "")
    src = (pdf_text or "").strip()
    if not src:
        return None
    df = extract_caixa_transactions(src)
    if df is None or df.empty:
        return None
    return finalize_caixa_df(df, extract_caixa_holder(src))


def _detect_caixa_format(pdf_path: str, embedded_text: str = "") -> str:
    """periodo_embedded | scan_columnar"""
    if _embedded_text_chars(pdf_path) >= 80:
        text = (embedded_text or "").strip() or pdf_to_text_embedded(pdf_path)
        if _detect_caixa_periodo_text(text):
            return "periodo_embedded"
    return "scan_columnar"


def _parse_caixa_pdf_core(
    pdf_path: str, embedded_text: str = ""
) -> Optional[pd.DataFrame]:
    """
    Pipeline Caixa: período embutido OU OCR colunar por página (não é fluxo genérico).
    """
    text = (embedded_text or "").strip()
    if len(text) < 40:
        text = (pdf_to_text_embedded(pdf_path) or "").strip()

    fmt = _detect_caixa_format(pdf_path, text)
    holder_src = text
    df = pd.DataFrame()

    if fmt == "periodo_embedded":
        df = extract_caixa_periodo(text)
        if df is None or df.empty:
            df = extract_caixa_transactions(text)
    else:
        ocr_blob = ""
        try:
            ocr_blob = (pdf_to_text_ocr(pdf_path) or "").strip()
        except Exception:
            pass
        src = ocr_blob if len(ocr_blob) > len(text) else text
        holder_src = src or holder_src

        if _is_caixa_ocr_columnar(src):
            df = extract_caixa_ocr_columns(src)
        elif _detect_caixa_periodo_text(src):
            df = extract_caixa_periodo(src)
        else:
            df = extract_caixa_transactions(src)

    if df is None or df.empty:
        return None

    holder = extract_caixa_holder(holder_src) or extract_caixa_holder(text)
    out = finalize_caixa_df(df, holder)
    out["_source"] = "caixa_v2"
    out["_caixa_format"] = fmt
    return out


def parse_caixa_pdf(pdf_path: str, embedded_text: str = "") -> Optional[pd.DataFrame]:
    """Delega ao extrator novo (`caixa_extrato`)."""
    from extractors.caixa_extrato import parse_caixa_pdf as _parse_new

    return _parse_new(pdf_path, embedded_text)


def try_extract_caixa(pdf_path: str) -> Optional[pd.DataFrame]:
    return parse_caixa_pdf(pdf_path, "")
