# Machine Monitoring Agent

This agent collects system metrics from a remote machine and sends them to the central monitoring server.

## Installation on Remote Machine (e.g., frodo)

1. Copy `agent.js` to the remote machine
2. Install dependencies:
   ```bash
   npm install systeminformation
   ```

## Usage

### Basic Usage

```bash
node agent.js --server http://YOUR_SERVER_IP:3000 --machine-id frodo
```

### With Custom Display Name

```bash
node agent.js \
  --server http://100.68.134.68:3000 \
  --machine-id frodo \
  --display-name "Frodo (Gaming PC)"
```

### Using Environment Variables

```bash
export SERVER_URL=http://100.68.134.68:3000
export MACHINE_ID=frodo
export DISPLAY_NAME="Frodo"
node agent.js
```

## Configuration Options

| Option | Environment Variable | Default | Description |
|--------|---------------------|---------|-------------|
| `--server` | `SERVER_URL` | (required) | URL of the central monitoring server |
| `--machine-id` | `MACHINE_ID` | hostname | Unique identifier for this machine |
| `--display-name` | `DISPLAY_NAME` | hostname | Human-readable name |
| `--interval` | `INTERVAL` | 2000 | Collection interval in milliseconds |
| `--batch-size` | `BATCH_SIZE` | 30 | Number of metrics to batch before sending |

## Running as a Service

### Using systemd (Linux)

Create `/etc/systemd/system/machine-agent.service`:

```ini
[Unit]
Description=Machine Monitoring Agent
After=network.target

[Service]
Type=simple
User=your-user
WorkingDirectory=/path/to/machineSite
Environment="SERVER_URL=http://100.68.134.68:3000"
Environment="MACHINE_ID=frodo"
Environment="DISPLAY_NAME=Frodo"
ExecStart=/usr/bin/node /path/to/machineSite/agent.js
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

Then enable and start:

```bash
sudo systemctl daemon-reload
sudo systemctl enable machine-agent
sudo systemctl start machine-agent
sudo systemctl status machine-agent
```

### Using PM2

```bash
pm2 start agent.js --name machine-agent -- \
  --server http://100.68.134.68:3000 \
  --machine-id frodo \
  --display-name "Frodo"

pm2 save
pm2 startup
```

## Verifying Connection

Check the agent logs to ensure it's connecting:

```bash
# If using systemd
sudo journalctl -u machine-agent -f

# If using PM2
pm2 logs machine-agent
```

You should see messages like:
```
Starting agent for machine: frodo
Display name: Frodo
Server: http://100.68.134.68:3000
Collection interval: 2000ms
Agent started, collecting metrics...
Submitted 30 metrics to server
```

## Troubleshooting

### Agent can't connect to server

- Ensure the server URL is correct and accessible from the remote machine
- Check firewall rules allow connections to port 3000
- Verify the server is running: `curl http://YOUR_SERVER_IP:3000/api/machines`

### No metrics appearing

- Check agent logs for errors
- Verify the machine is registered: `curl http://YOUR_SERVER_IP:3000/api/machines`
- Check server logs for errors

### Permission denied errors

- GPU monitoring (nvtop, radeontop) may require additional permissions
- Run as a user with appropriate access or adjust permissions
