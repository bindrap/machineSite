#!/bin/bash

# Machine Monitoring Agent Cleanup Script
# Run this script on any machine to completely remove the monitoring agent

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}=========================================${NC}"
echo -e "${BLUE}  Machine Monitoring Agent Cleanup${NC}"
echo -e "${BLUE}=========================================${NC}"
echo ""

# Check if running with sudo is needed
if [ "$EUID" -ne 0 ] && systemctl is-active --quiet machine-agent 2>/dev/null; then
    echo -e "${YELLOW}This script needs sudo access to remove the systemd service.${NC}"
    echo -e "${YELLOW}You may be prompted for your password.${NC}"
    echo ""
fi

# Function to stop and remove systemd service
cleanup_service() {
    echo -e "${YELLOW}Cleaning up systemd service...${NC}"

    if systemctl is-active --quiet machine-agent 2>/dev/null; then
        echo "  → Stopping machine-agent service..."
        sudo systemctl stop machine-agent
        echo -e "${GREEN}    ✓ Service stopped${NC}"
    else
        echo "  → Service is not running"
    fi

    if systemctl is-enabled --quiet machine-agent 2>/dev/null; then
        echo "  → Disabling machine-agent service..."
        sudo systemctl disable machine-agent
        echo -e "${GREEN}    ✓ Service disabled${NC}"
    else
        echo "  → Service is not enabled"
    fi

    if [ -f /etc/systemd/system/machine-agent.service ]; then
        echo "  → Removing service file..."
        sudo rm /etc/systemd/system/machine-agent.service
        echo -e "${GREEN}    ✓ Service file removed${NC}"
    else
        echo "  → Service file not found"
    fi

    echo "  → Reloading systemd daemon..."
    sudo systemctl daemon-reload
    echo -e "${GREEN}    ✓ Systemd reloaded${NC}"
    echo ""
}

# Function to remove agent files
cleanup_files() {
    echo -e "${YELLOW}Cleaning up agent files...${NC}"

    # Check for standalone agent.js in home directory
    if [ -f "$HOME/agent.js" ]; then
        echo "  → Removing $HOME/agent.js..."
        rm "$HOME/agent.js"
        echo -e "${GREEN}    ✓ Removed agent.js${NC}"
    fi

    # Check for node_modules in home directory (if installed there)
    if [ -d "$HOME/node_modules/systeminformation" ]; then
        echo "  → Removing systeminformation from $HOME/node_modules..."
        rm -rf "$HOME/node_modules/systeminformation"
        rm -rf "$HOME/node_modules/node-fetch"
        echo -e "${GREEN}    ✓ Removed dependencies${NC}"
    fi

    # Check for agent installation directory
    if [ -d "$HOME/machine-agent" ]; then
        echo "  → Removing $HOME/machine-agent directory..."
        rm -rf "$HOME/machine-agent"
        echo -e "${GREEN}    ✓ Removed agent directory${NC}"
    fi

    echo ""
}

# Main cleanup
cleanup_service
cleanup_files

echo -e "${GREEN}=========================================${NC}"
echo -e "${GREEN}  ✓ Cleanup Complete!${NC}"
echo -e "${GREEN}=========================================${NC}"
echo ""
echo "The monitoring agent has been completely removed from this machine."
echo ""
echo "To verify removal:"
echo "  systemctl status machine-agent  (should show 'could not be found')"
echo ""
