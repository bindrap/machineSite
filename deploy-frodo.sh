#!/bin/bash
ssh parteek@100.68.134.68 'bash -s' << 'ENDSSH'
cd /home/parteek

# Create service file
cat << 'SERVICE' | sudo tee /etc/systemd/system/machine-agent.service > /dev/null
[Unit]
Description=Machine Monitoring Agent - Frodo
After=network.target

[Service]
Type=simple
User=parteek
WorkingDirectory=/home/parteek
Environment="SERVER_URL=http://100.115.59.14:3005"
Environment="MACHINE_ID=frodo"
Environment="DISPLAY_NAME=Frodo"
ExecStart=/usr/bin/node /home/parteek/agent.js
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
SERVICE

# Start service
sudo systemctl daemon-reload
sudo systemctl enable machine-agent
sudo systemctl restart machine-agent
sleep 2
sudo systemctl status machine-agent --no-pager | head -10
ENDSSH
