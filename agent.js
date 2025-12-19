#!/usr/bin/env node

/**
 * Machine Monitoring Agent
 *
 * Collects system metrics and sends them to a central monitoring server.
 * Run this script on remote machines to monitor them from a central dashboard.
 *
 * Usage:
 *   node agent.js --server http://192.168.1.100:3005 --machine-id frodo
 *
 * Environment variables:
 *   SERVER_URL - The URL of the central monitoring server
 *   MACHINE_ID - Unique identifier for this machine (defaults to hostname)
 *   DISPLAY_NAME - Human-readable name for this machine
 *   INTERVAL - Collection interval in milliseconds (default: 2000)
 */

const os = require('os');
const { exec } = require('child_process');
const si = require('systeminformation');

// Parse command line arguments
const args = process.argv.slice(2);
const getArg = (name) => {
  const index = args.indexOf(`--${name}`);
  return index !== -1 && args[index + 1] ? args[index + 1] : null;
};

// Configuration
const SERVER_URL = getArg('server') || process.env.SERVER_URL;
const MACHINE_ID = getArg('machine-id') || process.env.MACHINE_ID || os.hostname();
const DISPLAY_NAME = getArg('display-name') || process.env.DISPLAY_NAME || os.hostname();
const INTERVAL = parseInt(getArg('interval') || process.env.INTERVAL || '2000');
const BATCH_SIZE = parseInt(getArg('batch-size') || process.env.BATCH_SIZE || '30');

if (!SERVER_URL) {
  console.error('Error: SERVER_URL is required. Use --server or set SERVER_URL environment variable.');
  console.error('Example: node agent.js --server http://192.168.1.100:3005 --machine-id frodo');
  process.exit(1);
}

console.log(`Starting agent for machine: ${MACHINE_ID}`);
console.log(`Display name: ${DISPLAY_NAME}`);
console.log(`Server: ${SERVER_URL}`);
console.log(`Collection interval: ${INTERVAL}ms`);
console.log(`Batch size: ${BATCH_SIZE} metrics`);

// Metrics buffer
const metricsBuffer = [];
let isSubmitting = false;

// Helper functions for GPU monitoring
async function getNvtopInfo() {
  try {
    return await new Promise((resolve, reject) => {
      exec('nvtop --once --no-color 2>/dev/null', { timeout: 3000 }, (err, stdout, stderr) => {
        if (err) return resolve(null);

        const gpuData = {};
        const lines = stdout.split('\n');

        for (const line of lines) {
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
        }

        resolve(Object.keys(gpuData).length > 0 ? gpuData : null);
      });
    });
  } catch (err) {
    return null;
  }
}

async function getRadeontopInfo() {
  try {
    return await new Promise((resolve, reject) => {
      exec('timeout 2 radeontop -d - -l 1 2>/dev/null', { timeout: 3000 }, (err, stdout, stderr) => {
        if (err) return resolve(null);

        const gpuData = {};
        const lines = stdout.split('\n');

        for (const line of lines) {
          const gpuMatch = line.match(/gpu\s+([\d.]+)%/);
          if (gpuMatch) gpuData.utilization = parseFloat(gpuMatch[1]);

          const vramMatch = line.match(/vram\s+([\d.]+)%\s+([\d.]+)mb/i);
          if (vramMatch) {
            gpuData.vramUtilization = parseFloat(vramMatch[1]);
            gpuData.vramUsedMB = parseFloat(vramMatch[2]);
          }
        }

        resolve(Object.keys(gpuData).length > 0 ? gpuData : null);
      });
    });
  } catch (err) {
    return null;
  }
}

// Collect system info (called once on startup)
async function collectSystemInfo() {
  try {
    const [osInfo, system, cpu, mem, graphics, time, versions, battery, fsSize] = await Promise.all([
      si.osInfo(),
      si.system(),
      si.cpu(),
      si.mem(),
      si.graphics(),
      si.time(),
      si.versions().catch(() => null),
      si.battery().catch(() => null),
      si.fsSize().catch(() => []),
    ]);

    return {
      os: `${osInfo.distro} ${osInfo.release} (${osInfo.kernel})`,
      arch: os.arch(),
      timezone: time.timezoneName || time.timezone,
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
      },
      memory: {
        total: mem.total,
      },
      gpu: (graphics.controllers || []).map(g => ({
        model: g.model,
        vramMB: g.vram,
      })),
      system: {
        manufacturer: system.manufacturer,
        model: system.model,
        serial: system.serial,
        uuid: system.uuid,
        sku: system.sku,
        virtual: system.virtual,
      },
      battery: battery ? {
        percent: battery.percent,
        health: battery.health || null,
        isCharging: battery.ischarging,
      } : null,
      disk: fsSize && fsSize.length ? {
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
      } : null,
      versions: versions ? {
        kernel: versions.kernel,
        node: versions.node,
        npm: versions.npm,
      } : null,
    };
  } catch (err) {
    console.error('Failed to collect system info:', err.message);
    return null;
  }
}

// Collect system metrics
async function collectMetrics() {
  try {
    const [load, mem, networks, graphics, temps, nvtopData, radeontopData] = await Promise.all([
      si.currentLoad(),
      si.mem(),
      si.networkStats(),
      si.graphics(),
      si.cpuTemperature().catch(() => null),
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

    // Get GPU info
    let gpu = (graphics.controllers || []).map((controller) => ({
      model: controller.model,
      vramMB: controller.vram || null,
      utilization: controller.utilizationGpu || null,
      temperature: controller.temperatureGpu || null,
    }));

    // Enhance with nvtop data
    if (nvtopData && gpu.length > 0) {
      if (nvtopData.utilization != null) gpu[0].utilization = nvtopData.utilization;
      if (nvtopData.temperature != null) gpu[0].temperature = nvtopData.temperature;
    }

    // Enhance with radeontop data
    if (radeontopData && gpu.length > 0) {
      if (radeontopData.utilization != null) gpu[0].utilization = radeontopData.utilization;
    }

    // Calculate GPU metrics
    let maxGpuUtil = null;
    let maxGpuTemp = null;
    let totalVram = 0;
    if (gpu && gpu.length > 0) {
      const utils = gpu.map(g => g.utilization).filter(u => u != null);
      const temps = gpu.map(g => g.temperature).filter(t => t != null);
      maxGpuUtil = utils.length > 0 ? Math.max(...utils) : null;
      maxGpuTemp = temps.length > 0 ? Math.max(...temps) : null;
      totalVram = gpu.reduce((sum, g) => sum + (g.vramMB || 0), 0);
    }

    return {
      timestamp: Date.now(),
      cpu_load: load.currentLoad,
      cpu_temp: temps?.main || null,
      ram_total: mem.total,
      ram_used: mem.active,
      ram_free: mem.free,
      ram_available: mem.available,
      ram_percent: (mem.active / mem.total) * 100,
      swap_total: mem.swaptotal || 0,
      swap_used: mem.swapused || 0,
      swap_percent: mem.swaptotal > 0 ? (mem.swapused / mem.swaptotal) * 100 : 0,
      gpu_utilization: maxGpuUtil,
      gpu_temp: maxGpuTemp,
      gpu_mem_used: totalVram,
      gpu_mem_total: totalVram,
      network_rx_sec: networkTotals.rxSec,
      network_tx_sec: networkTotals.txSec,
    };
  } catch (err) {
    console.error('Failed to collect metrics:', err.message);
    return null;
  }
}

// Global variable to track if system info has been sent
let systemInfoSent = false;

// Submit metrics to server
async function submitMetrics() {
  if (isSubmitting || metricsBuffer.length === 0) {
    return;
  }

  isSubmitting = true;

  try {
    const batch = metricsBuffer.splice(0, BATCH_SIZE);

    // Try dynamic import for fetch (Node 18+)
    let fetch;
    try {
      fetch = (await import('node-fetch')).default;
    } catch {
      // Fallback to built-in fetch in Node 18+
      fetch = global.fetch || require('node-fetch');
    }

    // Collect and send system info on first submission
    const systemInfo = !systemInfoSent ? await collectSystemInfo() : null;
    console.log('DEBUG: systemInfoSent =', systemInfoSent);
    console.log('DEBUG: systemInfo =', systemInfo ? Object.keys(systemInfo).length + ' fields' : 'NULL');
    if (systemInfo) {
      console.log('DEBUG: Sending system_info to server');
      systemInfoSent = true;
    } else {
      console.log('DEBUG: No system_info to send');
    }

    const response = await fetch(`${SERVER_URL}/api/machines/${MACHINE_ID}/metrics`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        metrics: batch,
        hostname: os.hostname(),
        display_name: DISPLAY_NAME,
        ip_address: getLocalIP(),
        system_info: systemInfo,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error(`Failed to submit metrics: ${response.status} ${error}`);
      // Put metrics back in buffer to retry
      metricsBuffer.unshift(...batch);
    } else {
      console.log(`Submitted ${batch.length} metrics to server`);
    }
  } catch (err) {
    console.error('Failed to submit metrics:', err.message);
  } finally {
    isSubmitting = false;
  }
}

// Get local IP address
function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return null;
}

// Main collection loop
async function collect() {
  const metrics = await collectMetrics();
  if (metrics) {
    metricsBuffer.push(metrics);

    // Submit if buffer is full
    if (metricsBuffer.length >= BATCH_SIZE) {
      await submitMetrics();
    }
  }
}

// Start collection
console.log('Agent started, collecting metrics...');
setInterval(collect, INTERVAL);

// Submit metrics every 30 seconds
setInterval(submitMetrics, 30000);

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('Shutting down gracefully...');
  await submitMetrics(); // Submit remaining metrics
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('Shutting down gracefully...');
  await submitMetrics(); // Submit remaining metrics
  process.exit(0);
});
