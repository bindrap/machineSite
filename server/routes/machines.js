const express = require('express');
const { getDatabase } = require('../db');

const router = express.Router();

/**
 * GET /api/machines
 * Get list of all registered machines
 */
router.get('/', async (req, res) => {
  try {
    const db = getDatabase();
    const machines = db.getMachines();

    // Parse metadata JSON for each machine
    const machinesWithMetadata = machines.map(m => ({
      ...m,
      metadata: m.metadata ? JSON.parse(m.metadata) : null
    }));

    res.json({
      machines: machinesWithMetadata,
      count: machinesWithMetadata.length
    });
  } catch (err) {
    console.error('Failed to get machines:', err);
    res.status(500).json({
      error: 'Failed to get machines',
      details: err.message
    });
  }
});

/**
 * GET /api/machines/:machine_id
 * Get details for a specific machine
 */
router.get('/:machine_id', async (req, res) => {
  try {
    const { machine_id } = req.params;
    const db = getDatabase();
    const machine = db.getMachine(machine_id);

    if (!machine) {
      return res.status(404).json({
        error: 'Machine not found'
      });
    }

    res.json({
      ...machine,
      metadata: machine.metadata ? JSON.parse(machine.metadata) : null
    });
  } catch (err) {
    console.error('Failed to get machine:', err);
    res.status(500).json({
      error: 'Failed to get machine',
      details: err.message
    });
  }
});

/**
 * POST /api/machines/:machine_id/register
 * Register or update a machine
 *
 * Body:
 * - hostname: string
 * - display_name: string
 * - ip_address: string
 * - metadata: object
 */
router.post('/:machine_id/register', async (req, res) => {
  try {
    const { machine_id } = req.params;
    const { hostname, display_name, ip_address, metadata } = req.body;

    const db = getDatabase();
    db.upsertMachine({
      machine_id,
      hostname: hostname || null,
      display_name: display_name || hostname || machine_id,
      ip_address: ip_address || null,
      last_seen: Date.now(),
      metadata: metadata || null
    });

    res.json({
      message: 'Machine registered successfully',
      machine_id
    });
  } catch (err) {
    console.error('Failed to register machine:', err);
    res.status(500).json({
      error: 'Failed to register machine',
      details: err.message
    });
  }
});

/**
 * POST /api/machines/:machine_id/metrics
 * Submit metrics for a remote machine
 *
 * Body:
 * - metrics: array of metric objects
 */
router.post('/:machine_id/metrics', async (req, res) => {
  try {
    const { machine_id } = req.params;
    const { metrics, hostname, display_name, ip_address, system_info } = req.body;

    if (!metrics || !Array.isArray(metrics)) {
      return res.status(400).json({
        error: 'Invalid metrics format. Expected array of metrics.'
      });
    }

    const db = getDatabase();

    // Register/update machine with system info if provided
    const machineData = {
      machine_id,
      hostname: hostname || null,
      display_name: display_name || hostname || machine_id,
      ip_address: ip_address || req.ip || null,
      last_seen: Date.now()
    };

    // Store system info in metadata if provided
    if (system_info) {
      console.log(`Received system_info for ${machine_id}:`, JSON.stringify(system_info, null, 2));
      machineData.metadata = system_info;
    } else {
      console.log(`No system_info received for ${machine_id}`);
    }

    db.upsertMachine(machineData);

    // Insert metrics with machine_id
    const metricsWithMachineId = metrics.map(m => ({
      ...m,
      machine_id
    }));

    db.insertMetricsBatch(metricsWithMachineId);

    res.json({
      message: 'Metrics submitted successfully',
      count: metrics.length,
      machine_id
    });
  } catch (err) {
    console.error('Failed to submit metrics:', err);
    res.status(500).json({
      error: 'Failed to submit metrics',
      details: err.message
    });
  }
});

module.exports = router;
