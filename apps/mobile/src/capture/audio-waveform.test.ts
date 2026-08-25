import { describe, expect, test } from "vitest";

import { FALLBACK_WAVEFORM_BARS, createWaveformBars } from "./audio-waveform";

describe("microphone waveform", () => {
  test("uses a quiet bounded fallback when metering is unavailable", () => {
    const bars = createWaveformBars(undefined);

    expect(bars).toEqual(FALLBACK_WAVEFORM_BARS);
    expect(bars.every((height) => height >= 6 && height <= 38)).toBe(true);
  });

  test("renders silence as the quietest bounded signal", () => {
    const bars = createWaveformBars(-60);

    expect(Math.max(...bars)).toBe(6);
    expect(Math.min(...bars)).toBe(6);
  });

  test("renders changing microphone levels as visibly different bounded bars", () => {
    const quiet = createWaveformBars(-45);
    const speech = createWaveformBars(-18);

    expect(speech).not.toEqual(quiet);
    expect(Math.max(...quiet)).toBeLessThan(Math.max(...speech));
    expect([...quiet, ...speech].every((height) => height >= 6 && height <= 38)).toBe(true);
  });

  test("clamps unexpectedly loud input to the maximum bar height", () => {
    expect(Math.max(...createWaveformBars(20))).toBe(38);
  });
});
