import {createHash, randomBytes} from "node:crypto";
import {getFirestore, FieldValue, Timestamp} from "firebase-admin/firestore";
import {getDatabase} from "firebase-admin/database";
import {onCall, HttpsError} from "firebase-functions/v2/https";
import {z} from "zod";

const region = "asia-south1";
const options = {region, maxInstances: 10, memory: "256MiB" as const,
  enforceAppCheck: process.env.DRIVE_ENFORCE_APP_CHECK === "true"};
const publicShareOptions = {region, maxInstances: 10};
const db = () => getFirestore();
const rtdb = () => getDatabase();

function uidOf(request: {auth?: {uid: string; token?: Record<string, unknown>}}): string {
  const uid = request.auth?.uid;
  if (!uid || request.auth?.token?.firebase &&
      (request.auth.token.firebase as Record<string, unknown>).sign_in_provider === "anonymous") {
    throw new HttpsError("unauthenticated", "Sign in with a verified account.");
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
function present(condition: unknown, message: string): asserts condition {
  if (!condition) throw new HttpsError("failed-precondition", message);
}
type Point = {lat: number; lng: number};
type SharedMember = {uid: string; quoteId: string; pickup: Point; destination: Point; fareMinor: number; pickupLabel: string; destinationLabel: string};

function distanceMeters(a: Point, b: Point): number {
  const rad = (n: number) => n * Math.PI / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(Math.max(0, 1 - x)));
}
function routeCompatible(a: SharedMember, b: SharedMember): boolean {
  if (distanceMeters(a.pickup, b.pickup) > 1500 || distanceMeters(a.destination, b.destination) > 2000) return false;
  const vx = (p: Point, q: Point) => (q.lng - p.lng) * Math.cos((p.lat + q.lat) * Math.PI / 360);
  const vy = (p: Point, q: Point) => q.lat - p.lat;
  const ax = vx(a.pickup, a.destination), ay = vy(a.pickup, a.destination);
  const bx = vx(b.pickup, b.destination), by = vy(b.pickup, b.destination);
  const denom = Math.hypot(ax, ay) * Math.hypot(bx, by);
  return denom > 0 && (ax * bx + ay * by) / denom >= 0.72;
}
function splitFare(total: number, members: SharedMember[]): Record<string, number> {
  const shares: Record<string, number> = {};
  if (!members.length) return shares;
  const base = Math.floor(total / members.length);
  let remainder = total - base * members.length;
  for (const member of members) {
    shares[member.uid] = base + (remainder > 0 ? 1 : 0);
    remainder -= remainder > 0 ? 1 : 0;
  }
  return shares;
}
function publicGroup(id: string, data: FirebaseFirestore.DocumentData, uid: string) {
  const members = (data.members || []) as SharedMember[];
  const shares = (data.fareShares || {}) as Record<string, number>;
  return {
    groupId: id, status: data.status, vehicleType: data.vehicleType,
    memberCount: members.length, maxPassengers: data.maxPassengers || 4,
    members: members.map(m => ({uid: m.uid, isYou: m.uid === uid,
      pickupLabel: m.pickupLabel, destinationLabel: m.destinationLabel})),
    leaderUid: data.leaderUid, totalEstimatedFareMinor: data.totalEstimatedFareMinor || 0,
    shareForCurrentUser: shares[uid] ?? null, fareShares: shares,
    expiresAtMs: data.expiresAt instanceof Timestamp ? data.expiresAt.toMillis() : null,
    rideId: data.rideId || null,
    provisional: true,
    note: "Provisional equal split of the lead rider's BDT route estimate. The group uses the lead route; a multi-stop route/fare may differ."
  };
}

export const getSafetyDashboard = onCall(options, async request => {
  const uid = uidOf(request);
  const [prefs, contacts] = await Promise.all([
    db().doc("safetyPreferences/" + uid).get(),
    db().collection("trustedContacts").doc(uid).collection("contacts").limit(20).get()
  ]);
  const p = prefs.data() || {};
  return {
    preferences: {
      safetyMode: p.safetyMode === true,
      driverPreference: p.driverPreference === "verified_only" ? "verified_only" : "any",
      shareTripByDefault: p.shareTripByDefault === true,
      preferredContactIds: Array.isArray(p.preferredContactIds) ? p.preferredContactIds : []
    },
    contacts: contacts.docs.map(doc => ({contactId: doc.id, name: doc.get("name"),
      phone: doc.get("phone"), relationship: doc.get("relationship") || "Other",
      createdAtMs: doc.get("createdAt") instanceof Timestamp ? doc.get("createdAt").toMillis() : null}))
  };
});

export const saveSafetyPreferences = onCall(options, async request => {
  const uid = uidOf(request);
  const input = parse(z.object({
    safetyMode: z.boolean(),
    driverPreference: z.enum(["any", "verified_only"]),
    shareTripByDefault: z.boolean(),
    preferredContactIds: z.array(z.string().regex(/^[A-Za-z0-9_-]{8,128}$/)).max(10)
  }).strict(), request.data);
  const contactRefs = input.preferredContactIds.map(id => db().doc("trustedContacts/" + uid + "/contacts/" + id));
  await db().runTransaction(async tx => {
    const contacts = await Promise.all(contactRefs.map(ref => tx.get(ref)));
    present(contacts.every(s => s.exists), "Select only your saved trusted contacts.");
    tx.set(db().doc("safetyPreferences/" + uid), {
      ...input, uid, updatedAt: FieldValue.serverTimestamp()
    }, {merge: true});
  });
  return {saved: true, preferences: input};
});

export const upsertTrustedContact = onCall(options, async request => {
  const uid = uidOf(request);
  const input = parse(z.object({
    contactId: z.string().regex(/^[A-Za-z0-9_-]{8,128}$/).optional(),
    name: z.string().trim().min(2).max(80),
    phone: z.string().trim().min(8).max(20),
    relationship: z.enum(["Family", "Friend", "Partner", "Colleague", "Other"]).default("Other")
  }).strict(), request.data);
  const phone = input.phone.replace(/[\s()-]/g, "");
  if (!/^(\+?[1-9]\d{7,14}|01[3-9]\d{8})$/.test(phone)) {
    throw new HttpsError("invalid-argument", "Enter a valid phone number, including country code when needed.");
  }
  const collection = db().collection("trustedContacts").doc(uid).collection("contacts");
  const ref = input.contactId ? collection.doc(input.contactId) : collection.doc();
  if (input.contactId) {
    const old = await ref.get();
    present(old.exists, "Trusted contact not found.");
  }
  await ref.set({name: input.name, phone, relationship: input.relationship,
    updatedAt: FieldValue.serverTimestamp(),
    ...(input.contactId ? {} : {createdAt: FieldValue.serverTimestamp()})}, {merge: true});
  return {contactId: ref.id, saved: true};
});

export const deleteTrustedContact = onCall(options, async request => {
  const uid = uidOf(request);
  const input = parse(z.object({contactId: z.string().regex(/^[A-Za-z0-9_-]{8,128}$/)}).strict(), request.data);
  const ref = db().doc("trustedContacts/" + uid + "/contacts/" + input.contactId);
  const old = await ref.get();
  present(old.exists, "Trusted contact not found.");
  await ref.delete();
  const pref = db().doc("safetyPreferences/" + uid);
  const p = await pref.get();
  if (p.exists) {
    const ids = (p.get("preferredContactIds") || []) as string[];
    await pref.update({preferredContactIds: ids.filter(id => id !== input.contactId),
      updatedAt: FieldValue.serverTimestamp()});
  }
  return {deleted: true};
});

export const createTripShare = onCall(options, async request => {
  const uid = uidOf(request);
  const input = parse(z.object({
    rideId: z.string().min(8).max(128),
    expiresInMinutes: z.union([z.literal(30), z.literal(60), z.literal(120)]).default(60)
  }).strict(), request.data);
  const ride = await db().doc("rides/" + input.rideId).get();
  const riderIds = Array.isArray(ride.get("riderIds")) ? ride.get("riderIds") as string[] : [];
  present(ride.exists && (ride.get("riderId") === uid || ride.get("driverId") === uid || riderIds.includes(uid)),
    "Only a trip participant can share this trip.");
  present(["accepted", "driver_arriving", "in_progress"].includes(String(ride.get("status"))),
    "Trip sharing is available only during an assigned active trip.");
  const token = randomBytes(24).toString("base64url");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const expiresAtMs = Date.now() + input.expiresInMinutes * 60000;
  await db().doc("tripShares/" + tokenHash).create({
    rideId: input.rideId, ownerUid: uid,
    expiresAt: Timestamp.fromMillis(expiresAtMs), revoked: false,
    createdAt: FieldValue.serverTimestamp()
  });
  return {sharePath: "/share/" + token, token, expiresAtMs,
    note: "Anyone with this private link can view limited trip status until it expires or is revoked. No SMS/push was sent."};
});

export const revokeTripShare = onCall(options, async request => {
  const uid = uidOf(request);
  const input = parse(z.object({token: z.string().min(24).max(100)}).strict(), request.data);
  const hash = createHash("sha256").update(input.token).digest("hex");
  const ref = db().doc("tripShares/" + hash);
  const snap = await ref.get();
  present(snap.exists && snap.get("ownerUid") === uid, "Share link not found.");
  await ref.update({revoked: true, revokedAt: FieldValue.serverTimestamp()});
  return {revoked: true};
});

export const getSharedTrip = onCall(publicShareOptions, async request => {
  const input = parse(z.object({token: z.string().min(24).max(100)}).strict(), request.data);
  const hash = createHash("sha256").update(input.token).digest("hex");
  const share = await db().doc("tripShares/" + hash).get();
  if (!share.exists || share.get("revoked") === true ||
      !(share.get("expiresAt") instanceof Timestamp) ||
      (share.get("expiresAt") as Timestamp).toMillis() <= Date.now()) {
    throw new HttpsError("not-found", "This trip share link is invalid, revoked, or expired.");
  }
  const ride = await db().doc("rides/" + String(share.get("rideId"))).get();
  if (!ride.exists) throw new HttpsError("not-found", "Trip is no longer available.");
  let location: {lat: number; lng: number; updatedAt: number; heading?: number} | null = null;
  if (["accepted", "driver_arriving", "in_progress"].includes(String(ride.get("status")))) {
    const snap = await rtdb().ref("tripLocations/" + String(share.get("rideId"))).get();
    const value = snap.val() as Record<string, unknown> | null;
    if (value && typeof value.lat === "number" && typeof value.lng === "number" &&
        typeof value.updatedAt === "number" && Date.now() - value.updatedAt <= 120000) {
      location = {lat: value.lat, lng: value.lng, updatedAt: value.updatedAt,
        ...(typeof value.heading === "number" ? {heading: value.heading} : {})};
    }
  }
  const expiresAt = share.get("expiresAt") as Timestamp;
  return {
    status: String(ride.get("status") || "unknown"),
    pickup: String(ride.get("pickup")?.label || "Pickup location"),
    destination: String(ride.get("destination")?.label || "Destination"),
    vehicleType: String(ride.get("vehicleType") || "ride"),
    location, expiresAtMs: expiresAt.toMillis(),
    lastUpdatedAtMs: location?.updatedAt || null,
    warning: "Trip-share link reveals limited trip status/location to anyone holding the link. Emergency services are not contacted."
  };
});

export const getRideDriverSummary = onCall(options, async request => {
  const uid = uidOf(request);
  const input = parse(z.object({rideId: z.string().min(8).max(128)}).strict(), request.data);
  const ride = await db().doc("rides/" + input.rideId).get();
  present(ride.exists, "Trip not found.");
  const riders = (ride.get("riderIds") as string[] | undefined) || [ride.get("riderId") as string];
  const driverId = ride.get("driverId") as string | null;
  present(driverId && (riders.includes(uid) || ride.get("riderId") === uid || driverId === uid),
    "Only a trip participant can view driver details.");
  const [profile, user] = await Promise.all([
    db().doc("driverProfiles/" + driverId).get(),
    db().doc("users/" + driverId).get()
  ]);
  return {
    verified: profile.exists && profile.get("approvalStatus") === "approved",
    name: String(user.get("displayName") || "DRIVE driver"),
    vehicleType: String(profile.get("vehicleType") || ride.get("vehicleType") || "vehicle"),
    ratingAverage: typeof profile.get("ratingAverage") === "number" ? profile.get("ratingAverage") : null,
    note: "Verification status reflects DRIVE admin approval, not a guarantee of personal safety."
  };
});

export const getCurrencyRate = onCall(options, async request => {
  uidOf(request);
  const input = parse(z.object({currency: z.enum(["BDT", "USD", "EUR", "GBP", "INR", "AUD", "CAD", "SGD", "JPY", "SAR", "AED"])}).strict(), request.data);
  if (input.currency === "BDT") return {base: "BDT", currency: "BDT", rate: 1, date: new Date().toISOString().slice(0, 10), source: "identity", displayOnly: true};
  try {
    const response = await fetch("https://open.er-api.com/v6/latest/BDT", {signal: AbortSignal.timeout(5000)});
    if (!response.ok) throw new Error("Rate service unavailable");
    const data = await response.json() as {result?: string; time_last_update_utc?: string; rates?: Record<string, unknown>};
    const rate = data.rates?.[input.currency];
    if (data.result !== "success" || typeof rate !== "number" || !Number.isFinite(rate) || rate <= 0) {
      throw new Error("Rate not available");
    }
    return {base: "BDT", currency: input.currency, rate,
      date: String(data.time_last_update_utc || new Date().toISOString()).slice(0, 16),
      source: "ExchangeRate-API open endpoint", displayOnly: true,
      warning: "Indicative display conversion only. The amount charged and settled remains BDT."};
  } catch (_) {
    throw new HttpsError("unavailable", "Exchange rates are temporarily unavailable. BDT quote is still valid.");
  }
});

export const requestSharedRide = onCall(options, async request => {
  const uid = uidOf(request);
  const input = parse(z.object({
    quoteId: z.string().min(8).max(128),
    idempotencyKey: z.string().regex(/^[A-Za-z0-9-]{12,80}$/)
  }).strict(), request.data);
  const keyRef = db().doc("sharedRideKeys/" + uid + "_" + input.idempotencyKey);
  const quoteRef = db().doc("rideQuotes/" + input.quoteId);
  const newGroupRef = db().collection("sharedRideGroups").doc();
  const groupId = await db().runTransaction(async tx => {
    const [key, quote] = await Promise.all([tx.get(keyRef), tx.get(quoteRef)]);
    if (key.exists) return String(key.get("groupId"));
    present(quote.exists && quote.get("riderId") === uid, "Quote not found or belongs to a different rider.");
    present(quote.get("usedAt") == null, "Quote already used.");
    present((quote.get("expiresAt") as Timestamp).toMillis() > Date.now(), "Quote expired. Generate a new estimate.");
    const activeGroups = await tx.get(db().collection("sharedRideGroups").where("status", "in", ["searching", "matched"]).limit(50));
    const pickup = quote.get("pickup") as Point;
    const destination = quote.get("destination") as Point;
    const fare = quote.get("fare") as {totalMinor?: number};
    const candidate: SharedMember = {
      uid, quoteId: input.quoteId, pickup, destination,
      fareMinor: Number(fare?.totalMinor || 0),
      pickupLabel: String(quote.get("pickupLabel") || "Pickup location"),
      destinationLabel: String(quote.get("destinationLabel") || "Destination")
    };
    for (const doc of activeGroups.docs) {
      const data = doc.data();
      const members = (data.members || []) as SharedMember[];
      if (!["searching", "matched"].includes(String(data.status)) ||
          (data.expiresAt instanceof Timestamp && data.expiresAt.toMillis() <= Date.now()) ||
          data.vehicleType !== quote.get("vehicleType") || members.length >= 4 ||
          members.some(m => m.uid === uid)) continue;
      if (!members.length || !routeCompatible(members[0], candidate)) continue;
      const nextMembers = [...members, candidate];
      const total = Number(data.totalEstimatedFareMinor || members[0].fareMinor);
      const shares = splitFare(total, nextMembers);
      tx.update(doc.ref, {
        members: nextMembers, memberIds: nextMembers.map(m => m.uid),
        fareShares: shares, status: nextMembers.length >= 2 ? "matched" : "searching",
        updatedAt: FieldValue.serverTimestamp()
      });
      tx.create(keyRef, {groupId: doc.id, createdAt: FieldValue.serverTimestamp()});
      return doc.id;
    }
    const total = candidate.fareMinor;
    tx.create(newGroupRef, {
      leaderUid: uid, vehicleType: quote.get("vehicleType"),
      status: "searching", maxPassengers: 4,
      members: [candidate], memberIds: [uid], totalEstimatedFareMinor: total,
      fareShares: {[uid]: total}, createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      expiresAt: Timestamp.fromMillis(Date.now() + 10 * 60000)
    });
    tx.create(keyRef, {groupId: newGroupRef.id, createdAt: FieldValue.serverTimestamp()});
    return newGroupRef.id;
  });
  const group = await db().doc("sharedRideGroups/" + groupId).get();
  return publicGroup(groupId, group.data() || {}, uid);
});

export const getMySharedRideRequests = onCall(options, async request => {
  const uid = uidOf(request);
  const groups = await db().collection("sharedRideGroups").where("memberIds", "array-contains", uid).limit(20).get();
  return {groups: groups.docs.map(doc => publicGroup(doc.id, doc.data(), uid))};
});

export const leaveSharedRideGroup = onCall(options, async request => {
  const uid = uidOf(request);
  const input = parse(z.object({groupId: z.string().regex(/^[A-Za-z0-9_-]{8,128}$/)}).strict(), request.data);
  const ref = db().doc("sharedRideGroups/" + input.groupId);
  await db().runTransaction(async tx => {
    const group = await tx.get(ref);
    present(group.exists, "Shared ride group not found.");
    const data = group.data() || {};
    present(["searching", "matched"].includes(String(data.status)), "A booked shared ride cannot be left here; use ride cancellation policy.");
    const members = (data.members || []) as SharedMember[];
    present(members.some(m => m.uid === uid), "You are not in this shared ride group.");
    const nextMembers = members.filter(m => m.uid !== uid);
    if (!nextMembers.length) {
      tx.update(ref, {status: "cancelled", members: [], memberIds: [], fareShares: {}, updatedAt: FieldValue.serverTimestamp()});
      return;
    }
    let total = Number(data.totalEstimatedFareMinor || 0);
    if (data.leaderUid === uid) {
      const leaderQuote = await tx.get(db().doc("rideQuotes/" + nextMembers[0].quoteId));
      present(leaderQuote.exists, "The next group lead's quote is unavailable.");
      total = Number((leaderQuote.get("fare") as {totalMinor?: number})?.totalMinor || 0);
    }
    tx.update(ref, {
      leaderUid: data.leaderUid === uid ? nextMembers[0].uid : data.leaderUid,
      members: nextMembers, memberIds: nextMembers.map(m => m.uid),
      totalEstimatedFareMinor: total, fareShares: splitFare(total, nextMembers),
      status: nextMembers.length >= 2 ? "matched" : "searching",
      updatedAt: FieldValue.serverTimestamp()
    });
  });
  return {left: true};
});

export const bookSharedRideGroup = onCall(options, async request => {
  const uid = uidOf(request);
  const input = parse(z.object({groupId: z.string().regex(/^[A-Za-z0-9_-]{8,128}$/)}).strict(), request.data);
  const groupRef = db().doc("sharedRideGroups/" + input.groupId);
  const rideRef = db().collection("rides").doc();
  const rideId = await db().runTransaction(async tx => {
    const group = await tx.get(groupRef);
    present(group.exists, "Shared ride group not found.");
    const data = group.data() || {};
    if (data.status === "booked" && typeof data.rideId === "string") return data.rideId;
    const members = (data.members || []) as SharedMember[];
    present(data.status === "matched" && members.length >= 2, "At least two compatible riders are needed before booking.");
    present(!(data.expiresAt instanceof Timestamp) || data.expiresAt.toMillis() > Date.now(),
      "This shared request expired. Leave it and request a fresh quote.");
    present(data.leaderUid === uid, "Only the group organizer can confirm the shared ride.");
    const quoteRefs = members.map(m => db().doc("rideQuotes/" + m.quoteId));
    const activeRefs = members.map(m => db().doc("riderActive/" + m.uid));
    const [quotes, active] = await Promise.all([
      Promise.all(quoteRefs.map(ref => tx.get(ref))),
      Promise.all(activeRefs.map(ref => tx.get(ref)))
    ]);
    present(active.every(s => !s.exists), "A group member already has an active ride.");
    for (let i = 0; i < members.length; i++) {
      const q = quotes[i];
      present(q?.exists && q.get("riderId") === members[i]?.uid, "A member quote is unavailable.");
      present(q.get("usedAt") == null, "A member quote was already used.");
      present((q.get("expiresAt") as Timestamp).toMillis() > Date.now(), "A member quote expired. Members must request fresh quotes.");
    }
    const leadIndex = members.findIndex(m => m.uid === uid);
    const lead = members[leadIndex] || members[0]!;
    const leadQuote = quotes[leadIndex]!;
    const total = Number((leadQuote.get("fare") as {totalMinor?: number})?.totalMinor || 0);
    const shares = splitFare(total, members);
    tx.create(rideRef, {
      riderId: uid, riderIds: members.map(m => m.uid), driverId: null,
      status: "matching", sharedRide: true, sharedGroupId: input.groupId,
      fareShares: shares, fare: leadQuote.get("fare"),
      pickup: {...(leadQuote.get("pickup") as Point), label: lead.pickupLabel},
      destination: {...(leadQuote.get("destination") as Point), label: lead.destinationLabel},
      vehicleType: leadQuote.get("vehicleType"), currency: "BDT",
      pricingVersion: leadQuote.get("pricingVersion"),
      estimateMethod: leadQuote.get("estimateMethod"),
      provisional: leadQuote.get("provisional") === true,
      routePolyline: leadQuote.get("encodedPolyline") || "",
      distanceMeters: leadQuote.get("distanceMeters"),
      durationSeconds: leadQuote.get("durationSeconds"),
      createdAt: FieldValue.serverTimestamp(), acceptedAt: null
    });
    for (let i = 0; i < activeRefs.length; i++) {
      tx.create(activeRefs[i]!, {rideId: rideRef.id, sharedGroupId: input.groupId});
      tx.update(quoteRefs[i]!, {usedAt: FieldValue.serverTimestamp()});
    }
    tx.update(groupRef, {status: "booked", rideId: rideRef.id,
      bookedBy: uid, fareShares: shares, totalEstimatedFareMinor: total,
      updatedAt: FieldValue.serverTimestamp()});
    return rideRef.id;
  });
  return {rideId, status: "matching", sharedRide: true,
    nextAction: "Dispatch will begin using the lead rider's route. Shared fare shares are provisional."};
});
