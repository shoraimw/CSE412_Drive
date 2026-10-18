import {getFirestore, FieldValue, Timestamp} from "firebase-admin/firestore";
import {onCall, HttpsError} from "firebase-functions/v2/https";
import {GoogleAuth} from "google-auth-library";
import {z} from "zod";

const getQuoteSchema = z.object({
  quoteId: z.string().trim().min(8).max(128),
}).strict();
const auth = new GoogleAuth();
const region = "asia-south1";

function hourInDhaka(now: Date): {hour_local: number; weekday: number} {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Dhaka", hour: "2-digit", hourCycle: "h23",
    weekday: "short",
  });
  const parts = formatter.formatToParts(now);
  const hour = Number(parts.find(p => p.type === "hour")?.value || "0");
  const day = parts.find(p => p.type === "weekday")?.value;
  const weekdays: Record<string, number> = {
    Sun: 6, Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5,
  };
  return {hour_local: hour, weekday: weekdays[day || "Mon"] ?? 0};
}

/**
 * Experimental read-only ML insight endpoint.
 * Does NOT modify fare, routing, payment, driver ranking or SOS state.
 * Uses a limited per-rider Firestore quota, App Check (when enabled), and a
 * private Cloud Run Invoker identity token. Client input is ONLY quoteId.
 */
export const getMlTripInsights = onCall({
  region, maxInstances: 6, concurrency: 20, timeoutSeconds: 8,
  enforceAppCheck: process.env.DRIVE_ENFORCE_APP_CHECK === "true",
}, async request => {
  const uid = request.auth?.uid;
  if (!uid || request.auth?.token.firebase?.sign_in_provider === "anonymous") {
    throw new HttpsError("unauthenticated", "Verified sign-in is required.");
  }
  const parsed = getQuoteSchema.safeParse(request.data);
  if (!parsed.success) throw new HttpsError("invalid-argument", "Invalid quote ID.");

  const quote = await getFirestore().doc("rideQuotes/" + parsed.data.quoteId).get();
  if (!quote.exists || quote.get("riderId") !== uid) {
    throw new HttpsError("permission-denied", "You cannot inspect this quote.");
  }
  const expires = quote.get("expiresAt") as Timestamp | undefined;
  if (!expires || expires.toMillis() <= Date.now()) {
    throw new HttpsError("failed-precondition", "Quote expired.");
  }
  const baselineFare = quote.get("fare") as {totalMinor?: number} | undefined;
  const baselineDuration = quote.get("durationSeconds");
  const distanceMeters = quote.get("distanceMeters");
  if (typeof distanceMeters !== "number" ||
      typeof baselineDuration !== "number" ||
      !Number.isFinite(distanceMeters) || distanceMeters <= 0 ||
      !Number.isFinite(baselineDuration) || baselineDuration <= 0 ||
      !Number.isSafeInteger(baselineFare?.totalMinor)) {
    throw new HttpsError("failed-precondition", "Quote is incomplete.");
  }
  const baseline = {
    etaMinutes: Math.ceil(baselineDuration / 60),
    authoritativeFareMinor: baselineFare!.totalMinor,
    currency: "BDT", source: "server_quote",
  };

  const serviceUrl = process.env.DRIVE_ML_SERVICE_URL;
  if (!serviceUrl) return {
    modelStatus: "not_deployed", baseline,
    note: "No ML model service configured; the actual quote is unchanged.",
  };
  if (!/^https:\/\/[a-zA-Z0-9.-]+\.run\.app\/?$/.test(serviceUrl)) {
    throw new HttpsError("failed-precondition", "ML service URL is invalid.");
  }

  const bucket = getFirestore().doc("mlInferenceBudgets/" + uid);
  await getFirestore().runTransaction(async tx => {
    const old = await tx.get(bucket);
    const last = old.get("lastUsedAt") as Timestamp | undefined;
    if (last && Date.now() - last.toMillis() < 8000) {
      throw new HttpsError("resource-exhausted",
        "Wait at least eight seconds before requesting another insight.");
    }
    tx.set(bucket, {lastUsedAt: FieldValue.serverTimestamp()}, {merge: true});
  });

  const {hour_local, weekday} = hourInDhaka(new Date());
  const vehicleType = quote.get("vehicleType");
  if (!["car", "bike", "premium"].includes(vehicleType)) {
    throw new HttpsError("failed-precondition", "Unknown ride category.");
  }
  // Placeholder traffic/demand inputs are openly declared. Until real
  // observations feed this feature vector, do not imply traffic-aware ML.
  const features = {
    distance_km: Math.min(150, distanceMeters / 1000),
    traffic_index: 1.0,
    demand_index: 1.0,
    hour_local, weekday,
    vehicle_type: vehicleType,
  };
  try {
    const client = await auth.getIdTokenClient(serviceUrl);
    const result = await client.request({
      url: serviceUrl.replace(/\/$/, "") + "/v1/predict/all",
      method: "POST", data: {features}, timeout: 2800,
    });
    const payload = result.data as Record<string, unknown>;
    if (!payload || typeof payload !== "object") throw new Error("Malformed ML response");
    return {
      modelStatus: "experimental", baseline, insights: payload,
      featureQuality: "neutral_traffic_and_demand_proxies",
      warning: "Experimental historical-data insights, NOT payable fare or emergency decisions.",
    };
  } catch (_) {
    return {
      modelStatus: "unavailable", baseline,
      note: "ML service unavailable; reliable server quote is unaffected.",
    };
  }
});
