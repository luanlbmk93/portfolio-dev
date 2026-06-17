from __future__ import annotations
import re
from typing import Any, Optional
import pandas as pd

def _parse_br_money(value: Any) -> float:
    if not value or str(value).strip() in ["", ","]:
        return 0.0
    s = str(value).replace("\u00a0", " ").strip()
    # Remove pontos de milhar e troca vírgula por ponto decimal
    s = s.replace(".", "").replace(",", ".")
    try:
        return float(s)
    except ValueError:
        return 0.0

def extract_bradesco_from_text(pdf_text: str) -> pd.DataFrame:
    # Titular: formatos comuns no PDF (app, Net Empresa, impresso)
    holder = None
    for pat in (
        r"(?i)nome\s*:\s*([^\n\r]+)",
        r"(?i)titular\s*:\s*([^\n\r]+)",
        r"(?i)cliente\s*:\s*([^\n\r]+)",
        r"(?i)extrato\s+de\s*:\s*([^\n\r]+)",
        r"(?i)nome\s+do\s+cliente\s*:\s*([^\n\r]+)",
    ):
        hm = re.search(pat, pdf_text or "")
        if hm:
            cand = hm.group(1).strip()
            if len(cand) >= 3 and not re.fullmatch(r"[\d\s./-]+", cand):
                holder = cand
                break

    # Divide por linhas e limpa
    lines = [ln.strip() for ln in (pdf_text or "").splitlines() if ln.strip()]

    rows = []
    current_date: Optional[str] = None
    pending_hist: list[str] = []
    current_tx: Optional[dict[str, Any]] = None

    # Bradesco Celular (texto extraído) costuma vir assim:
    # - linha com "HISTÓRICO" (sem valores)
    # - linha com data + docto + (crédito|débito) + saldo  (às vezes SEM a linha do histórico)
    # - linhas "REM:" / "DES:" depois
    #
    # Ex:
    #   TRANSFERENCIA PIX
    #   08/01/2026 1739592 820,00 804,88
    #   REM: WELLISSON FRANCO PINH 08/01
    date_re = re.compile(r"^(\d{2}/\d{2}/\d{4})\b")
    # Aceita formato BR com OU sem separador de milhar:
    #   "1.234,56", "1234,56", "31.819,06", "31819,06"
    # Alguns PDFs do Bradesco (mobile / Net Empresa) imprimem valores >= 1.000 sem
    # o ponto separador. A regex antiga só aceitava "1.234,56", então linhas com
    # "1234,56" ou saldo "31819,06" deixavam de bater como transação inteira —
    # a data ficava perdida e a "Média Mensal" zerava no relatório.
    money_re = r"(?:\d{1,3}(?:\.\d{3})+|\d+),\d{2}"
    # 1) linha “numérica” (às vezes sem data) → docto + valor + saldo
    tx_line_re = re.compile(rf"^(?:(\d{{2}}/\d{{2}}/\d{{4}})\s+)?(\d{{4,8}})\s+({money_re})\s+({money_re})$")
    # 2) linha completa em uma linha só → data + histórico + docto + valor + saldo
    tx_inline_re = re.compile(rf"^(\d{{2}}/\d{{2}}/\d{{4}})\s+(.+?)\s+(\d{{1,8}})\s+({money_re})\s+({money_re})$")
    # 3) histórico + docto + valores no fim (empresa na mesma linha)
    tx_tail_re = re.compile(rf"^(.+?)\s+(\d{{4,8}})\s+({money_re})\s+({money_re})$")
    money_tail_re = re.compile(rf"\s+({money_re})\s+({money_re})\s*$")
    new_hist_re = re.compile(
        r"^(RECEBIMENTO|TRANSFERENCIA|TRANSFERÊNCIA|PIX|PAGAMENTO|TED|DOC|RENTAB|ENCARGOS|SALARIO|SALÁRIO|DEPOSITO|DEPÓSITO|CREDITO|CRÉDITO)",
        re.IGNORECASE,
    )

    def is_header(line: str) -> bool:
        low = line.lower().replace("�", "")
        return any(
            x in low
            for x in (
                "bradesco",
                "extrato de:",
                "folha:",
                "data:",
                "nome:",
                "agência",
                "agencia",
                "conta",
                "movimentação",
                "movimentacao",
                "histórico",
                "historico",
                "docto",
                "crédito",
                "credito",
                "débito",
                "debito",
                "saldo",
                "total",
                "cod. lanc.",
                "cod. lanc",
                "-- 1 of",
                "-- 2 of",
            )
        )

    def clean_desc(desc: str) -> str:
        s = re.sub(r"\s+", " ", (desc or "").strip())
        # remove número de docto no fim (quando sobrar)
        s = re.sub(r"\b\d{4,8}\b$", "", s).strip()
        # remove lixo tipo "COD. LANC. 0"
        s = re.sub(r"(?i)\bcod\.?\s*lanc\.?\s*\d+\b", "", s).strip()
        return re.sub(r"\s+", " ", s).strip()

    def flush_current() -> None:
        nonlocal current_tx
        if not current_tx:
            return
        desc = clean_desc(" ".join([p for p in current_tx.get("desc_parts", []) if p]).strip())
        if desc:
            current_tx["description"] = desc
        else:
            current_tx["description"] = None

        # Sinal definitivo:
        # - REM = entrada (crédito)
        # - DES = saída (débito)
        # - fallback por palavras-chave quando não há REM/DES
        amt_abs = float(abs(current_tx.get("amount_abs") or 0.0))
        low_desc = (desc or "").lower()
        sign = current_tx.get("sign")
        if sign not in (-1, 1):
            if " des:" in f" {low_desc}":
                sign = -1
            elif " rem:" in f" {low_desc}":
                sign = 1
            else:
                saida_kw = ("pague facil", "débito", "debito", "encargos", "iof", "pacote", "gastos cartao", "cartao de credito", "pix qr code", "recarga")
                entrada_kw = (
                    "crédito",
                    "credito",
                    "deposito",
                    "depósito",
                    "pix recebido",
                    "recebimento fornecedor",
                    "recebimento",
                    "rentab",
                )
                if any(k in low_desc for k in saida_kw):
                    sign = -1
                elif any(k in low_desc for k in entrada_kw):
                    sign = 1
                else:
                    sign = -1

        amount_final = float(sign) * amt_abs
        rows.append(
            {
                "date": current_tx.get("date"),
                "description": current_tx.get("description"),
                "amount": amount_final,
                # Não preenche balance (evita diff(balance) distorcer amount no pipeline global)
                "balance": None,
                "holder": holder,
                "_source": "bradesco",
            }
        )
        current_tx = None

    def _shorten_party_line(line: str) -> str:
        """
        "REM: NOME 08/01" -> "REM: NOME"
        "DES: NOME 10/04" -> "DES: NOME"
        """
        s = re.sub(r"\s+", " ", (line or "").strip())
        m = re.match(r"^(REM:|DES:)\s*(.+)$", s, flags=re.IGNORECASE)
        if not m:
            return s
        tag = m.group(1).upper()
        rest = m.group(2).strip()
        # corta em "dd/mm" (data curta do app do Bradesco) ou em um docto colado no fim
        rest = re.split(r"\b\d{2}/\d{2}\b", rest, maxsplit=1)[0].strip()
        rest = re.sub(r"\b\d{4,8}\b$", "", rest).strip()
        rest = re.sub(r"\s{2,}", " ", rest).strip()
        return f"{tag} {rest}".strip()

    for line in lines:
        if is_header(line):
            continue

        # atualiza data "corrente" quando ela aparece no começo da linha
        md = date_re.match(line)
        if md:
            current_date = md.group(1)

        # Caso 2: data + histórico + docto + valores na MESMA linha (só quando há texto de histórico)
        m_inline = tx_inline_re.match(line)
        if m_inline:
            hist = m_inline.group(2).strip()
            # "11/02/2026 1107207 1.463,54 1.463,54" → hist vazio; histórico está em pending_hist (mtx)
            if hist and not re.fullmatch(r"\d{4,8}", hist):
                flush_current()
                current_date = m_inline.group(1)
                docto = m_inline.group(3).strip()
                v1 = m_inline.group(4)
                v2 = m_inline.group(5)

                if not current_date:
                    continue

                if docto in {"0", "00", "000"} and re.search(r"(?i)cod\.?\s*lanc", hist):
                    pending_hist = []
                    continue

                base_desc = " ".join([*pending_hist, hist]).strip()
                pending_hist = []
                val_tx = _parse_br_money(v1)

                low_desc = (base_desc or "").lower()
                saida_keywords = (
                    "des:",
                    "pague facil",
                    "débito",
                    "debito",
                    "encargos",
                    "iof",
                    "pacote",
                    "gastos cartao",
                    "cartao de credito",
                    "pix qr code",
                    "recarga",
                )
                entrada_keywords = (
                    "rem:",
                    "crédito",
                    "credito",
                    "deposito",
                    "depósito",
                    "pix rem",
                    "recebimento fornecedor",
                    "recebimento",
                    "rentab",
                )

                sign_hint: Optional[int] = None
                if "des:" in low_desc:
                    sign_hint = -1
                elif "rem:" in low_desc:
                    sign_hint = 1
                elif any(k in low_desc for k in saida_keywords):
                    sign_hint = -1
                elif any(k in low_desc for k in entrada_keywords):
                    sign_hint = 1

                current_tx = {
                    "date": current_date,
                    "amount_abs": float(abs(val_tx)),
                    "sign": sign_hint,
                    "desc_parts": [base_desc] if base_desc else [],
                }
                continue

        m_tail = tx_tail_re.match(line)
        if m_tail and not date_re.match(line):
            flush_current()
            hist_tail = m_tail.group(1).strip()
            docto = m_tail.group(2).strip()
            v1 = m_tail.group(3)
            v2 = m_tail.group(4)
            if not current_date:
                pending_hist.append(line)
                continue
            if docto in {"0", "00", "000"} and re.search(r"(?i)cod\.?\s*lanc", hist_tail):
                pending_hist = []
                continue
            base_desc = " ".join([*pending_hist, hist_tail]).strip()
            pending_hist = []
            val_tx = _parse_br_money(v1)
            low_desc = (base_desc or "").lower()
            sign_hint: Optional[int] = None
            if "des:" in low_desc:
                sign_hint = -1
            elif "rem:" in low_desc:
                sign_hint = 1
            elif any(k in low_desc for k in ("des:", "pague facil", "débito", "debito", "pix qr code")):
                sign_hint = -1
            elif any(
                k in low_desc
                for k in (
                    "rem:",
                    "recebimento fornecedor",
                    "recebimento",
                    "rentab",
                    "crédito",
                    "credito",
                    "deposito",
                    "depósito",
                    "pix rem",
                )
            ):
                sign_hint = 1
            current_tx = {
                "date": current_date,
                "amount_abs": float(abs(_parse_br_money(v1))),
                "sign": sign_hint,
                "desc_parts": [base_desc] if base_desc else [],
            }
            continue

        mtx = tx_line_re.match(line)
        if mtx:
            # nova transação: fecha a anterior (se existir)
            flush_current()

            date_in_line, docto, v1, v2 = mtx.groups()
            if date_in_line:
                current_date = date_in_line

            if not current_date:
                continue

            # descrição vem do "histórico" que apareceu na linha anterior (pending_hist)
            base_desc = " ".join(pending_hist).strip()
            pending_hist = []
            val_tx = _parse_br_money(v1)
            val_balance = _parse_br_money(v2)

            # inferência de sinal:
            # - REM: tende a ser entrada (recebido)
            # - DES: tende a ser saída (enviado)
            # (se não tivermos REM/DES, usamos palavras-chave)
            low_desc = (base_desc or "").lower()
            saida_keywords = (
                "des:",
                "pague facil",
                "pix des",
                "débito",
                "debito",
                "encargos",
                "iof",
                "pacote",
                "gastos cartao",
                "cartao de credito",
                "pix qr code",
                "recarga",
            )
            entrada_keywords = (
                "pix rem",
                "rem:",
                "crédito",
                "credito",
                "deposito",
                "depósito",
                "transferencia pix",
                "recebimento fornecedor",
                "recebimento",
                "rentab",
            )

            sign_hint: Optional[int] = None
            if "des:" in low_desc:
                sign_hint = -1
            elif "rem:" in low_desc:
                sign_hint = 1
            elif any(k in low_desc for k in saida_keywords):
                sign_hint = -1
            elif any(k in low_desc for k in entrada_keywords):
                sign_hint = 1

            # inicia transação aberta; anexamos REM/DES das linhas seguintes
            current_tx = {
                "date": current_date,
                "amount_abs": float(abs(val_tx)),
                "sign": sign_hint,
                "desc_parts": [base_desc] if base_desc else [],
            }
            continue

        # linha sem valores:
        # - se for só número (docto isolado), ignora
        if re.fullmatch(r"\d{4,8}", line):
            continue

        # linhas tipo REM:/DES: fazem parte do histórico da transação atual
        if line.upper().startswith(("REM:", "DES:")):
            short = _shorten_party_line(line)
            if current_tx is not None:
                current_tx.setdefault("desc_parts", []).append(short)
                # REM = entrada; DES = saída
                up = short.upper()
                if up.startswith("REM:"):
                    current_tx["sign"] = 1
                elif up.startswith("DES:"):
                    current_tx["sign"] = -1
            else:
                pending_hist.append(short)
            continue

        # Novo histórico pendente: fecha o lançamento anterior ANTES de anexar texto à transação aberta
        if current_tx is not None and new_hist_re.match(line) and not money_tail_re.search(line):
            flush_current()

        # Continuação do lançamento aberto (Bradesco Celular: empresa DEPOIS da linha numérica)
        if current_tx is not None:
            up = line.upper()
            if re.match(r"^ENCARGO\b", up) or "%" in line:
                current_tx.setdefault("desc_parts", []).append(line)
                continue
            if not money_tail_re.search(line) and not date_re.match(line):
                current_tx.setdefault("desc_parts", []).append(line)
                continue

        # Texto sem valores = histórico do próximo lançamento (ex.: "TRANSFERENCIA PIX", "RECEBIMENTO FORNECEDOR")
        if not money_tail_re.search(line):
            dm2 = date_re.match(line)
            if dm2:
                rest = line[dm2.end() :].strip()
                if rest and not money_tail_re.search(rest):
                    pending_hist.append(rest)
                    continue
            pending_hist.append(line)
            continue

        pending_hist.append(line)

    # fecha a última transação (se aberta)
    flush_current()

    return pd.DataFrame(rows)


def try_extract(pdf_text: str) -> Optional[pd.DataFrame]:
    df = extract_bradesco_from_text(pdf_text or "")
    if df is None or df.empty:
        return None

    out = df.copy()
    # garante colunas padrão do pipeline
    for col in ("date", "description", "amount", "debit", "credit", "balance", "_source", "holder"):
        if col not in out.columns:
            out[col] = None
    return out[["date", "description", "amount", "debit", "credit", "balance", "_source", "holder"]].copy()