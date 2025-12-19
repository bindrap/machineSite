#!/bin/bash

# Manual Agent Deployment Script
# Run this in your regular terminal (not through Claude Code)

set -e

# Configuration
CENTRAL_SERVER_IP="100.115.59.14"
CENTRAL_SERVER_PORT="3000"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Machine configurations
declare -A MACHINES PASSWORDS
MACHINES["frodo"]="100.68.134.68"
MACHINES["sauron"]="100.87.129.118"
MACHINES["gandalf"]="100.92.136.93"

# Passwords (will be used with sshpass)
PASSWORDS["frodo"]="password"
PASSWORDS["sauron"]="password"
PASSWORDS["gandalf"]="password"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}=== Machine Monitoring Agent Deployment ===${NC}"
echo ""
echo "This script will deploy agents to:"
for machine in "${!MACHINES[@]}"; do
    echo "  - $machine (${MACHINES[$machine]})"
done
echo ""

# Check if sshpass is installed
if ! command -v sshpass &> /dev/null; then
    echo -e "${YELLOW}sshpass is not installed. Installing...${NC}"
    if command -v pacman &> /dev/null; then
        # Arch Linux
        sudo pacman -S --noconfirm sshpass
    elif command -v apt-get &> /dev/null; then
        # Debian/Ubuntu
        sudo apt-get update -qq && sudo apt-get install -y sshpass
    else
        echo -e "${RED}Cannot detect package manager. Please install sshpass manually.${NC}"
        exit 1
    fi
fi

# Function to deploy agent to a machine
deploy_agent() {
    local machine_name=$1
    local machine_ip=$2
    local password=$3
    local display_name="${machine_name^}"

    echo -e "${YELLOW}Deploying to ${machine_name} (${machine_ip})...${NC}"

    # Test connection
    if ! sshpass -p "$password" ssh -o StrictHostKeyChecking=no -o ConnectTimeout=5 parteek@${machine_ip} exit 2>/dev/null; then
        echo -e "${RED}  ✗ Cannot connect to ${machine_name}${NC}"
        return 1
    fi

    # Copy agent script
    echo "  → Copying agent.js..."
    sshpass -p "$password" scp -o StrictHostKeyChecking=no "${SCRIPT_DIR}/agent.js" parteek@${machine_ip}:/home/parteek/

    # Setup on remote machine
    echo "  → Setting up systemd service..."
    sshpass -p "$password" ssh -o StrictHostKeyChecking=no parteek@${machine_ip} bash << 'ENDSSH'
        # Install systeminformation if needed
        if [ ! -d "/home/parteek/node_modules/systeminformation" ]; then
            echo "    Installing systeminformation..."
            cd /home/parteek
            npm install --no-save systeminformation 2>&1 | grep -E "added|up to date" || true
        fi

        # Create systemd service
        echo "    Creating systemd service..."
        echo "$SUDO_PASSWORD" | sudo -S tee /etc/systemd/system/machine-agent.service > /dev/null << 'SERVICE'
[Unit]
Description=Machine Monitoring Agent
After=network.target

[Service]
Type=simple
User=parteek
WorkingDirectory=/home/parteek
Environment="SERVER_URL=http://CENTRAL_SERVER_IP:CENTRAL_SERVER_PORT"
Environment="MACHINE_ID=MACHINE_NAME"
Environment="DISPLAY_NAME=DISPLAY_NAME"
ExecStart=/usr/bin/node /home/parteek/agent.js
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
SERVICE
ENDSSH

    # Now update the service file with actual values
    sshpass -p "$password" ssh -o StrictHostKeyChecking=no parteek@${machine_ip} bash << ENDSSH2
        # Replace placeholders in service file
        echo "$password" | sudo -S sed -i "s|CENTRAL_SERVER_IP|${CENTRAL_SERVER_IP}|g" /etc/systemd/system/machine-agent.service
        echo "$password" | sudo -S sed -i "s|CENTRAL_SERVER_PORT|${CENTRAL_SERVER_PORT}|g" /etc/systemd/system/machine-agent.service
        echo "$password" | sudo -S sed -i "s|MACHINE_NAME|${machine_name}|g" /etc/systemd/system/machine-agent.service
        echo "$password" | sudo -S sed -i "s|DISPLAY_NAME|${display_name}|g" /etc/systemd/system/machine-agent.service

        # Reload systemd and start service
        echo "    Enabling and starting service..."
        echo "$password" | sudo -S systemctl daemon-reload
        echo "$password" | sudo -S systemctl enable machine-agent 2>&1 | grep -E "Created|enabled" || true
        echo "$password" | sudo -S systemctl restart machine-agent

        # Wait a moment for service to start
        sleep 2

        # Check status
        if echo "$password" | sudo -S systemctl is-active --quiet machine-agent; then
            echo "    ✓ Service is running"
            echo "$password" | sudo -S journalctl -u machine-agent -n 3 --no-pager | tail -3
        else
            echo "    ✗ Service failed to start"
            echo "$password" | sudo -S systemctl status machine-agent --no-pager --lines=10
            exit 1
        fi
ENDSSH2

    if [ $? -eq 0 ]; then
        echo -e "${GREEN}  ✓ Successfully deployed to ${machine_name}${NC}"
        return 0
    else
        echo -e "${RED}  ✗ Failed to deploy to ${machine_name}${NC}"
        return 1
    fi
}

# Deploy to all machines
SUCCESS_COUNT=0
FAIL_COUNT=0

for machine in "${!MACHINES[@]}"; do
    if deploy_agent "$machine" "${MACHINES[$machine]}" "${PASSWORDS[$machine]}"; then
        ((SUCCESS_COUNT++))
    else
        ((FAIL_COUNT++))
    fi
    echo ""
done

# Summary
echo -e "${BLUE}=== Deployment Summary ===${NC}"
echo -e "${GREEN}Successful: ${SUCCESS_COUNT}${NC}"
echo -e "${RED}Failed: ${FAIL_COUNT}${NC}"
echo ""

if [ $SUCCESS_COUNT -gt 0 ]; then
    echo "To verify agents are working:"
    echo "  curl http://${CENTRAL_SERVER_IP}:${CENTRAL_SERVER_PORT}/api/machines"
    echo ""
    echo "View dashboard at:"
    echo "  http://${CENTRAL_SERVER_IP}:${CENTRAL_SERVER_PORT}"
fi
