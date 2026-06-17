#!/bin/bash
# Atualiza o portfolio na VPS (build + copia para odevcwb-web).
# Uso: bash /root/odevcwb-src/deploy/docker/update-portfolio.sh

set -e

SRC="${ODEVCWB_SRC:-/root/odevcwb-src}"
ODEV="${ODEVCWB_DIR:-/root/odevcwb}"

echo "==> Build em $SRC/portfolio pessoal"
cd "$SRC/portfolio pessoal"
npm install
npm run build

echo "==> Copia dist → $ODEV/portfolio/dist"
mkdir -p "$ODEV/portfolio/dist"
rm -rf "$ODEV/portfolio/dist"/*
cp -r dist/* "$ODEV/portfolio/dist/"

echo "==> Reinicia odevcwb-web"
cd "$ODEV"
docker compose restart odevcwb-web

echo ""
echo "Pronto. Teste: curl -sI http://odevcwb-web/ | head -3"
echo "No browser: Ctrl+Shift+R em https://odevcwb.com/"
