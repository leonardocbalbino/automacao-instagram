#!/usr/bin/env bash
# Atualiza a VPS com o que está na main. Uso: bash deploy/deploy.sh
set -euo pipefail
cd "$(dirname "$0")/.."
git pull --ff-only
docker compose up -d --build
docker image prune -f >/dev/null
docker compose ps
