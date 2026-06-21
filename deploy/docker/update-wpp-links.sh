#!/bin/bash
# Atualiza wpp-links em https://odevcwb.com/wpp-links/
# Uso: bash /root/odevcwb-src/deploy/docker/update-wpp-links.sh

set -e

SRC="${ODEVCWB_SRC:-/root/odevcwb-src}"
ODEV="${ODEVCWB_DIR:-/root/odevcwb}"

echo "==> Sincroniza nginx + compose"
cp "$SRC/deploy/docker/nginx-odevcwb-internal.conf" "$ODEV/nginx-odevcwb-internal.conf"
cp "$SRC/deploy/docker/docker-compose.yml" "$ODEV/docker-compose.yml"

echo "==> Build em $SRC/wpp-links"
cd "$SRC/wpp-links"
npm install
VITE_BASE=/wpp-links/ npm run build

echo "==> Copia dist → $ODEV/wpp-links/dist"
mkdir -p "$ODEV/wpp-links/dist"
rm -rf "$ODEV/wpp-links/dist"/*
cp -r dist/* "$ODEV/wpp-links/dist/"

echo "==> Recria odevcwb-web (monta volume wpp-links)"
cd "$ODEV"
docker compose up -d odevcwb-web

echo ""
echo "Pronto: https://odevcwb.com/wpp-links/"
