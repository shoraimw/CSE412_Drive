import {describe, expect, it} from "vitest";
import {
  appendUniqueRows, bdt, demoRates, parseRatePlan, recentStatusCounts,
  shortId, validateFarePlan, filterOperationalRows,
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
  it("appends cursor pages without duplicating an operational record", () => {
    const earlier=[{id:"x1",status:"open"},{id:"x2",status:"in_review"}];
    const older=[{id:"x2",status:"open"},{id:"x3",status:"resolved"}];
    const merged=appendUniqueRows(earlier,older);
    expect(merged.map(x=>x.id)).toEqual(["x1","x2","x3"]);
    expect(merged[1].status).toBe("in_review");
  });
  it("clearly counts only provided sampled rows", () => {
    expect(recentStatusCounts([
      {status: "completed"}, {status: "matching"}, {status: "completed"}
    ])).toEqual({completed: 2, matching: 1});
  });
});

describe("bounded operational search",()=>{
  const rows=[
    {id:"case-101",status:"open",priority:"high",serviceId:"ride-11",topic:"safety"},
    {id:"case-102",status:"in_review",priority:"normal",serviceId:"rental-55",topic:"payment"},
    {id:"case-103",status:"resolved",serviceId:"ride-22",topic:"service"},
  ];
  it("filters by status, priority and service identifier without fetching more records",()=>{
    expect(filterOperationalRows(rows,"","open","high").map(x=>x.id)).toEqual(["case-101"]);
    expect(filterOperationalRows(rows,"RENTAL-55","all","all").map(x=>x.id)).toEqual(["case-102"]);
    expect(filterOperationalRows(rows,"","all","normal").map(x=>x.id)).toEqual(["case-102","case-103"]);
    expect(filterOperationalRows(rows,"unknown","all","all")).toEqual([]);
  });
});
