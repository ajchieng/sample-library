import { describe, expect, it } from "vitest";
import { pendingMigrations, type Migration } from "./schema";

const m = (version: number): Migration => ({ version, up: async () => {} });

describe("pendingMigrations", () => {
  it("returns nothing for an empty migration list", () => {
    expect(pendingMigrations(0, [])).toEqual([]);
  });

  it("runs every migration for a fresh DB at version 0", () => {
    const list = [m(1), m(2), m(3)];
    expect(pendingMigrations(0, list).map((x) => x.version)).toEqual([1, 2, 3]);
  });

  it("only returns migrations above the current version", () => {
    const list = [m(1), m(2), m(3)];
    expect(pendingMigrations(2, list).map((x) => x.version)).toEqual([3]);
  });

  it("returns nothing when already at or beyond the latest version", () => {
    expect(pendingMigrations(3, [m(1), m(2), m(3)])).toEqual([]);
    expect(pendingMigrations(9, [m(1), m(2)])).toEqual([]);
  });

  it("sorts ascending by version and does not mutate the input", () => {
    const list = [m(3), m(1), m(2)];
    expect(pendingMigrations(0, list).map((x) => x.version)).toEqual([1, 2, 3]);
    // input order preserved
    expect(list.map((x) => x.version)).toEqual([3, 1, 2]);
  });
});
