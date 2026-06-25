import clsx from "clsx";
import { AlertTriangle, RefreshCw, Star } from "lucide-react";
import type { SampleFilters } from "../lib/sampleView";
import { SAMPLE_TYPES } from "../types/sample";

type Props = {
  filters: SampleFilters;
  onChange: (patch: Partial<SampleFilters>) => void;
  onClear: () => void;
  allTags: string[];
  keys: string[];
  moods: string[];
  resultCount: number;
  totalCount: number;
  missingCount: number;
  onlyMissing: boolean;
  onToggleMissing: () => void;
  onlyFavorites: boolean;
  onToggleFavorites: () => void;
  onRescan: () => void;
};

export function FilterBar({
  filters,
  onChange,
  onClear,
  allTags,
  keys,
  moods,
  resultCount,
  totalCount,
  missingCount,
  onlyMissing,
  onToggleMissing,
  onlyFavorites,
  onToggleFavorites,
  onRescan,
}: Props) {
  const hasActive =
    filters.type ||
    filters.tag ||
    filters.key ||
    filters.mood ||
    filters.bpmMin ||
    filters.bpmMax ||
    onlyMissing ||
    onlyFavorites;
  const resultLabel =
    resultCount === totalCount
      ? `${totalCount.toLocaleString()} beat${totalCount === 1 ? "" : "s"}`
      : `${resultCount.toLocaleString()} of ${totalCount.toLocaleString()} beats`;

  return (
    <div className="filterbar">
      <div className="type-pills">
        <TypePill
          label="All"
          active={filters.type === ""}
          onClick={() => onChange({ type: "" })}
        />
        {SAMPLE_TYPES.map((t) => (
          <TypePill
            key={t}
            label={t}
            active={filters.type === t}
            onClick={() => onChange({ type: t })}
          />
        ))}
      </div>

      <div className="filter-selects">
        <Select
          label="Tag"
          value={filters.tag}
          options={allTags}
          onChange={(v) => onChange({ tag: v })}
        />
        <Select
          label="Key"
          value={filters.key}
          options={keys}
          onChange={(v) => onChange({ key: v })}
        />
        <Select
          label="Mood"
          value={filters.mood}
          options={moods}
          onChange={(v) => onChange({ mood: v })}
        />
        <div className="bpm-range">
          <span className="filter-label">BPM</span>
          <input
            type="number"
            min={0}
            placeholder="min"
            aria-label="Minimum BPM"
            value={filters.bpmMin}
            onChange={(e) => onChange({ bpmMin: e.target.value })}
          />
          <span className="dash">–</span>
          <input
            type="number"
            min={0}
            placeholder="max"
            aria-label="Maximum BPM"
            value={filters.bpmMax}
            onChange={(e) => onChange({ bpmMax: e.target.value })}
          />
        </div>
        <button
          type="button"
          className={clsx("btn favorites-toggle", { active: onlyFavorites })}
          aria-pressed={onlyFavorites}
          onClick={onToggleFavorites}
          title="Show only favorite samples"
        >
          <Star size={14} fill={onlyFavorites ? "currentColor" : "none"} />
          Favorites
        </button>

        {missingCount > 0 ? (
          <button
            type="button"
            className={clsx("btn missing-toggle", { active: onlyMissing })}
            onClick={onToggleMissing}
            aria-pressed={onlyMissing}
            title="Show only samples whose file is missing"
          >
            <AlertTriangle size={14} />
            {missingCount} missing
          </button>
        ) : null}

        <button
          type="button"
          className="btn btn-ghost rescan-btn"
          onClick={onRescan}
          title="Re-check whether sample files still exist on disk"
        >
          <RefreshCw size={14} />
          Rescan
        </button>

        {hasActive ? (
          <button
            type="button"
            className="btn btn-ghost clear-btn"
            onClick={onClear}
          >
            Clear filters
          </button>
        ) : null}

        <div className="filter-count" aria-live="polite">
          {resultLabel}
        </div>
      </div>
    </div>
  );
}

function TypePill({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={clsx("type-pill", { active })}
      onClick={onClick}
      aria-pressed={active}
    >
      {label}
    </button>
  );
}

function Select({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="filter-select">
      <span className="filter-label">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">All</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  );
}
