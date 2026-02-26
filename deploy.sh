#!/bin/bash
set -e

EC2_HOST="13.223.100.207"
KEY="~/easyBranch-key.pem"
IMAGE_NAME="chatbot"

echo "==> Building Docker image locally..."
docker build --platform linux/amd64 -t $IMAGE_NAME .

echo "==> Saving and compressing image..."
docker save $IMAGE_NAME | gzip > /tmp/chatbot.tar.gz

echo "==> Uploading image to EC2..."
scp -i $KEY /tmp/chatbot.tar.gz ec2-user@$EC2_HOST:~/chatbot.tar.gz

echo "==> Uploading docker-compose and env..."
scp -i $KEY docker-compose.yml ec2-user@$EC2_HOST:~/docker-compose.yml
ssh -i $KEY ec2-user@$EC2_HOST "mkdir -p ~/backend"
scp -i $KEY backend/.env ec2-user@$EC2_HOST:~/backend/.env

echo "==> Deploying on EC2..."
ssh -i $KEY ec2-user@$EC2_HOST << 'EOF'
  docker load < ~/chatbot.tar.gz
  docker compose down
  docker compose up -d
  rm ~/chatbot.tar.gz
EOF

rm /tmp/chatbot.tar.gz
echo "==> Deploy complete!"
