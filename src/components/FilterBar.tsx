import { useState } from "react";
import clsx from "clsx";
import {
  AlertTriangle,
  BookmarkPlus,
  Check,
  RefreshCw,
  Star,
  Trash2,
  X,
} from "lucide-react";
import type { BrowsePreset } from "../lib/browsePresets";
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
  presets: BrowsePreset[];
  onSavePreset: (name: string) => void;
  onApplyPreset: (id: string) => void;
  onDeletePreset: (id: string) => void;
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
  presets,
  onSavePreset,
  onApplyPreset,
  onDeletePreset,
}: Props) {
  const [selectedPresetId, setSelectedPresetId] = useState("");
  const [savingPreset, setSavingPreset] = useState(false);
  const [presetName, setPresetName] = useState("");
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

        {presets.length > 0 ? (
          <div className="preset-picker">
            <span className="filter-label">View</span>
            <select
              value={selectedPresetId}
              aria-label="Saved browse views"
              onChange={(e) => {
                const id = e.target.value;
                setSelectedPresetId(id);
                if (id) onApplyPreset(id);
              }}
            >
              <option value="">Saved views</option>
              {presets.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="icon-btn preset-delete"
              disabled={!selectedPresetId}
              onClick={() => {
                if (!selectedPresetId) return;
                onDeletePreset(selectedPresetId);
                setSelectedPresetId("");
              }}
              aria-label="Delete selected saved view"
              title="Delete selected saved view"
            >
              <Trash2 size={14} />
            </button>
          </div>
        ) : null}

        {savingPreset ? (
          <form
            className="preset-save-inline"
            onSubmit={(event) => {
              event.preventDefault();
              if (!presetName.trim()) return;
              onSavePreset(presetName);
              setPresetName("");
              setSavingPreset(false);
            }}
          >
            <input
              type="text"
              value={presetName}
              onChange={(event) => setPresetName(event.target.value)}
              placeholder="View name"
              aria-label="Saved view name"
            />
            <button
              type="submit"
              className="icon-btn preset-save-confirm"
              disabled={!presetName.trim()}
              aria-label="Save browse view"
              title="Save browse view"
            >
              <Check size={14} />
            </button>
            <button
              type="button"
              className="icon-btn preset-save-cancel"
              onClick={() => {
                setPresetName("");
                setSavingPreset(false);
              }}
              aria-label="Cancel saving browse view"
              title="Cancel"
            >
              <X size={14} />
            </button>
          </form>
        ) : (
          <button
            type="button"
            className="btn btn-ghost preset-save"
            onClick={() => setSavingPreset(true)}
            title="Save the current search, filters, and sort"
          >
            <BookmarkPlus size={14} />
            Save view
          </button>
        )}

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
