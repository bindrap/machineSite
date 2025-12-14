-- Raw metrics table (2-second intervals)
CREATE TABLE IF NOT EXISTS metrics_raw (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp INTEGER NOT NULL,
  cpu_load REAL NOT NULL,
  cpu_temp REAL,
  ram_total INTEGER NOT NULL,
  ram_used INTEGER NOT NULL,
  ram_percent REAL NOT NULL,
  gpu_utilization REAL,
  gpu_temp REAL,
  gpu_mem_used INTEGER,
  gpu_mem_total INTEGER,
  network_rx_sec INTEGER,
  network_tx_sec INTEGER,
  created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
);

CREATE INDEX IF NOT EXISTS idx_metrics_timestamp ON metrics_raw(timestamp);
CREATE INDEX IF NOT EXISTS idx_metrics_created ON metrics_raw(created_at);

-- Hourly aggregated metrics
CREATE TABLE IF NOT EXISTS metrics_hourly (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hour_start INTEGER NOT NULL UNIQUE,
  cpu_load_avg REAL,
  cpu_load_min REAL,
  cpu_load_max REAL,
  cpu_temp_avg REAL,
  cpu_temp_max REAL,
  ram_percent_avg REAL,
  ram_percent_min REAL,
  ram_percent_max REAL,
  ram_used_avg INTEGER,
  gpu_util_avg REAL,
  gpu_util_min REAL,
  gpu_util_max REAL,
  gpu_temp_avg REAL,
  gpu_temp_max REAL,
  network_rx_total INTEGER,
  network_tx_total INTEGER,
  network_rx_avg INTEGER,
  network_tx_avg INTEGER,
  sample_count INTEGER,
  created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
);

CREATE INDEX IF NOT EXISTS idx_hourly_start ON metrics_hourly(hour_start);

-- Daily aggregated metrics
CREATE TABLE IF NOT EXISTS metrics_daily (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  day_start INTEGER NOT NULL UNIQUE,
  cpu_load_avg REAL,
  cpu_load_min REAL,
  cpu_load_max REAL,
  cpu_temp_avg REAL,
  cpu_temp_max REAL,
  ram_percent_avg REAL,
  ram_percent_min REAL,
  ram_percent_max REAL,
  gpu_util_avg REAL,
  gpu_util_min REAL,
  gpu_util_max REAL,
  gpu_temp_avg REAL,
  gpu_temp_max REAL,
  network_rx_total INTEGER,
  network_tx_total INTEGER,
  sample_count INTEGER,
  created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
);

CREATE INDEX IF NOT EXISTS idx_daily_start ON metrics_daily(day_start);

-- System events table
CREATE TABLE IF NOT EXISTS system_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  metadata TEXT,
  created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
);

CREATE INDEX IF NOT EXISTS idx_events_timestamp ON system_events(timestamp);

-- Database metadata
CREATE TABLE IF NOT EXISTS db_metadata (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
);

-- Insert default metadata
INSERT OR IGNORE INTO db_metadata (key, value) VALUES ('schema_version', '1');
INSERT OR IGNORE INTO db_metadata (key, value) VALUES ('retention_days_raw', '7');
INSERT OR IGNORE INTO db_metadata (key, value) VALUES ('retention_days_hourly', '90');
INSERT OR IGNORE INTO db_metadata (key, value) VALUES ('retention_days_daily', '0');
