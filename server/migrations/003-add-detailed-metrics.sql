-- Add detailed memory metrics
ALTER TABLE metrics_raw ADD COLUMN ram_free INTEGER;
ALTER TABLE metrics_raw ADD COLUMN ram_available INTEGER;
ALTER TABLE metrics_raw ADD COLUMN swap_total INTEGER;
ALTER TABLE metrics_raw ADD COLUMN swap_used INTEGER;
ALTER TABLE metrics_raw ADD COLUMN swap_percent REAL;
