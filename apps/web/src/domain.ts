export type RidePoint = {
  lat: number;
  lng: number;
  label: string;
};

export type PlaceSuggestion = {
  placeId: string;
  description: string;
};

export type FareQuote = {
  quoteId: string;
  expiresAtMs: number;
  fare: {totalMinor: number; currency?: string};
  route: {distanceMeters: number; durationSeconds: number; provisional: boolean};
  currency: string;
  warning?: string | null;
};

export function formatBdt(minor: number): string {
  if (!Number.isFinite(minor) || minor < 0) return "—";
  return new Intl.NumberFormat("en-BD", {
    style: "currency",
    currency: "BDT",
    maximumFractionDigits: 0
  }).format(minor / 100);
}

export function formatDistance(meters: number): string {
  if (!Number.isFinite(meters) || meters < 0) return "—";
  return meters >= 1000
    ? (meters / 1000).toFixed(1) + " km"
    : Math.round(meters) + " m";
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "—";
  const minutes = Math.max(1, Math.round(seconds / 60));
  if (minutes < 60) return minutes + " min";
  return Math.floor(minutes / 60) + " hr " + (minutes % 60) + " min";
}

export function displayError(error: unknown): string {
  const code = typeof error === "object" && error !== null && "code" in error
    ? String((error as {code: unknown}).code) : "";
  if (code.includes("permission-denied")) return "You do not have permission to do that.";
  if (code.includes("unauthenticated")) return "Please sign in again and retry.";
  if (code.includes("unavailable") || code.includes("network-request-failed")) {
    return "The service is temporarily unavailable. Check your connection and try again.";
  }
  if (code.includes("failed-precondition")) {
    return error instanceof Error ? error.message : "Required setup is missing.";
  }
  if (error instanceof Error && error.message) return error.message;
  return "Something went wrong. Please try again.";
}

export function validBangladeshPhone(phone: string): boolean {
  return /^(\+8801[3-9]\d{8}|01[3-9]\d{8})$/.test(phone.trim());
}