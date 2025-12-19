const express = require('express');
const os = require('os');
const si = require('systeminformation');
const { getDatabase } = require('../db');

const router = express.Router();

// Get current machine ID from environment
const CURRENT_MACHINE_ID = process.env.MACHINE_ID || os.hostname() || 'localhost';

// Import helper functions from main server
// (We'll need to refactor these, but for now we'll duplicate the key logic)

/**
 * GET /api/info/:machine_id
 * Get system information for a specific machine
 * - If machine_id is 'localhost' or matches current machine, query local system
 * - Otherwise, return stored metadata from database
 */
router.get('/:machine_id', async (req, res) => {
  try {
    const { machine_id } = req.params;
    const db = getDatabase();

    // If requesting localhost or current machine, get live system info
    if (machine_id === 'localhost' || machine_id === CURRENT_MACHINE_ID) {
      // Get this from the main /api/info endpoint
      const mainInfoResponse = await fetch('http://localhost:3000/api/info');
      const info = await mainInfoResponse.json();
      return res.json({ ...info, machine_id });
    }

    // For remote machines, get stored metadata
    const machine = db.getMachine(machine_id);

    if (!machine) {
      return res.status(404).json({
        error: 'Machine not found'
      });
    }

    // Parse metadata
    const systemInfo = machine.metadata ? JSON.parse(machine.metadata) : null;

    if (!systemInfo) {
      return res.status(404).json({
        error: 'No system information available for this machine'
      });
    }

    // Get latest metrics to provide live data
    const now = Date.now();
    const oneHourAgo = now - (60 * 60 * 1000);
    const recentMetrics = db.getMetrics(machine_id, oneHourAgo, now, 'raw');
    const latestMetric = recentMetrics.data && recentMetrics.data.length > 0
      ? recentMetrics.data[recentMetrics.data.length - 1]
      : null;

    // Calculate time since last seen
    const timeSinceLastSeen = now - machine.last_seen;
    const isOnline = timeSinceLastSeen < 5 * 60 * 1000; // 5 minutes

    // Return formatted system info similar to /api/info format
    res.json({
      machine_id: machine.machine_id,
      hostname: machine.hostname,
      os: systemInfo.os || 'Unknown',
      arch: systemInfo.arch || 'Unknown',
      timezone: systemInfo.timezone || 'Unknown',
      currentTime: new Date(machine.last_seen).toISOString(),
      uptimeSeconds: null, // Not available for remote machines
      uptimeHuman: 'Remote machine',
      machineAge: null, // Not available for remote machines
      cpu: systemInfo.cpu || {},
      cpuLoad: latestMetric ? {
        currentLoad: latestMetric.cpu_load,
        currentLoadUser: null,
        currentLoadSystem: null,
        currentLoadIdle: 100 - latestMetric.cpu_load,
        avgLoad: null,
        cpus: [],
      } : null,
      memory: {
        total: systemInfo.memory?.total || 0,
        used: latestMetric?.ram_used || 0,
        free: latestMetric?.ram_free || 0,
        available: latestMetric?.ram_available || 0,
        usedPercent: latestMetric?.ram_percent || 0,
        swapTotal: latestMetric?.swap_total || 0,
        swapUsed: latestMetric?.swap_used || 0,
        swapFree: (latestMetric?.swap_total || 0) - (latestMetric?.swap_used || 0),
        swapPercent: latestMetric?.swap_percent || 0,
      },
      gpu: systemInfo.gpu || [],
      temperatures: {
        cpu: latestMetric?.cpu_temp || null,
        gpu: latestMetric?.gpu_temp || null,
      },
      battery: systemInfo.battery || null,
      disk: systemInfo.disk || null,
      system: systemInfo.system || {},
      versions: systemInfo.versions || null,
      network: null,
      networkStats: null,
      diskIO: null,
      powerControlsEnabled: false,
      last_seen: machine.last_seen,
      is_remote: true,
      is_online: isOnline,
      time_since_last_seen: timeSinceLastSeen,
    });
  } catch (err) {
    console.error('Failed to get machine info:', err);
    res.status(500).json({
      error: 'Failed to get machine info',
      details: err.message
    });
  }
});

module.exports = router;
