-- Add machines table to store machine metadata
CREATE TABLE IF NOT EXISTS machines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  machine_id TEXT NOT NULL UNIQUE,
  hostname TEXT,
  display_name TEXT,
  ip_address TEXT,
  last_seen INTEGER,
  is_active INTEGER DEFAULT 1,
  metadata TEXT,
  created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
  updated_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
);

CREATE INDEX IF NOT EXISTS idx_machines_id ON machines(machine_id);
CREATE INDEX IF NOT EXISTS idx_machines_active ON machines(is_active);
CREATE INDEX IF NOT EXISTS idx_machines_last_seen ON machines(last_seen);

-- Add machine_id column to existing tables
-- SQLite requires recreating tables to add columns with defaults in a safe way
-- We'll use ALTER TABLE ADD COLUMN which works for new columns

-- Add machine_id to metrics_raw (default to 'localhost' for backward compatibility)
-- This will fail silently if the column already exists, which is fine
ALTER TABLE metrics_raw ADD COLUMN machine_id TEXT DEFAULT 'localhost';
ALTER TABLE metrics_hourly ADD COLUMN machine_id TEXT DEFAULT 'localhost';
ALTER TABLE metrics_daily ADD COLUMN machine_id TEXT DEFAULT 'localhost';
ALTER TABLE system_events ADD COLUMN machine_id TEXT DEFAULT 'localhost';

-- Create indexes for machine_id (these will be created only if they don't exist)
CREATE INDEX IF NOT EXISTS idx_metrics_raw_machine ON metrics_raw(machine_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_metrics_hourly_machine ON metrics_hourly(machine_id, hour_start);
CREATE INDEX IF NOT EXISTS idx_metrics_daily_machine ON metrics_daily(machine_id, day_start);
CREATE INDEX IF NOT EXISTS idx_events_machine ON system_events(machine_id, timestamp);

-- Insert default localhost machine
INSERT OR IGNORE INTO machines (machine_id, hostname, display_name, is_active, last_seen)
VALUES ('localhost', 'localhost', 'Local Machine', 1, strftime('%s', 'now') * 1000);
