/**
 * Digital Memorial: screen schedule sent by the display page. Each funeral home sets it in the panel (default: off
 * 00:00, on 07:30). The page posts {type:'KIOSK_SCREEN_SCHEDULE', enabled, sleepTime, wakeTime} whenever it
 * loads it; this turns it into the FreeKiosk screen scheduler config, which does the real screen off/on (native
 * alarms as Device Owner) and survives restarts.
 */
import { isValidTime, type ScreenScheduleRule } from '../types/screenScheduler';

export const MEMORIAL_SCHEDULE_RULE_ID = 'digital_memorial';

export interface MemorialScreenSchedule {
  enabled: boolean;
  rules: ScreenScheduleRule[];
}

/** The scheduler config for a page message, or null if the message is not a valid schedule. */
export function parseScreenScheduleMessage(data: unknown): MemorialScreenSchedule | null {
  if (!data || typeof data !== 'object') return null;
  const m = data as Record<string, unknown>;
  if (m.type !== 'KIOSK_SCREEN_SCHEDULE' || typeof m.enabled !== 'boolean') return null;
  if (!m.enabled) return { enabled: false, rules: [] };
  const { sleepTime, wakeTime } = m;
  if (typeof sleepTime !== 'string' || typeof wakeTime !== 'string') return null;
  if (!isValidTime(sleepTime) || !isValidTime(wakeTime) || sleepTime === wakeTime) return null;
  return {
    enabled: true,
    rules: [
      {
        id: MEMORIAL_SCHEDULE_RULE_ID,
        name: 'Memorial Digital',
        enabled: true,
        days: [0, 1, 2, 3, 4, 5, 6],
        sleepTime,
        wakeTime,
      },
    ],
  };
}

/** Whether applying `next` would change what the scheduler already has. */
export function scheduleChanged(
  next: MemorialScreenSchedule,
  current: { enabled: boolean; rules: ScreenScheduleRule[] },
): boolean {
  return next.enabled !== current.enabled || JSON.stringify(next.rules) !== JSON.stringify(current.rules);
}
