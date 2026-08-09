import type { P3Window } from "./availability";

const WINDOW_DAYS: Record<P3Window, number> = { "1D": 1, "3D": 3, "7D": 7, "14D": 14 };

export interface P3WindowResolution {
  window: P3Window;
  windowStart: Date;
  windowEnd: Date;
  startTarget: Date;
  endTarget: Date;
}

function assertUtcBoundary(value: Date): void {
  if (Number.isNaN(value.getTime())) throw new Error("Invalid window end");
  if (value.getUTCHours() !== 0 || value.getUTCMinutes() !== 0 || value.getUTCSeconds() !== 0 || value.getUTCMilliseconds() !== 0) {
    throw new Error("P3 window end must be a UTC day boundary");
  }
}

export function resolveP3Window(window: P3Window, windowEnd: Date): P3WindowResolution {
  assertUtcBoundary(windowEnd);
  const days = WINDOW_DAYS[window];
  const endTarget = new Date(windowEnd.getTime() - 24 * 60 * 60 * 1000);
  const startTarget = new Date(windowEnd.getTime() - (days + 1) * 24 * 60 * 60 * 1000);
  return { window, windowStart: startTarget, windowEnd, startTarget, endTarget };
}

export function utcDayStart(value: Date): Date {
  if (Number.isNaN(value.getTime())) throw new Error("Invalid timestamp");
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

export function windowDays(window: P3Window): number { return WINDOW_DAYS[window]; }
