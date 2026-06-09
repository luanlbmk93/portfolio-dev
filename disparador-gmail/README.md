# Disparador Gmail v2

App web com OAuth 2.0 — cada usuário conecta a própria conta Google.

## Desenvolvimento local

1. Copie `.env.example` para `.env` e preencha as credenciais Google (tipo **Web application**)
2. Redirect URI local: `http://localhost:3000/api/auth/callback`
3. Instale e rode:

```bash
npm run install:all
npm run build:client
npm run dev:server    # terminal 1 — porta 3000
npm run dev:client    # terminal 2 — porta 5174 (proxy /api)
```

## Produção (VPS)

Veja `../deploy/DEPLOY.md`

## Script antigo (CLI)

O arquivo `index.js` na raiz é a versão antiga de linha de comando (usa `credentials.json` fixo).
O servidor web usa `server/` e **não** depende desse script.
