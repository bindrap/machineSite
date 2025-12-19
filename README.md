# Machine Monitoring Dashboard

Futuristic, real-time multi-machine monitoring dashboard with centralized metrics collection and WebSocket-based live updates.

## Features

- 🖥️ **Multi-Machine Monitoring**: Monitor multiple machines from a single dashboard
- 📊 **Real-time Metrics**: Live updates every 2 seconds via WebSocket
- 📈 **Historical Data**: Automatic aggregation (hourly/daily) with configurable retention
- 🎨 **Beautiful UI**: Futuristic design with interactive charts and graphs
- 🔄 **Agent-Based**: Lightweight agents send metrics to central server
- 💾 **SQLite Storage**: Efficient local storage with automatic cleanup
- 🎯 **Machine Selector**: Easy switching between monitored machines
- 📡 **System Metrics**: CPU, RAM, GPU, Network, Temperature monitoring
- 🔌 **Optional Power Controls**: Remote shutdown/reboot capabilities

## Architecture

- **Primary Server (Legolas)**: Runs the web dashboard and database, collects its own metrics
- **Remote Agents**: Lightweight Node.js agents running on monitored machines
- **Communication**: Agents send batched metrics via HTTP POST
- **Storage**: SQLite database with automatic aggregation and retention

## Quick Start

### 1. Start the Primary Server

```bash
docker compose up -d
```

The dashboard is now available at:
- http://localhost:3005
- http://100.115.59.14:3005 (Tailscale)

### 2. Deploy Agents to Remote Machines

See `QUICKSTART.md` for detailed agent deployment instructions.

**Current Setup:**
- **Primary**: Legolas (100.115.59.14)
- **Agents**: Frodo (100.68.134.68), Sauron (100.87.129.118), Gandalf (100.92.136.93)

## Dashboard Usage

1. Open http://localhost:3005 in your browser
2. Use the **machine selector dropdown** (top-right) to switch between machines
3. View real-time metrics updating every 2 seconds
4. Zoom/pan on charts to explore historical data
5. Monitor system info, processes, and events

## Environment Variables

### Server (docker-compose.yml)
- `MACHINE_ID`: Unique identifier for this machine (default: hostname)
- `MACHINE_DISPLAY_NAME`: Human-readable name shown in UI
- `MACHINE_BIRTHDATE`: ISO date for machine age calculation
- `ENABLE_POWER_CONTROLS`: Enable shutdown/reboot endpoints (default: false)
- `DB_PATH`: SQLite database path (default: /app/data/metrics.db)
- `RETENTION_DAYS_RAW`: Keep raw metrics for N days (default: 7)
- `RETENTION_DAYS_HOURLY`: Keep hourly aggregates for N days (default: 90)
- `RETENTION_DAYS_DAILY`: Keep daily aggregates for N days (default: 0 = unlimited)

### Agent (agent.js)
- `SERVER_URL`: Central server URL (required)
- `MACHINE_ID`: Unique machine identifier
- `DISPLAY_NAME`: Display name in dashboard
- `INTERVAL`: Metric collection interval in ms (default: 2000)
- `BATCH_SIZE`: Metrics per batch before sending (default: 30)

## API Endpoints

### Machines
- `GET /api/machines` - List all registered machines
- `GET /api/machines/:id` - Get specific machine info
- `POST /api/machines/:id/metrics` - Submit metrics (used by agents)

### Metrics
- `GET /api/data/metrics?machine_id=X&start=Y&end=Z` - Query metrics
- `GET /api/data/stats?machine_id=X` - Database statistics
- `GET /api/data/export?machine_id=X&format=csv` - Export data

### System Info
- `GET /api/info` - Current machine system information
- `GET /api/processes` - Top processes by CPU usage

### Power Controls (if enabled)
- `POST /api/power/shutdown` - Shutdown machine
- `POST /api/power/reboot` - Reboot machine

## File Structure

```
machineSite/
├── server/
│   ├── index.js              # Main server
│   ├── db.js                 # Database layer
│   ├── metrics-writer.js     # Batched metrics writer
│   ├── aggregator.js         # Hourly/daily aggregation
│   ├── migrations/           # Database migrations
│   └── routes/               # API routes
├── public/
│   └── index.html            # Dashboard UI
├── agent.js                  # Remote agent script
├── docker-compose.yml        # Docker configuration
├── Dockerfile               # Container build
├── QUICKSTART.md            # Setup guide
└── MULTI_MACHINE_SETUP.md   # Detailed agent setup

## Data Retention & Cleanup

Metrics are automatically aggregated and cleaned up:

1. **Raw metrics** (2-sec intervals): Kept for 7 days, then deleted
2. **Hourly aggregates**: Computed at :05 past each hour, kept for 90 days
3. **Daily aggregates**: Computed at 00:10 daily, kept forever
4. **Cleanup**: Runs daily at 02:00 AM

## Troubleshooting

### Dashboard not loading
```bash
docker compose logs -f
docker compose restart
```

### Agent not sending data
```bash
# On remote machine
sudo systemctl status machine-agent
sudo journalctl -u machine-agent -f
```

### No metrics showing for a machine
```bash
curl http://localhost:3005/api/machines
curl "http://localhost:3005/api/data/stats?machine_id=frodo"
```

## Development

```bash
npm install
npm run dev  # Start with nodemon
```

Then visit http://localhost:3005

## Documentation

- `QUICKSTART.md` - Quick setup guide
- `MULTI_MACHINE_SETUP.md` - Detailed multi-machine setup
- `AGENT_README.md` - Agent configuration and deployment

## Tech Stack

- **Backend**: Node.js, Express, SQLite (better-sqlite3)
- **Frontend**: Vanilla JS, Chart.js, WebSocket
- **Monitoring**: systeminformation, nvtop, radeontop
- **Deployment**: Docker, systemd

## License

MIT
