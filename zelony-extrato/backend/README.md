## Backend (determinístico, sem IA)

Este backend processa **PDFs de extrato bancário** sem IA/LLM e gera:

- Transações com `amount` (positivo/negativo) e `type` (`entrada`/`saida`)
- Relatórios mensais (totais + médias)

### Rodar API local

```bash
cd backend
python -m pip install -r requirements.txt
python -m uvicorn api:app --reload --port 8000
```

### Se seu PDF for escaneado (imagem): habilitar OCR (determinístico)

Se o `meta.raw_rows` vier `0`, seu PDF provavelmente não tem texto (é imagem). Nesse caso, habilite OCR.

1) Instale o **Tesseract OCR** (Windows) e o idioma **Português (`por`)**.
2) Instale o **Poppler** (necessário para `pdf2image` no Windows).
3) Rode o backend com estas variáveis:

```bash
set ENABLE_OCR=1
set TESS_LANG=por
set POPPLER_PATH=C:\caminho\para\poppler\Library\bin
python -m uvicorn api:app --reload --port 8000
```

Obs: OCR é determinístico, mas a qualidade depende do scan (resolução/ruído).

### Testar via CLI (stdout JSON)

```bash
cd backend
python statement_pipeline.py "caminho/do/extrato.pdf"
```

### Integração com o frontend

O frontend pode chamar `POST http://localhost:8000/parse-statement` enviando `multipart/form-data` com o campo `file` (PDF).

