const path = require('path');
const os = require('os');
const fs = require('fs');
const http = require('http');
const express = require('express');
const compression = require('compression');
const { exec } = require('child_process');
const WebSocket = require('ws');
const si = require('systeminformation');
const { getDatabase } = require('./db');
const { MetricsWriter } = require('./metrics-writer');
const { MetricsAggregator } = require('./aggregator');

const app = express();
const port = process.env.PORT || 3000;
const powerControlsEnabled = String(process.env.ENABLE_POWER_CONTROLS || '').toLowerCase() === 'true';
const machineId = process.env.MACHINE_ID || os.hostname() || 'localhost';

app.use(compression());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: '/ws/metrics' });

const birthdateSource = resolveBirthdate();

// Initialize database and workers
const db = getDatabase();
const metricsWriter = new MetricsWriter();
const aggregator = new MetricsAggregator();

// Register this machine in the database
db.upsertMachine({
  machine_id: machineId,
  hostname: os.hostname(),
  display_name: process.env.MACHINE_DISPLAY_NAME || os.hostname(),
  ip_address: null, // Will be populated from network info
  last_seen: Date.now()
});

// Start metrics writer and aggregator
metricsWriter.start();
aggregator.start();

console.log(`Database and workers initialized for machine: ${machineId}`);

async function getNvtopInfo() {
  try {
    return await new Promise((resolve, reject) => {
      exec('nvtop --once --no-color 2>/dev/null', { timeout: 3000 }, (err, stdout, stderr) => {
        if (err) {
          return resolve(null);
        }

        // Parse nvtop output
        const gpuData = {};
        const lines = stdout.split('\n');

        for (const line of lines) {
          // Extract GPU utilization, memory, temperature, etc.
          if (line.includes('GPU')) {
            const utilMatch = line.match(/(\d+)%/);
            if (utilMatch) gpuData.utilization = parseInt(utilMatch[1]);
          }
          if (line.includes('MEM')) {
            const memMatch = line.match(/(\d+)MiB\s*\/\s*(\d+)MiB/);
            if (memMatch) {
              gpuData.memUsedMB = parseInt(memMatch[1]);
              gpuData.memTotalMB = parseInt(memMatch[2]);
            }
          }
          if (line.includes('Temp')) {
            const tempMatch = line.match(/(\d+)°C/);
            if (tempMatch) gpuData.temperature = parseInt(tempMatch[1]);
          }
          if (line.includes('Power')) {
            const powerMatch = line.match(/(\d+)W\s*\/\s*(\d+)W/);
            if (powerMatch) {
              gpuData.powerUsageW = parseInt(powerMatch[1]);
              gpuData.powerLimitW = parseInt(powerMatch[2]);
            }
          }
          if (line.includes('Fan')) {
            const fanMatch = line.match(/(\d+)%/);
            if (fanMatch) gpuData.fanSpeed = parseInt(fanMatch[1]);
          }
        }

        resolve(Object.keys(gpuData).length > 0 ? gpuData : null);
      });
    });
  } catch (err) {
    console.error('nvtop query failed:', err.message);
    return null;
  }
}

async function getRadeontopInfo() {
  try {
    return await new Promise((resolve, reject) => {
      exec('timeout 2 radeontop -d - -l 1 2>/dev/null', { timeout: 3000 }, (err, stdout, stderr) => {
        if (err) {
          return resolve(null);
        }

        // Parse radeontop output
        const gpuData = {};
        const lines = stdout.split('\n');

        for (const line of lines) {
          // radeontop output format: "gpu 45.67%, ee 12.34%, ..."
          const gpuMatch = line.match(/gpu\s+([\d.]+)%/);
          if (gpuMatch) gpuData.utilization = parseFloat(gpuMatch[1]);

          const vramMatch = line.match(/vram\s+([\d.]+)%\s+([\d.]+)mb/i);
          if (vramMatch) {
            gpuData.vramUtilization = parseFloat(vramMatch[1]);
            gpuData.vramUsedMB = parseFloat(vramMatch[2]);
          }

          const gtMatch = line.match(/gt\s+([\d.]+)%/);
          if (gtMatch) gpuData.graphicsPipe = parseFloat(gtMatch[1]);

          const mclkMatch = line.match(/mclk\s+([\d.]+)%\s+([\d.]+)mhz/i);
          if (mclkMatch) {
            gpuData.memClockUtil = parseFloat(mclkMatch[1]);
            gpuData.memClockMHz = parseFloat(mclkMatch[2]);
          }

          const sclkMatch = line.match(/sclk\s+([\d.]+)%\s+([\d.]+)mhz/i);
          if (sclkMatch) {
            gpuData.coreClockUtil = parseFloat(sclkMatch[1]);
            gpuData.coreClockMHz = parseFloat(sclkMatch[2]);
          }
        }

        resolve(Object.keys(gpuData).length > 0 ? gpuData : null);
      });
    });
  } catch (err) {
    console.error('radeontop query failed:', err.message);
    return null;
  }
}

async function getAmdGpuInfo() {
  const gpus = [];
  try {
    // Check for AMD GPUs in /sys/class/drm/
    const drmPath = '/sys/class/drm';
    if (!fs.existsSync(drmPath)) return gpus;

    const cards = fs.readdirSync(drmPath).filter((f) => /^card\d+$/.test(f) && !f.includes('-'));

    for (const card of cards) {
      const cardPath = path.join(drmPath, card, 'device');

      // Check if it's an AMD GPU
      const vendorPath = path.join(cardPath, 'vendor');
      if (!fs.existsSync(vendorPath)) continue;

      const vendor = fs.readFileSync(vendorPath, 'utf8').trim();
      if (vendor !== '0x1002') continue; // 0x1002 is AMD

      // Get GPU info
      const gpu = { model: 'AMD GPU', vramMB: null, temperature: null, utilization: null };

      // Try to get product name
      try {
        const devicePath = path.join(cardPath, 'device');
        const deviceId = fs.readFileSync(devicePath, 'utf8').trim();
        // Map common AMD device IDs to names
        const deviceMap = {
          '0x164e': 'AMD Radeon RX 7700 XT / 7800 XT',
          '0x164d': 'AMD Radeon RX 7900 XT',
          '0x7448': 'AMD Radeon RX 6800 XT',
        };
        gpu.model = deviceMap[deviceId] || `AMD GPU (${deviceId})`;
      } catch {}

      // Get VRAM size from mem_info_vram_total
      try {
        const vramPath = path.join(cardPath, 'mem_info_vram_total');
        if (fs.existsSync(vramPath)) {
          const vramBytes = parseInt(fs.readFileSync(vramPath, 'utf8').trim());
          gpu.vramMB = Math.round(vramBytes / (1024 * 1024));
        }
      } catch {}

      // Get temperature from hwmon
      try {
        const hwmonPath = path.join(cardPath, 'hwmon');
        if (fs.existsSync(hwmonPath)) {
          const hwmons = fs.readdirSync(hwmonPath);
          if (hwmons.length > 0) {
            const tempPath = path.join(hwmonPath, hwmons[0], 'temp1_input');
            if (fs.existsSync(tempPath)) {
              const tempMilliC = parseInt(fs.readFileSync(tempPath, 'utf8').trim());
              gpu.temperature = tempMilliC / 1000;
            }
          }
        }
      } catch {}

      // Get GPU utilization
      try {
        const utilPath = path.join(cardPath, 'gpu_busy_percent');
        if (fs.existsSync(utilPath)) {
          gpu.utilization = parseInt(fs.readFileSync(utilPath, 'utf8').trim());
        }
      } catch {}

      gpus.push(gpu);
    }
  } catch (err) {
    console.error('AMD GPU detection failed:', err.message);
  }
  return gpus;
}

app.get('/api/info', async (_req, res) => {
  try {
    const [osInfo, system, time, mem, graphics, cpu, battery, cpuTemp, fsSize, amdGpus, versions, networkInterfaces, currentLoad, nvtopData, radeontopData, cpuCurrentSpeed, diskIO, networkStats] = await Promise.all([
      si.osInfo(),
      si.system(),
      si.time(),
      si.mem(),
      si.graphics(),
      si.cpu(),
      si.battery().catch(() => null),
      si.cpuTemperature().catch(() => null),
      si.fsSize().catch(() => []),
      getAmdGpuInfo(),
      si.versions().catch(() => null),
      si.networkInterfaces().catch(() => []),
      si.currentLoad().catch(() => null),
      getNvtopInfo(),
      getRadeontopInfo(),
      si.cpuCurrentSpeed().catch(() => null),
      si.disksIO().catch(() => null),
      si.networkStats().catch(() => []),
    ]);

    const uptimeSeconds = time.uptime;
    const uptimeHuman = formatDuration(uptimeSeconds);

    const machineBirthdate = birthdateSource
      ? {
          iso: birthdateSource.toISOString(),
          human: formatDuration((Date.now() - birthdateSource.getTime()) / 1000),
        }
      : null;

    // Prefer AMD GPU info if available, otherwise fall back to systeminformation
    let gpuInfo = amdGpus.length > 0 ? amdGpus : (graphics.controllers || []).map((gpu) => ({
      model: gpu.model,
      vramMB: gpu.vram || null,
      utilization: gpu.utilizationGpu || null,
      temperature: gpu.temperatureGpu || null,
    }));

    // Enhance GPU info with nvtop data (for NVIDIA GPUs)
    if (nvtopData && gpuInfo.length > 0) {
      gpuInfo[0].nvtop = nvtopData;
      if (nvtopData.utilization != null) gpuInfo[0].utilization = nvtopData.utilization;
      if (nvtopData.temperature != null) gpuInfo[0].temperature = nvtopData.temperature;
    }

    // Enhance GPU info with radeontop data (for AMD GPUs)
    if (radeontopData && gpuInfo.length > 0) {
      gpuInfo[0].radeontop = radeontopData;
      if (radeontopData.utilization != null) gpuInfo[0].utilization = radeontopData.utilization;
    }

    res.json({
      os: `${osInfo.distro} ${osInfo.release} (${osInfo.kernel})`,
      arch: os.arch(),
      hostname: os.hostname(),
      cpu: {
        model: cpu.brand,
        cores: cpu.cores,
        physicalCores: cpu.physicalCores,
        processors: cpu.processors,
        speedGHz: cpu.speed,
        speedMin: cpu.speedmin,
        speedMax: cpu.speedmax,
        vendor: cpu.vendor,
        family: cpu.family,
        cache: cpu.cache,
        currentSpeed: cpuCurrentSpeed ? {
          avg: cpuCurrentSpeed.avg,
          min: cpuCurrentSpeed.min,
          max: cpuCurrentSpeed.max,
          cores: cpuCurrentSpeed.cores || []
        } : null,
      },
      cpuLoad: currentLoad ? {
        currentLoad: currentLoad.currentLoad,
        currentLoadUser: currentLoad.currentLoadUser,
        currentLoadSystem: currentLoad.currentLoadSystem,
        currentLoadIdle: currentLoad.currentLoadIdle,
        avgLoad: currentLoad.avgload,
        cpus: currentLoad.cpus || [],
      } : null,
      gpu: gpuInfo,
      memory: {
        total: mem.total,
        free: mem.free,
        used: mem.active,
        available: mem.available,
        buffers: mem.buffers,
        cached: mem.cached,
        slab: mem.slab,
        buffcache: mem.buffcache,
        swapTotal: mem.swaptotal,
        swapUsed: mem.swapused,
        swapFree: mem.swapfree,
        usedPercent: (mem.active / mem.total) * 100,
        swapPercent: mem.swaptotal > 0 ? (mem.swapused / mem.swaptotal) * 100 : 0,
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
        uuid: system.uuid,
        sku: system.sku,
        virtual: system.virtual,
      },
      battery: battery
        ? {
            percent: battery.percent,
            health: battery.health || null,
            isCharging: battery.ischarging,
            remainingMinutes: battery.timeremaining,
          }
        : null,
      disk: fsSize && fsSize.length
        ? {
            total: fsSize.reduce((acc, fs) => acc + (fs.size || 0), 0),
            used: fsSize.reduce((acc, fs) => acc + (fs.used || 0), 0),
            available: fsSize.reduce((acc, fs) => acc + (fs.available || 0), 0),
            filesystems: fsSize.map(fs => ({
              fs: fs.fs,
              type: fs.type,
              size: fs.size,
              used: fs.used,
              available: fs.available,
              use: fs.use,
              mount: fs.mount,
            })),
          }
        : null,
      diskIO: diskIO ? {
        rIO: diskIO.rIO,
        wIO: diskIO.wIO,
        tIO: diskIO.tIO,
        rIO_sec: diskIO.rIO_sec,
        wIO_sec: diskIO.wIO_sec,
        tIO_sec: diskIO.tIO_sec,
        ms: diskIO.ms,
      } : null,
      temperatures: {
        cpu: cpuTemp?.main || null,
        gpu: gpuInfo.length > 0 ? gpuInfo[0].temperature : null,
      },
      network: networkInterfaces && networkInterfaces.length > 0 ? networkInterfaces.map(iface => ({
        iface: iface.iface,
        ip4: iface.ip4,
        ip6: iface.ip6,
        mac: iface.mac,
        internal: iface.internal,
        virtual: iface.virtual,
        speed: iface.speed,
        type: iface.type,
      })) : null,
      networkStats: networkStats && networkStats.length > 0 ? networkStats.map(stat => ({
        iface: stat.iface,
        operstate: stat.operstate,
        rx_bytes: stat.rx_bytes,
        tx_bytes: stat.tx_bytes,
        rx_sec: stat.rx_sec,
        tx_sec: stat.tx_sec,
        rx_dropped: stat.rx_dropped,
        tx_dropped: stat.tx_dropped,
        rx_errors: stat.rx_errors,
        tx_errors: stat.tx_errors,
      })) : null,
      versions: versions ? {
        kernel: versions.kernel,
        node: versions.node,
        npm: versions.npm,
        v8: versions.v8,
        openssl: versions.openssl,
      } : null,
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

app.get('/api/processes', async (_req, res) => {
  try {
    const processes = await si.processes();
    const topProcesses = processes.list
      .sort((a, b) => b.cpu - a.cpu)
      .slice(0, 10)
      .map(proc => ({
        pid: proc.pid,
        name: proc.name,
        command: proc.command,
        cpu: proc.cpu,
        mem: proc.mem,
        memVsz: proc.memVsz,
        memRss: proc.memRss,
        user: proc.user,
        state: proc.state,
        started: proc.started,
      }));

    res.json({
      total: processes.all,
      running: processes.running,
      blocked: processes.blocked,
      sleeping: processes.sleeping,
      list: topProcesses,
    });
  } catch (err) {
    console.error('Failed to get processes', err);
    res.status(500).json({ error: 'Failed to get process list' });
  }
});

app.post('/api/processes/kill', async (req, res) => {
  const { pid, signal = 'SIGTERM' } = req.body;

  if (!pid) {
    return res.status(400).json({ error: 'PID is required' });
  }

  try {
    const validSignals = ['SIGTERM', 'SIGKILL', 'SIGINT'];
    const killSignal = validSignals.includes(signal) ? signal : 'SIGTERM';

    await new Promise((resolve, reject) => {
      exec(`kill -${killSignal} ${pid}`, (err, stdout, stderr) => {
        if (err) {
          if (err.message.includes('No such process')) {
            return reject(new Error('Process not found'));
          }
          if (err.message.includes('Operation not permitted')) {
            return reject(new Error('Permission denied'));
          }
          return reject(err);
        }
        resolve();
      });
    });

    res.json({ status: 'Process killed', pid, signal: killSignal });
  } catch (err) {
    console.error('Failed to kill process', err);
    res.status(500).json({ error: err.message || 'Failed to kill process' });
  }
});

// Mount metrics routes
const metricsRouter = require('./routes/metrics');
app.use('/api/metrics', metricsRouter);
app.use('/api/data', metricsRouter);

// Mount machines routes
const machinesRouter = require('./routes/machines');
app.use('/api/machines', machinesRouter);

// Mount info routes
const infoRouter = require('./routes/info');
app.use('/api/info', infoRouter);

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

      // Enqueue metrics for database storage
      // For multi-GPU systems, use the max utilization across all GPUs
      let maxGpuUtil = null;
      let maxGpuTemp = null;
      let totalVram = 0;
      if (metrics.gpu && metrics.gpu.length > 0) {
        const utils = metrics.gpu.map(g => g.utilization).filter(u => u != null);
        const temps = metrics.gpu.map(g => g.temperature).filter(t => t != null);
        maxGpuUtil = utils.length > 0 ? Math.max(...utils) : null;
        maxGpuTemp = temps.length > 0 ? Math.max(...temps) : null;
        totalVram = metrics.gpu.reduce((sum, g) => sum + (g.vramMB || 0), 0);
      }

      metricsWriter.enqueue({
        machine_id: machineId,
        timestamp: Date.now(),
        cpu_load: metrics.cpuLoad || 0,
        cpu_temp: metrics.cpuTemp || null,
        ram_total: metrics.memory.total || 0,
        ram_used: metrics.memory.used || 0,
        ram_percent: metrics.memory.usedPercent || 0,
        gpu_utilization: maxGpuUtil,
        gpu_temp: maxGpuTemp,
        gpu_mem_used: totalVram,
        gpu_mem_total: totalVram,
        network_rx_sec: metrics.network.rxSec || 0,
        network_tx_sec: metrics.network.txSec || 0
      });
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

// Graceful shutdown
process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

function gracefulShutdown() {
  console.log('Shutting down gracefully...');

  // Stop accepting new connections
  server.close(() => {
    console.log('HTTP server closed');
  });

  // Stop workers
  metricsWriter.stop();
  aggregator.stop();

  // Close database
  setTimeout(() => {
    db.close();
    process.exit(0);
  }, 1000);
}

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
  const [load, mem, networks, graphics, temps, amdGpus, nvtopData, radeontopData] = await Promise.all([
    si.currentLoad(),
    si.mem(),
    si.networkStats(),
    si.graphics(),
    si.cpuTemperature().catch(() => null),
    getAmdGpuInfo(),
    getNvtopInfo(),
    getRadeontopInfo(),
  ]);

  const networkTotals = (networks || []).reduce(
    (acc, nic) => {
      acc.rxSec += nic.rx_sec || 0;
      acc.txSec += nic.tx_sec || 0;
      return acc;
    },
    { rxSec: 0, txSec: 0 },
  );

  // Prefer AMD GPU info if available
  let gpu = amdGpus.length > 0 ? amdGpus : (graphics.controllers || []).map((controller) => ({
    model: controller.model,
    vramMB: controller.vram || null,
    utilization: controller.utilizationGpu || null,
    temperature: controller.temperatureGpu || null,
  }));

  // Enhance GPU info with nvtop data (for NVIDIA GPUs)
  if (nvtopData && gpu.length > 0) {
    gpu[0].nvtop = nvtopData;
    if (nvtopData.utilization != null) gpu[0].utilization = nvtopData.utilization;
    if (nvtopData.temperature != null) gpu[0].temperature = nvtopData.temperature;
  }

  // Enhance GPU info with radeontop data (for AMD GPUs)
  if (radeontopData && gpu.length > 0) {
    gpu[0].radeontop = radeontopData;
    if (radeontopData.utilization != null) gpu[0].utilization = radeontopData.utilization;
  }

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
