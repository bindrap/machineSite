#!/bin/bash

# Setup script for frodo monitoring agent
# This script should be run ON frodo (100.68.134.68)

set -e

echo "================================================"
echo "Setting up Machine Monitoring Agent on Frodo"
echo "================================================"

# Configuration
SERVER_URL="http://192.168.1.140:3000"
MACHINE_ID="frodo"
DISPLAY_NAME="Frodo"

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "Error: Node.js is not installed. Please install Node.js first."
    exit 1
fi

echo "Node.js version: $(node --version)"

# Install systeminformation if needed
echo "Installing dependencies..."
npm install --no-save systeminformation

# Create systemd service file
echo "Creating systemd service..."
sudo tee /etc/systemd/system/machine-agent.service > /dev/null <<EOF
[Unit]
Description=Machine Monitoring Agent
After=network.target

[Service]
Type=simple
User=$USER
WorkingDirectory=$PWD
Environment="SERVER_URL=${SERVER_URL}"
Environment="MACHINE_ID=${MACHINE_ID}"
Environment="DISPLAY_NAME=${DISPLAY_NAME}"
ExecStart=/usr/bin/node $PWD/agent.js
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

# Reload systemd and enable service
echo "Enabling and starting service..."
sudo systemctl daemon-reload
sudo systemctl enable machine-agent
sudo systemctl start machine-agent

echo ""
echo "================================================"
echo "Setup complete!"
echo "================================================"
echo ""
echo "Service status:"
sudo systemctl status machine-agent --no-pager
echo ""
echo "To view logs:"
echo "  sudo journalctl -u machine-agent -f"
echo ""
echo "The agent is now sending metrics to:"
echo "  ${SERVER_URL}"
echo ""
