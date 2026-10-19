import {describe, expect, it} from "vitest";
import {displayError, formatBdt, formatDistance, formatDuration, validBangladeshPhone} from "./domain";

describe("DRIVE web formatting and validation", () => {
  it("formats BDT minor units without trusting invalid values", () => {
    expect(formatBdt(12500)).toContain("125");
    expect(formatBdt(-1)).toBe("—");
  });
  it("formats route distance and ETA", () => {
    expect(formatDistance(850)).toBe("850 m");
    expect(formatDistance(2350)).toBe("2.4 km");
    expect(formatDuration(3660)).toBe("1 hr 1 min");
  });
  it("validates Bangladeshi mobile formats", () => {
    expect(validBangladeshPhone("+8801712345678")).toBe(true);
    expect(validBangladeshPhone("01712345678")).toBe(true);
    expect(validBangladeshPhone("123")).toBe(false);
  });
  it("explains server internal errors with actionable backend checks", () => {
    expect(displayError({code: "functions/internal"})).toContain("GOOGLE_MAPS_SERVER_KEY");
    expect(displayError({code: "functions/internal"})).toContain("Cloud Functions logs");
  });
  it("does not expose opaque unknown errors", () => {
    expect(displayError({code: "permission-denied"})).toContain("permission");
    expect(displayError(null)).toContain("try again");
  });
});