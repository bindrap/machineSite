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

-- Add machine_id column to existing tables (only if not exists)
-- SQLite doesn't support IF NOT EXISTS for ALTER COLUMN, so we check via pragma
-- Skip if column already exists (will silently fail if column exists, which is fine)

-- Try to add columns (will error if exists, but we handle it in code)
-- For now, we'll skip the ALTER TABLE commands since they were already run

-- Create indexes for machine_id
CREATE INDEX IF NOT EXISTS idx_metrics_raw_machine ON metrics_raw(machine_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_metrics_hourly_machine ON metrics_hourly(machine_id, hour_start);
CREATE INDEX IF NOT EXISTS idx_metrics_daily_machine ON metrics_daily(machine_id, day_start);
CREATE INDEX IF NOT EXISTS idx_events_machine ON system_events(machine_id, timestamp);

-- Insert default localhost machine
INSERT OR IGNORE INTO machines (machine_id, hostname, display_name, is_active, last_seen)
VALUES ('localhost', 'localhost', 'Local Machine', 1, strftime('%s', 'now') * 1000);
