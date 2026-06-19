import type { Sample } from "../types/sample";

type GroupableField = "content_hash" | "audio_fingerprint";

function duplicateGroupsBy(samples: Sample[], field: GroupableField): number[][] {
  const byValue = new Map<string, number[]>();
  for (const sample of samples) {
    const value = sample[field];
    if (!value) continue;
    const ids = byValue.get(value) ?? [];
    ids.push(sample.id);
    byValue.set(value, ids);
  }
  return Array.from(byValue.values())
    .filter((ids) => ids.length > 1)
    .map((ids) => [...ids].sort((a, b) => a - b))
    .sort((a, b) => a[0] - b[0]);
}

export function exactDuplicateGroups(samples: Sample[]): number[][] {
  return duplicateGroupsBy(samples, "content_hash");
}

export function nearDuplicateGroups(samples: Sample[]): number[][] {
  return duplicateGroupsBy(samples, "audio_fingerprint");
}

export function groupSizeForSample(groups: number[][], sampleId: number): number {
  return groups.find((group) => group.includes(sampleId))?.length ?? 0;
}

export function formatConfidence(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "-";
  const bounded = Math.max(0, Math.min(1, value));
  return `${Math.round(bounded * 100)}%`;
}
