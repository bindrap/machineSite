const express = require('express');
const { Parser } = require('json2csv');
const { getDatabase } = require('../db');

const router = express.Router();

/**
 * GET /api/metrics/range
 * Query historical metrics with date range
 *
 * Query params:
 * - start: ISO timestamp or Unix epoch (ms)
 * - end: ISO timestamp or Unix epoch (ms)
 * - granularity: 'raw' | 'hourly' | 'daily' | 'auto' (default: 'auto')
 */
router.get('/range', async (req, res) => {
  try {
    const { start, end, granularity = 'auto', machine_id = 'localhost' } = req.query;

    if (!start || !end) {
      return res.status(400).json({
        error: 'Missing required parameters: start and end'
      });
    }

    // Parse timestamps
    const startTimestamp = isNaN(start) ? new Date(start).getTime() : parseInt(start);
    const endTimestamp = isNaN(end) ? new Date(end).getTime() : parseInt(end);

    if (isNaN(startTimestamp) || isNaN(endTimestamp)) {
      return res.status(400).json({
        error: 'Invalid timestamp format'
      });
    }

    if (startTimestamp >= endTimestamp) {
      return res.status(400).json({
        error: 'Start timestamp must be before end timestamp'
      });
    }

    // Query database
    const db = getDatabase();
    const result = db.getMetrics(machine_id, startTimestamp, endTimestamp, granularity);

    // Format response
    res.json({
      machine_id,
      granularity: result.granularity,
      start: new Date(startTimestamp).toISOString(),
      end: new Date(endTimestamp).toISOString(),
      count: result.data.length,
      metrics: formatMetricsForResponse(result.data, result.granularity)
    });
  } catch (err) {
    console.error('Failed to query metrics:', err);
    res.status(500).json({
      error: 'Failed to query metrics',
      details: err.message
    });
  }
});

/**
 * GET /api/metrics/export/csv
 * Export metrics as CSV
 *
 * Query params: same as /api/metrics/range
 */
router.get('/export/csv', async (req, res) => {
  try {
    const { start, end, granularity = 'auto', machine_id = 'localhost' } = req.query;

    if (!start || !end) {
      return res.status(400).json({
        error: 'Missing required parameters: start and end'
      });
    }

    // Parse timestamps
    const startTimestamp = isNaN(start) ? new Date(start).getTime() : parseInt(start);
    const endTimestamp = isNaN(end) ? new Date(end).getTime() : parseInt(end);

    if (isNaN(startTimestamp) || isNaN(endTimestamp)) {
      return res.status(400).json({
        error: 'Invalid timestamp format'
      });
    }

    // Query database
    const db = getDatabase();
    const result = db.getMetrics(machine_id, startTimestamp, endTimestamp, granularity);

    // Convert to CSV
    const fields = getCSVFields(result.granularity);
    const parser = new Parser({ fields });
    const csv = parser.parse(result.data);

    // Send as download
    const filename = `metrics_${result.granularity}_${Date.now()}.csv`;
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  } catch (err) {
    console.error('Failed to export CSV:', err);
    res.status(500).json({
      error: 'Failed to export CSV',
      details: err.message
    });
  }
});

/**
 * GET /api/metrics/summary
 * Get summary statistics for a time period
 *
 * Query params:
 * - period: '24h' | '7d' | '30d' | '90d' | 'custom'
 * - start, end: required if period is 'custom'
 */
router.get('/summary', async (req, res) => {
  try {
    const { period = '24h', start, end, machine_id = 'localhost' } = req.query;

    let startTimestamp, endTimestamp;

    if (period === 'custom') {
      if (!start || !end) {
        return res.status(400).json({
          error: 'Custom period requires start and end parameters'
        });
      }
      startTimestamp = isNaN(start) ? new Date(start).getTime() : parseInt(start);
      endTimestamp = isNaN(end) ? new Date(end).getTime() : parseInt(end);
    } else {
      endTimestamp = Date.now();
      const periodMs = {
        '24h': 24 * 60 * 60 * 1000,
        '7d': 7 * 24 * 60 * 60 * 1000,
        '30d': 30 * 24 * 60 * 60 * 1000,
        '90d': 90 * 24 * 60 * 60 * 1000
      };

      if (!periodMs[period]) {
        return res.status(400).json({
          error: 'Invalid period. Must be 24h, 7d, 30d, 90d, or custom'
        });
      }

      startTimestamp = endTimestamp - periodMs[period];
    }

    // Query database
    const db = getDatabase();
    const result = db.getMetrics(machine_id, startTimestamp, endTimestamp, 'auto');

    // Calculate summary statistics
    const summary = calculateSummaryStats(result.data, result.granularity);

    res.json({
      machine_id,
      period: period,
      start: new Date(startTimestamp).toISOString(),
      end: new Date(endTimestamp).toISOString(),
      granularity: result.granularity,
      sample_count: result.data.length,
      ...summary
    });
  } catch (err) {
    console.error('Failed to get summary:', err);
    res.status(500).json({
      error: 'Failed to get summary',
      details: err.message
    });
  }
});

/**
 * POST /api/data/cleanup
 * Manually trigger data cleanup
 *
 * Body:
 * - older_than_days: number of days
 * - granularity: 'raw' | 'hourly' | 'daily'
 */
router.post('/cleanup', async (req, res) => {
  try {
    const { older_than_days, granularity } = req.body;

    if (!older_than_days || !granularity) {
      return res.status(400).json({
        error: 'Missing required parameters: older_than_days and granularity'
      });
    }

    if (!['raw', 'hourly', 'daily'].includes(granularity)) {
      return res.status(400).json({
        error: 'Invalid granularity. Must be raw, hourly, or daily'
      });
    }

    const db = getDatabase();
    const cutoffTimestamp = Date.now() - (older_than_days * 24 * 60 * 60 * 1000);

    let deletedCount = 0;

    switch (granularity) {
      case 'raw':
        const rawResult = db.stmts.deleteOldRawMetrics.run(cutoffTimestamp);
        deletedCount = rawResult.changes;
        break;
      case 'hourly':
        const hourlyResult = db.stmts.deleteOldHourlyMetrics.run(cutoffTimestamp);
        deletedCount = hourlyResult.changes;
        break;
      case 'daily':
        const dailyResult = db.stmts.deleteOldDailyMetrics.run(cutoffTimestamp);
        deletedCount = dailyResult.changes;
        break;
    }

    // Checkpoint WAL
    if (deletedCount > 0) {
      db.db.pragma('wal_checkpoint(TRUNCATE)');
    }

    res.json({
      deleted_count: deletedCount,
      granularity,
      older_than_days,
      cutoff_date: new Date(cutoffTimestamp).toISOString()
    });
  } catch (err) {
    console.error('Failed to cleanup data:', err);
    res.status(500).json({
      error: 'Failed to cleanup data',
      details: err.message
    });
  }
});

/**
 * GET /api/data/stats
 * Get database statistics
 */
router.get('/stats', async (req, res) => {
  try {
    const { machine_id = 'localhost' } = req.query;
    const db = getDatabase();
    const stats = db.getStats(machine_id);
    res.json(stats);
  } catch (err) {
    console.error('Failed to get stats:', err);
    res.status(500).json({
      error: 'Failed to get stats',
      details: err.message
    });
  }
});

/**
 * Helper: Format metrics for JSON response
 */
function formatMetricsForResponse(data, granularity) {
  if (granularity === 'raw') {
    return {
      cpu_load: data.map(d => ({ timestamp: d.timestamp, value: d.cpu_load })),
      cpu_temp: data.map(d => ({ timestamp: d.timestamp, value: d.cpu_temp })),
      ram_percent: data.map(d => ({ timestamp: d.timestamp, value: d.ram_percent })),
      gpu_utilization: data.map(d => ({ timestamp: d.timestamp, value: d.gpu_utilization })),
      gpu_temp: data.map(d => ({ timestamp: d.timestamp, value: d.gpu_temp })),
      network_rx: data.map(d => ({ timestamp: d.timestamp, value: d.network_rx_sec })),
      network_tx: data.map(d => ({ timestamp: d.timestamp, value: d.network_tx_sec }))
    };
  } else {
    // For hourly/daily, include min/max/avg
    const timestampField = granularity === 'hourly' ? 'hour_start' : 'day_start';
    return {
      cpu_load: data.map(d => ({
        timestamp: d[timestampField],
        avg: d.cpu_load_avg,
        min: d.cpu_load_min,
        max: d.cpu_load_max
      })),
      cpu_temp: data.map(d => ({
        timestamp: d[timestampField],
        avg: d.cpu_temp_avg,
        max: d.cpu_temp_max
      })),
      ram_percent: data.map(d => ({
        timestamp: d[timestampField],
        avg: d.ram_percent_avg,
        min: d.ram_percent_min,
        max: d.ram_percent_max
      })),
      gpu_utilization: data.map(d => ({
        timestamp: d[timestampField],
        avg: d.gpu_util_avg,
        min: d.gpu_util_min,
        max: d.gpu_util_max
      })),
      gpu_temp: data.map(d => ({
        timestamp: d[timestampField],
        avg: d.gpu_temp_avg,
        max: d.gpu_temp_max
      })),
      network_rx: data.map(d => ({
        timestamp: d[timestampField],
        total: d.network_rx_total,
        avg: d.network_rx_avg
      })),
      network_tx: data.map(d => ({
        timestamp: d[timestampField],
        total: d.network_tx_total,
        avg: d.network_tx_avg
      }))
    };
  }
}

/**
 * Helper: Get CSV field definitions based on granularity
 */
function getCSVFields(granularity) {
  const timestampField = granularity === 'raw' ? 'timestamp' :
    granularity === 'hourly' ? 'hour_start' : 'day_start';

  const baseFields = [
    { label: 'Timestamp', value: timestampField }
  ];

  if (granularity === 'raw') {
    return [
      ...baseFields,
      { label: 'CPU Load %', value: 'cpu_load' },
      { label: 'CPU Temp °C', value: 'cpu_temp' },
      { label: 'RAM Total Bytes', value: 'ram_total' },
      { label: 'RAM Used Bytes', value: 'ram_used' },
      { label: 'RAM %', value: 'ram_percent' },
      { label: 'GPU Util %', value: 'gpu_utilization' },
      { label: 'GPU Temp °C', value: 'gpu_temp' },
      { label: 'GPU Mem Used MB', value: 'gpu_mem_used' },
      { label: 'GPU Mem Total MB', value: 'gpu_mem_total' },
      { label: 'Network RX B/s', value: 'network_rx_sec' },
      { label: 'Network TX B/s', value: 'network_tx_sec' }
    ];
  } else {
    return [
      ...baseFields,
      { label: 'CPU Load Avg %', value: 'cpu_load_avg' },
      { label: 'CPU Load Min %', value: 'cpu_load_min' },
      { label: 'CPU Load Max %', value: 'cpu_load_max' },
      { label: 'CPU Temp Avg °C', value: 'cpu_temp_avg' },
      { label: 'CPU Temp Max °C', value: 'cpu_temp_max' },
      { label: 'RAM Avg %', value: 'ram_percent_avg' },
      { label: 'RAM Min %', value: 'ram_percent_min' },
      { label: 'RAM Max %', value: 'ram_percent_max' },
      { label: 'GPU Util Avg %', value: 'gpu_util_avg' },
      { label: 'GPU Util Min %', value: 'gpu_util_min' },
      { label: 'GPU Util Max %', value: 'gpu_util_max' },
      { label: 'GPU Temp Avg °C', value: 'gpu_temp_avg' },
      { label: 'GPU Temp Max °C', value: 'gpu_temp_max' },
      { label: 'Network RX Total Bytes', value: 'network_rx_total' },
      { label: 'Network TX Total Bytes', value: 'network_tx_total' },
      { label: 'Network RX Avg B/s', value: 'network_rx_avg' },
      { label: 'Network TX Avg B/s', value: 'network_tx_avg' },
      { label: 'Sample Count', value: 'sample_count' }
    ];
  }
}

/**
 * Helper: Calculate summary statistics
 */
function calculateSummaryStats(data, granularity) {
  if (data.length === 0) {
    return {
      cpu: null,
      ram: null,
      gpu: null,
      network: null
    };
  }

  const getValue = (metric, stat = 'value') => {
    if (granularity === 'raw') {
      return data.map(d => d[metric]).filter(v => v != null);
    } else {
      // For aggregated data, use avg values
      return data.map(d => d[`${metric}_avg`] || d[metric]).filter(v => v != null);
    }
  };

  const avg = arr => arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : null;
  const min = arr => arr.length > 0 ? Math.min(...arr) : null;
  const max = arr => arr.length > 0 ? Math.max(...arr) : null;
  const median = arr => {
    if (arr.length === 0) return null;
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  };
  const percentile = (arr, p) => {
    if (arr.length === 0) return null;
    const sorted = [...arr].sort((a, b) => a - b);
    const index = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, index)];
  };

  return {
    cpu: {
      avg: avg(getValue('cpu_load')),
      min: min(getValue('cpu_load')),
      max: max(getValue('cpu_load')),
      median: median(getValue('cpu_load')),
      p95: percentile(getValue('cpu_load'), 95)
    },
    ram: {
      avg: avg(getValue('ram_percent')),
      min: min(getValue('ram_percent')),
      max: max(getValue('ram_percent')),
      median: median(getValue('ram_percent')),
      p95: percentile(getValue('ram_percent'), 95)
    },
    gpu: {
      avg: avg(getValue('gpu_util')),
      min: min(getValue('gpu_util')),
      max: max(getValue('gpu_util')),
      median: median(getValue('gpu_util')),
      p95: percentile(getValue('gpu_util'), 95)
    },
    network: {
      total_rx_gb: granularity === 'raw'
        ? (data.reduce((sum, d) => sum + (d.network_rx_sec || 0), 0) * 2) / (1024 * 1024 * 1024)
        : data.reduce((sum, d) => sum + (d.network_rx_total || 0), 0) / (1024 * 1024 * 1024),
      total_tx_gb: granularity === 'raw'
        ? (data.reduce((sum, d) => sum + (d.network_tx_sec || 0), 0) * 2) / (1024 * 1024 * 1024)
        : data.reduce((sum, d) => sum + (d.network_tx_total || 0), 0) / (1024 * 1024 * 1024),
      avg_rx_mbps: avg(getValue('network_rx_sec')) * 8 / (1024 * 1024),
      avg_tx_mbps: avg(getValue('network_tx_sec')) * 8 / (1024 * 1024)
    }
  };
}

module.exports = router;
