import { describe, expect, it } from "vitest";

import { calendarMonthDays, shiftCalendarMonth } from "./calendar-dates";

describe("Calendar month navigation", () => {
  it("moves across the year boundary in either direction", () => {
    expect(shiftCalendarMonth({ year: 2026, month: 12 }, 1)).toEqual({ year: 2027, month: 1 });
    expect(shiftCalendarMonth({ year: 2027, month: 1 }, -1)).toEqual({ year: 2026, month: 12 });
  });

  it("lays out every date in a Sunday-first month grid", () => {
    const days = calendarMonthDays({ year: 2026, month: 10 });

    expect(days.slice(0, 4)).toEqual([null, null, null, null]);
    expect(days[4]).toBe("2026-10-01");
    expect(days[34]).toBe("2026-10-31");
    expect(days).toHaveLength(35);
  });
});
