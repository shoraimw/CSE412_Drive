export type VehicleCategory = "bike" | "car" | "premium";
export type Point = {lat: number; lng: number};
export type FareRates = {
  baseMinor: number;
  perKmMinor: number;
  perMinuteMinor: number;
  minMinor: number;
  serviceFeeMinor: number;
  surgeMultiplier: number;
  surgeCap: number;
};
export type FareBreakdown = {
  baseMinor: number;
  distanceMinor: number;
  durationMinor: number;
  serviceFeeMinor: number;
  surgeExtraMinor: number;
  totalMinor: number;
  currency: "BDT";
};
const HOUR = 3600000;
const EARTH_RADIUS_KM = 6371.0088;

export function assertPoint(value: Point): void {
  if (!Number.isFinite(value.lat) || !Number.isFinite(value.lng) ||
      value.lat < -90 || value.lat > 90 || value.lng < -180 || value.lng > 180) {
    throw new Error("Invalid latitude/longitude.");
  }
}

export function haversineKm(a: Point, b: Point): number {
  assertPoint(a);
  assertPoint(b);
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const x = Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(x)));
}

// Until a server-side Routes API quote is available in Phase 4, the
// demo quote is deliberately labelled provisional; it is not a road route.
export function approximateRoute(a: Point, b: Point): {
  distanceMeters: number; durationSeconds: number; provisional: true;
} {
  const directKm = haversineKm(a, b);
  if (directKm < 0.1 || directKm > 100) {
    throw new Error("Pickup and destination must be 0.1–100 km apart.");
  }
  const estimatedKm = directKm * 1.3;
  const estimatedMinutes = (estimatedKm / 24) * 60 + 4;
  return {
    distanceMeters: Math.ceil(estimatedKm * 1000),
    durationSeconds: Math.ceil(estimatedMinutes * 60),
    provisional: true
  };
}

export function calculateFare(
  distanceMeters: number,
  durationSeconds: number,
  rates: FareRates
): FareBreakdown {
  if (!Number.isFinite(distanceMeters) || !Number.isFinite(durationSeconds) ||
      distanceMeters <= 0 || durationSeconds <= 0 ||
      distanceMeters > 150000 || durationSeconds > 86400) {
    throw new Error("Route metrics out of bounds.");
  }
  const amounts = [rates.baseMinor, rates.perKmMinor, rates.perMinuteMinor,
    rates.minMinor, rates.serviceFeeMinor];
  if (amounts.some(x => !Number.isSafeInteger(x) || x < 0) ||
      !Number.isFinite(rates.surgeMultiplier) ||
      rates.surgeMultiplier < 1 || rates.surgeMultiplier > rates.surgeCap ||
      rates.surgeCap > 5) {
    throw new Error("Invalid fare policy.");
  }
  const distanceMinor = Math.round(distanceMeters * rates.perKmMinor / 1000);
  const durationMinor = Math.round(durationSeconds * rates.perMinuteMinor / 60);
  const subtotal = rates.baseMinor + distanceMinor + durationMinor + rates.serviceFeeMinor;
  const surged = Math.round(subtotal * rates.surgeMultiplier);
  const totalMinor = Math.max(rates.minMinor, surged);
  if (!Number.isSafeInteger(totalMinor)) throw new Error("Fare overflow.");
  return {
    baseMinor: rates.baseMinor,
    distanceMinor,
    durationMinor,
    serviceFeeMinor: rates.serviceFeeMinor,
    surgeExtraMinor: surged - subtotal,
    totalMinor,
    currency: "BDT"
  };
}

// Conservative hourly slot locking; even partially used hours are locked.
export function reservationSlots(startMs: number, endMs: number): string[] {
  if (!Number.isSafeInteger(startMs) || !Number.isSafeInteger(endMs) ||
      endMs <= startMs || endMs - startMs > 72 * HOUR) {
    throw new Error("Rental duration must be greater than zero and at most 72 hours.");
  }
  const result: string[] = [];
  const start = Math.floor(startMs / HOUR);
  const end = Math.ceil(endMs / HOUR);
  for (let slot = start; slot < end; slot++) result.push(String(slot));
  if (result.length > 73) throw new Error("Rental slot count exceeds limit.");
  return result;
}

export function validStateTransition(
  from: string, to: string, actor: "driver" | "rider" | "server"
): boolean {
  if (to === "cancelled") return (actor === "rider" || actor === "driver") &&
    ["matching", "accepted", "driver_arriving"].includes(from);
  return actor === "driver" && (
    (from === "accepted" && to === "driver_arriving") ||
    (from === "driver_arriving" && to === "in_progress") ||
    (from === "in_progress" && to === "completed")
  );
}

export function scoreDriver(km: number, rating: number, acceptanceRate: number): number {
  if (![km, rating, acceptanceRate].every(Number.isFinite)) return -Infinity;
  return 0.6 * Math.max(0, 1 - km / 8) +
    0.25 * Math.max(0, Math.min(1, rating / 5)) +
    0.15 * Math.max(0, Math.min(1, acceptanceRate));
}
