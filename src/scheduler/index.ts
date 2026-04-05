import cron from 'node-cron';
import { supabaseAdmin } from '../services/supabase';
import { runAutopilotForUser } from './autopilotRun';

// Map from user_id → cron task
const userJobs = new Map<string, cron.ScheduledTask>();

/**
 * Register a cron job for a user's autopilot config
 */
export function registerUserJob(config: {
  user_id: string;
  schedule_time: string;   // "HH:MM"
  schedule_days: number[]; // 0=Sun ... 6=Sat
}): void {
  // Cancel existing job first
  unregisterUserJob(config.user_id);

  const [hour, minute] = config.schedule_time.split(':').map(Number);
  const daysStr = config.schedule_days.join(','); // "1,3,5" for Mon,Wed,Fri
  const cronExpr = `${minute} ${hour} * * ${daysStr}`;

  if (!cron.validate(cronExpr)) {
    console.error(`[Scheduler] Invalid cron expression for user ${config.user_id}: ${cronExpr}`);
    return;
  }

  const task = cron.schedule(cronExpr, async () => {
    console.log(`[Scheduler] Running autopilot for user ${config.user_id}`);
    await runAutopilotForUser(config.user_id);
  }, { timezone: 'UTC' });

  userJobs.set(config.user_id, task);
  console.log(`[Scheduler] Registered job for user ${config.user_id}: ${cronExpr}`);
}

/**
 * Unregister a user's cron job
 */
export function unregisterUserJob(userId: string): void {
  const existing = userJobs.get(userId);
  if (existing) {
    existing.stop();
    userJobs.delete(userId);
    console.log(`[Scheduler] Unregistered job for user ${userId}`);
  }
}

/**
 * Load all enabled autopilot configs from DB and register cron jobs
 * Called once on server start
 */
export async function initScheduler(): Promise<void> {
  console.log('[Scheduler] Initializing...');

  const { data: configs, error } = await supabaseAdmin
    .from('autopilot_configs')
    .select('user_id, schedule_time, schedule_days')
    .eq('enabled', true);

  if (error) {
    console.error('[Scheduler] Failed to load configs:', error.message);
    return;
  }

  for (const config of configs || []) {
    registerUserJob(config);
  }

  console.log(`[Scheduler] Initialized ${configs?.length || 0} user jobs`);
}

export function getActiveJobCount(): number {
  return userJobs.size;
}
