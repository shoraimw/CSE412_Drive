import {onCall, HttpsError} from "firebase-functions/v2/https";
import {defineSecret} from "firebase-functions/params";
import {z} from "zod";
import {Point} from "./domain";

export const mapsServerKey = defineSecret("GOOGLE_MAPS_SERVER_KEY");
const options = {region: "asia-south1", maxInstances: 10, secrets: [mapsServerKey],
  enforceAppCheck: process.env.DRIVE_ENFORCE_APP_CHECK === "true"};
const placesEndpoint = "https://places.googleapis.com/v1/";

function requireAuth(uid: string | undefined): void {
  if (!uid) throw new HttpsError("unauthenticated", "Sign in to search for places.");
}
function apiKey(): string {
  const key = mapsServerKey.value();
  if (!key) throw new HttpsError("failed-precondition", "Google Maps server key not configured.");
  return key;
}
async function googleJson(url: string, init: RequestInit): Promise<Record<string, unknown>> {
  try {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(9000) });
    if (!res.ok) {
      // Do not forward Google API error text: it may contain internal information.
      throw new HttpsError("unavailable", "Google Maps request failed (" + res.status + ").");
    }
    const result: unknown = await res.json();
    if (!result || typeof result !== "object" || Array.isArray(result)) {
      throw new HttpsError("unavailable", "Invalid Google Maps response.");
    }
    return result as Record<string, unknown>;
  } catch (e) {
    if (e instanceof HttpsError) throw e;
    throw new HttpsError("unavailable", "Map service timed out or is unreachable.");
  }
}
const session = z.string().uuid();

export const autocompletePlaces = onCall(options, async (request) => {
  requireAuth(request.auth?.uid);
  const input = z.object({
    query: z.string().trim().min(3).max(100),
    sessionToken: session
  }).strict().safeParse(request.data);
  if (!input.success) throw new HttpsError("invalid-argument", "Enter at least 3 characters.");
  const response = await googleJson(placesEndpoint + "places:autocomplete", {
    method: "POST",
    headers: {"Content-Type": "application/json", "X-Goog-Api-Key": apiKey(),
      "X-Goog-FieldMask":
        "suggestions.placePrediction.placeId,suggestions.placePrediction.text.text"},
    body: JSON.stringify({input: input.data.query, sessionToken: input.data.sessionToken,
      includedRegionCodes: ["bd"], languageCode: "en"})
  });
  const suggestions = Array.isArray(response.suggestions) ? response.suggestions : [];
  return {predictions: suggestions.slice(0, 8).flatMap((entry) => {
    if (typeof entry !== "object" || entry === null) return [];
    const prediction = (entry as Record<string, unknown>).placePrediction as
      Record<string, unknown> | undefined;
    const text = prediction?.text as Record<string, unknown> | undefined;
    if (typeof prediction?.placeId !== "string" || typeof text?.text !== "string") return [];
    return [{placeId: prediction.placeId, description: text.text}];
  })};
});

export const resolvePlace = onCall(options, async (request) => {
  requireAuth(request.auth?.uid);
  const input = z.object({
    placeId: z.string().regex(/^[a-zA-Z0-9_-]{5,200}$/),
    sessionToken: session
  }).strict().safeParse(request.data);
  if (!input.success) throw new HttpsError("invalid-argument", "Invalid place selection.");
  const response = await googleJson(
    placesEndpoint + "places/" + encodeURIComponent(input.data.placeId) +
      "?sessionToken=" + encodeURIComponent(input.data.sessionToken),
    {headers: {"X-Goog-Api-Key": apiKey(),
      "X-Goog-FieldMask": "id,formattedAddress,location,displayName"}}
  );
  const location = response.location as Record<string, unknown> | undefined;
  if (!location || typeof location.latitude !== "number" ||
      typeof location.longitude !== "number") {
    throw new HttpsError("not-found", "Selected place has no usable coordinate.");
  }
  const display = response.displayName as Record<string, unknown> | undefined;
  return {
    lat: location.latitude, lng: location.longitude,
    label: String(response.formattedAddress || display?.text || "Selected location")
  };
});

export type ValidatedRoute = {
  distanceMeters: number;
  durationSeconds: number;
  encodedPolyline: string;
  provisional: boolean;
  routeSource: string;
};

export async function serverRoute(pickup: Point, destination: Point,
    vehicleType: "bike" | "car" | "premium"): Promise<ValidatedRoute> {
  // Google Routes does not provide motorbike routing in all regions. A DRIVE
  // route is used for ETA/fare on bike until a specialized provider exists.
  const response = await googleJson(
    "https://routes.googleapis.com/directions/v2:computeRoutes",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey(),
        "X-Goog-FieldMask":
          "routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline"
      },
      body: JSON.stringify({
        origin: {location: {latLng: {latitude: pickup.lat, longitude: pickup.lng}}},
        destination: {location: {latLng: {
          latitude: destination.lat, longitude: destination.lng
        }}},
        travelMode: "DRIVE",
        routingPreference: "TRAFFIC_AWARE",
        computeAlternativeRoutes: false,
        languageCode: "en", units: "METRIC"
      })
    }
  );
  const routes = response.routes as Record<string, unknown>[] | undefined;
  const primary = routes?.[0];
  if (!primary || typeof primary.distanceMeters !== "number" ||
      typeof primary.duration !== "string") {
    throw new HttpsError("not-found", "No drivable route found between these points.");
  }
  const durationSeconds = Math.ceil(Number(primary.duration.replace(/s$/, "")));
  const polyline = primary.polyline as Record<string, unknown> | undefined;
  const distanceMeters = primary.distanceMeters;
  if (!Number.isFinite(durationSeconds) || distanceMeters < 100 ||
      distanceMeters > 150000 || durationSeconds < 1 || durationSeconds > 86400) {
    throw new HttpsError("failed-precondition", "Route is outside supported distance/time limits.");
  }
  return {
    distanceMeters, durationSeconds,
    encodedPolyline: String(polyline?.encodedPolyline ?? ""),
    provisional: false,
    routeSource: vehicleType === "bike" ? "google_drive_proxy_for_bike" : "google_routes"
  };
}
