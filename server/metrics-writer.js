const { getDatabase } = require('./db');

/**
 * MetricsWriter handles batched writes to the database
 * to avoid I/O bottlenecks from writing every 2 seconds
 */
class MetricsWriter {
  constructor(options = {}) {
    this.queue = [];
    this.maxQueueSize = options.maxQueueSize || 100;
    this.flushInterval = options.flushInterval || 10000; // 10 seconds
    this.db = getDatabase();
    this.intervalId = null;
    this.isRunning = false;
  }

  /**
   * Start the batched write worker
   */
  start() {
    if (this.isRunning) {
      console.warn('MetricsWriter already running');
      return;
    }

    this.isRunning = true;
    this.intervalId = setInterval(() => {
      this.flush();
    }, this.flushInterval);

    console.log(`MetricsWriter started (flush every ${this.flushInterval}ms)`);
  }

  /**
   * Stop the batched write worker
   */
  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    // Flush any remaining metrics
    if (this.queue.length > 0) {
      this.flush();
    }

    this.isRunning = false;
    console.log('MetricsWriter stopped');
  }

  /**
   * Add a metric to the write queue
   * @param {Object} metric - The metric object to write
   */
  enqueue(metric) {
    // Add to queue
    this.queue.push(metric);

    // Drop oldest if queue is full (prioritize real-time over history)
    if (this.queue.length > this.maxQueueSize) {
      const dropped = this.queue.shift();
      console.warn('Metrics queue full, dropped oldest metric:', new Date(dropped.timestamp).toISOString());
    }
  }

  /**
   * Flush all queued metrics to the database
   */
  flush() {
    if (this.queue.length === 0) {
      return;
    }

    const batch = this.queue.splice(0);

    try {
      const startTime = Date.now();
      this.db.insertMetricsBatch(batch);
      const duration = Date.now() - startTime;

      console.log(`Flushed ${batch.length} metrics to database in ${duration}ms`);
    } catch (err) {
      console.error('Failed to flush metrics batch:', err.message);

      // On error, put metrics back in queue to retry
      // But only if queue isn't already full
      if (this.queue.length + batch.length <= this.maxQueueSize) {
        this.queue.unshift(...batch);
      } else {
        console.error(`Failed to requeue ${batch.length} metrics - queue full`);
      }
    }
  }

  /**
   * Get current queue size
   */
  getQueueSize() {
    return this.queue.length;
  }

  /**
   * Get stats about the writer
   */
  getStats() {
    return {
      queue_size: this.queue.length,
      max_queue_size: this.maxQueueSize,
      flush_interval_ms: this.flushInterval,
      is_running: this.isRunning
    };
  }
}

module.exports = { MetricsWriter };
