#!/bin/bash

# Interactive deployment - prompts for sudo password

set -e

CENTRAL_SERVER_IP="100.115.59.14"
CENTRAL_SERVER_PORT="3000"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

declare -A MACHINES
MACHINES["frodo"]="100.68.134.68"
MACHINES["sauron"]="100.87.129.118"
MACHINES["gandalf"]="100.92.136.93"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}=== Deploying Agents (Interactive) ===${NC}"
echo ""

# Prompt for sudo password
echo -n "Enter sudo password for remote machines: "
read -s SUDO_PASS
echo ""
echo ""

deploy_agent() {
    local machine_name=$1
    local machine_ip=$2
    local display_name="${machine_name^}"

    echo -e "${YELLOW}Deploying to ${machine_name}...${NC}"

    # Check SSH
    echo -n "  Testing SSH... "
    if ! timeout 5 ssh -o BatchMode=yes -o ConnectTimeout=3 parteek@${machine_ip} exit 2>/dev/null; then
        echo -e "${RED}not configured, skipping ✗${NC}"
        return 1
    fi
    echo -e "${GREEN}ok ✓${NC}"

    # Copy agent
    echo -n "  Copying agent.js... "
    if timeout 30 scp -q "${SCRIPT_DIR}/agent.js" parteek@${machine_ip}:/home/parteek/; then
        echo -e "${GREEN}done ✓${NC}"
    else
        echo -e "${RED}failed ✗${NC}"
        return 1
    fi

    # Deploy
    echo "  Installing and starting service..."
    timeout 120 ssh parteek@${machine_ip} bash << ENDSSH
        cd /home/parteek

        # Install dependencies
        if [ ! -d "node_modules/systeminformation" ]; then
            echo "    Installing systeminformation..."
            npm install --no-save systeminformation 2>&1 | grep -E "added|up to date" || true
        fi

        # Create service
        echo "    Creating systemd service..."
        echo "${SUDO_PASS}" | sudo -S tee /etc/systemd/system/machine-agent.service > /dev/null << 'SERVICE'
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

        # Start
        echo "    Starting service..."
        echo "${SUDO_PASS}" | sudo -S systemctl daemon-reload 2>&1 | grep -v "^\[sudo\]" || true
        echo "${SUDO_PASS}" | sudo -S systemctl enable machine-agent 2>&1 | grep -v "^\[sudo\]" | head -1
        echo "${SUDO_PASS}" | sudo -S systemctl restart machine-agent 2>&1 | grep -v "^\[sudo\]" || true

        # Verify
        sleep 3
        if echo "${SUDO_PASS}" | sudo -S systemctl is-active --quiet machine-agent 2>&1; then
            echo "    ✓ Agent running"
            echo "${SUDO_PASS}" | sudo -S journalctl -u machine-agent -n 2 --no-pager 2>&1 | grep -v "^\[sudo\]" | tail -2
        else
            echo "    ✗ Agent failed to start"
            echo "${SUDO_PASS}" | sudo -S systemctl status machine-agent --no-pager --lines=5 2>&1 | grep -v "^\[sudo\]"
            exit 1
        fi
ENDSSH

    if [ $? -eq 0 ]; then
        echo -e "${GREEN}  ✓ ${machine_name} deployed successfully${NC}"
        return 0
    else
        echo -e "${RED}  ✗ ${machine_name} deployment failed${NC}"
        return 1
    fi
}

# Deploy to all
SUCCESS=0
FAILED=0

for machine in frodo sauron gandalf; do
    echo ""
    if deploy_agent "$machine" "${MACHINES[$machine]}"; then
        ((SUCCESS++))
    else
        ((FAILED++))
    fi
done

echo ""
echo -e "${BLUE}=== Summary ===${NC}"
echo -e "Deployed: ${GREEN}${SUCCESS}${NC}"
echo -e "Failed/Skipped: ${YELLOW}${FAILED}${NC}"
echo ""

if [ $SUCCESS -gt 0 ]; then
    echo "Checking registered machines..."
    sleep 2
    curl -s http://localhost:3000/api/machines 2>/dev/null | grep -o '"machine_id":"[^"]*"' | sed 's/"machine_id":"\([^"]*\)"/  ✓ \1/' || echo "  (couldn't fetch - check dashboard manually)"
    echo ""
    echo -e "${GREEN}Dashboard: http://localhost:3000${NC}"
fi
