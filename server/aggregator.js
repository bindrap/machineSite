const cron = require('node-cron');
const { getDatabase } = require('./db');

/**
 * Aggregator handles periodic aggregation of metrics data
 * - Hourly: Aggregates raw data into hourly summaries
 * - Daily: Aggregates hourly data into daily summaries
 * - Cleanup: Removes old data based on retention policies
 */
class MetricsAggregator {
  constructor() {
    this.db = getDatabase();
    this.jobs = [];
  }

  /**
   * Start all aggregation jobs
   */
  start() {
    // Run hourly aggregation at 5 minutes past every hour
    const hourlyJob = cron.schedule('5 * * * *', () => {
      this.runHourlyAggregation();
    });
    this.jobs.push({ name: 'hourly', job: hourlyJob });

    // Run daily aggregation at 00:10 every day
    const dailyJob = cron.schedule('10 0 * * *', () => {
      this.runDailyAggregation();
    });
    this.jobs.push({ name: 'daily', job: dailyJob });

    // Run cleanup at 02:00 every day
    const cleanupJob = cron.schedule('0 2 * * *', () => {
      this.runCleanup();
    });
    this.jobs.push({ name: 'cleanup', job: cleanupJob });

    console.log('MetricsAggregator started with 3 jobs:');
    console.log('  - Hourly aggregation: every hour at :05');
    console.log('  - Daily aggregation: every day at 00:10');
    console.log('  - Cleanup: every day at 02:00');

    // Run initial aggregation after 30 seconds to catch up
    setTimeout(() => {
      this.runHourlyAggregation();
    }, 30000);
  }

  /**
   * Stop all aggregation jobs
   */
  stop() {
    this.jobs.forEach(({ name, job }) => {
      job.stop();
      console.log(`Stopped ${name} aggregation job`);
    });
    this.jobs = [];
  }

  /**
   * Run hourly aggregation for the previous hour
   */
  runHourlyAggregation() {
    try {
      const now = Date.now();
      const currentHour = Math.floor(now / (1000 * 60 * 60)) * (1000 * 60 * 60);
      const previousHour = currentHour - (60 * 60 * 1000);

      console.log(`Running hourly aggregation for ${new Date(previousHour).toISOString()}`);

      // Get all machines and aggregate for each
      const machines = this.db.getMachines();
      let totalSamples = 0;

      for (const machine of machines) {
        const result = this.db.aggregateHourly(machine.machine_id, previousHour);

        if (result) {
          console.log(`Hourly aggregation for ${machine.machine_id}: ${result.sample_count} samples`);
          totalSamples += result.sample_count;
        }
      }

      if (totalSamples > 0) {
        console.log(`Hourly aggregation complete: ${totalSamples} total samples across ${machines.length} machines`);
      } else {
        console.log('No data to aggregate for this hour');
      }
    } catch (err) {
      console.error('Hourly aggregation failed:', err.message);
    }
  }

  /**
   * Run daily aggregation for the previous day
   */
  runDailyAggregation() {
    try {
      const now = Date.now();
      const currentDay = Math.floor(now / (1000 * 60 * 60 * 24)) * (1000 * 60 * 60 * 24);
      const previousDay = currentDay - (24 * 60 * 60 * 1000);

      console.log(`Running daily aggregation for ${new Date(previousDay).toISOString()}`);

      // Get all machines and aggregate for each
      const machines = this.db.getMachines();
      let totalSamples = 0;

      for (const machine of machines) {
        const result = this.db.aggregateDaily(machine.machine_id, previousDay);

        if (result) {
          console.log(`Daily aggregation for ${machine.machine_id}: ${result.sample_count} samples`);
          totalSamples += result.sample_count;
        }
      }

      if (totalSamples > 0) {
        console.log(`Daily aggregation complete: ${totalSamples} total samples across ${machines.length} machines`);
      } else {
        console.log('No data to aggregate for this day');
      }
    } catch (err) {
      console.error('Daily aggregation failed:', err.message);
    }
  }

  /**
   * Run cleanup to remove old data
   */
  runCleanup() {
    try {
      console.log('Running database cleanup...');
      const deletedCount = this.db.cleanup();
      console.log(`Cleanup complete: removed ${deletedCount} records`);
    } catch (err) {
      console.error('Cleanup failed:', err.message);
    }
  }

  /**
   * Manually trigger aggregation for a specific time range
   * Useful for backfilling or testing
   */
  aggregateRange(machineId, startTimestamp, endTimestamp, granularity = 'hourly') {
    const results = [];

    if (granularity === 'hourly') {
      let current = Math.floor(startTimestamp / (1000 * 60 * 60)) * (1000 * 60 * 60);
      const end = Math.floor(endTimestamp / (1000 * 60 * 60)) * (1000 * 60 * 60);

      while (current < end) {
        const result = this.db.aggregateHourly(machineId, current);
        if (result) {
          results.push(result);
        }
        current += 60 * 60 * 1000;
      }
    } else if (granularity === 'daily') {
      let current = Math.floor(startTimestamp / (1000 * 60 * 60 * 24)) * (1000 * 60 * 60 * 24);
      const end = Math.floor(endTimestamp / (1000 * 60 * 60 * 24)) * (1000 * 60 * 60 * 24);

      while (current < end) {
        const result = this.db.aggregateDaily(machineId, current);
        if (result) {
          results.push(result);
        }
        current += 24 * 60 * 60 * 1000;
      }
    }

    return results;
  }

  /**
   * Get aggregator status
   */
  getStatus() {
    return {
      jobs: this.jobs.map(({ name, job }) => ({
        name,
        running: job.running || false
      })),
      db_stats: this.db.getStats()
    };
  }
}

module.exports = { MetricsAggregator };
