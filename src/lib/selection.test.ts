import { describe, expect, it } from "vitest";
import { selectAll, updateSelection } from "./selection";

const orderedIds = [10, 20, 30, 40, 50];

describe("updateSelection", () => {
  it("replaces selection on a plain click", () => {
    const result = updateSelection({
      current: new Set([10, 20]),
      orderedIds,
      targetId: 40,
      anchorId: 20,
      mode: "replace",
    });
    expect([...result.ids]).toEqual([40]);
    expect(result.primaryId).toBe(40);
    expect(result.anchorId).toBe(40);
  });

  it("toggles an item without clearing other selected items", () => {
    const added = updateSelection({
      current: new Set([10, 30]),
      orderedIds,
      targetId: 40,
      anchorId: 30,
      mode: "toggle",
    });
    expect([...added.ids]).toEqual([10, 30, 40]);
    expect(added.primaryId).toBe(40);

    const removed = updateSelection({
      current: added.ids,
      orderedIds,
      targetId: 40,
      anchorId: 40,
      mode: "toggle",
    });
    expect([...removed.ids]).toEqual([10, 30]);
    expect(removed.primaryId).toBe(10);
  });

  it("selects a contiguous range from the anchor", () => {
    const result = updateSelection({
      current: new Set([20]),
      orderedIds,
      targetId: 50,
      anchorId: 20,
      mode: "range",
    });
    expect([...result.ids]).toEqual([20, 30, 40, 50]);
    expect(result.primaryId).toBe(50);
    expect(result.anchorId).toBe(20);
  });

  it("falls back to replacement when the range anchor is no longer visible", () => {
    const result = updateSelection({
      current: new Set([10]),
      orderedIds: [30, 40],
      targetId: 40,
      anchorId: 10,
      mode: "range",
    });
    expect([...result.ids]).toEqual([40]);
  });
});

describe("selectAll", () => {
  it("selects all ordered ids and focuses the first", () => {
    const result = selectAll(orderedIds);
    expect([...result.ids]).toEqual(orderedIds);
    expect(result.primaryId).toBe(10);
    expect(result.anchorId).toBe(10);
  });
});
