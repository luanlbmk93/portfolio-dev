from __future__ import annotations

import os
import re
import sys
import tempfile
import time
from pathlib import Path
from typing import Any, Dict

from fastapi import FastAPI, File, Form, UploadFile
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from starlette.concurrency import run_in_threadpool

# Garante que imports locais (statement_pipeline.py) funcionem independente do cwd do PM2/Uvicorn
_HERE = Path(__file__).resolve().parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))

from statement_pipeline import run_pipeline  # noqa: E402


app = FastAPI(title="Extrato Pipeline (determinístico)", version="1.0.0")


@app.get("/health")
async def health() -> Dict[str, str]:
    """Confirma que o processo Python (extratos sem IA) está no ar."""
    return {"status": "ok", "service": "statement-api", "parse": "/parse-statement"}


@app.api_route("/api/proxy-gemini", methods=["POST", "GET", "OPTIONS"])
async def gemini_wrong_backend():
    """
    Se o Nginx mandar /api/* só para o Python (8000), a IA quebra.
    A rota real do Gemini fica no Node (POSTGRESQL-SERVER, porta 3000).
    """
    return JSONResponse(
        status_code=502,
        content={
            "error": (
                "Esta URL caiu no backend Python (extrato sem IA). "
                "A IA usa o servidor Node em /api/proxy-gemini (porta 3000). "
                "Ajuste o proxy: /api/proxy-gemini, /api/login e /api/audit-logs -> Node; "
                "/parse-statement -> Python."
            ),
        },
    )

origins = os.environ.get("CORS_ORIGINS", "http://localhost:5173").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in origins if o.strip()],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.post("/parse-statement")
async def parse_statement(
    file: UploadFile = File(...),
    bank: str = Form(""),
) -> Dict[str, Any]:
    name = (file.filename or "").lower()
    if not (name.endswith(".pdf") or name.endswith(".csv") or name.endswith(".ofx")):
        return {"error": "Envie um arquivo .pdf, .csv ou .ofx."}

    started = time.time()
    with tempfile.TemporaryDirectory(prefix="extrato_") as td:
        suffix = Path(name).suffix or ".bin"
        path = Path(td) / f"statement{suffix}"
        content = await file.read()
        path.write_bytes(content)
        size_kb = max(1, int(len(content) / 1024))
        print(f"[parse-statement] start file={file.filename} size_kb={size_kb}")

        try:
            bank_clean = (bank or "").strip().lower()
            print(f"[parse-statement] bank_form={bank_clean!r}")

            # Fallback determinístico: alguns deploys/proxies podem "perder" o campo `bank`.
            # Quando vier vazio, tenta inferir pelo nome do arquivo para cair no pipeline correto.
            if not bank_clean:
                if "caixa" in name:
                    bank_clean = "caixa"
                elif "banco do brasil" in name or "banco_do_brasil" in name or "bancodobrasil" in name or re.search(r"\bbb\b", name):
                    bank_clean = "bancodobrasil"
                elif "bradesco" in name:
                    bank_clean = "bradesco"
                elif "inter" in name or "banco inter" in name:
                    bank_clean = "inter"
                elif "itau" in name or "itaú" in name:
                    bank_clean = "itau"
                elif "nubank" in name or re.search(r"\bnu\b", name):
                    bank_clean = "nubank"
                elif "picpay" in name:
                    bank_clean = "picpay"
                elif "mercadopago" in name or "mercado pago" in name or "mercado_pago" in name:
                    bank_clean = "mercadopago"
                elif "stone" in name:
                    bank_clean = "stone"
                elif "sicredi" in name:
                    bank_clean = "sicredi"
                elif "neon" in name:
                    bank_clean = "neon"
                elif "santander" in name:
                    bank_clean = "santander"
                elif "c6" in name or "c6bank" in name:
                    bank_clean = "c6"
                elif "banco pan" in name or "bancopan" in name or re.search(r"\bpan\b", name):
                    bank_clean = "pan"
                elif "pagbank" in name or "pag_bank" in name or "pagseguro" in name:
                    bank_clean = "pagbank"

            result = await run_in_threadpool(
                run_pipeline, str(path), bank_clean or None  # type: ignore[arg-type]
            )

            elapsed_ms = int((time.time() - started) * 1000)
            meta = result.get("meta") if isinstance(result, dict) else None
            print(f"[parse-statement] ok elapsed_ms={elapsed_ms} meta={meta}")
            return result

        except Exception as e:
            elapsed_ms = int((time.time() - started) * 1000)
            print(f"[parse-statement] error elapsed_ms={elapsed_ms} err={e}")
            detail = str(e).strip() or repr(e)
            return JSONResponse(
                status_code=503,
                content={
                    "error": f"Falha ao processar arquivo: {detail[:500]}",
                    "detail": detail,
                },
            )