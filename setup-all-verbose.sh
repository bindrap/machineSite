#!/bin/bash

# Complete automated setup with verbose output and timeouts

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

echo -e "${BLUE}=== Complete Machine Monitoring Setup (Verbose) ===${NC}"
echo ""

# Check sshpass
if ! command -v sshpass &> /dev/null; then
    echo -e "${RED}sshpass not found. Please install it first:${NC}"
    echo "  sudo pacman -S sshpass"
    exit 1
fi
echo -e "${GREEN}✓ sshpass is installed${NC}"

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

# Function to setup SSH key with timeout
setup_ssh_key() {
    local machine_name=$1
    local machine_ip=$2
    local password=$3

    echo ""
    echo -e "${YELLOW}Setting up ${machine_name} (${machine_ip})...${NC}"

    # Test if already set up
    echo -n "  Testing existing connection... "
    if timeout 10 ssh -o BatchMode=yes -o ConnectTimeout=5 parteek@${machine_ip} exit 2>/dev/null; then
        echo -e "${GREEN}already configured ✓${NC}"
        return 0
    fi
    echo "not configured"

    # Test basic connectivity
    echo -n "  Testing network connectivity... "
    if ! timeout 10 ping -c 1 ${machine_ip} >/dev/null 2>&1; then
        echo -e "${RED}failed - cannot reach host ✗${NC}"
        return 1
    fi
    echo -e "${GREEN}ok ✓${NC}"

    # Try to connect with password
    echo -n "  Testing SSH with password... "
    if ! timeout 10 sshpass -p "$password" ssh -o StrictHostKeyChecking=no -o ConnectTimeout=5 parteek@${machine_ip} exit 2>/dev/null; then
        echo -e "${RED}failed ✗${NC}"
        return 1
    fi
    echo -e "${GREEN}ok ✓${NC}"

    # Copy SSH key
    echo -n "  Copying SSH key... "
    if timeout 30 sshpass -p "$password" ssh-copy-id -o StrictHostKeyChecking=no -o ConnectTimeout=10 parteek@${machine_ip} >/dev/null 2>&1; then
        echo -e "${GREEN}done ✓${NC}"
    else
        echo -e "${RED}failed ✗${NC}"
        return 1
    fi

    # Verify passwordless works
    echo -n "  Verifying passwordless SSH... "
    if timeout 10 ssh -o BatchMode=yes -o ConnectTimeout=5 parteek@${machine_ip} exit 2>/dev/null; then
        echo -e "${GREEN}works ✓${NC}"
        return 0
    else
        echo -e "${RED}failed ✗${NC}"
        return 1
    fi
}

# Setup SSH keys for all machines
SSH_SUCCESS=0
for machine in frodo sauron gandalf; do
    if setup_ssh_key "$machine" "${MACHINES[$machine]}" "${PASSWORDS[$machine]}"; then
        ((SSH_SUCCESS++))
    fi
done

echo ""
if [ $SSH_SUCCESS -eq 0 ]; then
    echo -e "${RED}Failed to set up SSH for any machine. Exiting.${NC}"
    exit 1
fi
echo -e "${GREEN}✓ SSH configured for $SSH_SUCCESS machine(s)${NC}"

echo ""
echo -e "${BLUE}=== Deploying Monitoring Agents ===${NC}"

# Function to deploy agent
deploy_agent() {
    local machine_name=$1
    local machine_ip=$2
    local display_name="${machine_name^}"

    echo ""
    echo -e "${YELLOW}Deploying to ${machine_name}...${NC}"

    # Verify SSH works
    echo -n "  Checking SSH connection... "
    if ! timeout 10 ssh -o BatchMode=yes -o ConnectTimeout=5 parteek@${machine_ip} exit 2>/dev/null; then
        echo -e "${RED}failed ✗${NC}"
        return 1
    fi
    echo -e "${GREEN}ok ✓${NC}"

    # Copy agent script
    echo -n "  Copying agent.js... "
    if timeout 30 scp -q -o ConnectTimeout=10 "${SCRIPT_DIR}/agent.js" parteek@${machine_ip}:/home/parteek/; then
        echo -e "${GREEN}done ✓${NC}"
    else
        echo -e "${RED}failed ✗${NC}"
        return 1
    fi

    # Setup on remote machine
    echo "  Setting up on remote machine..."
    if timeout 120 ssh parteek@${machine_ip} bash << ENDSSH
        set -e

        # Install systeminformation
        echo "    Installing dependencies..."
        if [ ! -d "/home/parteek/node_modules/systeminformation" ]; then
            cd /home/parteek
            npm install --no-save systeminformation
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

        # Start service
        echo "    Starting service..."
        sudo systemctl daemon-reload
        sudo systemctl enable machine-agent
        sudo systemctl restart machine-agent

        # Wait and check
        sleep 3
        if sudo systemctl is-active --quiet machine-agent; then
            echo "    Service is running"
            sudo journalctl -u machine-agent -n 3 --no-pager
        else
            echo "    Service failed to start:"
            sudo systemctl status machine-agent --no-pager --lines=10
            exit 1
        fi
ENDSSH
    then
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

for machine in frodo sauron gandalf; do
    # Only deploy if SSH is set up
    if timeout 5 ssh -o BatchMode=yes -o ConnectTimeout=3 parteek@${MACHINES[$machine]} exit 2>/dev/null; then
        if deploy_agent "$machine" "${MACHINES[$machine]}"; then
            ((SUCCESS_COUNT++))
        else
            ((FAIL_COUNT++))
        fi
    else
        echo -e "${YELLOW}Skipping ${machine} (SSH not configured)${NC}"
        ((FAIL_COUNT++))
    fi
done

# Summary
echo ""
echo -e "${BLUE}=== Setup Complete ===${NC}"
echo ""
echo -e "Successfully deployed: ${GREEN}${SUCCESS_COUNT}${NC}"
if [ $FAIL_COUNT -gt 0 ]; then
    echo -e "Failed: ${RED}${FAIL_COUNT}${NC}"
fi
echo ""

if [ $SUCCESS_COUNT -gt 0 ]; then
    echo "Checking registered machines..."
    sleep 2
    curl -s http://${CENTRAL_SERVER_IP}:${CENTRAL_SERVER_PORT}/api/machines 2>/dev/null | grep -o '"machine_id":"[^"]*"' | cut -d'"' -f4 | while read mid; do
        echo "  ✓ $mid"
    done
    echo ""
    echo -e "${GREEN}Dashboard: http://${CENTRAL_SERVER_IP}:${CENTRAL_SERVER_PORT}${NC}"
fi
