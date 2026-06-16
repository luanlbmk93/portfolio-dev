#!/bin/bash
# Recuperação SEGURA do Nexo — NÃO mexe em odevcwb, NÃO apaga volumes/postgres.
# Só reinicia API + worker se estiverem parados ou unhealthy.

set -euo pipefail

NEXO_DIR="/root/nexo/infrastructure/docker"
COMPOSE_FILE="docker-compose.prod.yml"

if [ ! -f "$NEXO_DIR/$COMPOSE_FILE" ]; then
  echo "ERRO: $NEXO_DIR/$COMPOSE_FILE não encontrado."
  exit 1
fi

cd "$NEXO_DIR"

echo "=== Status antes ==="
docker ps --filter name=nexo --format 'table {{.Names}}\t{{.Status}}'

echo ""
echo "=== Postgres + Redis (não reinicia dados) ==="
docker compose -f "$COMPOSE_FILE" up -d nexo-postgres nexo-redis
sleep 3
docker exec nexo-postgres pg_isready -U postgres || {
  echo "AVISO: postgres ainda não pronto — veja: docker logs nexo-postgres --tail 30"
}

echo ""
echo "=== Reiniciar só API + worker ==="
docker compose -f "$COMPOSE_FILE" up -d nexo-api nexo-worker
sleep 5

echo ""
echo "=== Teste interno ==="
docker exec nexo-web wget -qO- --timeout=5 http://nexo-api:3000/health 2>&1 \
  || docker exec nexo-web wget -qO- --timeout=5 http://nexo-api:3000/api/health 2>&1 \
  || echo "API ainda sem resposta — rode diagnose-nexo.sh e cole os logs"

echo ""
echo "=== Status depois ==="
docker ps --filter name=nexo --format 'table {{.Names}}\t{{.Status}}'

echo ""
echo "Se o site do Nexo ainda falhar, NÃO rode 'docker compose down' no Nexo."
echo "Cole a saída de: bash /root/odevcwb-src/deploy/docker/diagnose-nexo.sh"
