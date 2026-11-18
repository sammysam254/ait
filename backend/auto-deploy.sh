#!/usr/bin/env bash
# Auto-sync and rebuild daemon for Vertex SaaS Backend

cd "$(dirname "$0")"

git fetch origin main -q
LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse origin/main)

if [ "$LOCAL" != "$REMOTE" ]; then
    echo "[$(date)] New commit detected! Updating backend..."
    git pull origin main
    sudo docker compose build
    sudo docker compose up -d
    echo "[$(date)] Backend successfully rebuilt and restarted!"
fi
