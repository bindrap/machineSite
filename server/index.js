const path = require('path');
const os = require('os');
const http = require('http');
const express = require('express');
const compression = require('compression');
const { exec } = require('child_process');
const WebSocket = require('ws');
const si = require('systeminformation');

const app = express();
const port = process.env.PORT || 3000;
const powerControlsEnabled = String(process.env.ENABLE_POWER_CONTROLS || '').toLowerCase() === 'true';

app.use(compression());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: '/ws/metrics' });

const birthdateSource = resolveBirthdate();

app.get('/api/info', async (_req, res) => {
  try {
    const [osInfo, system, time, mem, graphics, cpu, battery, cpuTemp] = await Promise.all([
      si.osInfo(),
      si.system(),
      si.time(),
      si.mem(),
      si.graphics(),
      si.cpu(),
      si.battery().catch(() => null),
      si.cpuTemperature().catch(() => null),
    ]);

    const uptimeSeconds = time.uptime;
    const uptimeHuman = formatDuration(uptimeSeconds);

    const machineBirthdate = birthdateSource
      ? {
          iso: birthdateSource.toISOString(),
          human: formatDuration((Date.now() - birthdateSource.getTime()) / 1000),
        }
      : null;

    res.json({
      os: `${osInfo.distro} ${osInfo.release} (${osInfo.kernel})`,
      arch: os.arch(),
      hostname: os.hostname(),
      cpu: {
        model: cpu.brand,
        cores: cpu.cores,
        speedGHz: cpu.speed,
      },
      gpu: (graphics.controllers || []).map((gpu) => ({
        model: gpu.model,
        vramMB: gpu.vram || null,
        utilization: gpu.utilizationGpu || null,
        temperature: gpu.temperatureGpu || null,
      })),
      memory: {
        total: mem.total,
        free: mem.free,
        used: mem.active,
      },
      uptimeSeconds,
      uptimeHuman,
      currentTime: new Date(time.current).toISOString(),
      timezone: time.timezoneName || time.timezone,
      machineAge: machineBirthdate,
      powerControlsEnabled,
      system: {
        manufacturer: system.manufacturer,
        model: system.model,
        serial: system.serial,
      },
      battery: battery
        ? {
            percent: battery.percent,
            health: battery.health || null,
            isCharging: battery.ischarging,
            remainingMinutes: battery.timeremaining,
          }
        : null,
      temperatures: {
        cpu: cpuTemp?.main || null,
        gpu: (graphics.controllers || [])[0]?.temperatureGpu || null,
      },
    });
  } catch (err) {
    console.error('Failed to get info', err);
    res.status(500).json({ error: 'Failed to collect system info' });
  }
});

app.post('/api/power/shutdown', async (_req, res) => {
  if (!powerControlsEnabled) {
    return res.status(403).json({ error: 'Power controls are disabled. Set ENABLE_POWER_CONTROLS=true to allow.' });
  }

  try {
    await runPowerCommand('shutdown');
    res.status(202).json({ status: 'shutdown initiated' });
  } catch (err) {
    console.error('Shutdown failed', err);
    res.status(500).json({ error: 'Failed to trigger shutdown', details: err.message });
  }
});

app.post('/api/power/reboot', async (_req, res) => {
  if (!powerControlsEnabled) {
    return res.status(403).json({ error: 'Power controls are disabled. Set ENABLE_POWER_CONTROLS=true to allow.' });
  }

  try {
    await runPowerCommand('reboot');
    res.status(202).json({ status: 'reboot initiated' });
  } catch (err) {
    console.error('Reboot failed', err);
    res.status(500).json({ error: 'Failed to trigger reboot', details: err.message });
  }
});

// Fallback to index.html for SPA-style routing.
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

wss.on('connection', (ws) => {
  let alive = true;
  ws.on('pong', () => {
    alive = true;
  });

  const sendMetrics = async () => {
    try {
      const metrics = await collectMetrics();
      ws.send(JSON.stringify(metrics));
    } catch (err) {
      console.error('Failed to collect metrics', err);
    }
  };

  const interval = setInterval(sendMetrics, 2000);
  sendMetrics();

  ws.on('close', () => clearInterval(interval));
  ws.on('error', () => clearInterval(interval));

  const pingInterval = setInterval(() => {
    if (!alive) {
      ws.terminate();
      clearInterval(pingInterval);
      clearInterval(interval);
      return;
    }
    alive = false;
    ws.ping();
  }, 10000);
});

server.listen(port, () => {
  console.log(`Machine dashboard running on http://localhost:${port}`);
});

function resolveBirthdate() {
  const env = process.env.MACHINE_BIRTHDATE;
  if (env) {
    const date = new Date(env);
    if (!Number.isNaN(date.valueOf())) return date;
  }

  const markerPath = path.join(__dirname, '..', '.machine-birthdate');
  try {
    const raw = require('fs').readFileSync(markerPath, 'utf8').trim();
    const date = new Date(raw);
    if (!Number.isNaN(date.valueOf())) return date;
  } catch (_err) {
    // ignore when file is missing
  }

  return null;
}

function formatDuration(totalSeconds) {
  const seconds = Math.floor(totalSeconds % 60);
  const minutes = Math.floor((totalSeconds / 60) % 60);
  const hours = Math.floor((totalSeconds / 3600) % 24);
  const days = Math.floor(totalSeconds / 86400);
  return [
    days ? `${days}d` : null,
    hours ? `${hours}h` : null,
    minutes ? `${minutes}m` : null,
    `${seconds}s`,
  ]
    .filter(Boolean)
    .join(' ');
}

async function collectMetrics() {
  const [load, mem, networks, graphics, temps] = await Promise.all([
    si.currentLoad(),
    si.mem(),
    si.networkStats(),
    si.graphics(),
    si.cpuTemperature().catch(() => null),
  ]);

  const networkTotals = (networks || []).reduce(
    (acc, nic) => {
      acc.rxSec += nic.rx_sec || 0;
      acc.txSec += nic.tx_sec || 0;
      return acc;
    },
    { rxSec: 0, txSec: 0 },
  );

  const gpu = (graphics.controllers || []).map((controller) => ({
    model: controller.model,
    utilization: controller.utilizationGpu || null,
    temperature: controller.temperatureGpu || null,
  }));

  return {
    timestamp: new Date().toISOString(),
    cpuLoad: load.currentLoad,
    cpuTemp: temps?.main || null,
    memory: {
      total: mem.total,
      used: mem.active,
      free: mem.available,
      usedPercent: (mem.active / mem.total) * 100,
    },
    network: networkTotals,
    gpu,
  };
}

async function runPowerCommand(action) {
  const platform = os.platform();
  let command;

  if (platform === 'win32') {
    command = action === 'shutdown' ? 'shutdown /s /t 0' : 'shutdown /r /t 0';
  } else if (platform === 'darwin') {
    command = action === 'shutdown' ? 'sudo shutdown -h now' : 'sudo shutdown -r now';
  } else {
    command = action === 'shutdown' ? 'shutdown -h now' : 'shutdown -r now';
  }

  return new Promise((resolve, reject) => {
    exec(command, (err, stdout, stderr) => {
      if (err) {
        return reject(err);
      }
      console.log(`${action} command issued`, { stdout, stderr });
      resolve();
    });
  });
}
