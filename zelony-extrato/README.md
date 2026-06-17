# Zelony Extrato

Análise inteligente de extratos bancários — tema dark + dourado.

**Desenvolvido por Luan Biagioni**

## Stack

| Parte | Tecnologia | Porta |
|-------|------------|-------|
| Frontend | React + Vite | 5173 (dev) / 8080 (Docker) |
| API (auth, Gemini, auditoria) | Node + Express | 3000 |
| Extrator sem IA | Python FastAPI | 8000 |
| Banco | PostgreSQL 16 | 5433 (host) / 5432 (Docker) |

## Comando único (desenvolvimento)

```bash
cd zelony-extrato
cp .env.example .env   # ajuste JWT_SECRET, GEMINI_PAID_KEY, SEED_*
npm run start:all
```

Isso:
1. Cria `.env` se não existir
2. Instala dependências (root + server)
3. Sobe Postgres no Docker
4. Cria usuário admin (`SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`)
5. Inicia frontend, API Node e Python

Abra: **http://localhost:5173**

### Pré-requisitos

- Node 20+
- Docker (para Postgres)
- Python 3.12 + venv no `backend/` (para modo sem IA):

```bash
cd backend
python -m venv .venv
# Windows:
.venv\Scripts\pip install -r requirements.txt
# Linux:
.venv/bin/pip install -r requirements.txt
```

## Produção (Docker completo)

```bash
cp .env.example .env
npm run build
docker compose up -d --build
docker compose exec api node scripts/seed-admin.js
```

App em **http://localhost:8080**

## Variáveis importantes (.env)

```env
JWT_SECRET=string-longa-aleatoria
GEMINI_PAID_KEY=sua-chave-google-ai
SEED_ADMIN_EMAIL=seu@gmail.com
SEED_ADMIN_PASSWORD=senha_forte
DB_USER=zelony
DB_PASS=...
```

## Deploy VPS (junto ao Nexo)

Mesma ideia do odevcwb: stack Docker separado na rede `nexo_default`, Nginx no `nexo-web` com novo `server_name`.

1. Clone no servidor: `git clone ... /root/zelony-extrato`
2. Configure `.env` com `DB_HOST=postgres` (nome do service Docker)
3. `npm run build && docker compose up -d --build`
4. Adicione snippet Nginx no nexo-web apontando seu domínio → `zelony-web:80`

**Não rode `docker compose down` no stack Nexo.**

## GitHub

```bash
cd zelony-extrato
git init
git add .
git commit -m "Zelony Extrato: redesign, API Postgres, Docker"
git remote add origin https://github.com/SEU_USER/zelony-extrato.git
git push -u origin main
```
