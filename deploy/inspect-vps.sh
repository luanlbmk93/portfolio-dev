#!/bin/bash
# Script SOMENTE LEITURA — não altera nada na VPS.
# Rode na VPS e cole a saída completa para configurarmos sem conflito.

set -e

echo "========== INSPEÇÃO VPS (read-only) =========="
echo "Data: $(date -Is 2>/dev/null || date)"
echo "Hostname: $(hostname)"
echo ""

echo "========== PORTAS EM USO (LISTEN) =========="
if command -v ss >/dev/null; then
  sudo ss -tlnp | grep LISTEN || true
else
  sudo netstat -tlnp 2>/dev/null | grep LISTEN || true
fi
echo ""

echo "========== PM2 =========="
if command -v pm2 >/dev/null; then
  pm2 list || true
  pm2 jlist 2>/dev/null | head -c 4000 || true
else
  echo "pm2 não instalado"
fi
echo ""

echo "========== NGINX — sites ativos =========="
if command -v nginx >/dev/null; then
  ls -la /etc/nginx/sites-enabled/ 2>/dev/null || true
  echo ""
  echo "--- server_name em cada config ---"
  grep -R "server_name" /etc/nginx/sites-enabled/ 2>/dev/null || true
  echo ""
  echo "--- proxy_pass / upstream ---"
  grep -R "proxy_pass\|upstream" /etc/nginx/sites-enabled/ 2>/dev/null || true
else
  echo "nginx não instalado"
fi
echo ""

echo "========== SYSTEMD (node/nginx/docker) =========="
systemctl list-units --type=service --state=running 2>/dev/null \
  | grep -E 'nginx|node|pm2|docker|caddy|apache' || true
echo ""

echo "========== DOCKER =========="
if command -v docker >/dev/null; then
  docker ps --format 'table {{.Names}}\t{{.Ports}}\t{{.Status}}' 2>/dev/null || true
else
  echo "docker não instalado"
fi
echo ""

echo "========== PROCESSOS NODE =========="
ps aux | grep -E '[n]ode|[p]m2' || true
echo ""

echo "========== /var/www (pastas existentes) =========="
ls -la /var/www/ 2>/dev/null || echo "/var/www não existe"
echo ""

echo "========== TESTE PORTAS LOCAIS COMUNS =========="
for port in 80 443 3000 3001 3100 4000 5000 5173 8080; do
  if curl -s -o /dev/null -w "%{http_code}" --connect-timeout 1 "http://127.0.0.1:${port}/" 2>/dev/null | grep -qE '^[0-9]+$'; then
    code=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 1 "http://127.0.0.1:${port}/" 2>/dev/null)
    echo "porta ${port}: HTTP ${code}"
  else
    echo "porta ${port}: sem resposta / fechada"
  fi
done
echo ""
echo "========== FIM =========="
