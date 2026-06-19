import { describe, expect, it } from "vitest";
import {
  formatChannels,
  formatSampleRate,
  formatTime,
  parseVolume,
  shouldIgnoreGlobalPlaybackShortcut,
} from "./player";

describe("formatTime", () => {
  it("formats seconds as m:ss with zero-padding", () => {
    expect(formatTime(0)).toBe("0:00");
    expect(formatTime(5)).toBe("0:05");
    expect(formatTime(65)).toBe("1:05");
    expect(formatTime(600)).toBe("10:00");
  });

  it("floors fractional seconds", () => {
    expect(formatTime(3.9)).toBe("0:03");
  });

  it("renders non-finite or negative input as 0:00", () => {
    expect(formatTime(NaN)).toBe("0:00");
    expect(formatTime(Infinity)).toBe("0:00");
    expect(formatTime(-5)).toBe("0:00");
  });
});

describe("parseVolume", () => {
  it("defaults to 1.0 when missing or unparseable", () => {
    expect(parseVolume(null)).toBe(1);
    expect(parseVolume("not-a-number")).toBe(1);
  });

  it("passes through valid 0..1 values", () => {
    expect(parseVolume("0")).toBe(0);
    expect(parseVolume("0.5")).toBe(0.5);
    expect(parseVolume("1")).toBe(1);
  });

  it("clamps out-of-range values into 0..1", () => {
    expect(parseVolume("-0.3")).toBe(0);
    expect(parseVolume("2.5")).toBe(1);
  });
});

describe("formatSampleRate", () => {
  it("formats common rates with trailing zeros trimmed", () => {
    expect(formatSampleRate(44100)).toBe("44.1 kHz");
    expect(formatSampleRate(48000)).toBe("48 kHz");
    expect(formatSampleRate(96000)).toBe("96 kHz");
    expect(formatSampleRate(22050)).toBe("22.05 kHz");
  });

  it("returns empty string for missing/invalid input", () => {
    expect(formatSampleRate(null)).toBe("");
    expect(formatSampleRate(undefined)).toBe("");
    expect(formatSampleRate(0)).toBe("");
    expect(formatSampleRate(-1)).toBe("");
  });
});

describe("formatChannels", () => {
  it("labels mono and stereo", () => {
    expect(formatChannels(1)).toBe("mono");
    expect(formatChannels(2)).toBe("stereo");
  });

  it("falls back to 'N ch' for higher counts", () => {
    expect(formatChannels(6)).toBe("6 ch");
  });

  it("returns empty string for missing/invalid input", () => {
    expect(formatChannels(null)).toBe("");
    expect(formatChannels(undefined)).toBe("");
    expect(formatChannels(0)).toBe("");
  });
});

describe("shouldIgnoreGlobalPlaybackShortcut", () => {
  it("ignores editable text targets", () => {
    expect(shouldIgnoreGlobalPlaybackShortcut({ tagName: "INPUT" })).toBe(true);
    expect(shouldIgnoreGlobalPlaybackShortcut({ tagName: "TEXTAREA" })).toBe(
      true,
    );
    expect(
      shouldIgnoreGlobalPlaybackShortcut({ isContentEditable: true }),
    ).toBe(true);
  });

  it("ignores controls that use Space for their own interaction", () => {
    expect(shouldIgnoreGlobalPlaybackShortcut({ tagName: "BUTTON" })).toBe(
      true,
    );
    expect(shouldIgnoreGlobalPlaybackShortcut({ tagName: "SELECT" })).toBe(
      true,
    );
    expect(
      shouldIgnoreGlobalPlaybackShortcut({ tagName: "INPUT", type: "range" }),
    ).toBe(true);
  });

  it("allows non-interactive targets", () => {
    expect(shouldIgnoreGlobalPlaybackShortcut({ tagName: "DIV" })).toBe(false);
    expect(shouldIgnoreGlobalPlaybackShortcut(null)).toBe(false);
  });
});
