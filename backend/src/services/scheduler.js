import cron from 'node-cron';
import { prepare } from '../config/database.js';
import { recoverStuckCreativeJobs } from './creative/creativeVideoEngine.js';

let creativeVideoCronJob = null;

function refreshCreativeVideoSchedule() {
  const row = prepare(`SELECT value FROM settings WHERE key = 'creative_video_cron'`).get();
  const expr = (row?.value || '0 14 * * *').trim();
  if (creativeVideoCronJob) {
    creativeVideoCronJob.stop();
    creativeVideoCronJob = null;
  }
  if (!cron.validate(expr)) {
    console.warn('⚠️ Invalid creative_video_cron:', expr);
    return;
  }
  creativeVideoCronJob = cron.schedule(expr, async () => {
    try {
      const { runScheduledCreativeIfEnabled } = await import('./creative/creativeVideoEngine.js');
      await runScheduledCreativeIfEnabled();
    } catch (e) {
      console.error('shortvid cron error:', e);
    }
  });
  console.log(`🎬 shortvid cron: ${expr}`);
}

const scheduler = {
  init() {
    refreshCreativeVideoSchedule();
    cron.schedule('*/8 * * * *', () => {
      try {
        recoverStuckCreativeJobs(45);
      } catch (e) {
        console.error('shortvid stuck job recovery:', e);
      }
    });
  },
  rescheduleCreativeVideo() {
    refreshCreativeVideoSchedule();
  }
};

export default scheduler;
