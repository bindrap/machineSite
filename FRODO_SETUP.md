# Setting Up Frodo Agent

This guide explains how to set up the monitoring agent on the "frodo" machine to send metrics to the legolas server.

## Quick Setup (Automated)

On the **frodo** machine, run:

```bash
# Copy the setup script and agent.js to frodo machine
# Then run:
bash setup-frodo-agent.sh
```

## Manual Setup

If you prefer to set it up manually or the automated script doesn't work:

### 1. Copy Files to Frodo

Copy these files from legolas to frodo:
- `agent.js`
- `package.json` (or create it manually)

### 2. Install Dependencies

On frodo machine:

```bash
mkdir -p ~/machine-agent
cd ~/machine-agent

# Create package.json
cat > package.json << 'EOF'
{
  "name": "machine-agent",
  "version": "1.0.0",
  "dependencies": {
    "systeminformation": "^5.21.0",
    "node-fetch": "^2.7.0"
  }
}
EOF

# Copy agent.js here
cp /path/to/agent.js ./agent.js

# Install dependencies
npm install --production
```

### 3. Run the Agent

#### Option A: Run Directly (For Testing)

```bash
node agent.js \
  --server http://100.115.59.14:3005 \
  --machine-id frodo \
  --display-name "Frodo (Remote Machine)"
```

#### Option B: Run as Systemd Service (Recommended)

```bash
# Create service file
sudo nano /etc/systemd/system/machine-agent.service
```

Paste this content:

```ini
[Unit]
Description=Machine Monitoring Agent - frodo
After=network.target

[Service]
Type=simple
User=YOUR_USERNAME
WorkingDirectory=/home/YOUR_USERNAME/machine-agent
Environment="SERVER_URL=http://100.115.59.14:3005"
Environment="MACHINE_ID=frodo"
Environment="DISPLAY_NAME=Frodo (Remote Machine)"
Environment="INTERVAL=2000"
ExecStart=/usr/bin/node /home/YOUR_USERNAME/machine-agent/agent.js
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

Then:

```bash
sudo systemctl daemon-reload
sudo systemctl enable machine-agent
sudo systemctl start machine-agent
sudo systemctl status machine-agent
```

### 4. Verify It's Working

On **legolas** server:

```bash
# Check if frodo is registered
curl http://localhost:3005/api/machines | python3 -m json.tool

# Check if frodo is sending metrics
sqlite3 ~/Documents/machineSite/data/metrics.db \
  "SELECT COUNT(*) FROM metrics_raw WHERE machine_id='frodo' AND timestamp > $(date -d '5 minutes ago' +%s)000;"
```

On the **webpage** (http://100.115.59.14:3005):
- Frodo should appear in the machine dropdown
- Selecting frodo should show its metrics

## Troubleshooting

### Agent won't start
```bash
# Check logs
sudo journalctl -u machine-agent -f
```

### No data showing on dashboard
1. Check agent is running: `sudo systemctl status machine-agent`
2. Check network connectivity: `ping 100.115.59.14`
3. Test API endpoint: `curl http://100.115.59.14:3005/api/machines`
4. Check agent logs: `sudo journalctl -u machine-agent -n 50`

### GPU metrics not showing
Install GPU monitoring tools:
- NVIDIA: Install `nvtop`
- AMD: Install `radeontop`

```bash
# For AMD GPUs
sudo apt install radeontop

# For NVIDIA GPUs
sudo apt install nvtop
```

## Environment Variables

You can customize the agent behavior with these environment variables:

- `SERVER_URL`: URL of the legolas server (default: none, required)
- `MACHINE_ID`: Unique machine identifier (default: hostname)
- `DISPLAY_NAME`: Human-readable name (default: hostname)
- `INTERVAL`: Metrics collection interval in ms (default: 2000)
- `BATCH_SIZE`: Number of metrics to batch before sending (default: 30)

## Logs

View real-time logs:
```bash
sudo journalctl -u machine-agent -f
```

View last 100 lines:
```bash
sudo journalctl -u machine-agent -n 100
```
