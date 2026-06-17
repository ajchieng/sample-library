import type { Sample } from "../types/sample";
import { SampleRow } from "./SampleRow";

type Props = {
  samples: Sample[];
  selectedId: number | null;
  missingIds: Set<number>;
  onSelect: (id: number) => void;
  totalCount: number;
  missingCount: number;
};

export function SampleList({
  samples,
  selectedId,
  missingIds,
  onSelect,
  totalCount,
  missingCount,
}: Props) {
  const base =
    samples.length === totalCount
      ? `${totalCount} sample${totalCount === 1 ? "" : "s"}`
      : `${samples.length} of ${totalCount} samples`;
  const footer = missingCount > 0 ? `${base} · ${missingCount} missing` : base;

  return (
    <div className="sample-list">
      <div className="list-header">
        <div className="col-name">NAME</div>
        <div className="col-type">TYPE</div>
        <div className="col-bpm">BPM</div>
        <div className="col-key">KEY</div>
        <div className="col-tags">TAGS</div>
      </div>

      <div className="list-body">
        {samples.length === 0 ? (
          <EmptyState totalCount={totalCount} />
        ) : (
          samples.map((s) => (
            <SampleRow
              key={s.id}
              sample={s}
              selected={s.id === selectedId}
              missing={missingIds.has(s.id)}
              onSelect={onSelect}
            />
          ))
        )}
      </div>

      <div className="list-footer">{footer}</div>
    </div>
  );
}

function EmptyState({ totalCount }: { totalCount: number }) {
  return (
    <div className="empty-state">
      {totalCount === 0 ? (
        <>
          <p className="empty-title">Your library is empty</p>
          <p className="empty-sub">
            Click <strong>Import</strong> to add audio samples from your
            computer. Files stay exactly where they are.
          </p>
        </>
      ) : (
        <>
          <p className="empty-title">No samples match</p>
          <p className="empty-sub">Try adjusting your search or filters.</p>
        </>
      )}
    </div>
  );
}
