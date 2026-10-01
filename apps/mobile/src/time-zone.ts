export const DEFAULT_TIME_ZONE = "UTC";

export function getDeviceTimeZone(): string {
  try {
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (timeZone) {
      new Intl.DateTimeFormat("en-US", { timeZone }).format();
      return timeZone;
    }
  } catch {
    // Fall through to the deterministic UTC rendering and submission fallback.
  }
  return DEFAULT_TIME_ZONE;
}
