import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import WebViewComponent from '../src/components/WebViewComponent';
import {
  MEMORIAL_SCHEDULE_RULE_ID,
  parseScreenScheduleMessage,
  scheduleChanged,
} from '../src/utils/memorialScreenSchedule';
import { getActiveSleepRule } from '../src/types/screenScheduler';

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ navigate: jest.fn() }) }));

const message = (fields: Record<string, unknown>) => ({ type: 'KIOSK_SCREEN_SCHEDULE', ...fields });

describe('memorial screen schedule', () => {
  it('turns the page message into one every-day rule', () => {
    const schedule = parseScreenScheduleMessage(
      message({ enabled: true, sleepTime: '00:00', wakeTime: '07:30' }),
    )!;
    expect(schedule.enabled).toBe(true);
    expect(schedule.rules).toEqual([
      expect.objectContaining({
        id: MEMORIAL_SCHEDULE_RULE_ID,
        days: [0, 1, 2, 3, 4, 5, 6],
        sleepTime: '00:00',
        wakeTime: '07:30',
      }),
    ]);
    // Apagada a las 3:00, encendida a las 9:00 (hora de la tablet).
    expect(getActiveSleepRule(schedule.rules, new Date(2026, 9, 12, 3, 0))).not.toBeNull();
    expect(getActiveSleepRule(schedule.rules, new Date(2026, 9, 12, 9, 0))).toBeNull();
  });

  it('handles a window that crosses midnight', () => {
    const { rules } = parseScreenScheduleMessage(
      message({ enabled: true, sleepTime: '22:30', wakeTime: '07:00' }),
    )!;
    expect(getActiveSleepRule(rules, new Date(2026, 9, 12, 23, 0))).not.toBeNull();
    expect(getActiveSleepRule(rules, new Date(2026, 9, 13, 6, 59))).not.toBeNull();
    expect(getActiveSleepRule(rules, new Date(2026, 9, 13, 7, 0))).toBeNull();
  });

  it('always on = scheduler off', () => {
    expect(parseScreenScheduleMessage(message({ enabled: false }))).toEqual({
      enabled: false,
      rules: [],
    });
  });

  it('ignores anything else', () => {
    for (const bad of [
      null,
      'x',
      { type: 'OTHER', enabled: false },
      message({}),
      message({ enabled: true }),
      message({ enabled: true, sleepTime: '25:00', wakeTime: '07:30' }),
      message({ enabled: true, sleepTime: '07:30', wakeTime: '07:30' }),
    ]) {
      expect(parseScreenScheduleMessage(bad)).toBeNull();
    }
  });

  it('knows when nothing changed', () => {
    const a = parseScreenScheduleMessage(message({ enabled: true, sleepTime: '00:00', wakeTime: '07:30' }))!;
    const b = parseScreenScheduleMessage(message({ enabled: true, sleepTime: '23:00', wakeTime: '07:30' }))!;
    expect(scheduleChanged(a, a)).toBe(false);
    expect(scheduleChanged(b, a)).toBe(true);
    expect(scheduleChanged({ enabled: false, rules: [] }, a)).toBe(true);
  });

  it('the WebView hands a valid schedule from the page to the kiosk', async () => {
    const onScreenSchedule = jest.fn();
    let tree!: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      tree = ReactTestRenderer.create(
        <WebViewComponent {...({ url: 'https://example.test/display/t', onScreenSchedule } as any)} />,
      );
    });
    const webView = tree.root.findAll((n) => typeof n.props.onMessage === 'function')[0]!;
    const send = async (data: unknown) =>
      ReactTestRenderer.act(async () => {
        webView.props.onMessage({ nativeEvent: { data: JSON.stringify(data) } });
      });
    await send(message({ enabled: true, sleepTime: '00:00', wakeTime: '07:30' }));
    await send(message({ enabled: true, sleepTime: 'nope', wakeTime: '07:30' }));
    expect(onScreenSchedule).toHaveBeenCalledTimes(1);
    expect(onScreenSchedule.mock.calls[0][0].rules[0].sleepTime).toBe('00:00');
  });
});
