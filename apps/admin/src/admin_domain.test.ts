import {describe, expect, it} from "vitest";
import {
  bdt, demoRates, parseRatePlan, recentStatusCounts,
  shortId, validateFarePlan,
} from "./admin_domain";

describe("Phase 8 admin domain", () => {
  it("rejects unsafe pricing version and numeric bounds", () => {
    expect(validateFarePlan("bad version", demoRates)).toHaveLength(1);
    expect(validateFarePlan("v2026_08", demoRates)).toHaveLength(0);
    expect(validateFarePlan("v1234", {
      ...demoRates, car: {...demoRates.car, perKmMinor: -1}
    }).join(" ")).toContain("car.perKmMinor");
    expect(validateFarePlan("v1234", {
      ...demoRates, bike: {...demoRates.bike, surgeMultiplier: 6}
    }).join(" ")).toContain("surge");
  });
  it("validates trusted complete pricing plan shape", () => {
    expect(parseRatePlan(demoRates)).not.toBeNull();
    expect(parseRatePlan({car: demoRates.car})).toBeNull();
    expect(parseRatePlan({
      ...demoRates, bike: {...demoRates.bike, baseMinor: "3000"}
    })).toBeNull();
  });
  it("formats minor units and masks long IDs", () => {
    expect(bdt(12345)).toContain("123.45");
    expect(bdt(null)).toBe("—");
    expect(shortId("abcdefghijklmno")).toBe("abcdefg…lmno");
  });
  it("clearly counts only provided sampled rows", () => {
    expect(recentStatusCounts([
      {status: "completed"}, {status: "matching"}, {status: "completed"}
    ])).toEqual({completed: 2, matching: 1});
  });
});
