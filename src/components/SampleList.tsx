import { useEffect, useMemo, useRef, useState } from "react";
import type { Sample } from "../types/sample";
import { calculateVirtualWindow } from "../lib/virtualList";
import { SampleRow } from "./SampleRow";

const ROW_HEIGHT = 58;
const VIRTUALIZE_THRESHOLD = 250;
const VIRTUAL_OVERSCAN = 8;

type Props = {
  samples: Sample[];
  selectedId: number | null;
  missingIds: Set<number>;
  onSelect: (id: number) => void;
  onToggleFavorite: (id: number, value: boolean) => void;
  onImport: () => void;
  totalCount: number;
  missingCount: number;
};

export function SampleList({
  samples,
  selectedId,
  missingIds,
  onSelect,
  onToggleFavorite,
  onImport,
  totalCount,
  missingCount,
}: Props) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);

  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;

    const measure = () => setViewportHeight(el.clientHeight);
    measure();

    const resizeObserver =
      typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    resizeObserver?.observe(el);
    window.addEventListener("resize", measure);
    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);

  const virtualWindow = useMemo(
    () =>
      calculateVirtualWindow({
        itemCount: samples.length,
        rowHeight: ROW_HEIGHT,
        viewportHeight,
        scrollTop,
        overscan: VIRTUAL_OVERSCAN,
        threshold: VIRTUALIZE_THRESHOLD,
      }),
    [samples.length, scrollTop, viewportHeight],
  );

  const visibleSamples = useMemo(
    () => samples.slice(virtualWindow.start, virtualWindow.end),
    [samples, virtualWindow.start, virtualWindow.end],
  );

  useEffect(() => {
    const el = bodyRef.current;
    if (!el || selectedId == null || samples.length <= VIRTUALIZE_THRESHOLD) return;
    const selectedIndex = samples.findIndex((sample) => sample.id === selectedId);
    if (selectedIndex < 0) return;

    const rowTop = selectedIndex * ROW_HEIGHT;
    const rowBottom = rowTop + ROW_HEIGHT;
    if (rowTop < el.scrollTop) {
      el.scrollTop = rowTop;
    } else if (rowBottom > el.scrollTop + el.clientHeight) {
      el.scrollTop = rowBottom - el.clientHeight;
    }
  }, [samples, selectedId]);

  const base =
    samples.length === totalCount
      ? `${totalCount} sample${totalCount === 1 ? "" : "s"}`
      : `${samples.length} of ${totalCount} samples`;
  const footer = missingCount > 0 ? `${base} · ${missingCount} missing` : base;

  return (
    <div className="sample-list" role="grid" aria-label="Samples">
      <div className="list-header" role="row">
        <div className="col-name" role="columnheader">NAME</div>
        <div className="col-type" role="columnheader">TYPE</div>
        <div className="col-bpm" role="columnheader">BPM</div>
        <div className="col-key" role="columnheader">KEY</div>
        <div className="col-tags" role="columnheader">TAGS</div>
      </div>

      <div
        className="list-body"
        role="rowgroup"
        ref={bodyRef}
        onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
      >
        {samples.length === 0 ? (
          <EmptyState totalCount={totalCount} onImport={onImport} />
        ) : (
          <>
            {virtualWindow.topSpacer > 0 ? (
              <div
                className="virtual-spacer"
                style={{ height: virtualWindow.topSpacer }}
                aria-hidden="true"
              />
            ) : null}
            {visibleSamples.map((s) => (
              <SampleRow
                key={s.id}
                sample={s}
                selected={s.id === selectedId}
                missing={missingIds.has(s.id)}
                onSelect={onSelect}
                onToggleFavorite={onToggleFavorite}
              />
            ))}
            {virtualWindow.bottomSpacer > 0 ? (
              <div
                className="virtual-spacer"
                style={{ height: virtualWindow.bottomSpacer }}
                aria-hidden="true"
              />
            ) : null}
          </>
        )}
      </div>

      <div className="list-footer">{footer}</div>
    </div>
  );
}

function EmptyState({
  totalCount,
  onImport,
}: {
  totalCount: number;
  onImport: () => void;
}) {
  return (
    <div className="empty-state">
      {totalCount === 0 ? (
        <>
          <p className="empty-title">Your library is empty</p>
          <p className="empty-sub">
            Import audio files from anywhere on your Mac. Sample Tracker stores
            paths and metadata only; files stay exactly where they are.
          </p>
          <button type="button" className="btn btn-primary empty-action" onClick={onImport}>
            Import samples
          </button>
        </>
      ) : (
        <>
          <p className="empty-title">No samples match</p>
          <p className="empty-sub">
            Clear a filter, widen the BPM range, or try searching by filename,
            tag, key, mood, source, or notes.
          </p>
        </>
      )}
    </div>
  );
}
