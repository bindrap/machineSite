const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'metrics.db');
const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

class MetricsDatabase {
  constructor() {
    // Ensure data directory exists
    const dataDir = path.dirname(DB_PATH);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    // Initialize database with WAL mode for better concurrent access
    this.db = new Database(DB_PATH);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.pragma('cache_size = 10000');
    this.db.pragma('temp_store = MEMORY');

    // Run migrations
    this.runMigrations();

    // Prepare statements for better performance
    this.prepareStatements();

    console.log(`Database initialized at ${DB_PATH}`);
  }

  runMigrations() {
    const migrations = fs.readdirSync(MIGRATIONS_DIR)
      .filter(f => f.endsWith('.sql'))
      .sort();

    for (const migration of migrations) {
      const migrationPath = path.join(MIGRATIONS_DIR, migration);
      const sql = fs.readFileSync(migrationPath, 'utf8');
      this.db.exec(sql);
      console.log(`Migration applied: ${migration}`);
    }
  }

  prepareStatements() {
    // Insert statements
    this.stmts = {
      insertMetric: this.db.prepare(`
        INSERT INTO metrics_raw (
          machine_id, timestamp, cpu_load, cpu_temp, ram_total, ram_used, ram_percent,
          gpu_utilization, gpu_temp, gpu_mem_used, gpu_mem_total,
          network_rx_sec, network_tx_sec
        ) VALUES (
          @machine_id, @timestamp, @cpu_load, @cpu_temp, @ram_total, @ram_used, @ram_percent,
          @gpu_utilization, @gpu_temp, @gpu_mem_used, @gpu_mem_total,
          @network_rx_sec, @network_tx_sec
        )
      `),

      // Query statements
      getRawMetrics: this.db.prepare(`
        SELECT * FROM metrics_raw
        WHERE machine_id = ? AND timestamp >= ? AND timestamp <= ?
        ORDER BY timestamp ASC
      `),

      getHourlyMetrics: this.db.prepare(`
        SELECT * FROM metrics_hourly
        WHERE machine_id = ? AND hour_start >= ? AND hour_start <= ?
        ORDER BY hour_start ASC
      `),

      getDailyMetrics: this.db.prepare(`
        SELECT * FROM metrics_daily
        WHERE machine_id = ? AND day_start >= ? AND day_start <= ?
        ORDER BY day_start ASC
      `),

      // Cleanup statements
      deleteOldRawMetrics: this.db.prepare(`
        DELETE FROM metrics_raw WHERE machine_id = ? AND timestamp < ?
      `),

      deleteOldHourlyMetrics: this.db.prepare(`
        DELETE FROM metrics_hourly WHERE machine_id = ? AND hour_start < ?
      `),

      deleteOldDailyMetrics: this.db.prepare(`
        DELETE FROM metrics_daily WHERE machine_id = ? AND day_start < ?
      `),

      // Metadata
      getMetadata: this.db.prepare(`SELECT value FROM db_metadata WHERE key = ?`),
      setMetadata: this.db.prepare(`
        INSERT OR REPLACE INTO db_metadata (key, value, updated_at)
        VALUES (?, ?, strftime('%s', 'now') * 1000)
      `),

      // Stats
      getDbStats: this.db.prepare(`
        SELECT
          (SELECT COUNT(*) FROM metrics_raw WHERE machine_id = ?) as raw_count,
          (SELECT COUNT(*) FROM metrics_hourly WHERE machine_id = ?) as hourly_count,
          (SELECT COUNT(*) FROM metrics_daily WHERE machine_id = ?) as daily_count,
          (SELECT MIN(timestamp) FROM metrics_raw WHERE machine_id = ?) as oldest_raw,
          (SELECT MIN(hour_start) FROM metrics_hourly WHERE machine_id = ?) as oldest_hourly,
          (SELECT MIN(day_start) FROM metrics_daily WHERE machine_id = ?) as oldest_daily
      `),

      // Machine management
      getMachines: this.db.prepare(`SELECT * FROM machines WHERE is_active = 1 ORDER BY last_seen DESC`),
      getMachine: this.db.prepare(`SELECT * FROM machines WHERE machine_id = ?`),
      upsertMachine: this.db.prepare(`
        INSERT INTO machines (machine_id, hostname, display_name, ip_address, last_seen, metadata)
        VALUES (@machine_id, @hostname, @display_name, @ip_address, @last_seen, @metadata)
        ON CONFLICT(machine_id) DO UPDATE SET
          hostname = @hostname,
          display_name = @display_name,
          ip_address = @ip_address,
          last_seen = @last_seen,
          metadata = @metadata,
          updated_at = strftime('%s', 'now') * 1000
      `),
      updateMachineLastSeen: this.db.prepare(`
        UPDATE machines SET last_seen = ? WHERE machine_id = ?
      `)
    };
  }

  // Insert a single metric
  insertMetric(metric) {
    try {
      this.stmts.insertMetric.run({
        machine_id: metric.machine_id || 'localhost',
        timestamp: metric.timestamp,
        cpu_load: metric.cpu_load ?? null,
        cpu_temp: metric.cpu_temp ?? null,
        ram_total: metric.ram_total ?? 0,
        ram_used: metric.ram_used ?? 0,
        ram_percent: metric.ram_percent ?? 0,
        gpu_utilization: metric.gpu_utilization ?? null,
        gpu_temp: metric.gpu_temp ?? null,
        gpu_mem_used: metric.gpu_mem_used ?? null,
        gpu_mem_total: metric.gpu_mem_total ?? null,
        network_rx_sec: metric.network_rx_sec ?? 0,
        network_tx_sec: metric.network_tx_sec ?? 0
      });

      // Update machine last_seen
      this.stmts.updateMachineLastSeen.run(metric.timestamp, metric.machine_id || 'localhost');
    } catch (err) {
      console.error('Failed to insert metric:', err.message);
      throw err;
    }
  }

  // Batch insert metrics (more efficient)
  insertMetricsBatch(metrics) {
    if (!metrics || metrics.length === 0) return;

    const insert = this.db.transaction((metricsArray) => {
      for (const metric of metricsArray) {
        this.insertMetric(metric);
      }
    });

    try {
      insert(metrics);
    } catch (err) {
      console.error('Failed to insert metrics batch:', err.message);
      throw err;
    }
  }

  // Query metrics with auto-granularity selection
  getMetrics(machineId, startTimestamp, endTimestamp, granularity = 'auto') {
    const durationMs = endTimestamp - startTimestamp;
    const durationHours = durationMs / (1000 * 60 * 60);

    // Auto-select granularity based on time range
    if (granularity === 'auto') {
      if (durationHours <= 24) {
        granularity = 'raw';
      } else if (durationHours <= 24 * 90) {
        granularity = 'hourly';
      } else {
        granularity = 'daily';
      }
    }

    // Query based on granularity
    switch (granularity) {
      case 'raw':
        return {
          granularity: 'raw',
          data: this.stmts.getRawMetrics.all(machineId, startTimestamp, endTimestamp)
        };
      case 'hourly':
        const hourStart = Math.floor(startTimestamp / (1000 * 60 * 60)) * (1000 * 60 * 60);
        const hourEnd = Math.floor(endTimestamp / (1000 * 60 * 60)) * (1000 * 60 * 60);
        return {
          granularity: 'hourly',
          data: this.stmts.getHourlyMetrics.all(machineId, hourStart, hourEnd)
        };
      case 'daily':
        const dayStart = Math.floor(startTimestamp / (1000 * 60 * 60 * 24)) * (1000 * 60 * 60 * 24);
        const dayEnd = Math.floor(endTimestamp / (1000 * 60 * 60 * 24)) * (1000 * 60 * 60 * 24);
        return {
          granularity: 'daily',
          data: this.stmts.getDailyMetrics.all(machineId, dayStart, dayEnd)
        };
      default:
        throw new Error(`Invalid granularity: ${granularity}`);
    }
  }

  // Aggregate raw metrics into hourly
  aggregateHourly(machineId, hourStart) {
    const hourEnd = hourStart + (60 * 60 * 1000);

    const rawMetrics = this.stmts.getRawMetrics.all(machineId, hourStart, hourEnd);
    if (rawMetrics.length === 0) return null;

    // Calculate aggregates
    const cpu_loads = rawMetrics.map(m => m.cpu_load).filter(v => v != null);
    const cpu_temps = rawMetrics.map(m => m.cpu_temp).filter(v => v != null);
    const ram_percents = rawMetrics.map(m => m.ram_percent).filter(v => v != null);
    const ram_useds = rawMetrics.map(m => m.ram_used).filter(v => v != null);
    const gpu_utils = rawMetrics.map(m => m.gpu_utilization).filter(v => v != null);
    const gpu_temps = rawMetrics.map(m => m.gpu_temp).filter(v => v != null);
    const network_rx = rawMetrics.map(m => m.network_rx_sec || 0);
    const network_tx = rawMetrics.map(m => m.network_tx_sec || 0);

    const avg = arr => arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : null;
    const min = arr => arr.length > 0 ? Math.min(...arr) : null;
    const max = arr => arr.length > 0 ? Math.max(...arr) : null;
    const sum = arr => arr.reduce((a, b) => a + b, 0);

    const hourlyData = {
      machine_id: machineId,
      hour_start: hourStart,
      cpu_load_avg: avg(cpu_loads),
      cpu_load_min: min(cpu_loads),
      cpu_load_max: max(cpu_loads),
      cpu_temp_avg: avg(cpu_temps),
      cpu_temp_max: max(cpu_temps),
      ram_percent_avg: avg(ram_percents),
      ram_percent_min: min(ram_percents),
      ram_percent_max: max(ram_percents),
      ram_used_avg: avg(ram_useds),
      gpu_util_avg: avg(gpu_utils),
      gpu_util_min: min(gpu_utils),
      gpu_util_max: max(gpu_utils),
      gpu_temp_avg: avg(gpu_temps),
      gpu_temp_max: max(gpu_temps),
      network_rx_total: sum(network_rx),
      network_tx_total: sum(network_tx),
      network_rx_avg: avg(network_rx),
      network_tx_avg: avg(network_tx),
      sample_count: rawMetrics.length
    };

    // Insert hourly aggregate
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO metrics_hourly (
        machine_id, hour_start, cpu_load_avg, cpu_load_min, cpu_load_max, cpu_temp_avg, cpu_temp_max,
        ram_percent_avg, ram_percent_min, ram_percent_max, ram_used_avg,
        gpu_util_avg, gpu_util_min, gpu_util_max, gpu_temp_avg, gpu_temp_max,
        network_rx_total, network_tx_total, network_rx_avg, network_tx_avg, sample_count
      ) VALUES (
        @machine_id, @hour_start, @cpu_load_avg, @cpu_load_min, @cpu_load_max, @cpu_temp_avg, @cpu_temp_max,
        @ram_percent_avg, @ram_percent_min, @ram_percent_max, @ram_used_avg,
        @gpu_util_avg, @gpu_util_min, @gpu_util_max, @gpu_temp_avg, @gpu_temp_max,
        @network_rx_total, @network_tx_total, @network_rx_avg, @network_tx_avg, @sample_count
      )
    `);

    stmt.run(hourlyData);
    return hourlyData;
  }

  // Aggregate hourly metrics into daily
  aggregateDaily(machineId, dayStart) {
    const dayEnd = dayStart + (24 * 60 * 60 * 1000);

    const hourlyMetrics = this.stmts.getHourlyMetrics.all(machineId, dayStart, dayEnd);
    if (hourlyMetrics.length === 0) return null;

    // Calculate aggregates from hourly data
    const cpu_loads_avg = hourlyMetrics.map(m => m.cpu_load_avg).filter(v => v != null);
    const cpu_loads_min = hourlyMetrics.map(m => m.cpu_load_min).filter(v => v != null);
    const cpu_loads_max = hourlyMetrics.map(m => m.cpu_load_max).filter(v => v != null);
    const cpu_temps_avg = hourlyMetrics.map(m => m.cpu_temp_avg).filter(v => v != null);
    const cpu_temps_max = hourlyMetrics.map(m => m.cpu_temp_max).filter(v => v != null);
    const ram_percents_avg = hourlyMetrics.map(m => m.ram_percent_avg).filter(v => v != null);
    const ram_percents_min = hourlyMetrics.map(m => m.ram_percent_min).filter(v => v != null);
    const ram_percents_max = hourlyMetrics.map(m => m.ram_percent_max).filter(v => v != null);
    const gpu_utils_avg = hourlyMetrics.map(m => m.gpu_util_avg).filter(v => v != null);
    const gpu_utils_min = hourlyMetrics.map(m => m.gpu_util_min).filter(v => v != null);
    const gpu_utils_max = hourlyMetrics.map(m => m.gpu_util_max).filter(v => v != null);
    const gpu_temps_avg = hourlyMetrics.map(m => m.gpu_temp_avg).filter(v => v != null);
    const gpu_temps_max = hourlyMetrics.map(m => m.gpu_temp_max).filter(v => v != null);

    const avg = arr => arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : null;
    const min = arr => arr.length > 0 ? Math.min(...arr) : null;
    const max = arr => arr.length > 0 ? Math.max(...arr) : null;
    const sum = arr => arr.reduce((a, b) => a + b, 0);

    const dailyData = {
      machine_id: machineId,
      day_start: dayStart,
      cpu_load_avg: avg(cpu_loads_avg),
      cpu_load_min: min(cpu_loads_min),
      cpu_load_max: max(cpu_loads_max),
      cpu_temp_avg: avg(cpu_temps_avg),
      cpu_temp_max: max(cpu_temps_max),
      ram_percent_avg: avg(ram_percents_avg),
      ram_percent_min: min(ram_percents_min),
      ram_percent_max: max(ram_percents_max),
      gpu_util_avg: avg(gpu_utils_avg),
      gpu_util_min: min(gpu_utils_min),
      gpu_util_max: max(gpu_utils_max),
      gpu_temp_avg: avg(gpu_temps_avg),
      gpu_temp_max: max(gpu_temps_max),
      network_rx_total: sum(hourlyMetrics.map(m => m.network_rx_total || 0)),
      network_tx_total: sum(hourlyMetrics.map(m => m.network_tx_total || 0)),
      sample_count: sum(hourlyMetrics.map(m => m.sample_count || 0))
    };

    // Insert daily aggregate
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO metrics_daily (
        machine_id, day_start, cpu_load_avg, cpu_load_min, cpu_load_max, cpu_temp_avg, cpu_temp_max,
        ram_percent_avg, ram_percent_min, ram_percent_max,
        gpu_util_avg, gpu_util_min, gpu_util_max, gpu_temp_avg, gpu_temp_max,
        network_rx_total, network_tx_total, sample_count
      ) VALUES (
        @machine_id, @day_start, @cpu_load_avg, @cpu_load_min, @cpu_load_max, @cpu_temp_avg, @cpu_temp_max,
        @ram_percent_avg, @ram_percent_min, @ram_percent_max,
        @gpu_util_avg, @gpu_util_min, @gpu_util_max, @gpu_temp_avg, @gpu_temp_max,
        @network_rx_total, @network_tx_total, @sample_count
      )
    `);

    stmt.run(dailyData);
    return dailyData;
  }

  // Cleanup old data based on retention policies
  cleanup(machineId = null) {
    const now = Date.now();

    // Get retention settings
    const rawRetention = parseInt(this.stmts.getMetadata.get('retention_days_raw')?.value || '7');
    const hourlyRetention = parseInt(this.stmts.getMetadata.get('retention_days_hourly')?.value || '90');
    const dailyRetention = parseInt(this.stmts.getMetadata.get('retention_days_daily')?.value || '0');

    let deletedCount = 0;

    // Get list of machines to clean up
    const machines = machineId ? [machineId] : this.stmts.getMachines.all().map(m => m.machine_id);

    for (const mid of machines) {
      // Delete old raw data
      if (rawRetention > 0) {
        const rawCutoff = now - (rawRetention * 24 * 60 * 60 * 1000);
        const result = this.stmts.deleteOldRawMetrics.run(mid, rawCutoff);
        deletedCount += result.changes;
        if (result.changes > 0) {
          console.log(`Deleted ${result.changes} old raw metrics for ${mid} (older than ${rawRetention} days)`);
        }
      }

      // Delete old hourly data
      if (hourlyRetention > 0) {
        const hourlyCutoff = now - (hourlyRetention * 24 * 60 * 60 * 1000);
        const result = this.stmts.deleteOldHourlyMetrics.run(mid, hourlyCutoff);
        deletedCount += result.changes;
        if (result.changes > 0) {
          console.log(`Deleted ${result.changes} old hourly metrics for ${mid} (older than ${hourlyRetention} days)`);
        }
      }

      // Delete old daily data
      if (dailyRetention > 0) {
        const dailyCutoff = now - (dailyRetention * 24 * 60 * 60 * 1000);
        const result = this.stmts.deleteOldDailyMetrics.run(mid, dailyCutoff);
        deletedCount += result.changes;
        if (result.changes > 0) {
          console.log(`Deleted ${result.changes} old daily metrics for ${mid} (older than ${dailyRetention} days)`);
        }
      }
    }

    // Optimize database after cleanup
    if (deletedCount > 0) {
      this.db.pragma('wal_checkpoint(TRUNCATE)');
      console.log('Database checkpoint completed');
    }

    return deletedCount;
  }

  // Get database statistics
  getStats(machineId = 'localhost') {
    const stats = this.stmts.getDbStats.get(machineId, machineId, machineId, machineId, machineId, machineId);
    const dbSize = fs.statSync(DB_PATH).size;

    return {
      machine_id: machineId,
      raw_count: stats.raw_count || 0,
      hourly_count: stats.hourly_count || 0,
      daily_count: stats.daily_count || 0,
      oldest_raw: stats.oldest_raw ? new Date(stats.oldest_raw).toISOString() : null,
      oldest_hourly: stats.oldest_hourly ? new Date(stats.oldest_hourly).toISOString() : null,
      oldest_daily: stats.oldest_daily ? new Date(stats.oldest_daily).toISOString() : null,
      db_size_mb: (dbSize / (1024 * 1024)).toFixed(2),
      estimated_retention_days: {
        raw: this.stmts.getMetadata.get('retention_days_raw')?.value || '7',
        hourly: this.stmts.getMetadata.get('retention_days_hourly')?.value || '90',
        daily: this.stmts.getMetadata.get('retention_days_daily')?.value || '0 (unlimited)'
      }
    };
  }

  // Machine management methods
  getMachines() {
    return this.stmts.getMachines.all();
  }

  getMachine(machineId) {
    return this.stmts.getMachine.get(machineId);
  }

  upsertMachine(machine) {
    return this.stmts.upsertMachine.run({
      machine_id: machine.machine_id,
      hostname: machine.hostname || null,
      display_name: machine.display_name || machine.hostname || machine.machine_id,
      ip_address: machine.ip_address || null,
      last_seen: machine.last_seen || Date.now(),
      metadata: machine.metadata ? JSON.stringify(machine.metadata) : null
    });
  }

  // Close database connection
  close() {
    if (this.db) {
      this.db.close();
      console.log('Database connection closed');
    }
  }
}

// Singleton instance
let dbInstance = null;

function getDatabase() {
  if (!dbInstance) {
    dbInstance = new MetricsDatabase();
  }
  return dbInstance;
}

module.exports = { getDatabase, MetricsDatabase };
