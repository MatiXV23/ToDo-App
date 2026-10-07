#!/usr/bin/env bash
# Construye la imagen localmente, la carga en el servidor por SSH y levanta el stack.
# En el servidor no hay código: solo ~/todoapp/docker-compose.yml y ~/todoapp/.env.
#
#   DEPLOY_HOST=mati@192.168.1.235 DEPLOY_SSH_KEY=~/.ssh/ubuntu-server.pem scripts/deploy.sh
set -euo pipefail

HOST="${DEPLOY_HOST:?Definí DEPLOY_HOST, ej. mati@192.168.1.235}"
DIR="${DEPLOY_DIR:-todoapp}"
PLATFORM="${DEPLOY_PLATFORM:-linux/amd64}"
SSH_OPTS=(-o BatchMode=yes)
[[ -n "${DEPLOY_SSH_KEY:-}" ]] && SSH_OPTS+=(-i "${DEPLOY_SSH_KEY/#\~/$HOME}")
remote() { ssh "${SSH_OPTS[@]}" "$HOST" "$@"; }

cd "$(dirname "$0")/.."
REV="$(git rev-parse --short HEAD 2>/dev/null || date +%s)"

echo "→ Construyendo imagen todoapp:$REV ($PLATFORM)"
docker buildx build --platform "$PLATFORM" -t "todoapp:$REV" -t todoapp:latest --load .

echo "→ Copiando docker-compose.yml"
remote "mkdir -p ~/$DIR"
scp "${SSH_OPTS[@]}" deploy/docker-compose.yml "$HOST:~/$DIR/docker-compose.yml" >/dev/null

if ! remote "test -f ~/$DIR/.env"; then
  echo "✗ Falta ~/$DIR/.env en el servidor. Crealo a partir de deploy/.env.example." >&2
  exit 1
fi

echo "→ Cargando la imagen en el servidor"
docker save "todoapp:$REV" todoapp:latest | gzip -1 | remote "gunzip | docker load"

echo "→ Levantando el stack"
remote "cd ~/$DIR && docker compose up -d --remove-orphans && docker image prune -f >/dev/null"
remote "cd ~/$DIR && docker compose ps --format 'table {{.Service}}\t{{.Status}}'"
echo "✓ Desplegado todoapp:$REV"
