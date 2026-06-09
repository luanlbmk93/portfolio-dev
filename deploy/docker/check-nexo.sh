#!/bin/bash
# Diagnóstico rápido — somente leitura + testes internos Docker

echo "=== Rede do nexo-web ==="
docker inspect nexo-web --format '{{range $k, $v := .NetworkSettings.Networks}}  {{$k}} ({{$v.IPAddress}}){{"\n"}}{{end}}'

echo ""
echo "=== Containers odevcwb ==="
docker ps --filter name=odevcwb --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'

echo ""
echo "=== Nginx dentro do nexo-web ==="
docker exec nexo-web ls -la /etc/nginx/conf.d/ 2>/dev/null || echo "nexo-web inacessível"

echo ""
echo "=== Teste odevcwb-web (se existir) ==="
docker exec nexo-web wget -qO- --timeout=3 http://odevcwb-web/disparador-gmail/api/health 2>/dev/null \
  || echo "odevcwb-web ainda não na mesma rede ou não subiu"

echo ""
echo "=== Portas no HOST (80/443 devem ser só docker-proxy/nexo-web) ==="
ss -tlnp | grep -E ':80|:443|:3100' || true

echo ""
echo "=== Nexo ainda up? ==="
docker ps --filter name=nexo --format 'table {{.Names}}\t{{.Status}}'
