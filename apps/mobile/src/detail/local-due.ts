const pad = (value: number) => String(value).padStart(2, "0");

export function localDate(value: Date): string {
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
}

export function localTime(value: Date): string {
  return `${pad(value.getHours())}:${pad(value.getMinutes())}`;
}

// Reject normalized dates and DST gaps instead of silently changing the Member's selection.
export function parseLocalDue(date: string, time: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return null;
  const value = new Date(`${date}T${time}:00`);
  return !Number.isNaN(value.getTime()) && localDate(value) === date && localTime(value) === time ? value : null;
}
