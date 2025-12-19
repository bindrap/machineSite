#!/bin/bash
set -e

echo "========================================="
echo "Machine Monitoring Agent Setup - FRODO"
echo "========================================="
echo ""

# Configuration
SERVER_URL="${SERVER_URL:-http://100.115.59.14:3000}"
MACHINE_ID="frodo"
DISPLAY_NAME="Frodo (Remote Machine)"
INSTALL_DIR="$HOME/machine-agent"

echo "Configuration:"
echo "  Server URL: $SERVER_URL"
echo "  Machine ID: $MACHINE_ID"
echo "  Display Name: $DISPLAY_NAME"
echo "  Install Dir: $INSTALL_DIR"
echo ""

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed!"
    echo "Please install Node.js 18 or higher first:"
    echo "  https://nodejs.org/"
    exit 1
fi

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    echo "❌ Node.js version must be 18 or higher (found: $(node -v))"
    exit 1
fi

echo "✓ Node.js $(node -v) detected"
echo ""

# Create install directory
echo "Creating installation directory..."
mkdir -p "$INSTALL_DIR"
cd "$INSTALL_DIR"

# Copy agent files
echo "Setting up agent files..."
cat > package.json << 'PACKAGE_EOF'
{
  "name": "machine-agent",
  "version": "1.0.0",
  "description": "Machine monitoring agent",
  "main": "agent.js",
  "scripts": {
    "start": "node agent.js"
  },
  "dependencies": {
    "systeminformation": "^5.21.0",
    "node-fetch": "^2.7.0"
  }
}
PACKAGE_EOF

# Download or copy agent.js
if [ -f "/home/parteek/Documents/machineSite/agent.js" ]; then
    echo "Copying agent.js from source..."
    cp /home/parteek/Documents/machineSite/agent.js ./agent.js
else
    echo "❌ agent.js not found in source directory!"
    exit 1
fi

# Install dependencies
echo "Installing dependencies..."
npm install --production

# Create systemd service
echo "Creating systemd service..."
sudo tee /etc/systemd/system/machine-agent.service > /dev/null << SERVICE_EOF
[Unit]
Description=Machine Monitoring Agent - $MACHINE_ID
After=network.target

[Service]
Type=simple
User=$USER
WorkingDirectory=$INSTALL_DIR
Environment="SERVER_URL=$SERVER_URL"
Environment="MACHINE_ID=$MACHINE_ID"
Environment="DISPLAY_NAME=$DISPLAY_NAME"
Environment="INTERVAL=2000"
ExecStart=$(which node) $INSTALL_DIR/agent.js
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
SERVICE_EOF

# Enable and start service
echo "Enabling and starting service..."
sudo systemctl daemon-reload
sudo systemctl enable machine-agent
sudo systemctl start machine-agent

# Check status
echo ""
echo "========================================="
echo "✓ Installation complete!"
echo "========================================="
echo ""
echo "Service status:"
sudo systemctl status machine-agent --no-pager -l | head -15
echo ""
echo "Useful commands:"
echo "  View logs:    sudo journalctl -u machine-agent -f"
echo "  Stop agent:   sudo systemctl stop machine-agent"
echo "  Start agent:  sudo systemctl start machine-agent"
echo "  Restart:      sudo systemctl restart machine-agent"
echo "  Status:       sudo systemctl status machine-agent"
echo ""
echo "Agent is now sending metrics to: $SERVER_URL"
echo "Machine ID: $MACHINE_ID"
echo ""
