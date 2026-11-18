#!/usr/bin/env bash
set -e

echo "=========================================================="
echo " Vertex SaaS: Automated Linux VM / VPS Deployment Script"
echo "=========================================================="

# 1. Update OS and install dependencies
echo "[1/5] Updating packages and installing Docker..."
sudo apt-get update -y
sudo apt-get install -y curl git ufw

if ! command -v docker &> /dev/null; then
    curl -fsSL https://get.docker.com -o get-docker.sh
    sudo sh get-docker.sh
    sudo usermod -aG docker $USER
fi

if ! command -v docker-compose &> /dev/null; then
    sudo apt-get install -y docker-compose-plugin
fi

# 2. Firewall configuration
echo "[2/5] Configuring firewall..."
sudo ufw allow 22/tcp || true
sudo ufw allow 80/tcp || true
sudo ufw allow 443/tcp || true
sudo ufw allow 5000/tcp || true

# 3. Build & Run Container
echo "[3/5] Building and launching Vertex Backend container..."
if [ -f "docker-compose.yml" ]; then
    sudo docker compose down || true
    sudo docker compose up --build -d
else
    sudo docker build -t vertex-backend .
    sudo docker stop vertex-backend || true
    sudo docker rm vertex-backend || true
    sudo docker run -d --name vertex-backend \
      --restart unless-stopped \
      -p 5000:5000 \
      --env-file .env \
      vertex-backend
fi

# 4. Verification
echo "[4/5] Checking container status..."
sleep 5
sudo docker ps | grep vertex

echo "=========================================================="
echo " Backend Successfully Deployed and Running on Port 5000!"
echo " Health check: curl http://localhost:5000/health"
echo "=========================================================="
