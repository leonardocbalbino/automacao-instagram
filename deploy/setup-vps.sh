#!/usr/bin/env bash
# Prepara uma VPS Ubuntu/Debian: Docker, clone do repo, .env com segredos aleatórios e HTTPS.
# Uso (como root): bash setup-vps.sh <dominio>
#  - VPS com nginx já rodando: cria um site no nginx e emite o certificado com certbot.
#  - VPS dedicada: sobe o Caddy (profile caddy), que cuida do HTTPS sozinho.
set -euo pipefail

DOMAIN="${1:?uso: setup-vps.sh <dominio>}"
REPO="${REPO:-https://github.com/leonardocbalbino/automacao-instagram.git}"
DIR="${DIR:-/opt/automacao-instagram}"
API_PORT="${API_PORT:-3310}"

if ! command -v docker >/dev/null; then
  curl -fsSL https://get.docker.com | sh
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
  echo "API_BIND=127.0.0.1:$API_PORT" >> .env
  chmod 600 .env
  echo ".env criado em $DIR/.env: preencha IG_APP_ID e IG_APP_SECRET."
fi

if systemctl is-active --quiet nginx; then
  site=/etc/nginx/sites-available/automacao-instagram
  sed -e "s#server_name .*;#server_name $DOMAIN;#" -e "s#127.0.0.1:3310#127.0.0.1:$API_PORT#" deploy/nginx.conf > "$site"
  ln -sf "$site" /etc/nginx/sites-enabled/automacao-instagram
  nginx -t && systemctl reload nginx
  docker compose up -d --build
  command -v certbot >/dev/null || apt-get install -y certbot python3-certbot-nginx
  certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --register-unsafely-without-email --redirect
else
  grep -q "^COMPOSE_PROFILES=" .env || echo "COMPOSE_PROFILES=caddy" >> .env
  docker compose up -d --build
fi

echo "No ar: https://$DOMAIN"
