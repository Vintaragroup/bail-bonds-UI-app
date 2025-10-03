import { ensureWorker, getQueue } from './queueFactory.js';

const GPS_QUEUE = 'checkins:gps';

export function getGpsQueue() {
  return getQueue(GPS_QUEUE);
}

export function ensureGpsWorker() {
  const concurrency = Number(process.env.CHECKINS_QUEUE_CONCURRENCY || 2);
  return ensureWorker(
    GPS_QUEUE,
    async (job) => {
      console.log(`ℹ️  GPS queue received job ${job.id}`, job.name, job.data);
      // Placeholder: real implementation will dispatch notifications and wait for provider callback.
    },
    { concurrency, logSuccess: false },
  );
}
