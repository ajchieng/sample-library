import { useEffect, useMemo, useRef, useState } from "react";
import type { Sample } from "../types/sample";
import { calculateVirtualWindow } from "../lib/virtualList";
import type { SelectionMode } from "../lib/selection";
import { SampleRow } from "./SampleRow";

const ROW_HEIGHT = 58;
const VIRTUALIZE_THRESHOLD = 250;
const VIRTUAL_OVERSCAN = 8;

type Props = {
  samples: Sample[];
  activeId: number | null;
  selectedIds: ReadonlySet<number>;
  selectedDragPaths: string[];
  missingIds: Set<number>;
  onSelect: (id: number, mode: SelectionMode) => void;
  onToggleFavorite: (id: number, value: boolean) => void;
  onImport: () => void;
  totalCount: number;
  missingCount: number;
};

export function SampleList({
  samples,
  activeId,
  selectedIds,
  selectedDragPaths,
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
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(measure)
        : null;
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
    if (!el || activeId == null || samples.length <= VIRTUALIZE_THRESHOLD)
      return;
    const selectedIndex = samples.findIndex((sample) => sample.id === activeId);
    if (selectedIndex < 0) return;

    const rowTop = selectedIndex * ROW_HEIGHT;
    const rowBottom = rowTop + ROW_HEIGHT;
    if (rowTop < el.scrollTop) {
      el.scrollTop = rowTop;
    } else if (rowBottom > el.scrollTop + el.clientHeight) {
      el.scrollTop = rowBottom - el.clientHeight;
    }
  }, [samples, activeId]);

  const base =
    samples.length === totalCount
      ? `${totalCount} sample${totalCount === 1 ? "" : "s"}`
      : `${samples.length} of ${totalCount} samples`;
  const status = missingCount > 0 ? `${base} · ${missingCount} missing` : base;
  const footer =
    selectedIds.size > 0 ? `${selectedIds.size} selected · ${status}` : status;

  return (
    <div
      className="sample-list"
      role="grid"
      aria-label="Samples"
      aria-multiselectable="true"
    >
      <div className="list-header" role="row">
        <div className="col-name" role="columnheader">
          NAME
        </div>
        <div className="col-type" role="columnheader">
          TYPE
        </div>
        <div className="col-bpm" role="columnheader">
          BPM
        </div>
        <div className="col-key" role="columnheader">
          KEY
        </div>
        <div className="col-tags" role="columnheader">
          TAGS
        </div>
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
                selected={selectedIds.has(s.id)}
                active={s.id === activeId}
                missing={missingIds.has(s.id)}
                dragPaths={
                  selectedIds.has(s.id) && selectedDragPaths.length > 1
                    ? selectedDragPaths
                    : [s.file_path]
                }
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
            Import audio files from anywhere on your Mac. Sample Tracker keeps a
            managed copy while leaving your original exactly where it is.
          </p>
          <button
            type="button"
            className="btn btn-primary empty-action"
            onClick={onImport}
          >
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
