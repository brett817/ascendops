import { describe, it, expect } from 'vitest';
import { evaluateShift, type ShiftSchedule } from '../../../src/daemon/shift.js';

const NY = 'America/New_York';

// Helpers — produce a Date that, when interpreted in `tz`, lands on the desired wall clock.
// Strategy: build an ISO string with explicit UTC offset for that wall clock.
// For NY: April–November = EDT (UTC-4); December–March = EST (UTC-5).
function nyEDT(dateStr: string, hhmm: string): Date {
  // EDT = UTC-4
  return new Date(`${dateStr}T${hhmm}:00-04:00`);
}
function nyEST(dateStr: string, hhmm: string): Date {
  // EST = UTC-5
  return new Date(`${dateStr}T${hhmm}:00-05:00`);
}

describe('evaluateShift', () => {
  describe('backwards compat — undefined schedule', () => {
    it('returns in_shift always when schedule is undefined', () => {
      const now = nyEDT('2026-05-01', '03:00'); // 3am Friday EDT
      const result = evaluateShift(now, undefined, NY);
      expect(result).toEqual({
        in_shift: true,
        off_shift_emergency_only: false,
        off_shift_no_wake: false,
      });
    });
  });

  describe('weekly schedule — basic in/out', () => {
    const sched: ShiftSchedule = {
      weekly: {
        mon: { start: '09:00', end: '18:00' },
        tue: { start: '09:00', end: '18:00' },
        wed: { start: '09:00', end: '18:00' },
        thu: { start: '09:00', end: '18:00' },
        fri: { start: '09:00', end: '18:00' },
        sat: 'off',
        sun: 'off',
      },
    };

    it('weekday at 10:00 → in_shift', () => {
      const now = nyEDT('2026-05-01', '10:00'); // Friday
      const result = evaluateShift(now, sched, NY);
      expect(result.in_shift).toBe(true);
    });

    it('weekday at 19:00 (after end, no allowlist) → off_shift_no_wake', () => {
      const now = nyEDT('2026-05-01', '19:00'); // Friday after end
      const result = evaluateShift(now, sched, NY);
      expect(result).toEqual({
        in_shift: false,
        off_shift_emergency_only: false,
        off_shift_no_wake: true,
      });
    });

    it('saturday "off" → off_shift_no_wake (no allowlist)', () => {
      const now = nyEDT('2026-05-02', '14:00'); // Saturday
      const result = evaluateShift(now, sched, NY);
      expect(result.off_shift_no_wake).toBe(true);
    });
  });

  describe('emergency_override allowlist', () => {
    const sched: ShiftSchedule = {
      weekly: {
        mon: { start: '09:00', end: '18:00' },
        tue: { start: '09:00', end: '18:00' },
        wed: { start: '09:00', end: '18:00' },
        thu: { start: '09:00', end: '18:00' },
        fri: { start: '09:00', end: '18:00' },
        sat: 'off',
        sun: 'off',
      },
      emergency_override: {
        off_shift_can_wake_for: ['safety', 'flood', 'fire'],
      },
    };

    it('weekday off-shift with allowlist → off_shift_emergency_only', () => {
      const now = nyEDT('2026-05-01', '20:00'); // Friday after end
      const result = evaluateShift(now, sched, NY);
      expect(result).toEqual({
        in_shift: false,
        off_shift_emergency_only: true,
        off_shift_no_wake: false,
      });
    });

    it('saturday off-shift with allowlist → off_shift_emergency_only', () => {
      const now = nyEDT('2026-05-02', '14:00'); // Saturday
      const result = evaluateShift(now, sched, NY);
      expect(result.off_shift_emergency_only).toBe(true);
    });

    it('empty allowlist → off_shift_no_wake', () => {
      const emptySched: ShiftSchedule = {
        ...sched,
        emergency_override: { off_shift_can_wake_for: [] },
      };
      const now = nyEDT('2026-05-02', '14:00'); // Saturday
      const result = evaluateShift(now, emptySched, NY);
      expect(result.off_shift_no_wake).toBe(true);
    });
  });

  describe('"24h" sentinel', () => {
    it('weekly.sun = "24h", sunday 03:00 → in_shift', () => {
      const sched: ShiftSchedule = {
        weekly: {
          mon: { start: '09:00', end: '18:00' },
          tue: { start: '09:00', end: '18:00' },
          wed: { start: '09:00', end: '18:00' },
          thu: { start: '09:00', end: '18:00' },
          fri: { start: '09:00', end: '18:00' },
          sat: { start: '09:00', end: '18:00' },
          sun: '24h',
        },
      };
      const now = nyEDT('2026-05-03', '03:00'); // Sunday 3am
      const result = evaluateShift(now, sched, NY);
      expect(result.in_shift).toBe(true);
    });
  });

  describe('exception_days override', () => {
    const sched: ShiftSchedule = {
      weekly: {
        mon: { start: '09:00', end: '18:00' },
        tue: { start: '09:00', end: '18:00' },
        wed: { start: '09:00', end: '18:00' },
        thu: { start: '09:00', end: '18:00' },
        fri: { start: '09:00', end: '18:00' },
        sat: 'off',
        sun: 'off',
      },
      exception_days: [
        { date: '2026-05-01', shift: 'off', reason: 'May Day holiday' },
        { date: '2026-05-02', shift: '24h', reason: 'launch all-hands' },
        { date: '2026-05-03', shift: { start: '12:00', end: '16:00' }, reason: 'reduced Sunday' },
      ],
    };

    it('exception "off" overrides weekly working day', () => {
      const now = nyEDT('2026-05-01', '10:00'); // Friday — would normally be in_shift
      const result = evaluateShift(now, sched, NY);
      expect(result.in_shift).toBe(false);
    });

    it('exception "24h" overrides weekly off day', () => {
      const now = nyEDT('2026-05-02', '03:00'); // Saturday — would normally be off
      const result = evaluateShift(now, sched, NY);
      expect(result.in_shift).toBe(true);
    });

    it('exception window overrides weekly off day', () => {
      const onlyEDT = nyEDT('2026-05-03', '13:00'); // Sunday inside exception window
      const offEDT = nyEDT('2026-05-03', '17:00'); // Sunday outside exception window
      expect(evaluateShift(onlyEDT, sched, NY).in_shift).toBe(true);
      expect(evaluateShift(offEDT, sched, NY).in_shift).toBe(false);
    });
  });

  describe('window boundary inclusivity', () => {
    const sched: ShiftSchedule = {
      weekly: {
        mon: { start: '09:00', end: '18:00' },
        tue: { start: '09:00', end: '18:00' },
        wed: { start: '09:00', end: '18:00' },
        thu: { start: '09:00', end: '18:00' },
        fri: { start: '09:00', end: '18:00' },
        sat: 'off',
        sun: 'off',
      },
    };

    it('time == start → in_shift (inclusive start)', () => {
      const now = nyEDT('2026-05-01', '09:00'); // Friday at 09:00 sharp
      const result = evaluateShift(now, sched, NY);
      expect(result.in_shift).toBe(true);
    });

    it('time == end → off_shift (exclusive end)', () => {
      const now = nyEDT('2026-05-01', '18:00'); // Friday at 18:00 sharp
      const result = evaluateShift(now, sched, NY);
      expect(result.in_shift).toBe(false);
    });
  });

  describe('midnight-crossing window', () => {
    const sched: ShiftSchedule = {
      weekly: {
        mon: { start: '22:00', end: '06:00' },
        tue: { start: '22:00', end: '06:00' },
        wed: { start: '22:00', end: '06:00' },
        thu: { start: '22:00', end: '06:00' },
        fri: { start: '22:00', end: '06:00' },
        sat: { start: '22:00', end: '06:00' },
        sun: { start: '22:00', end: '06:00' },
      },
    };

    it('inside post-midnight portion → in_shift', () => {
      const now = nyEDT('2026-05-01', '03:00'); // Friday at 03:00
      const result = evaluateShift(now, sched, NY);
      expect(result.in_shift).toBe(true);
    });

    it('inside pre-midnight portion → in_shift', () => {
      const now = nyEDT('2026-05-01', '23:00'); // Friday at 23:00
      const result = evaluateShift(now, sched, NY);
      expect(result.in_shift).toBe(true);
    });

    it('between end and start (daytime) → off_shift', () => {
      const now = nyEDT('2026-05-01', '12:00'); // Friday noon
      const result = evaluateShift(now, sched, NY);
      expect(result.in_shift).toBe(false);
    });
  });

  describe('timezone correctness', () => {
    it('UTC instant interpreted in NY timezone, not system local', () => {
      // 2026-05-01T22:00:00Z = 18:00 EDT = exactly at end (off_shift)
      // If system used UTC, would think it's 22:00 → also off_shift, so we need a clearer test.
      // Better: pick a UTC instant where NY interpretation differs from UTC interpretation.
      // 2026-05-02T01:30:00Z = 21:30 EDT Friday May 1 (off_shift mon-fri 09-18)
      //                     = 01:30 UTC Saturday May 2
      // Schedule: mon-fri 09-18 in NY tz, sat off.
      const sched: ShiftSchedule = {
        weekly: {
          mon: { start: '09:00', end: '18:00' },
          tue: { start: '09:00', end: '18:00' },
          wed: { start: '09:00', end: '18:00' },
          thu: { start: '09:00', end: '18:00' },
          fri: { start: '09:00', end: '18:00' },
          sat: 'off',
          sun: 'off',
        },
      };
      const now = new Date('2026-05-02T01:30:00Z'); // = Friday 21:30 NY EDT (off_shift)
      const nyResult = evaluateShift(now, sched, NY);
      expect(nyResult.in_shift).toBe(false); // Friday 21:30 NY is past 18:00 cutoff

      // Same UTC instant in UTC timezone interpretation:
      // 2026-05-02 01:30 UTC = Saturday 01:30 → also off (sat off in this schedule)
      // So UTC interpretation also returns off, but for a DIFFERENT REASON (Saturday vs late Friday).
      // Use exception_days to verify which day the function actually saw.
      const schedWithFriException: ShiftSchedule = {
        ...sched,
        exception_days: [
          { date: '2026-05-01', shift: '24h', reason: 'NY Friday all-day' },
        ],
      };
      // If function interprets in NY tz, sees Friday May 1 → exception_days "24h" → in_shift
      // If function interprets in UTC, sees Saturday May 2 → no exception, weekly.sat = "off" → off_shift
      const checkNy = evaluateShift(now, schedWithFriException, NY);
      expect(checkNy.in_shift).toBe(true); // Confirms NY interpretation, not UTC
    });
  });

  describe('emergency_override interaction with "24h" / in_shift', () => {
    it('"24h" day → in_shift even with allowlist', () => {
      const sched: ShiftSchedule = {
        weekly: {
          mon: '24h',
          tue: '24h',
          wed: '24h',
          thu: '24h',
          fri: '24h',
          sat: '24h',
          sun: '24h',
        },
        emergency_override: { off_shift_can_wake_for: ['safety'] },
      };
      const now = nyEDT('2026-05-03', '03:00');
      const result = evaluateShift(now, sched, NY);
      expect(result.in_shift).toBe(true);
      expect(result.off_shift_emergency_only).toBe(false);
    });
  });

  describe('EST (winter) timezone correctness', () => {
    it('honors EST offset for December dates', () => {
      const sched: ShiftSchedule = {
        weekly: {
          mon: { start: '09:00', end: '18:00' },
          tue: { start: '09:00', end: '18:00' },
          wed: { start: '09:00', end: '18:00' },
          thu: { start: '09:00', end: '18:00' },
          fri: { start: '09:00', end: '18:00' },
          sat: 'off',
          sun: 'off',
        },
      };
      // Wednesday Dec 16 2026 at 14:00 EST
      const now = nyEST('2026-12-16', '14:00');
      const result = evaluateShift(now, sched, NY);
      expect(result.in_shift).toBe(true);
    });
  });
});
