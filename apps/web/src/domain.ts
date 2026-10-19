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
  if (code === "auth/unauthorized-domain") {
    return "This website domain is not authorized in Firebase Authentication. Add this Vercel hostname under Firebase Console → Authentication → Settings → Authorized domains.";
  }
  if (code === "auth/operation-not-allowed") {
    return "This sign-in method is disabled. Enable the selected provider in Firebase Console → Authentication → Sign-in method.";
  }
  if (code === "auth/invalid-api-key") {
    return "Firebase rejected the web API key. Check the Vercel VITE_FIREBASE_API_KEY environment variable and Firebase API key restrictions.";
  }
  if (code === "auth/popup-blocked") {
    return "The Google sign-in popup was blocked by the browser. Allow popups for this site and try again.";
  }
  if (code === "auth/popup-closed-by-user") {
    return "Google sign-in was closed before completion. Try again.";
  }
  if (code === "auth/captcha-check-failed" || code === "auth/invalid-app-credential") {
    return "Phone verification could not validate reCAPTCHA. Check the Firebase authorized domain, Phone provider and reCAPTCHA configuration.";
  }
  if (code === "auth/quota-exceeded" || code === "auth/too-many-requests") {
    return "Firebase has temporarily limited verification attempts. Try later or use a Firebase test phone number.";
  }
  if (code === "auth/invalid-phone-number") {
    return "Enter a valid Bangladesh mobile number, for example +8801712345678.";
  }
  if (code.includes("functions/not-found")) {
    return "The required Firebase Cloud Function is not deployed to the configured project/region. Deploy the staging functions and retry.";
  }
  if (code === "functions/internal" || code === "internal") {
    return "The DRIVE server failed while processing this request. For place search, check Cloud Functions logs for autocompletePlaces in asia-south1 and verify the GOOGLE_MAPS_SERVER_KEY secret, Places API (New), billing, and API-key restrictions. For fare estimates, also verify the active pricing configuration and Routes API.";
  }
  if (code === "functions/unknown" || code === "unknown") {
    return "The DRIVE backend returned an unknown error. Check Cloud Functions logs for the callable name and timestamp, then verify its secrets and required Firebase configuration.";
  }
  if (code === "functions/resource-exhausted") {
    return "The service reached a quota or rate limit. Check Firebase/Google Cloud usage and retry after the quota resets.";
  }
  if (code.includes("permission-denied")) return "You do not have permission to do that.";
  if (code.includes("unauthenticated")) return "Please sign in first, then retry.";
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