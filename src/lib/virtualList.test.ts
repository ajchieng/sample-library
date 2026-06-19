import { describe, expect, it } from "vitest";
import { calculateVirtualWindow } from "./virtualList";

describe("calculateVirtualWindow", () => {
  it("renders every item when the list is below the virtualization threshold", () => {
    expect(
      calculateVirtualWindow({
        itemCount: 20,
        rowHeight: 50,
        viewportHeight: 300,
        scrollTop: 0,
        overscan: 3,
        threshold: 100,
      }),
    ).toEqual({ start: 0, end: 20, topSpacer: 0, bottomSpacer: 0 });
  });

  it("calculates an overscanned window for large lists", () => {
    expect(
      calculateVirtualWindow({
        itemCount: 1000,
        rowHeight: 50,
        viewportHeight: 300,
        scrollTop: 500,
        overscan: 2,
        threshold: 100,
      }),
    ).toEqual({ start: 8, end: 18, topSpacer: 400, bottomSpacer: 49100 });
  });

  it("clamps the window at list boundaries", () => {
    expect(
      calculateVirtualWindow({
        itemCount: 1000,
        rowHeight: 50,
        viewportHeight: 300,
        scrollTop: 0,
        overscan: 2,
        threshold: 100,
      }),
    ).toEqual({ start: 0, end: 8, topSpacer: 0, bottomSpacer: 49600 });
  });
});
