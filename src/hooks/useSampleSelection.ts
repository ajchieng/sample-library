import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import type { Sample } from "../types/sample";
import {
  selectAll,
  updateSelection,
  type SelectionMode,
} from "../lib/selection";

type UseSampleSelectionOptions = {
  samples: Sample[];
  visible: Sample[];
  missingIds: Set<number>;
  helpOpen: boolean;
  setHelpOpen: Dispatch<SetStateAction<boolean>>;
  copyPaths: (filePaths: string[]) => void | Promise<void>;
};

function isEditableTarget(target: HTMLElement | null): boolean {
  return Boolean(
    target &&
    (target.tagName === "INPUT" ||
      target.tagName === "TEXTAREA" ||
      target.tagName === "SELECT" ||
      target.isContentEditable),
  );
}

export function useSampleSelection({
  samples,
  visible,
  missingIds,
  helpOpen,
  setHelpOpen,
  copyPaths,
}: UseSampleSelectionOptions) {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const selectionAnchor = useRef<number | null>(null);
  const editorDirty = useRef(false);

  const selected = useMemo(
    () => samples.find((s) => s.id === selectedId) ?? null,
    [samples, selectedId],
  );
  const selectedSamples = useMemo(
    () => samples.filter((sample) => selectedIds.has(sample.id)),
    [samples, selectedIds],
  );
  const selectedDragPaths = useMemo(
    () =>
      selectedSamples
        .filter((sample) => !missingIds.has(sample.id))
        .map((sample) => sample.file_path),
    [missingIds, selectedSamples],
  );
  const singleSelected = selectedIds.size === 1 ? selected : null;

  useEffect(() => {
    const existingIds = new Set(samples.map((sample) => sample.id));
    setSelectedIds((current) => {
      const next = new Set([...current].filter((id) => existingIds.has(id)));
      if (next.size === current.size) return current;
      return next;
    });
    if (selectedId != null && !existingIds.has(selectedId)) {
      setSelectedId(null);
      selectionAnchor.current = null;
    }
  }, [samples, selectedId]);

  const handleDirtyChange = useCallback((dirty: boolean) => {
    editorDirty.current = dirty;
  }, []);

  const clearSelection = useCallback(() => {
    editorDirty.current = false;
    selectionAnchor.current = null;
    setSelectedId(null);
    setSelectedIds(new Set());
  }, []);

  const requestSelect = useCallback(
    (id: number | null, mode: SelectionMode = "replace") => {
      if (id == null) {
        clearSelection();
        return;
      }
      if (mode === "replace" && id === selectedId && selectedIds.size === 1)
        return;
      if (
        editorDirty.current &&
        !window.confirm("Discard unsaved changes to this sample?")
      ) {
        return;
      }
      editorDirty.current = false;
      const next = updateSelection({
        current: selectedIds,
        orderedIds: visible.map((sample) => sample.id),
        targetId: id,
        anchorId: selectionAnchor.current,
        mode,
      });
      const primaryId =
        next.primaryId ??
        samples.find((sample) => next.ids.has(sample.id))?.id ??
        null;
      selectionAnchor.current = next.anchorId;
      setSelectedId(primaryId);
      setSelectedIds(next.ids);
    },
    [clearSelection, samples, selectedId, selectedIds, visible],
  );

  const selectSingle = useCallback((id: number) => {
    setSelectedId(id);
    setSelectedIds(new Set([id]));
    selectionAnchor.current = id;
  }, []);

  const removeIdsFromSelection = useCallback((removedIds: Set<number>) => {
    setSelectedIds((current) => {
      const next = new Set([...current].filter((id) => !removedIds.has(id)));
      setSelectedId((primary) =>
        primary != null && next.has(primary) ? primary : ([...next][0] ?? null),
      );
      return next;
    });
    selectionAnchor.current = null;
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && helpOpen) {
        e.preventDefault();
        setHelpOpen(false);
        return;
      }

      if (e.key === "Escape" && selectedIds.size > 1) {
        e.preventDefault();
        if (selectedId != null) requestSelect(selectedId);
        else clearSelection();
        return;
      }

      if (e.key === "?" && !helpOpen) {
        const target = e.target as HTMLElement | null;
        if (!isEditableTarget(target)) {
          e.preventDefault();
          setHelpOpen(true);
          return;
        }
      }

      if ((e.metaKey || e.ctrlKey) && (e.key === "c" || e.key === "C")) {
        const target = e.target as HTMLElement | null;
        if (isEditableTarget(target) || window.getSelection()?.toString())
          return;
        if (selectedDragPaths.length === 0) return;
        e.preventDefault();
        void copyPaths(selectedDragPaths);
        return;
      }

      if ((e.metaKey || e.ctrlKey) && (e.key === "a" || e.key === "A")) {
        const target = e.target as HTMLElement | null;
        if (isEditableTarget(target) || visible.length === 0) return;
        if (
          editorDirty.current &&
          !window.confirm("Discard unsaved changes to this sample?")
        ) {
          return;
        }
        e.preventDefault();
        editorDirty.current = false;
        const next = selectAll(visible.map((sample) => sample.id));
        selectionAnchor.current = next.anchorId;
        setSelectedId(next.primaryId);
        setSelectedIds(next.ids);
        return;
      }

      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
      const target = e.target as HTMLElement | null;
      if (isEditableTarget(target) || visible.length === 0) return;
      e.preventDefault();

      const idx = visible.findIndex((s) => s.id === selectedId);
      let next: number;
      if (e.key === "Home") next = 0;
      else if (e.key === "End") next = visible.length - 1;
      else if (idx < 0) next = e.key === "ArrowUp" ? visible.length - 1 : 0;
      else if (e.key === "ArrowDown")
        next = Math.min(visible.length - 1, idx + 1);
      else next = Math.max(0, idx - 1);

      requestSelect(visible[next].id, e.shiftKey ? "range" : "replace");
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    visible,
    selectedId,
    requestSelect,
    helpOpen,
    selectedIds,
    selectedDragPaths,
    copyPaths,
    clearSelection,
    setHelpOpen,
  ]);

  return {
    selectedId,
    selectedIds,
    selected,
    selectedSamples,
    selectedDragPaths,
    singleSelected,
    handleDirtyChange,
    clearSelection,
    requestSelect,
    selectSingle,
    removeIdsFromSelection,
  };
}
