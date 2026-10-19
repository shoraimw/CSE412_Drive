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


const touristCategory = z.enum([
  "tourist_attraction", "museum", "park", "restaurant",
  "lodging", "hospital", "pharmacy", "atm"
]);

export const discoverTouristPlaces = onCall(options, async request => {
  requireAuth(request.auth?.uid);
  const input = z.object({
    center: z.object({lat: z.number().finite().min(-90).max(90), lng: z.number().finite().min(-180).max(180)}).strict(),
    category: touristCategory,
    radiusMeters: z.number().int().min(500).max(10000).default(5000),
    languageCode: z.enum(["en", "bn"]).default("en")
  }).strict().safeParse(request.data);
  if (!input.success) throw new HttpsError("invalid-argument", "Choose a valid search area and category.");
  const includedTypes: Record<z.infer<typeof touristCategory>, string[]> = {
    tourist_attraction: ["tourist_attraction"],
    museum: ["museum"],
    park: ["park"],
    restaurant: ["restaurant"],
    lodging: ["lodging"],
    hospital: ["hospital"],
    pharmacy: ["pharmacy"],
    atm: ["atm"]
  };
  const response = await googleJson("https://places.googleapis.com/v1/places:searchNearby", {
    method: "POST",
    headers: {"Content-Type": "application/json", "X-Goog-Api-Key": apiKey(),
      "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress,places.location,places.types,places.rating,places.userRatingCount"},
    body: JSON.stringify({
      includedTypes: includedTypes[input.data.category],
      maxResultCount: 12,
      rankPreference: "POPULARITY",
      locationRestriction: {circle: {
        center: {latitude: input.data.center.lat, longitude: input.data.center.lng},
        radius: input.data.radiusMeters
      }},
      languageCode: input.data.languageCode
    })
  });
  const places = Array.isArray(response.places) ? response.places : [];
  return {places: places.flatMap((raw) => {
    if (!raw || typeof raw !== "object") return [];
    const p = raw as Record<string, unknown>;
    const location = p.location as Record<string, unknown> | undefined;
    const display = p.displayName as Record<string, unknown> | undefined;
    if (typeof p.id !== "string" || typeof location?.latitude !== "number" ||
        typeof location?.longitude !== "number") return [];
    return [{
      placeId: p.id, name: String(display?.text || "Recommended place"),
      address: String(p.formattedAddress || ""),
      lat: location.latitude, lng: location.longitude,
      types: Array.isArray(p.types) ? p.types.filter(x => typeof x === "string").slice(0, 8) : [],
      ...(typeof p.rating === "number" ? {rating: p.rating} : {}),
      ...(typeof p.userRatingCount === "number" ? {reviewCount: p.userRatingCount} : {})
    }];
  })};
});

export const getTouristRoute = onCall(options, async request => {
  requireAuth(request.auth?.uid);
  const point = z.object({lat: z.number().finite().min(-90).max(90), lng: z.number().finite().min(-180).max(180)}).strict();
  const input = z.object({
    origin: point, destination: point,
    waypoints: z.array(point).max(5).default([]),
    travelMode: z.enum(["DRIVE", "WALK", "BICYCLE"]).default("DRIVE"),
    optimizeStops: z.boolean().default(true)
  }).strict().safeParse(request.data);
  if (!input.success) throw new HttpsError("invalid-argument", "Invalid tourist route request.");
  const response = await googleJson("https://routes.googleapis.com/directions/v2:computeRoutes", {
    method: "POST",
    headers: {"Content-Type": "application/json", "X-Goog-Api-Key": apiKey(),
      "X-Goog-FieldMask": "routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline,routes.optimizedIntermediateWaypointIndex"},
    body: JSON.stringify({
      origin: {location: {latLng: {latitude: input.data.origin.lat, longitude: input.data.origin.lng}}},
      destination: {location: {latLng: {latitude: input.data.destination.lat, longitude: input.data.destination.lng}}},
      ...(input.data.waypoints.length ? {
        intermediates: input.data.waypoints.map(p => ({location: {latLng: {latitude: p.lat, longitude: p.lng}}})),
        optimizeWaypointOrder: input.data.optimizeStops
      } : {}),
      travelMode: input.data.travelMode,
      ...(input.data.travelMode === "DRIVE" ? {routingPreference: "TRAFFIC_AWARE"} : {}),
      languageCode: "en", units: "METRIC"
    })
  });
  const routes = response.routes as Record<string, unknown>[] | undefined;
  const route = routes?.[0];
  if (!route || typeof route.distanceMeters !== "number" || typeof route.duration !== "string") {
    throw new HttpsError("not-found", "No route found for these stops.");
  }
  const durationSeconds = Math.ceil(Number(route.duration.replace(/s$/, "")));
  if (!Number.isFinite(durationSeconds) || route.distanceMeters < 1 || durationSeconds < 1) {
    throw new HttpsError("failed-precondition", "The route provider returned invalid route data.");
  }
  const polyline = route.polyline as Record<string, unknown> | undefined;
  return {
    distanceMeters: route.distanceMeters, durationSeconds,
    encodedPolyline: String(polyline?.encodedPolyline || ""),
    optimizedIntermediateWaypointIndex: Array.isArray(route.optimizedIntermediateWaypointIndex)
      ? route.optimizedIntermediateWaypointIndex.filter(x => Number.isInteger(x)) : [],
    routeSource: "google_routes",
    warning: "Route optimization is based on Google Routes data and selected travel mode; it is not a guarantee of real-time road safety."
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
