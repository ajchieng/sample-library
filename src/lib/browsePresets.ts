import type { SampleFilters, SampleSort } from "./sampleView";

export const MAX_BROWSE_PRESETS = 8;

export type BrowsePreset = {
  id: string;
  name: string;
  search: string;
  filters: SampleFilters;
  sort: SampleSort;
  onlyMissing: boolean;
  onlyFavorites: boolean;
};

export function saveBrowsePreset(
  presets: BrowsePreset[],
  preset: BrowsePreset,
): BrowsePreset[] {
  const name = preset.name.trim();
  if (!name) return presets;

  const withoutDuplicate = presets.filter(
    (existing) => existing.name.trim().toLowerCase() !== name.toLowerCase(),
  );
  return [{ ...preset, name }, ...withoutDuplicate].slice(
    0,
    MAX_BROWSE_PRESETS,
  );
}
