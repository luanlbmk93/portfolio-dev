#!/bin/bash

cd /root/extrato-IA
npm run build
rm -rf /var/www/columnsys/*
cp -r dist/* /var/www/columnsys/
systemctl restart nginx

echo "🚀 Deploy concluído!"
