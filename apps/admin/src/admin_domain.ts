export type RateField =
  "baseMinor" | "perKmMinor" | "perMinuteMinor" |
  "minMinor" | "serviceFeeMinor" | "surgeMultiplier" | "surgeCap";
export type VehicleCategory = "bike" | "car" | "premium";
export type FareRates = Record<RateField, number>;
export type FarePlan = Record<VehicleCategory, FareRates>;

export const categories: VehicleCategory[] = ["bike", "car", "premium"];
export const moneyFields: RateField[] = [
  "baseMinor", "perKmMinor", "perMinuteMinor", "minMinor", "serviceFeeMinor"
];
export const allRateFields: RateField[] = [...moneyFields, "surgeMultiplier", "surgeCap"];

export const demoRates: FarePlan = {
  bike: {
    baseMinor: 3000, perKmMinor: 900, perMinuteMinor: 140,
    minMinor: 5000, serviceFeeMinor: 200,
    surgeMultiplier: 1, surgeCap: 2.5,
  },
  car: {
    baseMinor: 6000, perKmMinor: 1600, perMinuteMinor: 220,
    minMinor: 9000, serviceFeeMinor: 500,
    surgeMultiplier: 1, surgeCap: 2.5,
  },
  premium: {
    baseMinor: 12000, perKmMinor: 2700, perMinuteMinor: 350,
    minMinor: 16000, serviceFeeMinor: 1000,
    surgeMultiplier: 1, surgeCap: 2.5,
  },
};

export const bdt = (minor: unknown): string =>
  typeof minor === "number" && Number.isFinite(minor)
    ? "৳" + (minor / 100).toLocaleString("en-BD", {
        minimumFractionDigits: 2, maximumFractionDigits: 2
      })
    : "—";

export const shortId = (value: unknown): string =>
  typeof value === "string" && value.length > 14
    ? value.slice(0, 7) + "…" + value.slice(-4)
    : typeof value === "string" ? value : "—";

export function parseRatePlan(data: unknown): FarePlan | null {
  if (data === null || typeof data !== "object") return null;
  const result = {} as FarePlan;
  for (const category of categories) {
    const row = (data as Record<string, unknown>)[category];
    if (!row || typeof row !== "object") return null;
    const entries = {} as FareRates;
    for (const field of allRateFields) {
      const value = (row as Record<string, unknown>)[field];
      if (typeof value !== "number" || !Number.isFinite(value)) return null;
      entries[field] = value;
    }
    result[category] = entries;
  }
  return result;
}

export function validateFarePlan(version: string, plan: FarePlan): string[] {
  const problems: string[] = [];
  if (!/^[A-Za-z0-9_-]{4,48}$/.test(version)) {
    problems.push("Version must be 4–48 letters, numbers, hyphens or underscores.");
  }
  for (const category of categories) {
    const r = plan[category];
    for (const field of moneyFields) {
      const value = r[field];
      const max = field === "perKmMinor" || field === "perMinuteMinor"
        ? 1_000_000 : 10_000_000;
      if (!Number.isSafeInteger(value) || value < 0 || value > max) {
        problems.push(category + "." + field + " must be a nonnegative integer (BDT minor units).");
      }
    }
    if (!Number.isFinite(r.surgeCap) || r.surgeCap < 1 || r.surgeCap > 5 ||
        !Number.isFinite(r.surgeMultiplier) || r.surgeMultiplier < 1 ||
        r.surgeMultiplier > r.surgeCap) {
      problems.push(category + ": surge must satisfy 1 ≤ multiplier ≤ cap ≤ 5.");
    }
  }
  return problems;
}

export function recentStatusCounts(rows: ReadonlyArray<Record<string, unknown>>):
    Record<string, number> {
  const result: Record<string, number> = {};
  for (const row of rows) {
    const status = typeof row.status === "string" ? row.status : "unknown";
    result[status] = (result[status] || 0) + 1;
  }
  return result;
}

/** Avoid duplicated rows if records arrive while loading older pages. */
export function appendUniqueRows<T extends {id:string}>(
  existing:ReadonlyArray<T>, older:ReadonlyArray<T>,
):T[] {
  const seen=new Set(existing.map(item=>item.id));
  const merged=[...existing];
  for(const item of older){
    if(!seen.has(item.id)){seen.add(item.id);merged.push(item);}
  }
  return merged;
}
