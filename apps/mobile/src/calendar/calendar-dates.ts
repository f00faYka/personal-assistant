import type { LocalDate } from "../day/selected-day";

export interface CalendarMonth {
  readonly year: number;
  readonly month: number;
}

export function shiftCalendarMonth(month: CalendarMonth, offset: number): CalendarMonth {
  const shifted = new Date(month.year, month.month - 1 + offset, 1);
  return { year: shifted.getFullYear(), month: shifted.getMonth() + 1 };
}

export function calendarMonthDays(month: CalendarMonth): readonly (LocalDate | null)[] {
  const firstWeekday = new Date(month.year, month.month - 1, 1).getDay();
  const dayCount = new Date(month.year, month.month, 0).getDate();
  const cellCount = Math.ceil((firstWeekday + dayCount) / 7) * 7;

  return Array.from({ length: cellCount }, (_, index) => {
    const day = index - firstWeekday + 1;
    return day < 1 || day > dayCount
      ? null
      : `${month.year}-${String(month.month).padStart(2, "0")}-${String(day).padStart(2, "0")}` as LocalDate;
  });
}
