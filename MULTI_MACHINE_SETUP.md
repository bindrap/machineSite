# Multi-Machine Monitoring Setup Guide

This guide will help you set up monitoring for multiple machines, including frodo at 100.68.134.68.

## Overview

The system now supports monitoring multiple machines from a single dashboard:
- **Central Server**: Runs the main web app and stores metrics for all machines
- **Agents**: Run on remote machines (like frodo) and send metrics to the central server

## Step 1: Update the Central Server

The central server has been updated to support multiple machines. The changes include:
- New database schema with `machine_id` support
- API endpoints for machine registration and metrics submission
- Machine selector dropdown in the UI
- Updated metrics aggregation for multiple machines

### Start the Central Server

```bash
# Build and start the server
docker-compose down
docker-compose build
docker-compose up -d

# Check logs
docker-compose logs -f
```

The server will:
1. Run migrations to add the `machines` table and `machine_id` columns
2. Register itself as "localhost" machine
3. Start collecting metrics for the local machine

## Step 2: Set Up the Agent on Frodo

### Option A: Direct Node.js Execution

1. **Copy the agent to frodo:**
   ```bash
   scp agent.js your-user@100.68.134.68:/home/your-user/
   ```

2. **Install dependencies on frodo:**
   ```bash
   ssh your-user@100.68.134.68
   npm install systeminformation
   ```

3. **Run the agent:**
   ```bash
   # Replace YOUR_SERVER_IP with the IP of your central server
   node agent.js \
     --server http://YOUR_SERVER_IP:3005 \
     --machine-id frodo \
     --display-name "Frodo"
   ```

### Option B: Run as a Systemd Service (Recommended)

1. **Create the service file on frodo:**
   ```bash
   ssh your-user@100.68.134.68
   sudo nano /etc/systemd/system/machine-agent.service
   ```

2. **Add the following content** (update paths and IP):
   ```ini
   [Unit]
   Description=Machine Monitoring Agent
   After=network.target

   [Service]
   Type=simple
   User=your-user
   WorkingDirectory=/home/your-user
   Environment="SERVER_URL=http://YOUR_SERVER_IP:3005"
   Environment="MACHINE_ID=frodo"
   Environment="DISPLAY_NAME=Frodo"
   ExecStart=/usr/bin/node /home/your-user/agent.js
   Restart=always
   RestartSec=10

   [Install]
   WantedBy=multi-user.target
   ```

3. **Enable and start the service:**
   ```bash
   sudo systemctl daemon-reload
   sudo systemctl enable machine-agent
   sudo systemctl start machine-agent
   sudo systemctl status machine-agent
   ```

4. **Check logs:**
   ```bash
   sudo journalctl -u machine-agent -f
   ```

   You should see:
   ```
   Starting agent for machine: frodo
   Display name: Frodo
   Server: http://YOUR_SERVER_IP:3005
   Agent started, collecting metrics...
   Submitted 30 metrics to server
   ```

### Option C: Using PM2

```bash
ssh your-user@100.68.134.68

# Install PM2 globally
npm install -g pm2

# Start the agent
pm2 start agent.js --name machine-agent -- \
  --server http://YOUR_SERVER_IP:3005 \
  --machine-id frodo \
  --display-name "Frodo"

# Save PM2 configuration
pm2 save

# Setup PM2 to start on boot
pm2 startup
```

## Step 3: Verify the Setup

1. **Check the machines list:**
   ```bash
   curl http://YOUR_SERVER_IP:3005/api/machines
   ```

   You should see both machines:
   ```json
   {
     "machines": [
       {
         "machine_id": "localhost",
         "hostname": "your-server",
         "display_name": "Primary Server",
         ...
       },
       {
         "machine_id": "frodo",
         "hostname": "frodo",
         "display_name": "Frodo",
         ...
       }
     ]
   }
   ```

2. **Open the web dashboard:**
   - Navigate to `http://YOUR_SERVER_IP:3005`
   - You should see a machine selector dropdown in the top-right
   - Select "Frodo" to view its metrics

## How It Works

### Central Server
- Listens on port 3000
- Provides web dashboard
- Accepts metrics from remote agents via `/api/machines/:machine_id/metrics`
- Stores all metrics in a SQLite database with `machine_id` column

### Agent
- Collects system metrics every 2 seconds (configurable)
- Batches metrics (default 30 per batch)
- Sends batched metrics to central server every 30 seconds
- Automatically registers the machine on first connection
- Handles reconnection if server is temporarily unavailable

### Data Flow
```
[Frodo Agent] --HTTP POST--> [Central Server] --> [SQLite Database]
                                      |
                                      v
                              [Web Dashboard]
```

## Troubleshooting

### Agent can't connect to server

**Problem:** Agent logs show connection errors

**Solutions:**
1. Verify the server URL is correct and accessible from frodo
2. Check firewall rules:
   ```bash
   # On the server
   sudo ufw allow 3000/tcp
   ```
3. Test connectivity:
   ```bash
   # From frodo
   curl http://YOUR_SERVER_IP:3005/api/machines
   ```

### Frodo not appearing in machine selector

**Problem:** Machine selector only shows "localhost"

**Solutions:**
1. Check that the agent is running on frodo:
   ```bash
   ssh your-user@100.68.134.68
   sudo systemctl status machine-agent
   ```
2. Check agent logs for errors:
   ```bash
   sudo journalctl -u machine-agent -f
   ```
3. Verify the machine is registered:
   ```bash
   curl http://YOUR_SERVER_IP:3005/api/machines
   ```

### No metrics showing for frodo

**Problem:** Machine appears in selector but no data

**Solutions:**
1. Check database stats for frodo:
   ```bash
   curl "http://YOUR_SERVER_IP:3005/api/data/stats?machine_id=frodo"
   ```
2. Check server logs:
   ```bash
   docker-compose logs -f
   ```
3. Verify agent is sending metrics:
   ```bash
   sudo journalctl -u machine-agent -n 50
   ```

### Historical data not showing

**Problem:** Live metrics work but historical graphs are empty

**Solution:** Wait for data to accumulate (minimum 2-3 minutes) or check that aggregation jobs are running:
```bash
docker-compose logs | grep "aggregation"
```

## Adding More Machines

To monitor additional machines, simply:

1. Copy `agent.js` to the new machine
2. Install dependencies: `npm install systeminformation`
3. Run with a unique `machine-id`:
   ```bash
   node agent.js \
     --server http://YOUR_SERVER_IP:3005 \
     --machine-id my-new-machine \
     --display-name "My New Machine"
   ```

The machine will automatically register and appear in the dropdown!

## Configuration Reference

### Server Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `MACHINE_ID` | ID for the local machine | hostname |
| `MACHINE_DISPLAY_NAME` | Display name for local machine | hostname |
| `PORT` | Server port | 3000 |
| `ENABLE_POWER_CONTROLS` | Enable shutdown/reboot | false |
| `DB_PATH` | Database path | /app/data/metrics.db |

### Agent Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `SERVER_URL` | Central server URL | (required) |
| `MACHINE_ID` | Unique machine identifier | hostname |
| `DISPLAY_NAME` | Human-readable name | hostname |
| `INTERVAL` | Collection interval (ms) | 2000 |
| `BATCH_SIZE` | Metrics per batch | 30 |

## Next Steps

- Add more machines by deploying the agent
- Customize display names in the UI
- Set up alerts based on metrics (future feature)
- Export historical data to CSV for analysis
