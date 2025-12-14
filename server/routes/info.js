const express = require('express');
const os = require('os');
const si = require('systeminformation');
const { getDatabase } = require('../db');

const router = express.Router();

// Import helper functions from main server
// (We'll need to refactor these, but for now we'll duplicate the key logic)

/**
 * GET /api/info/:machine_id
 * Get system information for a specific machine
 * - If machine_id is 'localhost', query local system
 * - Otherwise, return stored metadata from database
 */
router.get('/:machine_id', async (req, res) => {
  try {
    const { machine_id } = req.params;
    const db = getDatabase();

    // If requesting localhost, get live system info
    if (machine_id === 'localhost') {
      // Get this from the main /api/info endpoint
      const mainInfoResponse = await fetch('http://localhost:3000/api/info');
      const info = await mainInfoResponse.json();
      return res.json({ ...info, machine_id: 'localhost' });
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

    // Return formatted system info similar to /api/info format
    res.json({
      machine_id: machine.machine_id,
      hostname: machine.hostname,
      os: systemInfo.os || 'Unknown',
      arch: systemInfo.arch || 'Unknown',
      cpu: systemInfo.cpu || {},
      memory: systemInfo.memory || {},
      gpu: systemInfo.gpu || [],
      system: systemInfo.system || {},
      last_seen: machine.last_seen,
      is_remote: true,
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
