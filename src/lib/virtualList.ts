export type VirtualWindow = {
  start: number;
  end: number;
  topSpacer: number;
  bottomSpacer: number;
};

export function calculateVirtualWindow({
  itemCount,
  rowHeight,
  viewportHeight,
  scrollTop,
  overscan,
  threshold,
}: {
  itemCount: number;
  rowHeight: number;
  viewportHeight: number;
  scrollTop: number;
  overscan: number;
  threshold: number;
}): VirtualWindow {
  if (itemCount <= threshold || viewportHeight <= 0 || rowHeight <= 0) {
    return { start: 0, end: itemCount, topSpacer: 0, bottomSpacer: 0 };
  }

  const visibleStart = Math.floor(scrollTop / rowHeight);
  const visibleCount = Math.ceil(viewportHeight / rowHeight);
  const start = Math.max(0, visibleStart - overscan);
  const end = Math.min(itemCount, visibleStart + visibleCount + overscan);

  return {
    start,
    end,
    topSpacer: start * rowHeight,
    bottomSpacer: Math.max(0, (itemCount - end) * rowHeight),
  };
}
