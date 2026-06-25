import { describe, expect, it } from "vitest";
import { formatImportSummary } from "./importSummary";

describe("formatImportSummary", () => {
  it("keeps import feedback compact and ordered", () => {
    expect(
      formatImportSummary({
        added: 3,
        inLibrary: 2,
        failed: 1,
        unsupported: 4,
      }),
    ).toBe(
      "3 imported · 2 already in library · 1 failed to copy · 4 unsupported",
    );
  });

  it("omits zero-count states", () => {
    expect(
      formatImportSummary({
        added: 0,
        inLibrary: 1,
        failed: 0,
        unsupported: 0,
      }),
    ).toBe("1 already in library");
  });

  it("returns null when there is nothing to report", () => {
    expect(
      formatImportSummary({
        added: 0,
        inLibrary: 0,
        failed: 0,
        unsupported: 0,
      }),
    ).toBeNull();
  });
});
