import { basename, filenameWithoutExt } from "./files";
import type { Sample } from "../types/sample";

const DRUM_KEYWORDS = ["drum", "snare", "hat", "kick", "crash"];

export function autoTagsForFilename(path: string): string[] {
  const name = filenameWithoutExt(basename(path)).toLowerCase();
  const tags: string[] = [];

  if (name.includes("beat")) {
    tags.push("beat");
  }

  if (DRUM_KEYWORDS.some((keyword) => name.includes(keyword))) {
    tags.push("drum");
  }

  return tags;
}

export type AutoTagPlanItem = {
  sampleId: number;
  name: string;
  filename: string;
  tagsToAdd: string[];
};

export type AutoTagPlan = {
  items: AutoTagPlanItem[];
  tagCounts: Record<string, number>;
  sampleCount: number;
  tagAddCount: number;
};

export function buildAutoTagPlan(samples: Sample[]): AutoTagPlan {
  const items: AutoTagPlanItem[] = [];
  const tagCounts: Record<string, number> = {};
  let tagAddCount = 0;

  for (const sample of samples) {
    const filename = sample.original_filename ?? basename(sample.file_path);
    const existing = new Set(sample.tags);
    const tagsToAdd = autoTagsForFilename(filename).filter(
      (tag) => !existing.has(tag),
    );

    if (tagsToAdd.length === 0) continue;

    for (const tag of tagsToAdd) {
      tagCounts[tag] = (tagCounts[tag] ?? 0) + 1;
      tagAddCount++;
    }

    items.push({
      sampleId: sample.id,
      name: sample.name,
      filename,
      tagsToAdd,
    });
  }

  return {
    items,
    tagCounts,
    sampleCount: items.length,
    tagAddCount,
  };
}
