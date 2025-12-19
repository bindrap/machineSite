#!/bin/bash

# Passwordless SSH Agent Deployment Script
# For use when SSH keys are already configured

set -e

# Configuration
CENTRAL_SERVER_IP="100.115.59.14"
CENTRAL_SERVER_PORT="3000"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Machine configurations
declare -A MACHINES
MACHINES["frodo"]="100.68.134.68"
MACHINES["sauron"]="100.87.129.118"
MACHINES["gandalf"]="100.92.136.93"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}=== Machine Monitoring Agent Deployment (Passwordless SSH) ===${NC}"
echo ""
echo "This script will deploy agents to:"
for machine in "${!MACHINES[@]}"; do
    echo "  - $machine (${MACHINES[$machine]})"
done
echo ""

# Function to deploy agent to a machine
deploy_agent() {
    local machine_name=$1
    local machine_ip=$2
    local display_name="${machine_name^}"

    echo -e "${YELLOW}Deploying to ${machine_name} (${machine_ip})...${NC}"

    # Test connection
    if ! ssh -o ConnectTimeout=5 -o BatchMode=yes parteek@${machine_ip} exit 2>/dev/null; then
        echo -e "${RED}  ✗ Cannot connect to ${machine_name} (SSH keys may not be set up)${NC}"
        return 1
    fi

    # Copy agent script
    echo "  → Copying agent.js..."
    scp -q "${SCRIPT_DIR}/agent.js" parteek@${machine_ip}:/home/parteek/ || {
        echo -e "${RED}  ✗ Failed to copy agent.js${NC}"
        return 1
    }

    # Setup on remote machine
    echo "  → Setting up systemd service..."
    ssh parteek@${machine_ip} bash << ENDSSH
        set -e

        # Install systeminformation if needed
        if [ ! -d "/home/parteek/node_modules/systeminformation" ]; then
            echo "    Installing systeminformation..."
            cd /home/parteek
            npm install --no-save systeminformation 2>&1 | grep -E "added|up to date" || true
        fi

        # Create systemd service
        echo "    Creating systemd service..."
        sudo tee /etc/systemd/system/machine-agent.service > /dev/null << 'SERVICE'
[Unit]
Description=Machine Monitoring Agent - ${display_name}
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
        echo "    Enabling and starting service..."
        sudo systemctl daemon-reload
        sudo systemctl enable machine-agent 2>&1 | grep -E "Created|enabled|already" || true
        sudo systemctl restart machine-agent

        # Wait a moment for service to start
        sleep 2

        # Check status
        if sudo systemctl is-active --quiet machine-agent; then
            echo "    ✓ Service is running"
            sudo journalctl -u machine-agent -n 3 --no-pager 2>/dev/null | tail -3 || true
        else
            echo "    ✗ Service failed to start"
            sudo systemctl status machine-agent --no-pager --lines=10
            exit 1
        fi
ENDSSH

    if [ $? -eq 0 ]; then
        echo -e "${GREEN}  ✓ Successfully deployed to ${machine_name}${NC}"
        return 0
    else
        echo -e "${RED}  ✗ Failed to deploy to ${machine_name}${NC}"
        return 1
    fi
}

# Deploy to all machines or specific ones
if [ $# -eq 0 ]; then
    # No arguments - deploy to all machines
    MACHINES_TO_DEPLOY=("${!MACHINES[@]}")
else
    # Deploy to specific machines
    MACHINES_TO_DEPLOY=("$@")
fi

SUCCESS_COUNT=0
FAIL_COUNT=0

for machine in "${MACHINES_TO_DEPLOY[@]}"; do
    if [ -n "${MACHINES[$machine]}" ]; then
        if deploy_agent "$machine" "${MACHINES[$machine]}"; then
            ((SUCCESS_COUNT++))
        else
            ((FAIL_COUNT++))
        fi
        echo ""
    else
        echo -e "${RED}Unknown machine: ${machine}${NC}"
        echo "Available machines: ${!MACHINES[@]}"
        echo ""
    fi
done

# Summary
echo -e "${BLUE}=== Deployment Summary ===${NC}"
echo -e "${GREEN}Successful: ${SUCCESS_COUNT}${NC}"
if [ $FAIL_COUNT -gt 0 ]; then
    echo -e "${RED}Failed: ${FAIL_COUNT}${NC}"
fi
echo ""

if [ $SUCCESS_COUNT -gt 0 ]; then
    echo "To verify agents are working:"
    echo "  curl http://${CENTRAL_SERVER_IP}:${CENTRAL_SERVER_PORT}/api/machines"
    echo ""
    echo "View dashboard at:"
    echo "  http://${CENTRAL_SERVER_IP}:${CENTRAL_SERVER_PORT}"
    echo ""
    echo "Check agent logs on a machine:"
    echo "  ssh parteek@MACHINE_IP 'sudo journalctl -u machine-agent -f'"
fi
