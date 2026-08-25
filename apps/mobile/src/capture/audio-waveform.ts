const MIN_METERING_DB = -60;
const MAX_METERING_DB = 0;
const MIN_BAR_HEIGHT = 6;
const MAX_BAR_HEIGHT = 38;

const BAR_PROFILE = [0.55, 0.75, 0.95, 0.65, 1, 0.8, 0.6, 0.9, 0.7, 1, 0.58, 0.82, 0.62, 0.92, 0.72, 1, 0.58, 0.84, 0.68, 0.96, 0.56, 0.78, 0.64, 0.88] as const;

export const FALLBACK_WAVEFORM_BARS = BAR_PROFILE.map((profile) => Math.round(MIN_BAR_HEIGHT + (MAX_BAR_HEIGHT - MIN_BAR_HEIGHT) * 0.2 * profile));

export function createWaveformBars(metering: number | undefined): readonly number[] {
  if (metering === undefined || !Number.isFinite(metering)) return FALLBACK_WAVEFORM_BARS;

  const level = Math.max(0, Math.min(1, (metering - MIN_METERING_DB) / (MAX_METERING_DB - MIN_METERING_DB)));
  return BAR_PROFILE.map((profile) => Math.round(MIN_BAR_HEIGHT + (MAX_BAR_HEIGHT - MIN_BAR_HEIGHT) * level * profile));
}
