import { describe, expect, it } from "vitest";
import { GENERATED_REGION_END, GENERATED_REGION_START } from "../../src/constants/paths.js";
import { MarkedRegionError, replaceMarkedRegion } from "../../src/utils/marked-region.js";

const generated = `${GENERATED_REGION_START}\nnew generated\n${GENERATED_REGION_END}`;

describe("marked-region", () => {
  it("prepends generated content when no region exists", () => {
    expect(replaceMarkedRegion("custom", generated)).toBe(`${generated}\n\ncustom`);
  });

  it("replaces only the generated region", () => {
    const existing = `${GENERATED_REGION_START}\nold\n${GENERATED_REGION_END}\n\ncustom`;
    expect(replaceMarkedRegion(existing, generated)).toBe(`${generated}\n\ncustom`);
  });

  it("throws when markers are broken", () => {
    expect(() => replaceMarkedRegion(`${GENERATED_REGION_START}\nold`, generated)).toThrow(
      MarkedRegionError,
    );
  });
});
