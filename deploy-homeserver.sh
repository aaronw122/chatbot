#!/bin/bash
# Deploy chatbot to homeserver (Docker + Cloudflare "Easy Branch" tunnel).
#
# We build NATIVELY ON THE HOMESERVER (amd64), not locally. Cross-building this
# Bun image on an arm64 Mac via QEMU crashes ("CPU lacks AVX support" -> Bun segfault),
# so instead we rsync the source and build server-side. The build is small (~250MB peak),
# well within the homeserver's resources.
#
# Runtime dir on server: ~/chatbot (holds docker-compose.yml + .env.production).
# Build dir on server:    ~/chatbot-build (synced source; .env.production is NOT here).
set -euo pipefail

SERVER=homeserver
BUILD_DIR='~/chatbot-build'
RUN_DIR='~/chatbot'

echo "==> Syncing source to $SERVER:$BUILD_DIR ..."
rsync -az --delete \
  --exclude '.git' --exclude 'node_modules' --exclude 'backend/dist' --exclude 'frontend/dist' \
  --exclude '*.tar.gz' --exclude '.claude' --exclude 'supabase/.temp' --exclude 'supabase/.branches' \
  --exclude '*.pem' --exclude 'terraform/.terraform' \
  ./ "$SERVER:$BUILD_DIR/"

echo "==> Building image on homeserver (native amd64)..."
ssh "$SERVER" "cd $BUILD_DIR && docker build --platform linux/amd64 -t chatbot:latest ."

echo "==> Syncing compose file + starting container..."
ssh "$SERVER" "mkdir -p $RUN_DIR"
scp docker-compose.homeserver.yml "$SERVER:$RUN_DIR/docker-compose.yml"
ssh "$SERVER" "cd $RUN_DIR && docker compose up -d --force-recreate --remove-orphans"

echo "==> Container status:"
ssh "$SERVER" "docker ps --filter name=chatbot --format '{{.Names}}  {{.Status}}'"
echo "==> Done. (Ensure ~/chatbot/.env.production exists on the server.)"
