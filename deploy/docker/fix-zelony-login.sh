#!/bin/bash
# Diagnóstico + correção rede/login Zelony na VPS
set -euo pipefail

cd /root/odevcwb-src/zelony-extrato

NET=$(docker inspect nexo-web --format '{{range $k,$v := .NetworkSettings.Networks}}{{$k}}{{end}}' 2>/dev/null | head -1)
NET=${NET:-nexo_default}
echo "Rede Nexo: $NET"

echo ""
echo "=== Containers ==="
docker compose ps

echo ""
echo "=== Conectar zelony-web na rede do Nexo ==="
docker network connect "$NET" zelony-web 2>/dev/null || echo "(já conectado ou erro benigno)"
docker inspect zelony-web --format 'Redes: {{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}'

echo ""
echo "=== Teste API local (8080) ==="
curl -sf http://localhost:8080/api/health && echo " OK health:8080" || echo " FALHOU health:8080"
curl -sf -X POST http://localhost:8080/api/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"test@test.com","senha":"wrong"}' | head -c 120 || echo " FALHOU login:8080"

echo ""
echo ""
echo "=== Teste via odevcwb-web (como o domínio) ==="
docker exec nexo-web wget -qO- http://odevcwb-web/extrato/api/health 2>&1 | head -c 120 || echo "FALHOU extrato/api/health"

echo ""
echo "=== Recriar admin (lê .env da pasta) ==="
docker compose exec -T api node scripts/seed-admin.js || echo "seed falhou — confira SEED_* no .env"

echo ""
echo "=== Atualizar nginx odevcwb ==="
cp /root/odevcwb-src/deploy/docker/nginx-odevcwb-internal.conf /root/odevcwb/nginx-odevcwb-internal.conf
cd /root/odevcwb && docker compose restart odevcwb-web

echo ""
echo "=== Recriar zelony-web na rede certa ==="
cd /root/odevcwb-src/zelony-extrato
export NEXO_DOCKER_NETWORK="$NET"
echo "NEXO_DOCKER_NETWORK=$NET" > compose.env
docker compose up -d --force-recreate web api

sleep 3
echo ""
echo "Teste final:"
curl -sf http://localhost:8080/api/health && echo ""
echo "Abra: https://odevcwb.com/extrato/"
