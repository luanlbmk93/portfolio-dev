#!/bin/bash
set -euo pipefail

cd /root/odevcwb

echo "=== Rede Docker do Nexo ==="
NET=$(docker inspect nexo-web --format '{{range $k,$v := .NetworkSettings.Networks}}{{$k}}{{end}}' 2>/dev/null | head -1)
if [ -z "$NET" ]; then
  echo "ERRO: container nexo-web não encontrado."
  exit 1
fi
echo "nexo-web está em: $NET"
export NEXO_DOCKER_NETWORK="$NET"
echo "NEXO_DOCKER_NETWORK=$NET" > .env

echo ""
echo "=== Containers odevcwb ==="
docker ps -a --filter name=odevcwb --format 'table {{.Names}}\t{{.Status}}'

echo ""
echo "=== Sincronizar arquivos ==="
cp /root/odevcwb-src/deploy/docker/nginx-odevcwb-internal.conf ./nginx-odevcwb-internal.conf
cp /root/odevcwb-src/deploy/docker/docker-compose.yml ./docker-compose.yml

echo ""
echo "=== Subir stack na rede correta ==="
docker compose down
docker compose up -d --build

echo ""
echo "=== Teste interno (nexo-web → odevcwb-web) ==="
sleep 2
docker exec nexo-web wget -qO- --timeout=5 http://odevcwb-web/ 2>&1 | head -3 || {
  echo "FALHOU: nexo-web não alcança odevcwb-web."
  echo "Redes do odevcwb-web:"
  docker inspect odevcwb-web --format '{{json .NetworkSettings.Networks}}' 2>/dev/null || true
  exit 1
}

echo ""
echo "=== Teste API ==="
docker exec nexo-web wget -qO- --timeout=5 http://odevcwb-api:3100/disparador-gmail/api/health 2>&1 || true

echo ""
echo "OK — recarregue https://odevcwb.com/ no navegador."
