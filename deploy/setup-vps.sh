#!/usr/bin/env bash
# Prepara uma VPS Ubuntu/Debian: Docker, firewall, clone do repo e .env com segredos aleatórios.
# Uso (como root): bash setup-vps.sh <dominio>
set -euo pipefail

DOMAIN="${1:?uso: setup-vps.sh <dominio>}"
REPO="${REPO:-https://github.com/leonardocbalbino/automacao-instagram.git}"
DIR="${DIR:-/opt/automacao-instagram}"

if ! command -v docker >/dev/null; then
  curl -fsSL https://get.docker.com | sh
fi

if command -v ufw >/dev/null; then
  ufw allow OpenSSH >/dev/null
  ufw allow 80/tcp >/dev/null
  ufw allow 443/tcp >/dev/null
  ufw --force enable >/dev/null
fi

if [ ! -d "$DIR/.git" ]; then
  git clone "$REPO" "$DIR"
fi
cd "$DIR"

if [ ! -f .env ]; then
  cp .env.example .env
  sed -i "s#^DOMAIN=.*#DOMAIN=$DOMAIN#" .env
  sed -i "s#^PUBLIC_URL=.*#PUBLIC_URL=https://$DOMAIN#" .env
  sed -i "s#^POSTGRES_PASSWORD=.*#POSTGRES_PASSWORD=$(openssl rand -hex 16)#" .env
  sed -i "s#^JWT_SECRET=.*#JWT_SECRET=$(openssl rand -hex 32)#" .env
  sed -i "s#^TOKEN_ENCRYPTION_KEY=.*#TOKEN_ENCRYPTION_KEY=$(openssl rand -hex 32)#" .env
  sed -i "s#^IG_WEBHOOK_VERIFY_TOKEN=.*#IG_WEBHOOK_VERIFY_TOKEN=$(openssl rand -hex 12)#" .env
  sed -i "s#^BULL_BOARD_PASSWORD=.*#BULL_BOARD_PASSWORD=$(openssl rand -hex 12)#" .env
  chmod 600 .env
  echo ".env criado em $DIR/.env — preencha IG_APP_ID e IG_APP_SECRET."
fi

docker compose up -d --build
echo "No ar: https://$DOMAIN (o certificado sai assim que o DNS apontar para esta VPS)"
