from __future__ import annotations

import json
import os
import re
import sys
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple

import pandas as pd

# Permite importar `extractors.*` tanto em produção (cwd=backend)
# quanto em execuções onde o módulo é importado como `backend.statement_pipeline`.
_BACKEND_DIR = Path(__file__).resolve().parent
if str(_BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(_BACKEND_DIR))

BANK_ALIASES: Dict[str, str] = {
    # Nubank
    "nu": "nubank",
    "nubank": "nubank",
    # Caixa
    "cef": "caixa",
    "caixa": "caixa",
    # Banco do Brasil
    "bb": "bancodobrasil",
    "banco_do_brasil": "bancodobrasil",
    "bancodobrasil": "bancodobrasil",
    # Bradesco
    "banco_bradesco": "bradesco",
    "bradesco": "bradesco",
    # Itaú
    "itau": "itau",
    "itaú": "itau",
    "banco_itau": "itau",
    "banco_itaú": "itau",
    # Mercado Pago
    "mercadopago": "mercadopago",
    "mercado_pago": "mercadopago",
    # Banco Inter
    "inter": "inter",
    "banco_inter": "inter",
    # PicPay
    "picpay": "picpay",
    "pic_pay": "picpay",
    # Stone
    "stone": "stone",
    # Sicredi
    "sicredi": "sicredi",
    # Neon
    "neon": "neon",
    # Santander
    "santander": "santander",
    "banco_santander": "santander",
    # C6 Bank
    "c6": "c6",
    "c6bank": "c6",
    "banco_c6": "c6",
    # Banco Pan
    "pan": "pan",
    "banco_pan": "pan",
    "bancopan": "pan",
    # PagBank
    "pagbank": "pagbank",
    "pag_bank": "pagbank",
    "pagseguro": "pagbank",
}


def normalize_bank_key(bank: Optional[str]) -> str:
    key = _to_text(bank).lower()
    return BANK_ALIASES.get(key, key)


def _to_text(x: Any) -> str:
    return "" if x is None else str(x).strip()


def parse_br_money(value: Any) -> Optional[float]:
    """
    Converte valores BR determinísticamente:
    - "1.234,56" -> 1234.56
    - "R$ - 12,34" -> -12.34
    Retorna None se não houver dígitos.
    """
    if value is None:
        return None
    if isinstance(value, (int, float)) and pd.notna(value):
        return float(value)

    s = _to_text(value)
    if not s:
        return None

    # mantém apenas dígitos, separadores e sinal
    s = s.replace("\u00a0", " ")  # NBSP
    s = re.sub(r"[^\d,.\-+]", "", s)
    if not re.search(r"\d", s):
        return None

    # remove milhares (.) e troca decimal (,) por (.)
    s = s.replace(".", "").replace(",", ".")

    # resolve casos como "--1" ou "+-1"
    s = re.sub(r"(?<=.)[+\-]+", "", s)
    try:
        return float(s)
    except ValueError:
        return None


def _has_explicit_sign(value: Any) -> bool:
    """
    True quando o texto do valor contém sinal explícito (+/-) antes do número.
    Útil para não "inventar" sinal quando o PDF só mostra valor absoluto.
    """
    if value is None:
        return False
    if isinstance(value, (int, float)):
        return float(value) < 0
    s = _to_text(value)
    if not s:
        return False
    # procura + ou - antes de qualquer dígito
    return bool(re.search(r"^[^\d]*[+-]\s*\d", s))


def parse_date(value: Any) -> Optional[datetime]:
    s = _to_text(value)
    if not s:
        return None

    # formatos comuns: YYYY-MM-DD, DD/MM/YYYY, DD/MM (assume ano atual do extrato? não dá)
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", s):
        try:
            return datetime.strptime(s, "%Y-%m-%d")
        except ValueError:
            return None

    if re.fullmatch(r"\d{2}/\d{2}/\d{4}", s):
        try:
            return datetime.strptime(s, "%d/%m/%Y")
        except ValueError:
            return None

    # Nubank (e alguns PDFs): "02 JAN 2024" / "02 FEV 2024"
    m = re.fullmatch(r"(\d{2})\s+([A-Za-zÀ-ÿ]{3})\s+(\d{4})", s.strip(), flags=re.IGNORECASE)
    if m:
        dd = int(m.group(1))
        mon = m.group(2).strip().upper()
        yyyy = int(m.group(3))
        mon_map = {
            # PT-BR
            "JAN": 1,
            "FEV": 2,
            "MAR": 3,
            "ABR": 4,
            "MAI": 5,
            "JUN": 6,
            "JUL": 7,
            "AGO": 8,
            "SET": 9,
            "OUT": 10,
            "NOV": 11,
            "DEZ": 12,
            # EN (caso apareça)
            "APR": 4,
            "MAY": 5,
            "AUG": 8,
            "SEP": 9,
            "OCT": 10,
            "DEC": 12,
        }
        mm = mon_map.get(mon)
        if mm is None:
            return None
        try:
            return datetime(yyyy, mm, dd)
        except ValueError:
            return None

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


def _extract_with_bankstatementparser(pdf_path: str) -> Optional[pd.DataFrame]:
    """
    Tenta usar bankstatementparser como "principal".
    Se não disponível / falhar, retorna None.
    """
    try:
        # A API real do pacote pode variar; mantemos isolado e com fallback.
        from bankstatementparser import BankStatementParser  # type: ignore
    except Exception:
        return None

    try:
        parser = BankStatementParser()
        result = parser.parse(pdf_path)  # pode ser list[dict] ou DataFrame
        if isinstance(result, pd.DataFrame):
            df = result.copy()
        else:
            df = pd.DataFrame(result)
        if df.empty:
            return None
        df["_source"] = "bankstatementparser"
        return df
    except Exception:
        return None


def _extract_with_pdfplumber(pdf_path: str) -> pd.DataFrame:
    """
    Fallback determinístico com pdfplumber:
    - tenta extrair tabelas
    - se não achar, extrai texto e aplica regex (data + valores)
    """
    import pdfplumber

    rows: List[ExtractedRow] = []
    full_text_chunks: List[str] = []

    def normalize_header(h: str) -> str:
        x = _to_text(h).lower()
        x = (
            x.replace("ç", "c")
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
        x = re.sub(r"\s+", " ", x).strip()
        return x

    header_aliases = {
        "date": {"data", "dt", "data movimento", "data mov"},
        "description": {"historico", "hist", "descricao", "descr", "descricao/historico", "lancamento"},
        "debit": {"debito", "débito", "saidas", "saida", "valor debito"},
        "credit": {"credito", "crédito", "entradas", "entrada", "valor credito"},
        "amount": {"valor", "vl", "valor (r$)", "valor r$"},
        "balance": {"saldo", "saldo (r$)", "saldo r$", "saldo atual"},
    }

    def map_columns(headers: List[str]) -> Dict[int, str]:
        mapped: Dict[int, str] = {}
        for idx, h in enumerate(headers):
            nh = normalize_header(h)
            for key, aliases in header_aliases.items():
                if nh in {normalize_header(a) for a in aliases}:
                    mapped[idx] = key
                    break
        return mapped

    pages_total = 0
    pages_with_text = 0
    total_text_chars = 0

    with pdfplumber.open(pdf_path) as pdf:
        pages_total = len(pdf.pages)
        for page in pdf.pages:
            # 1) tabelas
            try:
                tables = page.extract_tables() or []
            except Exception:
                tables = []

            for table in tables:
                if not table or len(table) < 2:
                    continue
                headers = [(_to_text(c) or "") for c in table[0]]
                mapped = map_columns(headers)
                if not mapped:
                    continue
                for line in table[1:]:
                    if not line:
                        continue
                    rec: Dict[str, Any] = {}
                    for col_idx, key in mapped.items():
                        if col_idx < len(line):
                            rec[key] = line[col_idx]
                    if not any(_to_text(rec.get(k)) for k in ("date", "description", "amount", "debit", "credit", "balance")):
                        continue
                    rows.append(
                        ExtractedRow(
                            date=_to_text(rec.get("date")) or None,
                            description=_to_text(rec.get("description")) or None,
                            amount=rec.get("amount"),
                            debit=rec.get("debit"),
                            credit=rec.get("credit"),
                            balance=rec.get("balance"),
                        )
                    )

            # 2) texto + regex (Caixa e similares)
            text = page.extract_text() or ""
            if text.strip():
                pages_with_text += 1
                total_text_chars += len(text)
                full_text_chunks.append(text)
            for raw_line in text.splitlines():
                line = raw_line.strip()
                if not line:
                    continue

                # Data: DD/MM/YYYY ou DD/MM (não tentamos inferir ano)
                m = re.match(r"^(?P<dt>\d{2}/\d{2}/\d{4}|\d{2}/\d{2})\s+(?P<rest>.+)$", line)
                if not m:
                    continue

                dt = m.group("dt")
                rest = m.group("rest").strip()

                # captura valores monetários no fim (valor e saldo)
                monies = re.findall(r"[-+]?\d{1,3}(?:\.\d{3})*,\d{2}", rest)
                if not monies:
                    continue

                # heurística determinística:
                # - se houver 2+ valores, assume último = saldo, penúltimo = valor
                # - se houver 1, assume amount
                amount_raw = monies[-1] if len(monies) == 1 else monies[-2]
                balance_raw = None if len(monies) == 1 else monies[-1]

                # descrição = texto antes do primeiro valor encontrado
                first_val_pos = rest.find(monies[0])
                desc = rest[:first_val_pos].strip()
                if not desc:
                    desc = rest

                rows.append(
                    ExtractedRow(
                        date=dt,
                        description=desc,
                        amount=amount_raw,
                        balance=balance_raw,
                    )
                )

    df = _rows_to_df(rows)
    df["_source"] = "pdfplumber"
    df["_pages_total"] = pages_total
    df["_pages_with_text"] = pages_with_text
    df["_text_chars"] = total_text_chars
    return df


def _ocr_text_from_pdf(pdf_path: str) -> str:
    """
    OCR determinístico via Tesseract.
    Requer instalações no sistema:
    - Tesseract OCR (com idioma `por`)
    - Poppler (para pdf2image no Windows)
    """
    from pdf2image import convert_from_path  # type: ignore
    import pytesseract  # type: ignore

    poppler_path = os.environ.get("POPPLER_PATH") or None
    images = convert_from_path(pdf_path, dpi=300, poppler_path=poppler_path)
    chunks: List[str] = []
    for img in images:
        txt = pytesseract.image_to_string(img, lang=os.environ.get("TESS_LANG", "por"))
        if txt:
            chunks.append(txt)
    return "\n".join(chunks)


def _extract_from_ocr_text(ocr_text: str) -> pd.DataFrame:
    rows: List[ExtractedRow] = []
    for raw_line in (ocr_text or "").splitlines():
        line = raw_line.strip()
        if not line:
            continue
        m = re.match(r"^(?P<dt>\d{2}/\d{2}/\d{4}|\d{2}/\d{2})\s+(?P<rest>.+)$", line)
        if not m:
            continue
        dt = m.group("dt")
        rest = m.group("rest").strip()
        monies = re.findall(r"[-+]?\d{1,3}(?:\.\d{3})*,\d{2}", rest)
        if not monies:
            continue
        amount_raw = monies[-1] if len(monies) == 1 else monies[-2]
        balance_raw = None if len(monies) == 1 else monies[-1]
        first_val_pos = rest.find(monies[0])
        desc = rest[:first_val_pos].strip() or rest
        rows.append(ExtractedRow(date=dt, description=desc, amount=amount_raw, balance=balance_raw))

    df = _rows_to_df(rows)
    df["_source"] = "ocr"
    return df


def _parse_csv(path: str) -> pd.DataFrame:
    """
    CSV determinístico: tenta mapear colunas comuns para o schema padrão.
    Espera pelo menos data + descrição + (valor ou crédito/débito ou saldo).
    """
    # tenta separadores comuns no Brasil
    for sep in (";", ",", "\t"):
        try:
            df = pd.read_csv(path, sep=sep, dtype=str, encoding_errors="ignore")
            if df.shape[1] >= 2:
                break
        except Exception:
            df = pd.DataFrame()
    if df is None or df.empty:
        df = pd.DataFrame()

    # normaliza headers
    def nh(x: str) -> str:
        return (
            _to_text(x)
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
            .strip()
        )

    cols = {nh(c): c for c in df.columns}

    def pick(*cands: str) -> Optional[str]:
        for c in cands:
            key = nh(c)
            if key in cols:
                return cols[key]
        return None

    c_date = pick("data", "date", "dt", "data_movimento", "data movimento", "data mov")
    c_desc = pick("descricao", "descrição", "historico", "histórico", "historico/descricao", "lancamento", "lançamento", "description")
    c_amount = pick("valor", "amount", "vl", "valor (r$)")
    c_credit = pick("credito", "crédito", "entrada", "entradas")
    c_debit = pick("debito", "débito", "saida", "saidas", "saída")
    c_balance = pick("saldo", "balance", "saldo (r$)", "saldo atual")

    out = pd.DataFrame()
    out["date"] = df[c_date] if c_date else None
    out["description"] = df[c_desc] if c_desc else ""
    out["amount"] = df[c_amount] if c_amount else None
    out["credit"] = df[c_credit] if c_credit else None
    out["debit"] = df[c_debit] if c_debit else None
    out["balance"] = df[c_balance] if c_balance else None
    out["_source"] = "csv"
    return out


def _parse_ofx(path: str) -> pd.DataFrame:
    """
    OFX determinístico (recomendado para "qualquer banco"):
    extrai transações do arquivo estruturado.
    """
    from ofxparse import OfxParser  # type: ignore

    with open(path, "rb") as f:
        ofx = OfxParser.parse(f)

    rows: List[Dict[str, Any]] = []
    stmts = []
    if getattr(ofx, "account", None) and getattr(ofx.account, "statement", None):
        stmts.append(ofx.account.statement)
    if getattr(ofx, "accounts", None):
        for acc in ofx.accounts:
            st = getattr(acc, "statement", None)
            if st:
                stmts.append(st)

    for st in stmts:
        for t in getattr(st, "transactions", []) or []:
            # t.amount já vem com sinal (entrada + / saída -) em geral
            rows.append(
                {
                    "date": getattr(t, "date", None).strftime("%Y-%m-%d") if getattr(t, "date", None) else None,
                    "description": _to_text(getattr(t, "memo", None) or getattr(t, "payee", None) or ""),
                    "amount": getattr(t, "amount", None),
                    "balance": getattr(st, "balance", None),
                    "_source": "ofx",
                }
            )

    df = pd.DataFrame(rows)
    for col in ("date", "description", "amount", "debit", "credit", "balance", "_source"):
        if col not in df.columns:
            df[col] = None
    return df[["date", "description", "amount", "debit", "credit", "balance", "_source"]].copy()


def _pdf_text(file_path: str) -> str:
    import logging

    import pdfplumber  # local import

    # Aviso cosmético do pdfminer em alguns PDFs — não afeta extração
    logging.getLogger("pdfminer").setLevel(logging.ERROR)
    logging.getLogger("pdfplumber").setLevel(logging.ERROR)

    with pdfplumber.open(file_path) as pdf:
        return "\n".join([(p.extract_text() or "") for p in pdf.pages])


def _clean_nubank_junk(df: pd.DataFrame) -> pd.DataFrame:
    """
    Remove lixo comum de cabeçalho/rodapé do Nubank que alguns parsers capturam como descrição.
    Mantém apenas linhas com data e desc que não batem nos padrões de atendimento/ouvidoria.
    """
    if df is None or df.empty:
        return df
    out = df.copy()
    if "date" in out.columns:
        out["date"] = out["date"].where(out["date"].notna(), None)
        out = out[out["date"].astype(str).str.strip().str.lower().ne("none")]
        out = out[out["date"].astype(str).str.strip().ne("")]
    if "description" in out.columns:
        desc = out["description"].fillna("").astype(str)
        junk_patterns = (
            r"tem alguma duvida|tem alguma dúvida|ouvidoria|atendimento 24h|"
            r"\b4020\s*0185\b|\b0800\s*591\s*2117\b|\b0800\s*887\s*0463\b|"
            r"nubank\.com\.br/contatos|capitais e regioes metropolitanas|"
            r"demais localidades|caso a solucao fornecida|fale com a ouvidoria"
        )
        out = out[~desc.str.lower().str.contains(junk_patterns, regex=True, na=False)]
    return out


def _pipeline_pdf_nubank(file_path: str, text: str) -> pd.DataFrame:
    """
    Nubank: tenta extrair o máximo possível (bankstatementparser/pdfplumber/genérico),
    mas usa o extractor específico para obter o titular (holder) e aplicar limpezas.
    """
    from extractors.nubank import try_extract as try_extract_nubank  # type: ignore

    nb = try_extract_nubank(text)
    holder_val: Optional[str] = None
    if nb is not None and not nb.empty and "holder" in nb.columns:
        hv = nb["holder"].dropna()
        if not hv.empty:
            holder_val = str(hv.iloc[0]).strip() or None

    df = _extract_with_bankstatementparser(file_path)
    if df is None or df.empty:
        df = _extract_with_pdfplumber(file_path)
    if df is None:
        df = pd.DataFrame()
    if df.empty:
        try:
            from extractors.generic_pdf_text_regex import try_extract as try_extract_generic  # type: ignore

            gd = try_extract_generic(text)
            if gd is not None and not gd.empty:
                df = gd
        except Exception:
            pass
    if df.empty and nb is not None and not nb.empty:
        df = nb
    if holder_val and not df.empty:
        df = df.copy()
        df["holder"] = holder_val
    return _clean_nubank_junk(df) if df is not None else pd.DataFrame()


def _pipeline_pdf_bancodobrasil(file_path: str, text: str) -> pd.DataFrame:
    from extractors.bancodobrasil import try_extract as try_extract_bb  # type: ignore

    bb = try_extract_bb(text)
    holder_val: Optional[str] = None
    if bb is not None and not bb.empty and "holder" in bb.columns:
        hv = bb["holder"].dropna()
        if not hv.empty:
            holder_val = str(hv.iloc[0]).strip() or None

    df = bb if bb is not None and not bb.empty else pd.DataFrame()
    if df.empty:
        df2 = _extract_with_bankstatementparser(file_path)
        if df2 is not None and not df2.empty:
            df = df2
    if df.empty:
        df_pl = _extract_with_pdfplumber(file_path)
        df = df_pl if isinstance(df_pl, pd.DataFrame) and not df_pl.empty else pd.DataFrame()
    if df.empty:
        try:
            from extractors.generic_pdf_text_regex import try_extract as try_extract_generic  # type: ignore

            gd = try_extract_generic(text)
            if gd is not None and not gd.empty:
                df = gd
        except Exception:
            pass
    if df.empty:
        # Se o PDF veio sem texto (escaneado), tenta OCR mesmo com banco escolhido
        enable_ocr = str(os.environ.get("ENABLE_OCR", "")).strip().lower() in {"1", "true", "yes", "y", "on"}
        if enable_ocr:
            try:
                ocr_text = _ocr_text_from_pdf(file_path)
                ocr_df = _extract_from_ocr_text(ocr_text)
                if not ocr_df.empty:
                    df = ocr_df
            except Exception:
                pass

    if holder_val and not df.empty:
        df = df.copy()
        df["holder"] = holder_val
    return df if df is not None else pd.DataFrame()


def _pipeline_pdf_caixa(file_path: str, text: str) -> pd.DataFrame:
    """
    Caixa: texto embutido primeiro; um único OCR (PyMuPDF+Tesseract em parse_caixa_pdf).
    Evita rodar pdf2image 300dpi + OCR de novo — extrato 15 páginas passava de 3 min.
    """
    df_out = pd.DataFrame()
    alt_pdf2image = ""

    try:
        from extractors.caixa_extrato import parse_caixa_pdf  # type: ignore

        cand = parse_caixa_pdf(file_path, text)
        if cand is not None and not cand.empty:
            df_out = cand.copy()
    except Exception as e:
        # Se o PDF está sem texto e o OCR não está disponível, melhor falhar com mensagem clara
        if not (text or "").strip():
            raise
        # caso contrário, segue com fallbacks
        _ = e

    if df_out.empty:
        try:
            from extractors.generic_pdf_text_regex import try_extract as try_extract_generic  # type: ignore

            for blob in (text, alt_pdf2image):
                blob = (blob or "").strip()
                if len(blob) < 12:
                    continue
                gd = try_extract_generic(blob)
                if gd is not None and not gd.empty:
                    df_out = gd.copy()
                    df_out["_source"] = "caixa_fallback_regex"
                    break
        except Exception:
            pass

    if df_out.empty:
        df2 = _extract_with_bankstatementparser(file_path)
        if df2 is not None and not df2.empty:
            df_out = df2.copy()
            df_out["_source"] = "caixa_fallback_bankstatementparser"

    if df_out.empty:
        df_pl = _extract_with_pdfplumber(file_path)
        if isinstance(df_pl, pd.DataFrame) and not df_pl.empty:
            df_out = df_pl.copy()
            df_out["_source"] = "caixa_fallback_pdfplumber"

    if df_out.empty:
        enable_ocr_env = str(os.environ.get("ENABLE_OCR", "")).strip().lower() in {"1", "true", "yes", "y", "on"}
        if enable_ocr_env:
            try:
                ocr_text = _ocr_text_from_pdf(file_path)
                ocr_df = _extract_from_ocr_text(ocr_text)
                if not ocr_df.empty:
                    df_out = ocr_df.copy()
                    df_out["_source"] = "caixa_fallback_ocr_generic"
            except Exception:
                pass

    if "_source" not in df_out.columns and not df_out.empty:
        df_out = df_out.copy()
        df_out["_source"] = "caixa"

    # PDF escaneado sem OCR/configuração: não devolve vazio silencioso
    if df_out.empty and not (text or "").strip():
        raise RuntimeError(
            "Extrato CAIXA parece escaneado (sem texto embutido) e não foi possível extrair via OCR. "
            "No servidor, instale/configure Tesseract (PT-BR) e/ou defina ENABLE_OCR=1."
        )

    return df_out if isinstance(df_out, pd.DataFrame) else pd.DataFrame()


def _pipeline_pdf_santander(file_path: str, text: str) -> pd.DataFrame:
    """Santander: 2 formatos (Internet Banking texto + Consolidado imagem/OCR)."""
    from extractors.santander import try_extract  # type: ignore

    df = try_extract(text, pdf_path=file_path)
    if df is None or getattr(df, "empty", True):
        return pd.DataFrame()
    out = df.copy()
    if "_source" not in out.columns:
        out["_source"] = "santander"
    return out


def _pdf_text_fitz(pdf_path: str) -> str:
    """Texto embutido via PyMuPDF — fallback quando pdfplumber vem vazio no servidor."""
    try:
        import fitz  # PyMuPDF

        doc = fitz.open(pdf_path)
        try:
            return "\n".join((p.get_text("text") or "") for p in doc).strip()
        finally:
            doc.close()
    except Exception:
        return ""


def _pipeline_pdf_sicredi(file_path: str, text: str) -> pd.DataFrame:
    """
    Sicredi: só texto do PDF (padrão data + descrição + +/- R$).
    Não compartilha OCR/código da Caixa. Tenta pdfplumber e PyMuPDF antes de falhar.
    """
    from extractors.sicredi import try_extract  # type: ignore

    blobs: List[str] = []
    for b in (text or "", _pdf_text_fitz(file_path), _pdf_text(file_path)):
        b = (b or "").strip()
        if b and b not in blobs:
            blobs.append(b)

    last_err: Optional[Exception] = None
    for blob in blobs:
        if len(blob) < 80:
            continue
        try:
            df = try_extract(blob)
            if df is not None and not df.empty:
                out = df.copy()
                if "_source" not in out.columns:
                    out["_source"] = "sicredi"
                return out
        except Exception as e:
            last_err = e

    hint = f" Detalhe: {last_err}" if last_err else ""
    raise RuntimeError(
        "Extrato Sicredi: não foi possível ler lançamentos. "
        "Confirme que o PDF tem texto selecionável (não é scan) e que o banco Sicredi está selecionado."
        + hint
    )


def _pipeline_pdf_simple_extractor(module_name: str, bank_source: str, text: str) -> pd.DataFrame:
    """
    Pipeline simples: chama extractors.<module_name>.try_extract(text) e retorna DataFrame.
    """
    import importlib

    mod = importlib.import_module(f"extractors.{module_name}")
    fn = getattr(mod, "try_extract", None)
    if not callable(fn):
        return pd.DataFrame()
    df = fn(text)
    if df is None or getattr(df, "empty", True):
        return pd.DataFrame()
    out = df.copy()
    if "_source" not in out.columns:
        out["_source"] = bank_source
    return out


BANK_PDF_PIPELINES: Dict[str, Any] = {
    "nubank": _pipeline_pdf_nubank,
    "bancodobrasil": _pipeline_pdf_bancodobrasil,
    "caixa": _pipeline_pdf_caixa,
    "bradesco": lambda file_path, text: _pipeline_pdf_simple_extractor("bradesco", "bradesco", text),
    "inter": lambda file_path, text: _pipeline_pdf_simple_extractor("inter", "inter", text),
    "mercadopago": lambda file_path, text: _pipeline_pdf_simple_extractor("mercadopago", "mercadopago", text),
    "itau": lambda file_path, text: _pipeline_pdf_simple_extractor("itau", "itau", text),
    "picpay": lambda file_path, text: _pipeline_pdf_simple_extractor("picpay", "picpay", text),
    "stone": lambda file_path, text: _pipeline_pdf_simple_extractor("stone", "stone", text),
    "sicredi": _pipeline_pdf_sicredi,
    "neon": lambda file_path, text: _pipeline_pdf_simple_extractor("neon", "neon", text),
    "santander": _pipeline_pdf_santander,
    "c6": lambda file_path, text: _pipeline_pdf_simple_extractor("c6", "c6", text),
    "pan": lambda file_path, text: _pipeline_pdf_simple_extractor("pan", "pan", text),
    "pagbank": lambda file_path, text: _pipeline_pdf_simple_extractor("pagbank", "pagbank", text),
}


def _parse_pdf_with_bank(file_path: str, text: str, bank_key: str) -> pd.DataFrame:
    bank_key = normalize_bank_key(bank_key)
    fn = BANK_PDF_PIPELINES.get(bank_key)
    if not callable(fn):
        return pd.DataFrame()
    try:
        out = fn(file_path, text)
        return out if isinstance(out, pd.DataFrame) else pd.DataFrame()
    except Exception:
        # Caixa/Sicredi: erro claro em vez de "0 transações" silencioso
        if bank_key in {"caixa", "sicredi"}:
            raise
        return pd.DataFrame()


def _parse_pdf_legacy(file_path: str, text: str) -> pd.DataFrame:
    """Compat / CLI: tenta Nubank, depois bibliotecas genéricas."""
    try:
        from extractors.nubank import try_extract as try_extract_nubank  # type: ignore

        nb = try_extract_nubank(text)
        if nb is not None and not nb.empty:
            return _clean_nubank_junk(nb)

        df = _extract_with_bankstatementparser(file_path)
        if df is None or df.empty:
            df = _extract_with_pdfplumber(file_path)
        return df if df is not None else pd.DataFrame()
    except Exception:
        df = _extract_with_bankstatementparser(file_path)
        if df is None or df.empty:
            df = _extract_with_pdfplumber(file_path)
        return df if df is not None else pd.DataFrame()


def parseStatement(file_path: str, bank: Optional[str] = None) -> pd.DataFrame:
    """
    EXTRAÇÃO: com `bank` (ex.: nubank, caixa) vindo do front, usa só esse extractor em PDF.
    Sem `bank` (CLI/legado): mantém a cascata antiga.
    """
    file_path = str(file_path)
    ext = Path(file_path).suffix.lower()
    bank_key = normalize_bank_key(bank)

    df: pd.DataFrame

    if ext in {".csv"}:
        df = _parse_csv(file_path)
    elif ext in {".ofx"}:
        df = _parse_ofx(file_path)
    elif ext == ".pdf":
        text = _pdf_text(file_path)
        if bank_key:
            df = _parse_pdf_with_bank(file_path, text, bank_key)
        else:
            # Auto-detecção determinística (evita cair em parser genérico com sinal errado)
            # Itaú: cabeçalho com CPF + agência/conta e seção "extrato conta / lançamentos"
            itau_sig = bool(
                re.search(r"\bextrato conta\s*/\s*lan", text, flags=re.IGNORECASE)
                and re.search(r"\bag(?:ê|e|�)ncia:\s*\d+\s+conta:\s*[\d\-]+", text, flags=re.IGNORECASE)
                and re.search(r"\b\d{3}\.\d{3}\.\d{3}-\d{2}\b", text)
            )
            picpay_sig = bool(
                (
                    re.search(r"picpay\s+servi[çc]os", text, flags=re.IGNORECASE)
                    or re.search(r"22\.896\.431/0001-10", text)
                )
                and re.search(r"saldo\s+ao\s+final\s+do\s+dia", text, flags=re.IGNORECASE)
            )
            mp_sig = bool(
                re.search(r"extrato\s+de\s+conta", text, flags=re.IGNORECASE)
                and re.search(r"id\s+da\s+opera", text, flags=re.IGNORECASE)
                and re.search(r"detalhe\s+dos\s+movimentos", text, flags=re.IGNORECASE)
            )
            stone_sig = bool(
                re.search(r"stone\s+institui[cç][aã]o\s+de\s+pagamento", text, flags=re.IGNORECASE)
                and re.search(r"data\s+tipo\s+descri", text, flags=re.IGNORECASE)
            )
            sicredi_sig = bool(
                re.search(r"(?i)\bsicredi\b", text)
                and re.search(r"(?i)cooperativa:\s*\d+", text)
                and re.search(r"(?i)data\s+descri", text)
            )
            neon_sig = bool(
                re.search(r"(?i)neon\s+pagamentos", text)
                and re.search(r"(?i)extrato\s+por", text)
                and re.search(r"(?i)valor\s+saldo", text)
            )
            inter_sig = bool(
                re.search(r"(?i)institui[cç][aã]o:\s*banco\s+inter", text)
                or (
                    re.search(r"(?i)banco\s+inter", text)
                    and re.search(r"(?i)saldo\s+do\s+dia", text)
                )
            )
            santander_sig = bool(
                re.search(r"(?i)santander\s+select", text)
                or re.search(r"(?i)extrato\s+de\s+conta\s+corrente", text)
                or re.search(r"(?i)extrato\s+consolidado\s+inteligente", text)
                or (
                    re.search(r"(?i)internet\s+banking", text)
                    and re.search(r"(?i)pix\s+(enviado|recebido)", text)
                )
            )
            if inter_sig:
                df = _parse_pdf_with_bank(file_path, text, "inter")
            elif santander_sig:
                df = _parse_pdf_with_bank(file_path, text, "santander")
            elif bool(
                re.search(r"(?i)caixa\s+econ[oô]mica|extrato\s+por\s+per[ií]odo", text)
                and (
                    re.search(r"(?i)imprime_ext_periodo|internet\s*banking\s*caixa", text)
                    or len(re.findall(r"\d{2}/\d{2}/\d{4}\s*-\s*\d{2}:\d{2}", text)) >= 5
                    or (
                        re.search(r"(?i)data\s+mov", text)
                        and re.search(r"(?i)hist[oó]rico", text)
                    )
                )
            ):
                df = _parse_pdf_with_bank(file_path, text, "caixa")
            elif bool(
                re.search(r"(?i)c6\s*bank|banco\s+c6", text)
                or (
                    re.search(r"(?i)extrato\s+exportado", text)
                    and re.search(r"(?i)ag[eê]ncia\s*:\s*\d", text)
                    and re.search(r"(?i)pix\s+(recebido\s+de|enviado\s+para)", text)
                )
            ):
                df = _parse_pdf_with_bank(file_path, text, "c6")
            elif itau_sig:
                df = _parse_pdf_with_bank(file_path, text, "itau")
            elif picpay_sig:
                df = _parse_pdf_with_bank(file_path, text, "picpay")
            elif mp_sig:
                df = _parse_pdf_with_bank(file_path, text, "mercadopago")
            elif stone_sig:
                df = _parse_pdf_with_bank(file_path, text, "stone")
            elif sicredi_sig:
                df = _parse_pdf_with_bank(file_path, text, "sicredi")
            elif neon_sig:
                df = _parse_pdf_with_bank(file_path, text, "neon")
            else:
                df = _parse_pdf_legacy(file_path, text)
        # Fallback genérico só quando ninguém escolheu banco (legado)
        if not bank_key and (df is None or df.empty):
            try:
                from extractors.generic_pdf_text_regex import try_extract as try_extract_generic  # type: ignore

                gd = try_extract_generic(text)
                if gd is not None and not gd.empty:
                    df = gd
            except Exception:
                pass

        # Caixa + PDF ainda vazio: típico de extrato só-imagem (sem texto embutido).
        # Tenta OCR global mesmo sem ENABLE_OCR — pdf2image/poppler + regex linha-a-linha.
        if bank_key == "caixa" and (df is None or df.empty):
            try:
                from extractors.generic_pdf_text_regex import try_extract as try_extract_generic  # type: ignore

                em = ""
                try:
                    em = _ocr_text_from_pdf(file_path)
                except Exception:
                    em = ""
                if not em.strip():
                    try:
                        from extractors.caixa import pdf_to_text_ocr as caixa_pix_ocr  # type: ignore

                        em = caixa_pix_ocr(file_path)
                    except Exception:
                        em = ""
                if em.strip():
                    gd = try_extract_generic(em)
                    if gd is not None and not gd.empty:
                        df = gd.copy()
                        df["_source"] = "caixa_emergency_regex"
                    else:
                        ed = _extract_from_ocr_text(em)
                        if ed is not None and not ed.empty:
                            df = ed.copy()
                            df["_source"] = "caixa_emergency_ocrlines"
            except Exception:
                pass
    else:
        df = _extract_with_bankstatementparser(file_path)
        if df is None or df.empty:
            df = _extract_with_pdfplumber(file_path)
        if df is None:
            df = pd.DataFrame()

    # OCR só no fluxo sem banco informado (evita misturar com extrato do banco errado)
    enable_ocr = str(os.environ.get("ENABLE_OCR", "")).strip().lower() in {"1", "true", "yes", "y", "on"}
    if ext in {".pdf"} and enable_ocr and not bank_key and (df is None or df.empty):
        try:
            ocr_text = _ocr_text_from_pdf(file_path)
            ocr_df = _extract_from_ocr_text(ocr_text)
            if not ocr_df.empty:
                df = ocr_df
        except Exception:
            pass

    if df is None:
        df = pd.DataFrame()

    # garante colunas
    for col in (
        "date",
        "description",
        "amount",
        "debit",
        "credit",
        "balance",
        "counterparty",
        "_source",
        "_pages_total",
        "_pages_with_text",
        "_text_chars",
    ):
        if col not in df.columns:
            df[col] = None
    out_cols = ["date", "description", "amount", "debit", "credit", "balance", "_source"]
    if "counterparty" in df.columns:
        out_cols.insert(out_cols.index("balance") + 1, "counterparty")
    if "holder" in df.columns:
        out_cols.append("holder")
    # metadados extras (opcional, usado no relatório final)
    for extra in ("cpf", "agency", "account", "period_start", "period_end", "issued_at"):
        if extra in df.columns:
            out_cols.append(extra)
    return df[out_cols].copy()


def normalizeTransaction(row: Dict[str, Any]) -> Dict[str, Any]:
    """
    NORMALIZAÇÃO:
    - sempre retorna amount float (quando possível)
    - amount tem prioridade
    - senão: credit positivo, debit negativo
    - trata formato BR
    """
    raw_amount = row.get("amount")
    amount = parse_br_money(raw_amount)
    credit = parse_br_money(row.get("credit"))
    debit = parse_br_money(row.get("debit"))
    balance = parse_br_money(row.get("balance"))

    amount_origin = "amount" if amount is not None else "none"
    amount_explicit_sign = _has_explicit_sign(raw_amount)

    if amount is None:
        if credit is not None and credit != 0:
            amount = abs(float(credit))
            amount_origin = "credit"
            amount_explicit_sign = True
        elif debit is not None and debit != 0:
            amount = -abs(float(debit))
            amount_origin = "debit"
            amount_explicit_sign = True
        else:
            amount = None

    cp = _to_text(row.get("counterparty")) or ""
    return {
        "date": row.get("date"),
        "description": _to_text(row.get("description")) or "",
        "amount": float(amount) if amount is not None else None,
        "balance": float(balance) if balance is not None else None,
        "debit": float(debit) if debit is not None else None,
        "credit": float(credit) if credit is not None else None,
        "counterparty": cp or None,
        "_source": _to_text(row.get("_source")) or "",
        "_amount_origin": amount_origin,
        "_amount_explicit_sign": bool(amount_explicit_sign),
    }


def normalizeTransactions(df: pd.DataFrame) -> pd.DataFrame:
    out = df.copy()
    out = out.where(pd.notna(out), None)

    records = [normalizeTransaction(rec) for rec in out.to_dict(orient="records")]
    # garante schema mesmo quando records == []
    ndf = pd.DataFrame(
        records,
        columns=[
            "date",
            "description",
            "amount",
            "balance",
            "debit",
            "credit",
            "counterparty",
            "_source",
            "_amount_origin",
            "_amount_explicit_sign",
        ],
    )

    # parse dates (mantém None se inválida)
    ndf["date"] = ndf["date"].apply(parse_date)

    # força floats
    for col in ("amount", "balance", "debit", "credit"):
        if col in ndf.columns:
            ndf[col] = pd.to_numeric(ndf[col], errors="coerce").astype("float64")

    return ndf


_ENTRADA_WORDS = [
    "credito",
    "crédito",
    "receb",
    "recebido",
    "recebida",
    "deposito",
    "depósito",
    "pix recebido",
    "pix recebida",
    "transferencia recebida",
    "transferência recebida",
    "estorno",
    "reembolso",
    "salario",
    "salário",
    "provento",
    "pagamento de bonus",
    "liquido de vencimento",
    "adiantamento de salario",
    "pix devolvido",
]
_SAIDA_WORDS = [
    "debito",
    "débito",
    "pagamento",
    "pagto",
    "compra",
    "pix enviado",
    "pix enviada",
    "transferencia enviada",
    "transferência enviada",
    "ted",
    "doc",
    "boleto",
    "fatura",
    "cartao",
    "cartão",
    "pay",
    "saque",
    "tarifa",
    "taxa",
    "iof",
    "juros",
    "multa",
    "encargo",
    "anuidade",
    "recarga",
    "aplicacao",
    "aplicação",
    "investimento",
]


def _desc_fallback_type(description: str) -> Optional[str]:
    s = _to_text(description).lower()
    s_norm = (
        s.replace("ç", "c")
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
    for w in _ENTRADA_WORDS:
        if normalize_word(w) in s_norm:
            return "entrada"
    for w in _SAIDA_WORDS:
        if normalize_word(w) in s_norm:
            return "saida"
    return None


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


def _classify_trust_extracted_amount(df: pd.DataFrame, bank: Optional[str] = None) -> bool:
    """
    Quando o extrator já devolve amount + balance fieis ao PDF, não recalcular amount
    como diff(balance): ordenar só por data em dias com dezenas de lançamentos embaralha
    a ordem e transforma tarifas/saídas em "entradas" com valores absurdos.
    Neon: amount já vem do delta de saldo na ordem do extrato.
    """
    bank_key = normalize_bank_key(bank)
    if bank_key in {"stone", "neon", "inter", "santander", "c6", "caixa", "sicredi", "pan", "pagbank"}:
        return True
    if "_source" not in df.columns or df.empty:
        return False
    s = df["_source"].fillna("").astype(str).str.lower().str.strip()
    nonempty = s[s != ""]
    if nonempty.empty:
        return False
    # Inter/Stone/Neon já trazem amount e saldo corretos por linha do PDF
    trust = frozenset({"stone", "neon", "inter", "santander", "c6", "caixa", "sicredi", "pan", "pagbank"})
    return bool(nonempty.nunique(dropna=False) == 1 and (nonempty.iloc[0] in trust))


def classifyTransactions(df: pd.DataFrame, bank: Optional[str] = None) -> pd.DataFrame:
    """
    CLASSIFICAÇÃO por prioridade:
    1) Se houver saldo: amount = diff(balance) (sobrescreve), exceto fontes em que o
       extrator já traz amount correto (ex.: Stone).
    2) Sem saldo: sinal do amount.
    3) Último caso: descrição (apenas se amount ausente).
    """
    out = df.copy()

    has_balance = out["balance"].notna().any()
    trust_amount = _classify_trust_extracted_amount(out, bank=bank)
    if has_balance and not trust_amount:
        out = out.sort_values("date", na_position="last").reset_index(drop=True)
        out["amount"] = out["balance"].diff().fillna(out["balance"])
    else:
        # Sem saldo: se o valor veio como "absoluto" (sem +/-) de uma coluna genérica,
        # corrigimos o sinal APENAS quando a descrição indicar claramente entrada/saída.
        # Fontes confiáveis (Santander/Inter/etc.) já trazem o sinal correto no amount.
        if (
            not trust_amount
            and "_amount_origin" in out.columns
            and "_amount_explicit_sign" in out.columns
        ):
            def adjust_sign(r: pd.Series) -> float:
                amt = r.get("amount")
                if not pd.notna(amt):
                    return amt
                origin = str(r.get("_amount_origin") or "")
                explicit = bool(r.get("_amount_explicit_sign"))
                # só ajusta quando o sinal é ambíguo
                if origin != "amount" or explicit:
                    return float(amt)
                hinted = _desc_fallback_type(r.get("description", ""))
                if hinted == "saida":
                    return -abs(float(amt))
                if hinted == "entrada":
                    return abs(float(amt))
                return float(amt)

            out["amount"] = out.apply(adjust_sign, axis=1)

    def classify_row(r: pd.Series) -> Optional[str]:
        amt = r.get("amount")
        if pd.notna(amt):
            if float(amt) > 0:
                return "entrada"
            if float(amt) < 0:
                return "saida"
        return _desc_fallback_type(r.get("description", ""))

    out["type"] = out.apply(classify_row, axis=1)

    # dataset final exigido
    out["amount"] = pd.to_numeric(out["amount"], errors="coerce").astype("float64")
    out["balance"] = pd.to_numeric(out["balance"], errors="coerce").astype("float64")
    cols = ["date", "description", "amount", "balance", "type"]
    if "counterparty" in out.columns:
        cols.append("counterparty")
    return out[cols].copy()


def _dedupe_transactions(df: pd.DataFrame) -> pd.DataFrame:
    """
    Remove duplicatas de forma determinística.
    Chave: (date, description normalizada, amount em centavos, balance em centavos).
    Mantém a primeira ocorrência (ordem original).
    """
    if df.empty:
        return df

    # Neon: no mesmo dia há vários "Crédito para Pix" com mesmo valor e mesmo saldo após o par;
    # a chave (data, desc, amount, balance) não é única — não deduplicar.
    if "_source" in df.columns and df["_source"].fillna("").astype(str).str.lower().eq("neon").all():
        return df.reset_index(drop=True)

    x = df.copy()
    # normaliza descrição para comparação
    x["_desc_key"] = x["description"].fillna("").astype(str).map(lambda s: normalize_word(s))
    # quantiza valores (centavos) para evitar ruído de float
    x["_amt_key"] = (pd.to_numeric(x["amount"], errors="coerce") * 100).round().astype("Int64")
    x["_bal_key"] = (pd.to_numeric(x["balance"], errors="coerce") * 100).round().astype("Int64")
    x["_date_key"] = x["date"].astype("datetime64[ns]")

    before = len(x)
    x = x.drop_duplicates(subset=["_date_key", "_desc_key", "_amt_key", "_bal_key"], keep="first")
    x = x.drop(columns=["_date_key", "_desc_key", "_amt_key", "_bal_key"], errors="ignore")
    x = x.reset_index(drop=True)
    return x


def generateReport(df: pd.DataFrame) -> Dict[str, Any]:
    """
    Relatórios:
    - resumo mensal: total_entrada, total_saida, saldo
    - média mensal: média de entradas e saídas por mês
    """
    if df.empty:
        return {
            "monthly_summary": [],
            "monthly_average": {"avg_entrada": 0.0, "avg_saida": 0.0},
        }

    x = df.copy()
    x = x[pd.notna(x["date"])].copy()
    if x.empty:
        return {
            "monthly_summary": [],
            "monthly_average": {"avg_entrada": 0.0, "avg_saida": 0.0},
        }

    x["month"] = x["date"].dt.to_period("M").astype(str)

    entrada = x.loc[x["amount"] > 0].groupby("month")["amount"].sum()
    saida = x.loc[x["amount"] < 0].groupby("month")["amount"].sum()

    months = sorted(set(x["month"].tolist()))
    rows = []
    for m in months:
        total_in = float(entrada.get(m, 0.0))
        total_out = float(saida.get(m, 0.0))  # negativo
        rows.append(
            {
                "month": m,
                "total_entrada": float(total_in),
                "total_saida": float(total_out),
                "saldo": float(total_in + total_out),
            }
        )

    avg_entrada = float(pd.Series([r["total_entrada"] for r in rows]).mean()) if rows else 0.0
    avg_saida = float(pd.Series([r["total_saida"] for r in rows]).mean()) if rows else 0.0

    return {
        "monthly_summary": rows,
        "monthly_average": {"avg_entrada": avg_entrada, "avg_saida": avg_saida},
    }


def run_pipeline(pdf_path: str, bank: Optional[str] = None) -> Dict[str, Any]:
    raw = parseStatement(pdf_path, bank=bank)
    statement_holder: Optional[str] = None
    if "holder" in raw.columns and raw["holder"].notna().any():
        hv = raw["holder"].dropna()
        if not hv.empty:
            statement_holder = str(hv.iloc[0]).strip() or None

    # metadados opcionais (quando extractor disponibiliza)
    meta_extras: Dict[str, Any] = {}
    for k in ("cpf", "agency", "account", "period_start", "period_end", "issued_at"):
        if k in raw.columns and raw[k].notna().any():
            v = raw[k].dropna()
            if not v.empty:
                meta_extras[k] = str(v.iloc[0]).strip()
    raw_norm = raw.drop(columns=["holder"], errors="ignore")
    norm = normalizeTransactions(raw_norm)
    norm = _dedupe_transactions(norm)
    classified = classifyTransactions(norm, bank=bank)
    report = generateReport(classified)

    # serialização JSON-friendly
    out_df = classified.copy()
    def _fmt_out_date(d: Any) -> Optional[str]:
        if d is None or (isinstance(d, float) and pd.isna(d)):
            return None
        if hasattr(d, "strftime"):
            try:
                return d.strftime("%Y-%m-%d")
            except Exception:
                return None
        s = _to_text(d)
        if re.fullmatch(r"\d{4}-\d{2}-\d{2}", s):
            return s
        parsed = parse_date(s)
        return parsed.strftime("%Y-%m-%d") if parsed else s or None

    out_df["date"] = out_df["date"].apply(_fmt_out_date)
    out_df = out_df.where(pd.notna(out_df), None)

    src_counts = {}
    if "_source" in raw.columns:
        for v, c in raw["_source"].fillna("").astype(str).value_counts().items():
            if v:
                src_counts[str(v)] = int(c)
    pages_meta = {}
    for k in ("_pages_total", "_pages_with_text", "_text_chars"):
        if k in raw.columns and raw[k].notna().any():
            pages_meta[k.replace("_", "")] = int(pd.to_numeric(raw[k], errors="coerce").fillna(0).max())

    # auditoria rápida: onde pode estar inflando entradas (valores positivos sem saldo)
    counts = {}
    if not classified.empty:
        counts["count_total"] = int(len(classified))
        counts["count_pos"] = int((classified["amount"] > 0).sum())
        counts["count_neg"] = int((classified["amount"] < 0).sum())
        counts["count_zero"] = int((classified["amount"] == 0).sum())
        counts["count_type_entrada"] = int((classified["type"] == "entrada").sum())
        counts["count_type_saida"] = int((classified["type"] == "saida").sum())

    ambiguous_samples = []
    try:
        if not norm.empty and not bool(norm["balance"].notna().any()):
            amb = norm.copy()
            amb = amb[(amb["amount"] > 0) & (amb["_amount_origin"] == "amount") & (~amb["_amount_explicit_sign"])]
            # descrição que não bate em keywords
            amb["_hint"] = amb["description"].map(lambda d: _desc_fallback_type(d) or "")
            amb = amb[amb["_hint"] == ""]
            for rec in amb.head(12).to_dict(orient="records"):
                ambiguous_samples.append(
                    {
                        "date": str(rec.get("date")),
                        "description": str(rec.get("description"))[:180],
                        "amount": float(rec.get("amount")) if rec.get("amount") is not None else None,
                        "source": str(rec.get("_source") or ""),
                    }
                )
    except Exception:
        pass

    return {
        "transactions": out_df.to_dict(orient="records"),
        "report": report,
        "meta": {
            "bank": (bank or "").strip().lower() or None,
            "statement_holder": statement_holder,
            **meta_extras,
            "raw_rows": int(len(raw)),
            "normalized_rows": int(len(norm)),
            "classified_rows": int(len(classified)),
            "has_any_balance": bool(norm["balance"].notna().any()) if "balance" in norm.columns else False,
            "sources": src_counts,
            **pages_meta,
            "enable_ocr": bool(str(os.environ.get("ENABLE_OCR", "")).strip().lower() in {"1", "true", "yes", "y", "on"}),
            **counts,
            "ambiguous_positive_samples": ambiguous_samples,
        },
    }


def main(argv: Optional[List[str]] = None) -> int:
    import argparse

    p = argparse.ArgumentParser()
    p.add_argument("pdf_path")
    args = p.parse_args(argv)

    pdf_path = str(args.pdf_path)
    if not Path(pdf_path).exists():
        raise SystemExit(f"Arquivo não encontrado: {pdf_path}")

    result = run_pipeline(pdf_path)
    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

