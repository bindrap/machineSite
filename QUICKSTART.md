# Quick Start Guide - Multi-Machine Monitoring on Legolas

## System Overview

You now have a fully functional multi-machine monitoring system running on **Legolas** (your primary server at `100.115.59.14`).

### Architecture
- **Primary Server (Legolas)**: Runs the web dashboard and collects metrics from itself and remote agents
- **Agents (Frodo, Sauron, Gandalf)**: Run on remote machines and send metrics to the primary server

## What's Fixed

✅ Database migration error resolved
✅ `machine_id` column properly added to all tables
✅ Docker container configured for Legolas
✅ Multi-machine support verified
✅ Agent setup scripts created

## Access Your Dashboard

The dashboard is now running at:
- **Local**: http://localhost:3005
- **Network**: http://100.115.59.14:3005 (via Tailscale)
- **LAN**: http://192.168.1.138:3005 (if on same network)

## Setting Up Agents on Frodo, Sauron, and Gandalf

### Quick Setup (All Machines at Once)

```bash
cd ~/Documents/machineSite
./setup-agents.sh
```

This will automatically set up agents on all three machines (frodo, sauron, gandalf).

### Setup Individual Machines

```bash
cd ~/Documents/machineSite

# Setup just frodo
./setup-agents.sh frodo

# Setup sauron and gandalf
./setup-agents.sh sauron gandalf
```

### What the Setup Script Does

1. Copies `agent.js` to the remote machine
2. Installs `systeminformation` npm package
3. Creates a systemd service that:
   - Starts automatically on boot
   - Restarts automatically if it crashes
   - Collects metrics every 2 seconds
   - Sends batched metrics to Legolas
4. Starts the service immediately

### Machine IPs (Tailscale)

- **Legolas**: 100.115.59.14 (Primary Server)
- **Frodo**: 100.68.134.68
- **Sauron**: 100.87.129.118
- **Gandalf**: 100.92.136.93

## Verifying Everything Works

### 1. Check Docker Container Status

```bash
cd ~/Documents/machineSite
docker compose ps
docker compose logs -f
```

You should see:
```
Migration applied: 001-initial.sql
Migration applied: 002-add-machines.sql
Database initialized at /app/data/metrics.db
Machine dashboard running on http://localhost:3005
```

### 2. Check Registered Machines

```bash
curl http://localhost:3005/api/machines
```

You should see all registered machines (legolas, and any agents you've set up).

### 3. Check Agent Status on Remote Machines

```bash
# On frodo
ssh parteek@100.68.134.68 'sudo systemctl status machine-agent'

# On sauron
ssh parteek@100.87.129.118 'sudo systemctl status machine-agent'

# On gandalf
ssh parteek@100.92.136.93 'sudo systemctl status machine-agent'
```

### 4. View Agent Logs

```bash
# Real-time logs from frodo
ssh parteek@100.68.134.68 'sudo journalctl -u machine-agent -f'
```

Look for messages like:
```
Submitted 30 metrics to server
```

### 5. Access the Web Dashboard

Open http://localhost:3005 (or http://100.115.59.14:3005 from another machine)

You should see:
- A dropdown in the top-right corner to select different machines
- Real-time metrics graphs (CPU, RAM, GPU, Network)
- Machine information (OS, uptime, hardware specs)
- Process list

## Dashboard Features

The web UI includes:

1. **Machine Selector**: Dropdown in top-right to switch between machines
2. **Real-time Metrics**: Updated every 2 seconds
   - CPU load and temperature
   - RAM usage
   - GPU utilization and temperature
   - Network throughput
3. **Historical Graphs**: Zoom and pan to explore historical data
4. **Machine Info**:
   - OS details
   - CPU and GPU specs
   - Memory totals
   - Uptime and machine age
5. **Process Monitor**: Top 10 processes by CPU usage
6. **System Events**: Track important system events

## Managing the System

### Restart the Primary Server

```bash
cd ~/Documents/machineSite
docker compose restart
```

### Rebuild After Code Changes

```bash
cd ~/Documents/machineSite
docker compose build --no-cache
docker compose up -d
```

### Stop Everything

```bash
cd ~/Documents/machineSite
docker compose down
```

### Restart an Agent

```bash
ssh parteek@MACHINE_IP 'sudo systemctl restart machine-agent'
```

### Stop an Agent

```bash
ssh parteek@MACHINE_IP 'sudo systemctl stop machine-agent'
```

### Remove an Agent

```bash
ssh parteek@MACHINE_IP 'sudo systemctl stop machine-agent && sudo systemctl disable machine-agent && sudo rm /etc/systemd/system/machine-agent.service'
```

## Data Retention

Current settings (configured in docker-compose.yml):
- **Raw metrics** (2-second intervals): 7 days
- **Hourly aggregates**: 90 days
- **Daily aggregates**: Unlimited

Database is stored in: `~/Documents/machineSite/data/metrics.db`

## Troubleshooting

### Agent can't connect to server

1. Check firewall on Legolas:
   ```bash
   sudo ufw status
   sudo ufw allow 3000/tcp
   ```

2. Verify the server is accessible:
   ```bash
   # From the agent machine
   curl http://100.115.59.14:3005/api/machines
   ```

3. Check Tailscale connectivity:
   ```bash
   ping 100.115.59.14
   ```

### No metrics showing for a machine

1. Check if agent is running:
   ```bash
   ssh parteek@MACHINE_IP 'sudo systemctl status machine-agent'
   ```

2. View agent logs for errors:
   ```bash
   ssh parteek@MACHINE_IP 'sudo journalctl -u machine-agent -n 50'
   ```

3. Verify machine is registered:
   ```bash
   curl http://localhost:3005/api/machines
   ```

### Dashboard shows "localhost" instead of machine names

This is normal - "localhost" is the default machine created by the migration. You can ignore it or remove it from the database.

### Database is getting large

Run cleanup manually:
```bash
docker compose exec machine-site node -e "
const { getDatabase } = require('./server/db');
const db = getDatabase();
db.cleanup();
"
```

Cleanup runs automatically at 2:00 AM daily.

## Next Steps

1. **Enable Power Controls** (shutdown/reboot from dashboard):
   Edit `docker-compose.yml` and set `ENABLE_POWER_CONTROLS=true`, then rebuild.

2. **Customize Display Names**:
   Edit environment variables in the agent setup script or docker-compose.yml

3. **Add More Machines**:
   Just add them to the `MACHINES` array in `setup-agents.sh` and run the script

4. **Export Historical Data**:
   API endpoint: `GET /api/data/export?machine_id=frodo&format=csv`

5. **Set Custom Machine Birthdate**:
   Edit `MACHINE_BIRTHDATE` in docker-compose.yml for each machine

## Support

For more detailed information, see:
- `MULTI_MACHINE_SETUP.md` - Detailed multi-machine setup guide
- `AGENT_README.md` - Agent configuration and usage
- `README.md` - General project information

## Summary

✅ Your system is now running!
✅ Web dashboard: http://localhost:3005
✅ To add agents: `./setup-agents.sh`
✅ Check status: `docker compose ps`

Enjoy monitoring your machines! 🚀
