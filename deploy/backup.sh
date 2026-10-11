#!/bin/sh
# Copies the live database out of the running container, safely.
#   deploy/backup.sh [directory]      (default: ./backups)
# Run it from the folder that holds compose.yaml.
set -eu

dest="${1:-./backups}"
stamp="$(date +%Y%m%d-%H%M%S)"
inside="/data/backup-$stamp.db"

mkdir -p "$dest"
docker compose exec -T app node_modules/.bin/tsx src/server/scripts/backup.ts "$inside"
docker compose cp "app:$inside" "$dest/app-$stamp.db"
docker compose exec -T app rm "$inside"
echo "Saved $dest/app-$stamp.db"
