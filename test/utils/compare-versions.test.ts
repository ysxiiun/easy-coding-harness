import { describe, expect, it } from "vitest";
import { compareVersions, isVersionBehind } from "../../src/utils/compare-versions.js";

describe("compareVersions", () => {
  it("compares semver-like versions", () => {
    expect(compareVersions("0.1.1", "0.1.1")).toBe(0);
    expect(compareVersions("0.1.2", "0.1.1")).toBe(1);
    expect(compareVersions("0.2.0", "0.10.0")).toBe(-1);
    expect(compareVersions("0.1", "0.1.0")).toBe(0);
  });

  it("detects an installed version behind the current CLI", () => {
    expect(isVersionBehind("0.1.0", "0.1.1")).toBe(true);
    expect(isVersionBehind("0.1.1", "0.1.1")).toBe(false);
  });
});
