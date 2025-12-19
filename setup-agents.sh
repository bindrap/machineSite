#!/bin/bash

# Machine Monitoring Agent Setup Script
# This script sets up monitoring agents on remote machines

set -e

# Configuration
CENTRAL_SERVER_IP="100.115.59.14"  # Legolas IP
CENTRAL_SERVER_PORT="3000"

# Define machines with their Tailscale IPs
declare -A MACHINES
MACHINES["frodo"]="100.68.134.68"
MACHINES["sauron"]="100.87.129.118"
MACHINES["gandalf"]="100.92.136.93"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}=== Machine Monitoring Agent Setup ===${NC}"
echo ""
echo "Central Server: http://${CENTRAL_SERVER_IP}:${CENTRAL_SERVER_PORT}"
echo ""
echo "Available machines:"
for machine in "${!MACHINES[@]}"; do
    echo "  - $machine (${MACHINES[$machine]})"
done
echo ""

# Function to setup agent on a machine
setup_agent() {
    local machine_name=$1
    local machine_ip=$2
    local display_name="${machine_name^}"  # Capitalize first letter

    echo -e "${YELLOW}Setting up agent on ${machine_name} (${machine_ip})...${NC}"

    # Check if we can SSH to the machine
    if ! ssh -o ConnectTimeout=5 -o BatchMode=yes parteek@${machine_ip} exit 2>/dev/null; then
        echo -e "${RED}Cannot connect to ${machine_name}. Skipping...${NC}"
        return 1
    fi

    # Copy agent script
    echo "  → Copying agent.js..."
    scp -q agent.js parteek@${machine_ip}:/home/parteek/

    # Install dependencies and setup systemd service
    echo "  → Installing dependencies and setting up service..."
    ssh parteek@${machine_ip} << EOF
        # Install systeminformation if not already installed
        if [ ! -d "/home/parteek/node_modules/systeminformation" ]; then
            echo "    Installing systeminformation..."
            cd /home/parteek && npm install systeminformation
        fi

        # Create systemd service
        echo "    Creating systemd service..."
        sudo tee /etc/systemd/system/machine-agent.service > /dev/null << 'SERVICE'
[Unit]
Description=Machine Monitoring Agent for ${display_name}
After=network.target

[Service]
Type=simple
User=parteek
WorkingDirectory=/home/parteek
Environment="SERVER_URL=http://${CENTRAL_SERVER_IP}:${CENTRAL_SERVER_PORT}"
Environment="MACHINE_ID=${machine_name}"
Environment="DISPLAY_NAME=${display_name}"
ExecStart=/usr/bin/node /home/parteek/agent.js
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
SERVICE

        # Reload systemd and start service
        echo "    Starting service..."
        sudo systemctl daemon-reload
        sudo systemctl enable machine-agent
        sudo systemctl restart machine-agent

        # Check status
        sleep 2
        if sudo systemctl is-active --quiet machine-agent; then
            echo "    ✓ Service is running"
            sudo journalctl -u machine-agent -n 5 --no-pager
        else
            echo "    ✗ Service failed to start"
            sudo systemctl status machine-agent --no-pager
            exit 1
        fi
EOF

    if [ $? -eq 0 ]; then
        echo -e "${GREEN}  ✓ Successfully set up agent on ${machine_name}${NC}"
        return 0
    else
        echo -e "${RED}  ✗ Failed to set up agent on ${machine_name}${NC}"
        return 1
    fi
}

# Main setup logic
if [ $# -eq 0 ]; then
    # No arguments - setup all machines
    echo "Setting up agents on all machines..."
    echo ""

    for machine in "${!MACHINES[@]}"; do
        setup_agent "$machine" "${MACHINES[$machine]}"
        echo ""
    done
else
    # Setup specific machines
    for machine_name in "$@"; do
        if [ -n "${MACHINES[$machine_name]}" ]; then
            setup_agent "$machine_name" "${MACHINES[$machine_name]}"
            echo ""
        else
            echo -e "${RED}Unknown machine: ${machine_name}${NC}"
            echo "Available machines: ${!MACHINES[@]}"
        fi
    done
fi

echo -e "${GREEN}=== Setup Complete ===${NC}"
echo ""
echo "To check agent status on a machine:"
echo "  ssh parteek@MACHINE_IP 'sudo systemctl status machine-agent'"
echo ""
echo "To view agent logs on a machine:"
echo "  ssh parteek@MACHINE_IP 'sudo journalctl -u machine-agent -f'"
echo ""
echo "To verify machines are registered:"
echo "  curl http://${CENTRAL_SERVER_IP}:${CENTRAL_SERVER_PORT}/api/machines"
echo ""
