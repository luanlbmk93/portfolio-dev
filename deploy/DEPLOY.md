# Deploy na VPS

> **Sua VPS usa Docker (Nexo)** — siga **`DEPLOY-NEXO.md`**, não o guia Nginx/PM2 abaixo.

---

## VPS com Nexo (seu caso)

Ver **`deploy/DEPLOY-NEXO.md`** — stack isolado `odevcwb-web` + `odevcwb-api`, integração só no `nexo-web`.

---

## VPS limpa (sem Docker) — referência antiga

| URL | App | Como roda |
|-----|-----|-----------|
| `odevcwb.com/` | Portfolio pessoal | **Nginx estático** |
| `odevcwb.com/separadorpdf/` | PDF Tools | **Nginx estático** |
| `odevcwb.com/wpp-links/` | WhatsApp Links | **Nginx estático** |
| `odevcwb.com/disparador-gmail/` | Disparador Gmail | **Nginx estático** + **Node só na API** (porta **3100**) |

> **Regra de ouro:** não edite o Nginx/PM2 do site que já existe. Só **adicione** um server block novo para `odevcwb.com` e um processo PM2 novo na porta **3100**.

---

## Passo 0 — Inspecionar a VPS (antes de qualquer coisa)

Conecte na VPS e rode **somente leitura**:

```bash
bash /var/www/odevcwb/deploy/inspect-vps.sh
```

Ou cole estes comandos manualmente:

```bash
sudo ss -tlnp | grep LISTEN
pm2 list
ls -la /etc/nginx/sites-enabled/
grep -R "server_name\|proxy_pass" /etc/nginx/sites-enabled/
docker ps 2>/dev/null
```

**Cole a saída aqui** — assim escolhemos uma porta livre (padrão: **3100**) sem conflitar com seu backend atual.

---

## Passo 1 — Estrutura na VPS

```text
/var/www/odevcwb/
  portfolio/dist/          ← build do portfolio
  separador/dist/          ← build do separador
  disparador-gmail/
    server/
    client/dist/
    .env
  deploy/
    ecosystem.config.cjs
    nginx-odevcwb.conf.example
    inspect-vps.sh
```

Envie a pasta `2 PASTAS` inteira (renomeie para `odevcwb` na VPS se quiser).

---

## Passo 2 — Build (na VPS ou local)

```bash
cd /var/www/odevcwb
npm install
npm run install:disparador
npm run build
```

Isso gera:
- `portfolio pessoal/dist` → copie/sirva como `portfolio/dist`
- `separador/dist` com base `/separadorpdf/`
- `disparador-gmail/client/dist` com base `/disparador-gmail/`

**Organize as pastas:**

```bash
mkdir -p portfolio
cp -r "portfolio pessoal/dist" portfolio/dist
```

---

## Passo 3 — Disparador (.env)

```bash
cd /var/www/odevcwb/disparador-gmail
cp .env.example .env
nano .env
```

```env
GOOGLE_REDIRECT_URI=https://odevcwb.com/disparador-gmail/api/auth/callback
PORT=3100
BASE_PATH=/disparador-gmail
```

No Google Cloud Console → OAuth **Web application** → redirect URI acima.

---

## Passo 4 — PM2 (processo NOVO, isolado)

```bash
cd /var/www/odevcwb/deploy
pm2 start ecosystem.config.cjs
pm2 save
```

Teste (não deve conflitar com nada na 3100):

```bash
curl http://127.0.0.1:3100/disparador-gmail/api/health
```

---

## Passo 5 — Nginx (arquivo NOVO, não editar o existente)

```bash
sudo cp /var/www/odevcwb/deploy/nginx-odevcwb.conf.example /etc/nginx/sites-available/odevcwb.com
sudo nano /etc/nginx/sites-available/odevcwb.com   # ajuste caminhos SSL se preciso
sudo ln -s /etc/nginx/sites-available/odevcwb.com /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d odevcwb.com -d www.odevcwb.com
```

**Não remova** o `sites-enabled` do site antigo. Dois server blocks podem coexistir (domínios diferentes).

---

## Passo 6 — DNS

Aponte `odevcwb.com` e `www.odevcwb.com` para o IP da VPS.

---

## O que NÃO fazer

- Não usar porta 3000/8080/etc. se já estiver ocupada — confira com `inspect-vps.sh`
- Não alterar o `server { }` do site/backend que já roda
- Não colocar `credentials.json` / `token.json` antigos no servidor
- Não rodar `pm2 delete all`

---

## Atualizar depois

```bash
cd /var/www/odevcwb
git pull   # se usar git
npm run build
cp -r "portfolio pessoal/dist" portfolio/dist
pm2 restart odevcwb-disparador
sudo nginx -t && sudo systemctl reload nginx
```
