#!/bin/bash
# Diagnóstico do stack Nexo (NÃO altera nada).
# Rode na VPS e cole a saída completa.

set -u

echo "========== NEXO — DIAGNÓSTICO $(date -Is 2>/dev/null || date) =========="
echo ""

echo "=== 1. Containers Nexo ==="
docker ps -a --filter name=nexo --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}' || true
echo ""

echo "=== 2. Containers odevcwb (só referência) ==="
docker ps -a --filter name=odevcwb --format 'table {{.Names}}\t{{.Status}}' || true
echo ""

echo "=== 3. Disco (postgres trava se disco cheio) ==="
df -h / /var/lib/docker 2>/dev/null || df -h
echo ""

echo "=== 4. Memória ==="
free -h 2>/dev/null || true
echo ""

echo "=== 5. Postgres responde? ==="
docker exec nexo-postgres pg_isready -U postgres 2>&1 || echo "FALHOU: nexo-postgres"
echo ""

echo "=== 6. Redis responde? ==="
docker exec nexo-redis redis-cli ping 2>&1 || echo "FALHOU: nexo-redis"
echo ""

echo "=== 7. nexo-api alcança postgres? ==="
docker exec nexo-api sh -c 'wget -qO- --timeout=3 http://127.0.0.1:3000/health 2>/dev/null || wget -qO- --timeout=3 http://127.0.0.1:3000/api/health 2>/dev/null || wget -qO- --timeout=3 http://127.0.0.1:3000/ 2>/dev/null | head -c 200' 2>&1 || echo "FALHOU: nexo-api não responde em :3000"
echo ""

echo "=== 8. nexo-web alcança nexo-api? ==="
docker exec nexo-web wget -qO- --timeout=5 http://nexo-api:3000/health 2>&1 \
  || docker exec nexo-web wget -qO- --timeout=5 http://nexo-api:3000/api/health 2>&1 \
  || echo "FALHOU: nexo-web não alcança nexo-api"
echo ""

echo "=== 9. Nginx no nexo-web (configs) ==="
docker exec nexo-web ls -la /etc/nginx/conf.d/ 2>/dev/null || true
echo "--- nginx -t ---"
docker exec nexo-web nginx -t 2>&1 || true
echo ""

echo "=== 10. Rede nexo_default ==="
docker network inspect nexo_default --format '{{range .Containers}}{{.Name}} {{end}}' 2>/dev/null || echo "rede nexo_default não encontrada"
echo ""

echo "=== 11. Últimos logs nexo-api (erros de banco?) ==="
docker logs nexo-api --tail 40 2>&1 || true
echo ""

echo "=== 12. Últimos logs nexo-worker ==="
docker logs nexo-worker --tail 20 2>&1 || true
echo ""

echo "=== 13. Últimos logs nexo-postgres ==="
docker logs nexo-postgres --tail 15 2>&1 || true
echo ""

echo "=== 14. OOM kill recente? ==="
dmesg 2>/dev/null | grep -i 'out of memory\|oom-kill' | tail -5 || echo "(sem permissão ou sem OOM)"
echo ""

echo "========== FIM — cole tudo acima no chat =========="
