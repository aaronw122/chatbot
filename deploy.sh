#!/bin/bash
EC2_HOST="13.223.100.207"
KEY="~/easyBranch-key.pem"
APP_DIR="~/app"

ssh -i $KEY ec2-user@$EC2_HOST << 'EOF'
  cd ~/app 2>/dev/null || { git clone https://github.com/aaronw122/chatbot.git ~/app && cd ~/app; }
  git pull origin docker
  docker compose down
  docker compose up -d --build
EOF
