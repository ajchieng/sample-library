export type SelectionMode = "replace" | "toggle" | "range";

export type SelectionResult = {
  ids: Set<number>;
  primaryId: number | null;
  anchorId: number | null;
};

export function updateSelection({
  current,
  orderedIds,
  targetId,
  anchorId,
  mode,
}: {
  current: ReadonlySet<number>;
  orderedIds: number[];
  targetId: number;
  anchorId: number | null;
  mode: SelectionMode;
}): SelectionResult {
  if (mode === "range" && anchorId != null) {
    const anchorIndex = orderedIds.indexOf(anchorId);
    const targetIndex = orderedIds.indexOf(targetId);
    if (anchorIndex >= 0 && targetIndex >= 0) {
      const start = Math.min(anchorIndex, targetIndex);
      const end = Math.max(anchorIndex, targetIndex);
      return {
        ids: new Set(orderedIds.slice(start, end + 1)),
        primaryId: targetId,
        anchorId,
      };
    }
  }

  if (mode === "toggle") {
    const ids = new Set(current);
    if (ids.has(targetId)) ids.delete(targetId);
    else ids.add(targetId);
    return {
      ids,
      primaryId: ids.has(targetId)
        ? targetId
        : (orderedIds.find((id) => ids.has(id)) ?? null),
      anchorId: targetId,
    };
  }

  return {
    ids: new Set([targetId]),
    primaryId: targetId,
    anchorId: targetId,
  };
}

export function selectAll(orderedIds: number[]): SelectionResult {
  return {
    ids: new Set(orderedIds),
    primaryId: orderedIds[0] ?? null,
    anchorId: orderedIds[0] ?? null,
  };
}
