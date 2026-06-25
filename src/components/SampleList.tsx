import { useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { ChevronDown, ChevronUp } from "lucide-react";
import type { Sample } from "../types/sample";
import { calculateVirtualWindow } from "../lib/virtualList";
import type { SampleSort, SortKey } from "../lib/sampleView";
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
  sort: SampleSort;
  onSort: (key: SortKey) => void;
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
  sort,
  onSort,
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
  const virtualized = samples.length > VIRTUALIZE_THRESHOLD;
  const visibleRange =
    samples.length > 0
      ? `${virtualWindow.start + 1}-${virtualWindow.end}`
      : "0";
  const footerText = virtualized ? `${footer} · rows ${visibleRange}` : footer;

  const scrollToTop = () => {
    const el = bodyRef.current;
    if (el) el.scrollTop = 0;
  };

  const scrollToSelected = () => {
    const el = bodyRef.current;
    if (!el || activeId == null) return;
    const selectedIndex = samples.findIndex((sample) => sample.id === activeId);
    if (selectedIndex < 0) return;
    el.scrollTop = selectedIndex * ROW_HEIGHT;
  };

  return (
    <div
      className="sample-list"
      role="grid"
      aria-label="Samples"
      aria-multiselectable="true"
    >
      <div className="list-header" role="row">
        <SortHeader
          className="col-name"
          label="NAME"
          sortKey="name"
          sort={sort}
          onSort={onSort}
        />
        <SortHeader
          className="col-type"
          label="TYPE"
          sortKey="type"
          sort={sort}
          onSort={onSort}
        />
        <SortHeader
          className="col-bpm"
          label="BPM"
          sortKey="bpm"
          sort={sort}
          onSort={onSort}
        />
        <SortHeader
          className="col-key"
          label="KEY"
          sortKey="musical_key"
          sort={sort}
          onSort={onSort}
        />
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

      <div className="list-footer">
        <span>{footerText}</span>
        {virtualized ? (
          <div className="list-footer-actions">
            <button
              type="button"
              className="btn btn-ghost"
              onClick={scrollToTop}
            >
              Top
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={scrollToSelected}
              disabled={activeId == null}
            >
              Selected
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function SortHeader({
  className,
  label,
  sortKey,
  sort,
  onSort,
}: {
  className: string;
  label: string;
  sortKey: SortKey;
  sort: SampleSort;
  onSort: (key: SortKey) => void;
}) {
  const active = sort.key === sortKey;
  const ariaSort: "ascending" | "descending" | "none" = active
    ? sort.dir === "asc"
      ? "ascending"
      : "descending"
    : "none";
  return (
    <div className={className} role="columnheader" aria-sort={ariaSort}>
      <button
        type="button"
        className={clsx("col-sort", { active })}
        onClick={() => onSort(sortKey)}
      >
        {label}
        {active ? (
          sort.dir === "asc" ? (
            <ChevronUp size={13} aria-hidden="true" />
          ) : (
            <ChevronDown size={13} aria-hidden="true" />
          )
        ) : null}
      </button>
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
