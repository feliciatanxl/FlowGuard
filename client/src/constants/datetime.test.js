import { describe, it, expect } from 'vitest';
import {
  bookingWindowMinutes,
  addSingaporeMinutesToLocalInput,
  validateBookingWindowLocal,
  formatDurationMinutes,
  singaporeLocalInputToIso,
} from './datetime';

// These helpers must be host-timezone independent (a kiosk in any zone measures the
// same Singapore wall-clock window), so every assertion holds regardless of TZ.
describe('Singapore booking-window helpers', () => {
  it('measures a 6–7 PM SG window as exactly 60 minutes', () => {
    expect(bookingWindowMinutes('2026-08-10T18:00', '2026-08-10T19:00')).toBe(60);
  });

  it('measures a 6–8 PM SG window as exactly 120 minutes', () => {
    expect(bookingWindowMinutes('2026-08-10T18:00', '2026-08-10T20:00')).toBe(120);
  });

  it('returns null when a value is missing/unparseable', () => {
    expect(bookingWindowMinutes('', '2026-08-10T19:00')).toBeNull();
    expect(bookingWindowMinutes('2026-08-10T18:00', '')).toBeNull();
  });

  it('suggests an end exactly one hour after the start (Singapore wall clock)', () => {
    expect(addSingaporeMinutesToLocalInput('2026-08-10T18:00', 60)).toBe('2026-08-10T19:00');
    // The suggested end, converted to UTC, is one hour after the start's UTC instant.
    const startIso = singaporeLocalInputToIso('2026-08-10T18:00');
    const endLocal = addSingaporeMinutesToLocalInput('2026-08-10T18:00', 60);
    const endIso = singaporeLocalInputToIso(endLocal);
    expect(new Date(endIso).getTime() - new Date(startIso).getTime()).toBe(60 * 60000);
  });

  it('accepts 60 and 120 minutes, rejects 59 and 121 with the API messages', () => {
    expect(validateBookingWindowLocal('2026-08-10T18:00', '2026-08-10T19:00')).toMatchObject({ ok: true, durationMinutes: 60 });
    expect(validateBookingWindowLocal('2026-08-10T18:00', '2026-08-10T20:00')).toMatchObject({ ok: true, durationMinutes: 120 });
    expect(validateBookingWindowLocal('2026-08-10T18:00', '2026-08-10T18:59')).toMatchObject({
      ok: false, error: 'Booking duration must be at least 1 hour.',
    });
    expect(validateBookingWindowLocal('2026-08-10T18:00', '2026-08-10T20:01')).toMatchObject({
      ok: false, error: 'Booking duration cannot exceed 2 hours.',
    });
  });

  it('requires both slots and rejects end-before-start', () => {
    expect(validateBookingWindowLocal('', '')).toMatchObject({ ok: false, error: 'slot_start and slot_end are required.' });
    expect(validateBookingWindowLocal('2026-08-10T19:00', '2026-08-10T18:00')).toMatchObject({
      ok: false, error: 'slot_end must be after slot_start.',
    });
  });

  it('formats durations for display', () => {
    expect(formatDurationMinutes(60)).toBe('1 h');
    expect(formatDurationMinutes(90)).toBe('1 h 30 m');
    expect(formatDurationMinutes(45)).toBe('45 m');
    expect(formatDurationMinutes(null)).toBe('—');
  });
});
