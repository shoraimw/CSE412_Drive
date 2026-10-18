// Phase 6 server-controlled payments, messaging, ratings and notifications.
export {
  sendRideMessage, rateCompletedRide, registerPushToken, unregisterPushToken,
  onDriverOfferCreated, onRideStatusChanged, onRideMessageCreated, deliverPushNotification
} from "./engagement";
export {
  chooseCashForRide, reportCashReceived,
  prepareStripeTestPayment, stripeTestWebhook
} from "./payments";

import {initializeApp} from "firebase-admin/app";
import {getAuth} from "firebase-admin/auth";
import {getDatabase} from "firebase-admin/database";
import {getFirestore, FieldValue, Timestamp, DocumentReference} from "firebase-admin/firestore";
import {getStorage} from "firebase-admin/storage";
import {onCall, CallableRequest, HttpsError} from "firebase-functions/v2/https";
import {geohashQueryBounds} from "geofire-common";
import {z} from "zod";
import {
  approximateRoute, calculateFare, haversineKm, reservationSlots,
  scoreDriver, validStateTransition, Point, FareRates, VehicleCategory
} from "./domain";
import {mapsServerKey, serverRoute} from "./maps";
export {autocompletePlaces, resolvePlace} from "./maps";

const initialConfig = JSON.parse(process.env.FIREBASE_CONFIG || "{}") as {
  projectId?: string; databaseURL?: string; storageBucket?: string;
};
initializeApp({
  ...initialConfig,
  databaseURL: process.env.FIREBASE_DATABASE_URL || initialConfig.databaseURL ||
    (process.env.FIREBASE_DATABASE_EMULATOR_HOST ?
      "https://" + (process.env.GCLOUD_PROJECT || "demo-drive-local") +
        "-default-rtdb.firebaseio.com" : undefined),
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET || initialConfig.storageBucket ||
    (process.env.FIREBASE_STORAGE_EMULATOR_HOST ?
      (process.env.GCLOUD_PROJECT || "demo-drive-local") + ".appspot.com" : undefined)
});
const db = getFirestore();
const rtdb = getDatabase();
const auth = getAuth();
const region = "asia-south1";
const options = {region, maxInstances: 10, memory: "256MiB" as const};
const pointSchema = z.object({
  lat: z.number().finite().min(-90).max(90),
  lng: z.number().finite().min(-180).max(180)
}).strict();
const categorySchema = z.enum(["bike", "car", "premium"]);
const roleDecisionSchema = z.object({
  uid: z.string().min(4).max(128),
  approve: z.boolean(),
  reason: z.string().max(400).default("")
}).strict();
const rideIdSchema = z.object({rideId: z.string().min(8).max(128)}).strict();

function authenticated(request: CallableRequest<unknown>): string {
  const uid = request.auth?.uid;
  if (!uid || request.auth?.token.firebase?.sign_in_provider === "anonymous") {
    throw new HttpsError("unauthenticated", "Sign in with a verified account.");
  }
  return uid;
}
function administrator(request: CallableRequest<unknown>): string {
  const uid = authenticated(request);
  if (request.auth?.token.admin !== true) {
    throw new HttpsError("permission-denied", "Administrator privileges required.");
  }
  return uid;
}
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new HttpsError("invalid-argument", result.error.issues.map(i => i.message).join("; "));
  }
  return result.data;
}
function requirePresent(condition: unknown, message: string): asserts condition {
  if (!condition) throw new HttpsError("failed-precondition", message);
}
function roundMoney(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new HttpsError("failed-precondition", "Invalid monetary configuration.");
  }
  return value;
}
function asPoint(value: unknown): Point {
  return parse(pointSchema, value);
}

export const ensureProfile = onCall(options, async request => {
  const uid = authenticated(request);
  const input = parse(z.object({
    displayName: z.string().trim().min(2).max(80),
    locale: z.enum(["en", "bn"]).default("en")
  }).strict(), request.data);
  const ref = db.doc("users/" + uid);
  const user = await auth.getUser(uid);
  await db.runTransaction(async tx => {
    const old = await tx.get(ref);
    if (!old.exists) {
      tx.create(ref, {
        uid, displayName: input.displayName, locale: input.locale,
        email: user.email || null, phone: user.phoneNumber || null,
        accountStatus: "active", roles: ["rider"],
        photoUrl: user.photoURL || null,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp()
      });
    } else {
      requirePresent(old.get("accountStatus") === "active", "This account is disabled.");
      tx.update(ref, {
        displayName: input.displayName, locale: input.locale,
        updatedAt: FieldValue.serverTimestamp()
      });
    }
  });
  return {uid, profileReady: true};
});

export const submitDriverApplication = onCall(options, async request => {
  const uid = authenticated(request);
  const input = parse(z.object({
    vehicleType: categorySchema,
    vehiclePlate: z.string().trim().min(4).max(32),
    vehicleModel: z.string().trim().min(2).max(80),
    documentPaths: z.array(z.string().min(10).max(220)).length(3)
  }).strict(), request.data);
  const unique = new Set(input.documentPaths);
  if (unique.size !== 3 || !input.documentPaths.every(path =>
    path.startsWith("applications/" + uid + "/") && !path.includes(".."))) {
    throw new HttpsError("invalid-argument", "Upload three distinct documents to your own application folder.");
  }
  const files = await Promise.all(input.documentPaths.map(p => getStorage().bucket().file(p).exists()));
  requirePresent(files.every(result => result[0]), "Upload all application files before submitting.");
  await db.runTransaction(async tx => {
    const profile = await tx.get(db.doc("users/" + uid));
    const ref = db.doc("driverApplications/" + uid);
    const previous = await tx.get(ref);
    requirePresent(profile.exists && profile.get("accountStatus") === "active",
      "Complete your profile before applying.");
    requirePresent(!previous.exists || previous.get("status") === "rejected",
      "An application is already pending or approved.");
    tx.set(ref, {
      uid, ...input, status: "pending", reviewedBy: null, decisionReason: null,
      submittedAt: FieldValue.serverTimestamp()
    });
    tx.set(db.doc("driverProfiles/" + uid), {
      uid, approvalStatus: "pending", vehicleType: input.vehicleType,
      vehiclePlate: input.vehiclePlate, online: false,
      ratingAverage: 5, acceptanceRate: 1
    }, {merge: true});
  });
  return {status: "pending"};
});

export const reviewDriverApplication = onCall(options, async request => {
  const adminId = administrator(request);
  const input = parse(roleDecisionSchema, request.data);
  const ref = db.doc("driverApplications/" + input.uid);
  await db.runTransaction(async tx => {
    const current = await tx.get(ref);
    requirePresent(current.exists && current.get("status") === "pending", "No pending driver application.");
    tx.update(ref, {
      status: input.approve ? "approved" : "rejected",
      reviewedBy: adminId, decisionReason: input.reason,
      reviewedAt: FieldValue.serverTimestamp()
    });
    tx.set(db.doc("driverProfiles/" + input.uid), {
      approvalStatus: input.approve ? "approved" : "rejected",
      online: false, approvedAt: input.approve ? FieldValue.serverTimestamp() : null
    }, {merge: true});
    tx.create(db.collection("auditEvents").doc(), {
      type: "driver_review", actorId: adminId, subjectId: input.uid,
      approved: input.approve, reason: input.reason,
      createdAt: FieldValue.serverTimestamp()
    });
  });
  // Claim is not sufficient alone; all privileged operations also check
  // the trusted profile approvalStatus in Firestore.
  const user = await auth.getUser(input.uid);
  await auth.setCustomUserClaims(input.uid, {...(user.customClaims || {}), driver: input.approve});
  return {uid: input.uid, status: input.approve ? "approved" : "rejected",
    refreshIdTokenRequired: true};
});

export const submitOwnerApplication = onCall(options, async request => {
  const uid = authenticated(request);
  const input = parse(z.object({businessName: z.string().trim().min(2).max(100)}).strict(), request.data);
  await db.runTransaction(async tx => {
    const user = await tx.get(db.doc("users/" + uid));
    const ref = db.doc("ownerProfiles/" + uid);
    const old = await tx.get(ref);
    requirePresent(user.exists && user.get("accountStatus") === "active", "Complete your profile.");
    requirePresent(!old.exists || old.get("approvalStatus") === "rejected",
      "An owner application is already open or approved.");
    tx.set(ref, {uid, businessName: input.businessName, approvalStatus: "pending",
      submittedAt: FieldValue.serverTimestamp()});
  });
  return {status: "pending"};
});

export const reviewOwnerApplication = onCall(options, async request => {
  const adminId = administrator(request);
  const input = parse(roleDecisionSchema, request.data);
  await db.runTransaction(async tx => {
    const ref = db.doc("ownerProfiles/" + input.uid);
    const old = await tx.get(ref);
    requirePresent(old.exists && old.get("approvalStatus") === "pending",
      "No pending owner application.");
    tx.update(ref, {approvalStatus: input.approve ? "approved" : "rejected",
      reviewedBy: adminId, decisionReason: input.reason,
      reviewedAt: FieldValue.serverTimestamp()});
    tx.create(db.collection("auditEvents").doc(), {
      type: "owner_review", actorId: adminId, subjectId: input.uid,
      approved: input.approve, createdAt: FieldValue.serverTimestamp()
    });
  });
  return {status: input.approve ? "approved" : "rejected"};
});

export const registerRentalVehicle = onCall(options, async request => {
  const uid = authenticated(request);
  const input = parse(z.object({
    model: z.string().trim().min(2).max(100),
    plate: z.string().trim().min(4).max(32),
    type: categorySchema,
    seatCount: z.number().int().min(1).max(12),
    rentalRatePerHourMinor: z.number().int().min(100).max(5000000),
    area: z.string().trim().min(2).max(100)
  }).strict(), request.data);
  const owner = await db.doc("ownerProfiles/" + uid).get();
  requirePresent(owner.get("approvalStatus") === "approved", "Owner approval is required.");
  const vehicle = db.collection("vehicles").doc();
  const {plate, ...publicListing} = input;
  await db.runTransaction(async tx => {
    tx.create(vehicle, {
      ...publicListing, ownerId: uid, approvalStatus: "pending", rentalEnabled: false,
      currency: "BDT", createdAt: FieldValue.serverTimestamp()
    });
    // Plate/registration data is server-only, not part of publicly listed vehicles.
    tx.create(db.doc("vehiclePrivate/" + vehicle.id), {
      ownerId: uid, plate, createdAt: FieldValue.serverTimestamp()
    });
  });
  return {vehicleId: vehicle.id, status: "pending"};
});

export const reviewRentalVehicle = onCall(options, async request => {
  const adminId = administrator(request);
  const input = parse(z.object({
    vehicleId: z.string().min(8).max(128), approve: z.boolean()
  }).strict(), request.data);
  const ref = db.doc("vehicles/" + input.vehicleId);
  await db.runTransaction(async tx => {
    const vehicle = await tx.get(ref);
    requirePresent(vehicle.exists && vehicle.get("approvalStatus") === "pending",
      "No pending vehicle.");
    tx.update(ref, {approvalStatus: input.approve ? "approved" : "rejected",
      rentalEnabled: input.approve, reviewedBy: adminId,
      reviewedAt: FieldValue.serverTimestamp()});
  });
  return {status: input.approve ? "approved" : "rejected"};
});

export const setDriverAvailability = onCall(options, async request => {
  const uid = authenticated(request);
  const input = parse(z.object({online: z.boolean()}).strict(), request.data);
  const profile = await db.doc("driverProfiles/" + uid).get();
  requirePresent(profile.exists && profile.get("approvalStatus") === "approved",
    "Admin-approved driver profile required.");
  await db.runTransaction(async tx => {
    const [fresh, busy] = await Promise.all([
      tx.get(profile.ref), tx.get(db.doc("driverBusy/" + uid))
    ]);
    requirePresent(fresh.get("approvalStatus") === "approved",
      "Driver approval is required.");
    requirePresent(input.online || !busy.exists,
      "Finish or cancel your current trip before going offline.");
    tx.update(profile.ref, {
      online: input.online, updatedAt: FieldValue.serverTimestamp()
    });
  });
  if (!input.online) await rtdb.ref("driverLocations/" + uid).remove();
  return {online: input.online};
});

async function activePricing(category: VehicleCategory): Promise<{
  version: string; rate: FareRates;
}> {
  const publicConfig = await db.doc("appConfig/public").get();
  const version = publicConfig.get("activePricingVersion") as string | undefined;
  requirePresent(typeof version === "string", "Seed an active pricing configuration first.");
  const snapshot = await db.doc("pricingConfigs/" + version).get();
  requirePresent(snapshot.exists && snapshot.get("active") === true,
    "Active pricing configuration not found.");
  const rate = snapshot.get("vehicles." + category) as FareRates | undefined;
  requirePresent(rate, "No pricing configured for this vehicle category.");
  return {version, rate};
}

export const getFareQuote = onCall(
  {...options, secrets: [mapsServerKey]},
  async request => {
    const uid = authenticated(request);
    const input = parse(z.object({
      pickup: pointSchema, destination: pointSchema, vehicleType: categorySchema
    }).strict(), request.data);
    const {version, rate} = await activePricing(input.vehicleType);
    let route: {
      distanceMeters: number; durationSeconds: number; provisional: boolean;
      encodedPolyline?: string; routeSource?: string;
    };
    try {
      // No silent live fallback when Routes fails: that would produce a
      // potentially misleading real-world quote.
      route = process.env.FUNCTIONS_EMULATOR === "true" &&
        !mapsServerKey.value()
        ? {...approximateRoute(input.pickup, input.destination),
          encodedPolyline: "", routeSource: "emulator_provisional"}
        : await serverRoute(input.pickup, input.destination, input.vehicleType);
    } catch (error) {
      if (error instanceof HttpsError) throw error;
      throw new HttpsError("invalid-argument", error instanceof Error ?
        error.message : "Invalid route.");
    }
    let fare;
    try {
      fare = calculateFare(route.distanceMeters, route.durationSeconds, rate);
    } catch (e) {
      throw new HttpsError("failed-precondition", e instanceof Error ?
        e.message : "Fare computation failed.");
    }
    const quote = db.collection("rideQuotes").doc();
    const now = Date.now();
    await quote.create({
      riderId: uid, ...input, ...route, fare, pricingVersion: version,
      currency: "BDT", estimateMethod: route.routeSource,
      expiresAt: Timestamp.fromMillis(now + 5 * 60 * 1000),
      usedAt: null, createdAt: FieldValue.serverTimestamp()
    });
    return {
      quoteId: quote.id, expiresAtMs: now + 5 * 60 * 1000,
      route, fare, pricingVersion: version, currency: "BDT",
      warning: route.provisional ?
        "Demo-only approximate route. No live road routing is connected." : null
    };
  }
);

export const requestRide = onCall(options, async request => {
  const uid = authenticated(request);
  const input = parse(z.object({
    quoteId: z.string().min(8).max(128),
    idempotencyKey: z.string().regex(/^[A-Za-z0-9-]{12,80}$/)
  }).strict(), request.data);
  const quoteRef = db.doc("rideQuotes/" + input.quoteId);
  const activeRef = db.doc("riderActive/" + uid);
  const keyRef = db.doc("requestKeys/" + uid + "_" + input.idempotencyKey);
  const rideRef = db.collection("rides").doc();
  const rideId = await db.runTransaction(async tx => {
    const [existing, active, quote] = await Promise.all([
      tx.get(keyRef), tx.get(activeRef), tx.get(quoteRef)
    ]);
    if (existing.exists) return existing.get("rideId") as string;
    requirePresent(!active.exists, "You already have an active ride.");
    requirePresent(quote.exists && quote.get("riderId") === uid,
      "Quote not found or belongs to a different rider.");
    requirePresent(quote.get("usedAt") == null, "Quote already used.");
    requirePresent((quote.get("expiresAt") as Timestamp).toMillis() > Date.now(),
      "Quote has expired. Generate another fare estimate.");
    tx.create(rideRef, {
      riderId: uid, driverId: null, status: "matching",
      pickup: quote.get("pickup"), destination: quote.get("destination"),
      vehicleType: quote.get("vehicleType"), fare: quote.get("fare"),
      currency: "BDT", pricingVersion: quote.get("pricingVersion"),
      estimateMethod: quote.get("estimateMethod"),
      provisional: quote.get("provisional") === true,
      routePolyline: quote.get("encodedPolyline") || "",
      distanceMeters: quote.get("distanceMeters"),
      durationSeconds: quote.get("durationSeconds"),
      createdAt: FieldValue.serverTimestamp(), acceptedAt: null
    });
    tx.create(activeRef, {rideId: rideRef.id});
    tx.create(keyRef, {rideId: rideRef.id, createdAt: FieldValue.serverTimestamp()});
    tx.update(quoteRef, {usedAt: FieldValue.serverTimestamp()});
    return rideRef.id;
  });
  return {rideId, status: "matching",
    nextAction: "Call dispatchNearbyDrivers after drivers publish locations."};
});

export const dispatchNearbyDrivers = onCall(options, async request => {
  const uid = authenticated(request);
  const input = parse(rideIdSchema, request.data);
  const rideRef = db.doc("rides/" + input.rideId);
  const ride = await rideRef.get();
  requirePresent(ride.exists && ride.get("riderId") === uid, "Ride not found.");
  requirePresent(ride.get("status") === "matching", "Ride is no longer matching.");
  const pickup = asPoint(ride.get("pickup"));
  const bounds = geohashQueryBounds([pickup.lat, pickup.lng], 8000);
  const queryResults = await Promise.all(bounds.map(([start, end]) =>
    rtdb.ref("driverLocations").orderByChild("geohash").startAt(start).endAt(end).limitToFirst(40).get()
  ));
  const candidates = new Map<string, {km: number}>();
  for (const snap of queryResults) {
    snap.forEach(child => {
      const location = child.val() as {lat?: unknown; lng?: unknown; updatedAt?: unknown};
      if (typeof location.lat !== "number" || typeof location.lng !== "number" ||
          typeof location.updatedAt !== "number" || Date.now() - location.updatedAt > 30000) {
        return false;
      }
      try {
        const km = haversineKm(pickup, {lat: location.lat, lng: location.lng});
        if (km <= 8) candidates.set(child.key || "", {km});
      } catch {
        // Ignore malformed location.
      }
      return false;
    });
  }
  const ranked: {uid: string; score: number}[] = [];
  for (const [driverId, {km}] of [...candidates].slice(0, 90)) {
    if (!driverId || driverId === uid) continue;
    const [profile, busy] = await Promise.all([
      db.doc("driverProfiles/" + driverId).get(),
      db.doc("driverBusy/" + driverId).get()
    ]);
    if (busy.exists || profile.get("approvalStatus") !== "approved" ||
        profile.get("online") !== true || profile.get("vehicleType") !== ride.get("vehicleType")) {
      continue;
    }
    ranked.push({uid: driverId, score: scoreDriver(km,
      Number(profile.get("ratingAverage") ?? 5),
      Number(profile.get("acceptanceRate") ?? 1))});
  }
  ranked.sort((a, b) => b.score - a.score);
  const selected = ranked.slice(0, 3);
  const offerRefs = selected.map(x => db.doc("driverOffers/" + input.rideId + "_" + x.uid));
  const offered = await db.runTransaction(async tx => {
    const [freshRide, ...oldOffers] = await Promise.all([
      tx.get(rideRef), ...offerRefs.map(ref => tx.get(ref))
    ]);
    requirePresent(freshRide.get("status") === "matching", "Ride already matched or cancelled.");
    const last = freshRide.get("lastDispatchAt") as Timestamp | undefined;
    if (last && Date.now() - last.toMillis() < 15000) {
      throw new HttpsError("resource-exhausted", "Wait 15 seconds before trying again.");
    }
    const targets: string[] = [];
    for (let i = 0; i < selected.length; i++) {
      const candidate = selected[i];
      const old = oldOffers[i];
      if (!candidate || !old || old.exists) continue;
      tx.create(offerRefs[i] as DocumentReference, {
        rideId: input.rideId, driverId: candidate.uid, riderId: uid,
        status: "pending", score: candidate.score,
        expiresAt: Timestamp.fromMillis(Date.now() + 45000),
        pickup: freshRide.get("pickup"), destination: freshRide.get("destination"),
        vehicleType: freshRide.get("vehicleType"),
        distanceMeters: freshRide.get("distanceMeters"),
        durationSeconds: freshRide.get("durationSeconds"),
        estimatedFareMinor: (freshRide.get("fare") as {totalMinor: number}).totalMinor,
        createdAt: FieldValue.serverTimestamp()
      });
      targets.push(candidate.uid);
    }
    tx.update(rideRef, {lastDispatchAt: FieldValue.serverTimestamp()});
    return targets;
  });
  return {rideId: input.rideId, offeredTo: offered, candidateCount: ranked.length,
    note: "Drivers can read their targeted offers. FCM push delivery is added in Phase 6."};
});

export const respondToOffer = onCall(options, async request => {
  const driverId = authenticated(request);
  const input = parse(z.object({
    offerId: z.string().min(8).max(260), accept: z.boolean()
  }).strict(), request.data);
  const offerRef = db.doc("driverOffers/" + input.offerId);
  const offer = await offerRef.get();
  requirePresent(offer.exists && offer.get("driverId") === driverId,
    "This ride offer was not issued to your account.");
  const rideId = offer.get("rideId") as string;
  const rideRef = db.doc("rides/" + rideId);
  const busyRef = db.doc("driverBusy/" + driverId);
  const driverRef = db.doc("driverProfiles/" + driverId);
  const result = await db.runTransaction(async tx => {
    const [freshOffer, ride, driver, busy] = await Promise.all([
      tx.get(offerRef), tx.get(rideRef), tx.get(driverRef), tx.get(busyRef)
    ]);
    requirePresent(freshOffer.get("driverId") === driverId, "Offer ownership mismatch.");
    if (ride.get("driverId") === driverId && ride.get("status") === "accepted") {
      return {rideId, status: "accepted", riderId: ride.get("riderId") as string};
    }
    requirePresent(freshOffer.get("status") === "pending", "Offer is no longer pending.");
    requirePresent((freshOffer.get("expiresAt") as Timestamp).toMillis() > Date.now(),
      "The offer has expired.");
    if (!input.accept) {
      tx.update(offerRef, {status: "declined", respondedAt: FieldValue.serverTimestamp()});
      return {rideId, status: "declined", riderId: ""};
    }
    requirePresent(ride.exists && ride.get("status") === "matching",
      "This ride is no longer available.");
    requirePresent(driver.get("approvalStatus") === "approved" &&
      driver.get("online") === true &&
      driver.get("vehicleType") === ride.get("vehicleType"),
      "Driver not eligible for this offer.");
    requirePresent(!busy.exists, "You already have an assigned ride.");
    tx.create(busyRef, {rideId, assignedAt: FieldValue.serverTimestamp()});
    tx.update(offerRef, {status: "accepted", respondedAt: FieldValue.serverTimestamp()});
    tx.update(rideRef, {
      driverId, status: "accepted", acceptedAt: FieldValue.serverTimestamp()
    });
    return {rideId, status: "accepted", riderId: ride.get("riderId") as string};
  });
  if (result.status === "accepted") {
    await rtdb.ref().update({
      ["rideDriver/" + rideId]: driverId,
      ["tripAccess/" + rideId + "/" + result.riderId]: true,
      ["tripAccess/" + rideId + "/" + driverId]: true
    });
  }
  return {rideId, status: result.status};
});

export const advanceRide = onCall(options, async request => {
  const driverId = authenticated(request);
  const input = parse(z.object({
    rideId: z.string().min(8).max(128),
    toStatus: z.enum(["driver_arriving", "in_progress", "completed"])
  }).strict(), request.data);
  const rideRef = db.doc("rides/" + input.rideId);
  const busyRef = db.doc("driverBusy/" + driverId);
  await db.runTransaction(async tx => {
    const ride = await tx.get(rideRef);
    const busy = await tx.get(busyRef);
    requirePresent(ride.exists && ride.get("driverId") === driverId,
      "You are not the assigned driver.");
    requirePresent(busy.exists && busy.get("rideId") === input.rideId,
      "Driver assignment is inconsistent.");
    requirePresent(validStateTransition(ride.get("status") as string, input.toStatus, "driver"),
      "Invalid ride transition.");
    tx.update(rideRef, {
      status: input.toStatus, updatedAt: FieldValue.serverTimestamp(),
      ...(input.toStatus === "completed" ? {
        finalFare: ride.get("fare"),
        finalFareIsProvisional: ride.get("provisional") === true,
        settlementStatus: "not_settled",
        completedAt: FieldValue.serverTimestamp()
      } : {})
    });
    tx.create(db.collection("rideEvents").doc(), {
      rideId: input.rideId, actorId: driverId, type: input.toStatus,
      createdAt: FieldValue.serverTimestamp()
    });
    if (input.toStatus === "completed") {
      tx.delete(busyRef);
      tx.delete(db.doc("riderActive/" + ride.get("riderId")));
    }
  });
  if (input.toStatus === "completed") {
    await rtdb.ref().update({
      ["tripAccess/" + input.rideId]: null,
      ["rideDriver/" + input.rideId]: null,
      ["tripLocations/" + input.rideId]: null
    });
  }
  return {rideId: input.rideId, status: input.toStatus};
});

export const cancelRide = onCall(options, async request => {
  const uid = authenticated(request);
  const input = parse(rideIdSchema, request.data);
  const rideRef = db.doc("rides/" + input.rideId);
  const result = await db.runTransaction(async tx => {
    const ride = await tx.get(rideRef);
    requirePresent(ride.exists, "Ride not found.");
    const riderId = ride.get("riderId") as string;
    const driverId = ride.get("driverId") as string | null;
    requirePresent(uid === riderId || uid === driverId, "Not a trip participant.");
    const from = ride.get("status") as string;
    requirePresent(validStateTransition(from, "cancelled",
      uid === riderId ? "rider" : "driver"), "Ride can no longer be cancelled.");
    const busyRef = driverId ? db.doc("driverBusy/" + driverId) : null;
    if (busyRef) {
      const busy = await tx.get(busyRef);
      if (busy.exists && busy.get("rideId") === input.rideId) tx.delete(busyRef);
    }
    tx.update(rideRef, {status: "cancelled", cancelledBy: uid,
      cancellationFeeMinor: 0, cancellationPolicy: "phase2_no_fee",
      cancelledAt: FieldValue.serverTimestamp()});
    tx.delete(db.doc("riderActive/" + riderId));
    tx.create(db.collection("rideEvents").doc(), {
      rideId: input.rideId, actorId: uid, type: "cancelled",
      createdAt: FieldValue.serverTimestamp()
    });
    return {driverId};
  });
  if (result.driverId) {
    await rtdb.ref().update({
      ["tripAccess/" + input.rideId]: null,
      ["rideDriver/" + input.rideId]: null,
      ["tripLocations/" + input.rideId]: null
    });
  }
  return {rideId: input.rideId, status: "cancelled", cancellationFeeMinor: 0};
});

export const createRentalBooking = onCall(options, async request => {
  const renterId = authenticated(request);
  const input = parse(z.object({
    vehicleId: z.string().min(8).max(128),
    startAtMs: z.number().int().positive(),
    endAtMs: z.number().int().positive()
  }).strict(), request.data);
  requirePresent(input.startAtMs >= Date.now() + 60000 &&
    input.startAtMs < Date.now() + 90 * 86400000,
    "Rental start must be at least one minute from now and within 90 days.");
  let slots: string[];
  try { slots = reservationSlots(input.startAtMs, input.endAtMs); }
  catch (error) {
    throw new HttpsError("invalid-argument", error instanceof Error ? error.message : "Invalid dates.");
  }
  const vehicleRef = db.doc("vehicles/" + input.vehicleId);
  const bookingRef = db.collection("rentalBookings").doc();
  const lockRefs = slots.map(slot => db.doc("vehicleReservationLocks/" + input.vehicleId + "_" + slot));
  const outcome = await db.runTransaction(async tx => {
    const vehicle = await tx.get(vehicleRef);
    requirePresent(vehicle.exists && vehicle.get("approvalStatus") === "approved" &&
      vehicle.get("rentalEnabled") === true, "Rental vehicle is unavailable.");
    const ownerId = vehicle.get("ownerId") as string;
    requirePresent(ownerId !== renterId, "You cannot rent your own vehicle.");
    const owner = await tx.get(db.doc("ownerProfiles/" + ownerId));
    const lockDocs = await Promise.all(lockRefs.map(ref => tx.get(ref)));
    requirePresent(owner.get("approvalStatus") === "approved", "Owner is not approved.");
    requirePresent(lockDocs.every(snap => !snap.exists), "Vehicle is already reserved for these hours.");
    const hourlyRate = roundMoney(vehicle.get("rentalRatePerHourMinor") as number);
    const hours = Math.ceil((input.endAtMs - input.startAtMs) / 3600000);
    const totalMinor = roundMoney(hourlyRate * hours);
    tx.create(bookingRef, {
      renterId, ownerId, vehicleId: input.vehicleId,
      startAt: Timestamp.fromMillis(input.startAtMs),
      endAt: Timestamp.fromMillis(input.endAtMs),
      lockSlots: slots, status: "confirmed", currency: "BDT",
      totalMinor, rentalRatePerHourMinor: hourlyRate,
      createdAt: FieldValue.serverTimestamp()
    });
    for (const [i, ref] of lockRefs.entries()) {
      tx.create(ref, {
        vehicleId: input.vehicleId, slot: slots[i], bookingId: bookingRef.id,
        createdAt: FieldValue.serverTimestamp()
      });
    }
    return {totalMinor, hours};
  });
  return {bookingId: bookingRef.id, status: "confirmed", currency: "BDT", ...outcome};
});

export const cancelRentalBooking = onCall(options, async request => {
  const uid = authenticated(request);
  const input = parse(z.object({bookingId: z.string().min(8).max(128)}).strict(), request.data);
  const bookingRef = db.doc("rentalBookings/" + input.bookingId);
  await db.runTransaction(async tx => {
    const booking = await tx.get(bookingRef);
    requirePresent(booking.exists && booking.get("status") === "confirmed",
      "Booking is not cancellable.");
    requirePresent(uid === booking.get("renterId") || uid === booking.get("ownerId"),
      "Not a participant in this rental.");
    requirePresent((booking.get("startAt") as Timestamp).toMillis() > Date.now(),
      "Rental has already started.");
    const vehicleId = booking.get("vehicleId") as string;
    const slots = booking.get("lockSlots") as string[];
    const refs = slots.map(slot => db.doc("vehicleReservationLocks/" + vehicleId + "_" + slot));
    const locks = await Promise.all(refs.map(ref => tx.get(ref)));
    requirePresent(locks.every(lock => lock.exists &&
      lock.get("bookingId") === input.bookingId), "Reservation locks are inconsistent.");
    tx.update(bookingRef, {status: "cancelled", cancelledBy: uid,
      cancelledAt: FieldValue.serverTimestamp()});
    for (const ref of refs) tx.delete(ref);
  });
  return {bookingId: input.bookingId, status: "cancelled"};
});

export const reportSafetyIncident = onCall(options, async request => {
  const uid = authenticated(request);
  const input = parse(z.object({
    rideId: z.string().min(8).max(128),
    type: z.enum(["sos", "route_deviation", "long_stop"]),
    note: z.string().max(500).default("")
  }).strict(), request.data);
  const ride = await db.doc("rides/" + input.rideId).get();
  requirePresent(ride.exists &&
    (ride.get("riderId") === uid || ride.get("driverId") === uid),
    "You are not a participant in this ride.");
  const ref = db.collection("safetyIncidents").doc();
  await ref.create({
    rideId: input.rideId, reporterId: uid,
    type: input.type, note: input.note, status: "open",
    createdAt: FieldValue.serverTimestamp(),
    alertDeliveryStatus: "not_configured"
  });
  return {incidentId: ref.id, recorded: true, notified: false,
    warning: "A record was created. Emergency dispatch/contact alerts are not configured in Phase 2."};
});


const fareRatesSchema = z.object({
  baseMinor: z.number().int().min(0).max(10000000),
  perKmMinor: z.number().int().min(0).max(1000000),
  perMinuteMinor: z.number().int().min(0).max(1000000),
  minMinor: z.number().int().min(0).max(10000000),
  serviceFeeMinor: z.number().int().min(0).max(10000000),
  surgeMultiplier: z.number().min(1).max(5),
  surgeCap: z.number().min(1).max(5)
}).strict().refine(value => value.surgeMultiplier <= value.surgeCap,
  "Surge multiplier cannot exceed the cap.");

export const publishPricingConfig = onCall(options, async request => {
  const adminId = administrator(request);
  const input = parse(z.object({
    version: z.string().regex(/^[A-Za-z0-9_-]{4,48}$/),
    vehicles: z.object({
      bike: fareRatesSchema, car: fareRatesSchema, premium: fareRatesSchema
    }).strict()
  }).strict(), request.data);
  const configRef = db.doc("appConfig/public");
  const pricingRef = db.doc("pricingConfigs/" + input.version);
  await db.runTransaction(async tx => {
    const [config, proposed] = await Promise.all([
      tx.get(configRef), tx.get(pricingRef)
    ]);
    requirePresent(!proposed.exists, "Pricing version already exists.");
    const previousVersion = config.get("activePricingVersion") as string | undefined;
    let previousRef: DocumentReference | null = null;
    let previousExists = false;
    if (previousVersion && previousVersion !== input.version) {
      previousRef = db.doc("pricingConfigs/" + previousVersion);
      previousExists = (await tx.get(previousRef)).exists;
    }
    tx.create(pricingRef, {
      version: input.version, vehicles: input.vehicles, active: true,
      currency: "BDT", createdBy: adminId,
      createdAt: FieldValue.serverTimestamp()
    });
    tx.set(configRef, {
      activePricingVersion: input.version,
      supportedVehicleTypes: ["bike", "car", "premium"],
      supportedLocales: ["en", "bn"],
      updatedAt: FieldValue.serverTimestamp()
    }, {merge: true});
    if (previousRef && previousExists) tx.update(previousRef, {active: false});
    tx.create(db.collection("auditEvents").doc(), {
      type: "pricing_published", actorId: adminId, version: input.version,
      createdAt: FieldValue.serverTimestamp()
    });
  });
  return {version: input.version, published: true};
});


// Allows a rider to exit a stalled matching request. All offers issued in
// that attempt expire before the state can transition to no_driver_found.
export const finalizeUnmatchedRide = onCall(options, async request => {
  const uid = authenticated(request);
  const input = parse(rideIdSchema, request.data);
  const rideRef = db.doc("rides/" + input.rideId);
  await db.runTransaction(async tx => {
    const ride = await tx.get(rideRef);
    requirePresent(ride.exists && ride.get("riderId") === uid, "Ride not found.");
    requirePresent(ride.get("status") === "matching", "Ride is no longer matching.");
    const last = ride.get("lastDispatchAt") as Timestamp | undefined;
    requirePresent(last && Date.now() - last.toMillis() > 60000,
      "Give existing offers at least 60 seconds to expire.");
    tx.update(rideRef, {status: "no_driver_found",
      finishedAt: FieldValue.serverTimestamp()});
    tx.delete(db.doc("riderActive/" + uid));
  });
  return {rideId: input.rideId, status: "no_driver_found"};
});
