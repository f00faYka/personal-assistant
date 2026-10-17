import { describe, expect, test } from "vitest";
import { localDate, localTime, parseLocalDue } from "./local-due";

describe("local due information", () => {
  test.each(["24:00", "12:60", "-1:00", "9:30", "", "NaN"])('rejects invalid 24-hour time %s', (time) => {
    expect(parseLocalDue("2026-10-20", time)).toBeNull();
  });
  test("rejects impossible calendar dates", () => {
    expect(parseLocalDue("2026-02-30", "09:00")).toBeNull();
  });
  test("accepts midnight and the last minute of the day", () => {
    expect(localTime(parseLocalDue("2026-10-20", "00:00")!)).toBe("00:00");
    expect(localTime(parseLocalDue("2026-10-20", "23:59")!)).toBe("23:59");
  });
  test.skipIf(Intl.DateTimeFormat().resolvedOptions().timeZone !== "Europe/Warsaw")("uses Warsaw local time across UTC date and DST boundaries", () => {
    expect(localDate(new Date("2026-10-19T22:30:00Z"))).toBe("2026-10-20");
    expect(localTime(new Date("2026-10-19T22:30:00Z"))).toBe("00:30");
    expect(parseLocalDue("2026-10-20", "09:00")?.toISOString()).toBe("2026-10-20T07:00:00.000Z");
    expect(parseLocalDue("2026-12-20", "09:00")?.toISOString()).toBe("2026-12-20T08:00:00.000Z");
    expect(parseLocalDue("2026-03-29", "02:30")).toBeNull();
  });
});
