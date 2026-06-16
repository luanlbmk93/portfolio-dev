# Deploy odevcwb.com na VPS com Nexo (Docker)

Sua VPS roda o stack **Nexo** — `nexo-web` controla **80/443**.  
**Não** instale Nginx/PM2 no host. **Não** use portas 80/443 de novo.

## Mapa

```
Internet → nexo-web (80/443) ──proxy──► odevcwb-web (nginx interno)
                                              ├── /                    portfolio
                                              ├── /separadorpdf/       PDF Tools
                                              ├── /disparador-gmail/   frontend
                                              └── /disparador-gmail/api/ → odevcwb-api:3100

nexo-api, postgres, redis… → INTocados
```

---

## Passo 1 — Descobrir rede Docker do Nexo

Na VPS:

```bash
docker inspect nexo-web --format '{{range $k, $v := .NetworkSettings.Networks}}{{$k}}{{end}}'
```

Anote o nome (ex: `docker_default` ou `nexo_default`).

Veja como o nexo-web carrega Nginx:

```bash
docker exec nexo-web ls -la /etc/nginx/conf.d/
docker exec nexo-web cat /etc/nginx/nginx.conf
cat /root/nexo/infrastructure/docker/docker-compose.prod.yml
```

**Cole aqui se quiser validação** — mas pode seguir abaixo.

---

## Passo 2 — Enviar arquivos para a VPS

Na sua máquina, build local:

```bash
cd "2 PASTAS"
npm install
npm run install:disparador
npm run build
mkdir -p portfolio
cp -r "portfolio pessoal/dist" portfolio/dist
```

Envie para a VPS (exemplo):

```bash
scp -r "2 PASTAS" root@SEU_IP:/root/odevcwb-src
```

Na VPS, organize:

```bash
mkdir -p /root/odevcwb
cp -r /root/odevcwb-src/deploy/docker/* /root/odevcwb/
cp -r /root/odevcwb-src/portfolio /root/odevcwb/
cp -r /root/odevcwb-src/separador /root/odevcwb/
cp -r /root/odevcwb-src/disparador-gmail /root/odevcwb/
```

Estrutura final:

```text
/root/odevcwb/
  docker-compose.yml
  nginx-odevcwb-internal.conf
  portfolio/dist/
  separador/dist/
  disparador-gmail/client/dist/
  disparador-gmail/.env
```

---

## Passo 3 — Configurar .env do disparador

```bash
cd /root/odevcwb/disparador-gmail
cp .env.example .env
nano .env
```

```env
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_REDIRECT_URI=https://odevcwb.com/disparador-gmail/api/auth/callback
SESSION_SECRET=string-longa-aleatoria
```

Google Cloud → OAuth Web → redirect URI acima.

---

## Passo 4 — Subir stack odevcwb (sem tocar no Nexo)

```bash
cd /root/odevcwb

# OBRIGATÓRIO: mesma rede do nexo-web (senão = 502 Bad Gateway)
cp /root/odevcwb-src/deploy/docker/compose.env .env
# ou: bash /root/odevcwb-src/deploy/docker/fix-502.sh

docker compose build odevcwb-api
docker compose up -d
docker ps | grep odevcwb
```

Teste **dentro** da rede Docker:

```bash
docker exec nexo-web wget -qO- http://odevcwb-web/ | head -5
docker exec nexo-web wget -qO- http://odevcwb-api:3100/disparador-gmail/api/health
```

Se `odevcwb-web` não resolver, a rede está errada — confira o passo 1.

---

## Passo 5 — Integrar no nexo-web (único ponto sensível)

Adicione um **arquivo novo** no Nginx do `nexo-web` — **não apague** o config do Nexo.

### Opção A — volume no compose do Nexo (recomendado)

Edite `/root/nexo/infrastructure/docker/docker-compose.prod.yml` e no serviço `nexo-web` adicione volume:

```yaml
volumes:
  - /root/odevcwb/nexo-web-odevcwb.conf.snippet:/etc/nginx/conf.d/odevcwb.conf:ro
```

Copie o snippet:

```bash
cp /root/odevcwb-src/deploy/docker/nexo-web-odevcwb.conf.snippet /root/odevcwb/
```

SSL para `odevcwb.com` (se ainda não tiver):

```bash
# Dentro ou fora do container — depende de como o Nexo faz certbot
docker exec nexo-web certbot certonly --webroot ...
```

Recrie **só** o nexo-web:

```bash
cd /root/nexo/infrastructure/docker
docker compose -f docker-compose.prod.yml up -d nexo-web
docker exec nexo-web nginx -t
docker exec nexo-web nginx -s reload
```

### Opção B — copiar manualmente

```bash
docker cp /root/odevcwb/nexo-web-odevcwb.conf.snippet nexo-web:/etc/nginx/conf.d/odevcwb.conf
docker exec nexo-web nginx -t && docker exec nexo-web nginx -s reload
```

---

## Passo 6 — DNS

Aponte `odevcwb.com` e `www.odevcwb.com` para o IP da VPS.

---

## Checklist de segurança

- [ ] `docker ps` — nexo-api, postgres, redis continuam **Up**
- [ ] Nenhum container novo na 80/443 do host (só nexo-web)
- [ ] `odevcwb-api` **sem** `ports:` publicado
- [ ] Site Nexo original ainda abre no domínio dele
- [ ] `https://odevcwb.com/` → portfolio
- [ ] `https://odevcwb.com/separadorpdf/` → PDF Tools
- [ ] `https://odevcwb.com/disparador-gmail/` → disparador

---

## Atualizar apps

```bash
# rebuild local, reenviar dists, na VPS:
cd /root/odevcwb
cp /root/odevcwb-src/deploy/docker/compose.env .env   # não pule isso
docker compose up -d --build odevcwb-api
docker compose restart odevcwb-web
```

## 502 Bad Gateway

Significa que o **nexo-web** não alcança o **odevcwb-web** (container parado ou rede Docker errada).

```bash
cd /root/odevcwb-src && git pull
bash /root/odevcwb-src/deploy/docker/fix-502.sh
```

Ou manualmente:

```bash
docker ps -a | grep odevcwb
docker inspect nexo-web --format '{{range $k,$v := .NetworkSettings.Networks}}{{$k}}{{end}}'
# Use o nome da rede acima:
cd /root/odevcwb
echo 'NEXO_DOCKER_NETWORK=nexo_default' > .env   # troque se for outro nome
docker compose down && docker compose up -d
docker exec nexo-web wget -qO- http://odevcwb-web/ | head -3
```

## Nexo parou (site abre, banco/API não funciona)

O stack **Nexo** (`/root/nexo/`) é separado do odevcwb. Nossos scripts **não** apagam postgres do Nexo, mas recriar `nexo-web` ou falta de disco/memória pode derrubar API/worker.

**Diagnóstico (só leitura):**

```bash
cd /root/odevcwb-src && git pull
bash /root/odevcwb-src/deploy/docker/diagnose-nexo.sh
```

**Recuperação segura (só API + worker, sem apagar banco):**

```bash
bash /root/odevcwb-src/deploy/docker/fix-nexo-safe.sh
```

**NÃO rode** `docker compose down` em `/root/nexo/` sem saber o que está fazendo — isso derruba postgres e a aplicação inteira.

Cole a saída do `diagnose-nexo.sh` se ainda não voltar.

---

## Por que isso não conflita

| Recurso | Nexo | odevcwb |
|---------|------|---------|
| Host 80/443 | nexo-web | **não usa** |
| Porta 3000 | nexo-api (interno) | **não usa** |
| Porta 3100 | livre no host | só rede Docker interna |
| Postgres/Redis | nexo | **não mexe** |

Conflito só acontece se você **editar/apagar** o config principal do Nexo em vez de **adicionar** `odevcwb.conf`.
