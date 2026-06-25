import { describe, expect, it } from "vitest";
import type { SampleFilters, SampleSort } from "./sampleView";
import { MAX_BROWSE_PRESETS, saveBrowsePreset } from "./browsePresets";

const emptyFilters: SampleFilters = {
  type: "",
  tag: "",
  key: "",
  mood: "",
  bpmMin: "",
  bpmMax: "",
};

const defaultSort: SampleSort = { key: "created_at", dir: "desc" };

describe("browse presets", () => {
  it("prepends a trimmed preset and keeps the newest value for duplicate names", () => {
    const existing = saveBrowsePreset([], {
      id: "first",
      name: "Drum loops",
      search: "type:loop tag:drums",
      filters: emptyFilters,
      sort: defaultSort,
      onlyMissing: false,
      onlyFavorites: false,
    });

    const updated = saveBrowsePreset(existing, {
      id: "second",
      name: "  drum loops  ",
      search: "bpm:90-110",
      filters: { ...emptyFilters, type: "loop" },
      sort: { key: "bpm", dir: "asc" },
      onlyMissing: false,
      onlyFavorites: true,
    });

    expect(updated).toHaveLength(1);
    expect(updated[0]).toMatchObject({
      id: "second",
      name: "drum loops",
      search: "bpm:90-110",
      onlyFavorites: true,
    });
  });

  it("caps saved presets so the menu stays compact", () => {
    const presets = Array.from({ length: MAX_BROWSE_PRESETS + 2 }, (_, i) => ({
      id: `preset-${i}`,
      name: `Preset ${i}`,
      search: "",
      filters: emptyFilters,
      sort: defaultSort,
      onlyMissing: false,
      onlyFavorites: false,
    })).reduce(saveBrowsePreset, []);

    expect(presets).toHaveLength(MAX_BROWSE_PRESETS);
    expect(presets[0].name).toBe(`Preset ${MAX_BROWSE_PRESETS + 1}`);
    expect(presets[presets.length - 1]?.name).toBe("Preset 2");
  });
});
