#!/bin/bash

# Remote Machine Monitoring Agent Cleanup Script
# This script removes monitoring agents from remote machines via SSH

set -e

# Define machines with their Tailscale IPs (same as setup-agents.sh)
declare -A MACHINES
MACHINES["frodo"]="100.68.134.68"
MACHINES["sauron"]="100.87.129.118"
MACHINES["gandalf"]="100.92.136.93"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}=========================================${NC}"
echo -e "${BLUE}  Remote Agent Cleanup${NC}"
echo -e "${BLUE}=========================================${NC}"
echo ""
echo "Available machines:"
for machine in "${!MACHINES[@]}"; do
    echo "  - $machine (${MACHINES[$machine]})"
done
echo ""

# Function to cleanup agent on a remote machine
cleanup_agent() {
    local machine_name=$1
    local machine_ip=$2

    echo -e "${YELLOW}Cleaning up agent on ${machine_name} (${machine_ip})...${NC}"

    # Check if we can SSH to the machine
    if ! ssh -o ConnectTimeout=5 -o BatchMode=yes parteek@${machine_ip} exit 2>/dev/null; then
        echo -e "${RED}Cannot connect to ${machine_name}. Skipping...${NC}"
        return 1
    fi

    # Run cleanup on remote machine
    ssh parteek@${machine_ip} << 'EOF'
        echo "  → Stopping and disabling service..."
        if systemctl is-active --quiet machine-agent 2>/dev/null; then
            sudo systemctl stop machine-agent
            echo "    ✓ Service stopped"
        fi

        if systemctl is-enabled --quiet machine-agent 2>/dev/null; then
            sudo systemctl disable machine-agent
            echo "    ✓ Service disabled"
        fi

        if [ -f /etc/systemd/system/machine-agent.service ]; then
            echo "  → Removing service file..."
            sudo rm /etc/systemd/system/machine-agent.service
            sudo systemctl daemon-reload
            echo "    ✓ Service file removed"
        fi

        echo "  → Removing agent files..."
        [ -f "$HOME/agent.js" ] && rm "$HOME/agent.js" && echo "    ✓ Removed agent.js"
        [ -d "$HOME/machine-agent" ] && rm -rf "$HOME/machine-agent" && echo "    ✓ Removed agent directory"
        [ -d "$HOME/node_modules/systeminformation" ] && rm -rf "$HOME/node_modules/systeminformation" "$HOME/node_modules/node-fetch" && echo "    ✓ Removed dependencies"

        echo "  → Cleanup complete"
EOF

    if [ $? -eq 0 ]; then
        echo -e "${GREEN}  ✓ Successfully cleaned up agent on ${machine_name}${NC}"
        return 0
    else
        echo -e "${RED}  ✗ Failed to clean up agent on ${machine_name}${NC}"
        return 1
    fi
}

# Main cleanup logic
if [ $# -eq 0 ]; then
    # No arguments - cleanup all machines
    echo "Cleaning up agents on all machines..."
    echo ""

    for machine in "${!MACHINES[@]}"; do
        cleanup_agent "$machine" "${MACHINES[$machine]}"
        echo ""
    done
else
    # Cleanup specific machines
    for machine_name in "$@"; do
        if [ -n "${MACHINES[$machine_name]}" ]; then
            cleanup_agent "$machine_name" "${MACHINES[$machine_name]}"
            echo ""
        else
            echo -e "${RED}Unknown machine: ${machine_name}${NC}"
            echo "Available machines: ${!MACHINES[@]}"
        fi
    done
fi

echo -e "${GREEN}=========================================${NC}"
echo -e "${GREEN}  ✓ Remote Cleanup Complete${NC}"
echo -e "${GREEN}=========================================${NC}"
echo ""
echo "To verify removal on a machine:"
echo "  ssh parteek@MACHINE_IP 'systemctl status machine-agent'"
echo ""
