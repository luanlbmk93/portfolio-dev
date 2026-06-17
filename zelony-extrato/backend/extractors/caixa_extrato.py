"""
Caixa Econômica — extrator novo (2026).

PDF escaneado: OCR do Tesseract empilha colunas (datas → docs → tipos → nomes → valores).
Regra: C/D do PDF define o sinal; não realinha por palavra-chave no histórico.
"""
from __future__ import annotations

import os
import re
from typing import Any, Dict, List, Optional, Tuple

import pandas as pd

_BR_VAL = r"\d{1,3}(?:\.\d{3})*,\d{2}|\d+,\d{2}"
_DATE_RE = re.compile(r"^(\d{2}/\d{2}/\d{4})\s*-\s*(\d{2}:\d{2}:\d{2})")
_DOC_RE = re.compile(r"^(?:\d{5,8}|000000)$")
_MONEY_RE = re.compile(rf"^({_BR_VAL})\s*([CDcd])\s*$", re.I)
_ROW_PERIOD = re.compile(
    rf"^(?P<dt>\d{{2}}/\d{{2}}/\d{{4}})"
    rf"(?:\s*-\s*\d{{2}}:\d{{2}}:\d{{2}})?\s+"
    rf"(?P<rest>.+)$"
)
_MONEY_TAIL = re.compile(rf"({_BR_VAL})\s*([CDcd])\s*$", re.I)
_SALDO_MARK = re.compile(r"(?i)^saldo\s+(?:dia|anterior)\b")
_JUNK_LINE = re.compile(
    r"(?i)^(?:caixa|extrato\s+por|cliente|conta|ag[eê]ncia|per[ií]odo|"
    r"data|nr\.?\s*doc|hist[oó]rico|favorecido|lan[cç]amentos|complemento|"
    r"imprime_ext|internet\s*banking|pessoas\s+com|defici[eê]ncia|0800|"
    r"ouvidoria|sac\s+caixa|capitais\s+e\s+reg)"
)
_OCR_GARBAGE = re.compile(r"^[\d\*#\+%\.\s]{6,}$|^\*\*|^et\s+\d", re.I)

_TYPE_PIX = re.compile(r"(?i)^pix\s+(?:enviado|recebido|devolvido)")
_TYPE_OTHER = re.compile(
    r"(?i)^(?:compra\s+cart[aã]o\s+deb|deb[ií]to\s+transporte|pag\s+boleto|"
    r"dep[oó]sito\s+dinh|credito\s+salario|credito\s+juros|correcao\s+monet|"
    r"saque\s+din|tar\s+|programa\s+bolsa|remuner|estorno|ted\b|doc\b)"
)
_TYPE_NO_NAME = re.compile(
    r"(?i)^(?:deb[ií]to\s+transporte|pag\s+boleto|dep[oó]sito\s+dinh|"
    r"credito\s+salario|credito\s+juros|correcao\s+monet|saque\s+din|"
    r"saldo\s+anterior|programa\s+bolsa)"
)


def _parse_money(value: str) -> Optional[float]:
    if not value:
        return None
    try:
        return float(value.replace(".", "").replace(",", "."))
    except ValueError:
        return None


def _configure_tesseract() -> None:
    import pytesseract

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
    blobs: List[str] = []
    try:
        import fitz

        doc = fitz.open(pdf_path)
        try:
            parts = [(p.get_text("text") or "").strip() for p in doc]
            parts = [p for p in parts if p]
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
    return max(blobs, key=len) if blobs else ""


def pdf_to_text_ocr(pdf_path: str) -> str:
    import fitz
    import pytesseract
    from PIL import Image

    _configure_tesseract()
    lang_pref = (os.environ.get("TESS_LANG") or "por+eng").strip() or "por+eng"
    langs = [lang_pref]
    if lang_pref != "eng":
        langs.append("eng")
    try:
        dpi = float(os.environ.get("CAIXA_OCR_DPI", "200"))
    except ValueError:
        dpi = 200.0
    dpi = max(120.0, min(dpi, 220.0))
    z = dpi / 72.0
    mat = fitz.Matrix(z, z)
    out: List[str] = []
    doc = fitz.open(pdf_path)
    try:
        for page in doc:
            pix = page.get_pixmap(matrix=mat, alpha=False)
            img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
            text = ""
            for lg in langs:
                try:
                    text = pytesseract.image_to_string(img, lang=lg) or ""
                    if len(text.strip()) > 80:
                        break
                except Exception:
                    continue
            if not text.strip():
                text = pytesseract.image_to_string(img) or ""
            out.append(text)
    finally:
        doc.close()
    return "\n".join(out)


def _embedded_chars(pdf_path: str) -> int:
    try:
        import fitz

        doc = fitz.open(pdf_path)
        try:
            return sum(len((p.get_text("text") or "")) for p in doc)
        finally:
            doc.close()
    except Exception:
        return 0


def _is_periodo_line(text: str) -> bool:
    if not text or len(text) < 200:
        return False
    rows = 0
    for ln in text.splitlines():
        ln = re.sub(r"\s+", " ", ln.strip())
        if not ln:
            continue
        if _ROW_PERIOD.match(ln) and _MONEY_TAIL.search(ln):
            rows += 1
            if rows >= 3:
                return True
    return False


def _is_transaction_type(line: str) -> bool:
    s = re.sub(r"\s+", " ", (line or "").strip()).rstrip(".,")
    if not s or _SALDO_MARK.match(s):
        return False
    return bool(_TYPE_PIX.match(s) or _TYPE_OTHER.match(s))


def _is_name_line(line: str) -> bool:
    s = re.sub(r"\s+", " ", (line or "").strip())
    if len(s) < 4:
        return False
    if _DATE_RE.match(s) or _DOC_RE.match(s) or _MONEY_RE.match(s):
        return False
    if _SALDO_MARK.match(s) or _is_transaction_type(s):
        return False
    if _JUNK_LINE.match(s) and len(s) < 40:
        return False
    if _OCR_GARBAGE.match(s.replace(" ", "")):
        return False
    return bool(re.search(r"[A-Za-zÀ-ÖØ-öø-ÿ]{3}", s))


def _normalize_type(s: str) -> str:
    s = re.sub(r"\s+", " ", s.strip()).rstrip(".,")
    m = _TYPE_PIX.match(s)
    if m:
        return s.upper().split()[0] + " " + s.upper().split()[1]
    return s.upper()


def _build_description(hist_type: str, name: str) -> str:
    t = _normalize_type(hist_type)
    n = re.sub(r"\s+", " ", (name or "").strip())
    if _TYPE_NO_NAME.match(t) or not n:
        return t
    return f"{t} {n}".strip()


def _amount_from_cd(value: float, cd: str) -> float:
    return abs(value) if cd.upper() == "C" else -abs(value)


def _amount_with_hist_sign(desc: str, value: float, cd: str) -> float:
    """
    Usa C/D do extrato; corrige só quando o tipo do histórico contradiz o OCR.
    (Evita COMPRA/PIX ENVIADO virarem entrada por C/D trocado.)
    """
    d = (desc or "").upper()
    v = abs(value)
    cd_u = (cd or "C").upper()
    debit_hints = (
        "PIX ENVIADO",
        "COMPRA CART",
        "DEBITO TRANSPORTE",
        "PAG BOLETO",
        "SAQUE DIN",
        "SAQUE ",
        "TAR ",
        "DEB PREST",
    )
    credit_hints = (
        "PIX RECEBIDO",
        "PIX DEVOLVIDO",
        "CREDITO SALARIO",
        "CREDITO JUROS",
        "DEPOSITO DINH",
        "DEPOSITO",
        "ESTORNO",
    )
    if any(h in d for h in debit_hints):
        return -v
    if any(h in d for h in credit_hints):
        return v
    return _amount_from_cd(value, cd_u)


def _parse_money_line(line: str) -> Optional[Tuple[float, str]]:
    m = _MONEY_RE.match(line.strip())
    if not m:
        return None
    v = _parse_money(m.group(1))
    if v is None:
        return None
    return v, m.group(2).upper()


def _split_pages(lines: List[str]) -> List[List[str]]:
    pages: List[List[str]] = []
    cur: List[str] = []
    for ln in lines:
        if ln.strip().upper() == "CAIXA" and cur:
            pages.append(cur)
            cur = [ln]
        else:
            cur.append(ln)
    if cur:
        pages.append(cur)
    return pages


def _parse_page(body: List[str]) -> Tuple[List[str], List[str], List[str], List[Tuple[float, str]]]:
    """Uma página OCR: datas, tipos, nomes, valores só entre Valor e Saldo."""
    dates: List[str] = []
    types: List[str] = []
    names: List[str] = []
    mov: List[Tuple[float, str]] = []

    valor_i = -1
    saldo_i = len(body)
    for i, ln in enumerate(body):
        ll = ln.lower().strip()
        if ll == "valor" and valor_i < 0:
            valor_i = i
        elif ll == "saldo" and valor_i >= 0 and saldo_i == len(body):
            saldo_i = i

    pre = body[:valor_i] if valor_i >= 0 else body
    mov_lines = body[valor_i + 1 : saldo_i] if valor_i >= 0 else []

    phase = "dates"
    for line in pre:
        line = line.strip()
        if not line or line.upper() == "CAIXA":
            continue
        if _JUNK_LINE.match(line) and len(line) < 35:
            continue
        m = _DATE_RE.match(line)
        if m:
            phase = "dates"
            if m.group(2) != "00:00:00":
                dates.append(m.group(1))
            continue
        if phase == "dates" and _DOC_RE.match(line):
            phase = "docs"
            continue
        if phase == "docs" and _DOC_RE.match(line):
            continue
        if phase in ("dates", "docs"):
            phase = "hist"
        if _SALDO_MARK.match(line):
            continue
        if _is_transaction_type(line):
            types.append(line)
            phase = "hist"
            continue
        if _is_name_line(line):
            names.append(re.sub(r"\s+", " ", line))
            phase = "names"
            continue

    for line in mov_lines:
        line = line.strip()
        if not line:
            continue
        p = _parse_money_line(line)
        if p:
            mov.append(p)

    if valor_i < 0 and types:
        tail_start = 0
        last_name = -1
        for idx, ln in enumerate(pre):
            if _is_name_line(ln):
                last_name = idx
        if last_name >= 0:
            tail_start = last_name + 1
        else:
            last_type = -1
            for idx, ln in enumerate(pre):
                if _is_transaction_type(ln):
                    last_type = idx
            if last_type >= 0:
                tail_start = last_type + 1
        for line in pre[tail_start:]:
            p = _parse_money_line(line.strip())
            if p:
                mov.append(p)

    mov = _trim_mov_for_types(mov, len(types), from_tail=(valor_i < 0))
    return dates, types, names, mov


def _trim_mov_for_types(
    mov: List[Tuple[float, str]], n_types: int, *, from_tail: bool = False
) -> List[Tuple[float, str]]:
    """Alinha quantidade de valores à de lançamentos (ordem top-down = índice do histórico)."""
    if n_types <= 0:
        return []
    cleaned: List[Tuple[float, str]] = []
    for v, cd in mov:
        if abs(v) < 0.001:
            continue
        cleaned.append((v, cd))
    if len(cleaned) > n_types:
        # Coluna Valor e cauda OCR seguem a ordem dos tipos (primeiros N valores).
        cleaned = cleaned[:n_types]
    return cleaned


def _scan_ocr_columns(lines: List[str]) -> Tuple[List[str], List[str], List[Tuple[float, str]]]:
    dates: List[str] = []
    types: List[str] = []
    names: List[str] = []
    mov: List[Tuple[float, str]] = []

    for page in _split_pages(lines):
        d, t, n, m = _parse_page(page)
        dates.extend(d)
        types.extend(t)
        names.extend(n)
        mov.extend(m)

    return dates, types, names, mov


def _pair_types_names(types: List[str], names: List[str]) -> List[str]:
    """Monta descrição na ordem do OCR (fila de nomes para PIX/COMPRA)."""
    out: List[str] = []
    ni = 0
    for t in types:
        if _TYPE_NO_NAME.match(_normalize_type(t)):
            out.append(_build_description(t, ""))
            continue
        nm = ""
        if ni < len(names):
            nm = names[ni]
            ni += 1
        out.append(_build_description(t, nm))
    return out


def _assign_dates(dates: List[str], n: int) -> List[str]:
    if n <= 0:
        return []
    if not dates:
        return [""] * n
    out: List[str] = []
    di = 0
    for _ in range(n):
        if di < len(dates):
            out.append(dates[di])
            di += 1
        else:
            out.append(out[-1] if out else dates[-1])
    return out


def _extract_from_ocr_blob(blob: str) -> pd.DataFrame:
    """Uma página = um bloco (datas + histórico + valores na mesma página)."""
    lines = [ln.strip() for ln in (blob or "").splitlines() if ln.strip()]
    rows: List[Dict[str, Any]] = []

    for page in _split_pages(lines):
        dates, types, names, mov = _parse_page(page)
        if not mov or not types:
            continue
        descs = _pair_types_names(types, names)
        n = min(len(descs), len(mov))
        if n <= 0:
            continue
        dts = _assign_dates(dates, n)
        for i in range(n):
            desc = descs[i]
            if _SALDO_MARK.match(desc):
                continue
            val, cd = mov[i]
            amt = _amount_with_hist_sign(desc, val, cd)
            if abs(amt) < 0.001:
                continue
            rows.append(
                {
                    "date": dts[i],
                    "description": desc,
                    "amount": amt,
                    "counterparty": None,
                }
            )
    return pd.DataFrame(rows)


def _extract_periodo_embedded(text: str) -> pd.DataFrame:
    rows: List[Dict[str, Any]] = []
    for ln in text.splitlines():
        ln = re.sub(r"\s+", " ", ln.strip())
        if not ln:
            continue
        m = _ROW_PERIOD.match(ln)
        if not m:
            continue
        rest = m.group("rest")
        hits = list(_MONEY_TAIL.finditer(rest))
        if not hits:
            continue
        mov = hits[-2] if len(hits) >= 2 else hits[-1]
        hist = rest[: mov.start()].strip()
        if _SALDO_MARK.match(hist) or not hist:
            continue
        v = _parse_money(mov.group(1))
        if v is None:
            continue
        cd = mov.group(2).upper()
        rows.append(
            {
                "date": m.group("dt"),
                "description": hist.upper(),
                "amount": _amount_with_hist_sign(hist.upper(), v, cd),
                "counterparty": None,
            }
        )
    return pd.DataFrame(rows)


def extract_caixa_holder(text: str) -> Optional[str]:
    if not text:
        return None
    for pat in (
        r"(?i)cliente[:\s]+([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ\s\.]{4,60})",
        r"(?i)titular[:\s]+([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ\s\.]{4,60})",
    ):
        m = re.search(pat, text)
        if m:
            return re.sub(r"\s+", " ", m.group(1).strip())
    return None


def parse_caixa_pdf(pdf_path: str, embedded_text: str = "") -> Optional[pd.DataFrame]:
    text = (embedded_text or "").strip()
    if len(text) < 40:
        text = (pdf_to_text_embedded(pdf_path) or "").strip()

    df = pd.DataFrame()
    holder_src = text
    fmt = "scan"

    if _embedded_chars(pdf_path) >= 80 and _is_periodo_line(text):
        df = _extract_periodo_embedded(text)
        fmt = "embedded"
    else:
        ocr = ""
        try:
            ocr = (pdf_to_text_ocr(pdf_path) or "").strip()
        except Exception:
            pass
        src = ocr if len(ocr) > len(text) else text
        holder_src = src or holder_src
        if _is_periodo_line(src):
            df = _extract_periodo_embedded(src)
            fmt = "embedded_ocr"
        else:
            df = _extract_from_ocr_blob(src)
            fmt = "scan"

    if df is None or df.empty:
        return None

    out = df.copy()
    out["_source"] = "caixa_extrato"
    out["_caixa_format"] = fmt
    holder = extract_caixa_holder(holder_src)
    if holder:
        out["holder"] = holder
    return out


def try_extract_caixa(pdf_path: str) -> Optional[pd.DataFrame]:
    return parse_caixa_pdf(pdf_path, "")
