#!/bin/bash

# Complete automated setup: SSH keys + agent deployment
# This script automates everything

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

PASSWORDS["frodo"]="password"
PASSWORDS["sauron"]="password"
PASSWORDS["gandalf"]="password"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}=== Complete Machine Monitoring Setup ===${NC}"
echo ""
echo "This script will:"
echo "  1. Install sshpass (if needed)"
echo "  2. Set up SSH keys for passwordless authentication"
echo "  3. Deploy monitoring agents to all machines"
echo ""

# Install sshpass if needed
if ! command -v sshpass &> /dev/null; then
    echo -e "${YELLOW}Installing sshpass...${NC}"
    if command -v pacman &> /dev/null; then
        sudo pacman -S --noconfirm sshpass
    elif command -v apt-get &> /dev/null; then
        sudo apt-get update -qq && sudo apt-get install -y sshpass
    else
        echo -e "${RED}Cannot install sshpass. Please install it manually.${NC}"
        exit 1
    fi
    echo -e "${GREEN}✓ sshpass installed${NC}"
fi

# Generate SSH key if needed
if [ ! -f ~/.ssh/id_rsa ]; then
    echo -e "${YELLOW}Generating SSH key...${NC}"
    ssh-keygen -t rsa -b 4096 -f ~/.ssh/id_rsa -N "" -q
    echo -e "${GREEN}✓ SSH key generated${NC}"
else
    echo -e "${GREEN}✓ SSH key already exists${NC}"
fi

echo ""
echo -e "${BLUE}=== Setting Up Passwordless SSH ===${NC}"

# Function to setup SSH key
setup_ssh_key() {
    local machine_name=$1
    local machine_ip=$2
    local password=$3

    echo -n "  ${machine_name} (${machine_ip}): "

    # Test if already set up
    if ssh -o BatchMode=yes -o ConnectTimeout=3 parteek@${machine_ip} exit 2>/dev/null; then
        echo -e "${GREEN}already configured ✓${NC}"
        return 0
    fi

    # Copy SSH key
    sshpass -p "$password" ssh-copy-id -o StrictHostKeyChecking=no -o ConnectTimeout=5 parteek@${machine_ip} >/dev/null 2>&1

    # Verify
    if ssh -o BatchMode=yes -o ConnectTimeout=3 parteek@${machine_ip} exit 2>/dev/null; then
        echo -e "${GREEN}configured ✓${NC}"
        return 0
    else
        echo -e "${RED}failed ✗${NC}"
        return 1
    fi
}

# Setup SSH keys for all machines
for machine in "${!MACHINES[@]}"; do
    setup_ssh_key "$machine" "${MACHINES[$machine]}" "${PASSWORDS[$machine]}"
done

echo ""
echo -e "${BLUE}=== Deploying Monitoring Agents ===${NC}"

# Function to deploy agent
deploy_agent() {
    local machine_name=$1
    local machine_ip=$2
    local display_name="${machine_name^}"

    echo -e "${YELLOW}Deploying to ${machine_name}...${NC}"

    # Copy agent script
    echo "  → Copying agent.js..."
    scp -q "${SCRIPT_DIR}/agent.js" parteek@${machine_ip}:/home/parteek/ || {
        echo -e "${RED}  ✗ Failed to copy agent.js${NC}"
        return 1
    }

    # Setup on remote machine
    echo "  → Installing dependencies and setting up service..."
    ssh parteek@${machine_ip} bash << ENDSSH
        set -e

        # Install systeminformation if needed
        if [ ! -d "/home/parteek/node_modules/systeminformation" ]; then
            cd /home/parteek
            npm install --no-save systeminformation >/dev/null 2>&1
        fi

        # Create systemd service
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

        # Start service
        sudo systemctl daemon-reload
        sudo systemctl enable machine-agent >/dev/null 2>&1
        sudo systemctl restart machine-agent

        # Wait and check
        sleep 2
        if sudo systemctl is-active --quiet machine-agent; then
            echo "  ✓ Service started successfully"
            sudo journalctl -u machine-agent -n 2 --no-pager 2>/dev/null | tail -2
        else
            echo "  ✗ Service failed to start"
            sudo systemctl status machine-agent --no-pager --lines=5
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

# Deploy to all machines
SUCCESS_COUNT=0
FAIL_COUNT=0

for machine in "${!MACHINES[@]}"; do
    if deploy_agent "$machine" "${MACHINES[$machine]}"; then
        ((SUCCESS_COUNT++))
    else
        ((FAIL_COUNT++))
    fi
    echo ""
done

# Summary
echo -e "${BLUE}=== Setup Complete ===${NC}"
echo ""
echo -e "Deployed: ${GREEN}${SUCCESS_COUNT}${NC} successful"
if [ $FAIL_COUNT -gt 0 ]; then
    echo -e "Failed: ${RED}${FAIL_COUNT}${NC}"
fi
echo ""

if [ $SUCCESS_COUNT -gt 0 ]; then
    echo "Verifying registered machines..."
    sleep 2
    curl -s http://${CENTRAL_SERVER_IP}:${CENTRAL_SERVER_PORT}/api/machines | grep -o '"machine_id":"[^"]*"' | cut -d'"' -f4 | while read mid; do
        echo "  → $mid"
    done
    echo ""
    echo -e "${GREEN}Dashboard available at: http://${CENTRAL_SERVER_IP}:${CENTRAL_SERVER_PORT}${NC}"
    echo ""
    echo "To check agent status on a machine:"
    echo "  ssh parteek@MACHINE_IP 'sudo systemctl status machine-agent'"
    echo ""
    echo "To view agent logs:"
    echo "  ssh parteek@MACHINE_IP 'sudo journalctl -u machine-agent -f'"
fi
