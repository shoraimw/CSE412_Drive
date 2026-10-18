import {getFirestore, FieldValue, Timestamp} from "firebase-admin/firestore";
import {getAuth} from "firebase-admin/auth";
import {onCall, HttpsError} from "firebase-functions/v2/https";
import {z} from "zod";
import {canTransitionCase, disputeDocumentId} from "./admin_policy";

const inputSchema = z.object({
  incidentId: z.string().min(8).max(128),
  expectedStatus: z.enum(["open","in_review"]),
  nextStatus: z.enum(["in_review","resolved","dismissed"]),
  note: z.string().trim().min(10).max(800)
}).strict();

export const reviewSafetyIncident = onCall({
  region: "asia-south1", maxInstances: 8,
  enforceAppCheck: process.env.DRIVE_ENFORCE_APP_CHECK === "true"
}, async request => {
  if (!request.auth?.uid || request.auth.token.admin !== true) {
    throw new HttpsError("permission-denied", "Admin access required.");
  }
  const result = inputSchema.safeParse(request.data);
  if (!result.success) throw new HttpsError("invalid-argument", "Invalid review.");
  const value = result.data;
  const allowed = value.expectedStatus === "open"
    ? value.nextStatus === "in_review"
    : ["resolved","dismissed"].includes(value.nextStatus);
  if (!allowed) throw new HttpsError("invalid-argument", "Invalid status change.");
  const db = getFirestore();
  await db.runTransaction(async transaction => {
    const reference = db.doc("safetyIncidents/" + value.incidentId);
    const current = await transaction.get(reference);
    if (!current.exists) throw new HttpsError("not-found", "Incident not found.");
    if (current.get("status") !== value.expectedStatus) {
      throw new HttpsError("failed-precondition", "Incident status changed. Refresh first.");
    }
    transaction.update(reference, {
      status: value.nextStatus, reviewNote: value.note,
      lastReviewedBy: request.auth!.uid, lastReviewedAt: FieldValue.serverTimestamp()
    });
    transaction.create(db.collection("auditEvents").doc(), {
      type: "incident_review", incidentId: value.incidentId,
      actorId: request.auth!.uid, fromStatus: value.expectedStatus,
      toStatus: value.nextStatus, note: value.note,
      createdAt: FieldValue.serverTimestamp()
    });
  });
  return {status: value.nextStatus, notified: false};
});
/**
 * Phase 8: evidence-backed service disputes, NOT automatic refunds or
 * emergency dispatch. One stable case per service/participant; only trusted
 * backend code creates or resolves records.
 */
const disputeInput = z.object({
  serviceType: z.enum(["ride", "rental"]),
  serviceId: z.string().regex(/^[A-Za-z0-9_-]{8,128}$/),
  topic: z.enum(["payment", "service", "safety", "other"]),
  description: z.string().trim().min(25).max(1200)
}).strict();

export const openServiceDispute = onCall({
  region: "asia-south1", maxInstances: 12,
  enforceAppCheck: process.env.DRIVE_ENFORCE_APP_CHECK === "true"
}, async request => {
  const uid = request.auth?.uid;
  if (!uid || request.auth?.token.firebase?.sign_in_provider === "anonymous") {
    throw new HttpsError("unauthenticated", "Sign in before opening a case.");
  }
  const result = disputeInput.safeParse(request.data);
  if (!result.success) throw new HttpsError("invalid-argument", "Invalid dispute.");
  const input = result.data;
  const db = getFirestore();
  const recordRef = db.doc(
    (input.serviceType === "ride" ? "rides/" : "rentalBookings/") + input.serviceId
  );
  const caseId = disputeDocumentId(input.serviceType, input.serviceId, uid);
  const disputeRef = db.doc("serviceDisputes/" + caseId);
  let status = "open";
  await db.runTransaction(async tx => {
    const [related, prior] = await Promise.all([
      tx.get(recordRef), tx.get(disputeRef)
    ]);
    if (!related.exists) {
      throw new HttpsError("not-found", "The requested service does not exist.");
    }
    const allowed = input.serviceType === "ride"
      ? [related.get("riderId"), related.get("driverId")].includes(uid)
      : [related.get("renterId"), related.get("ownerId")].includes(uid);
    if (!allowed) {
      throw new HttpsError("permission-denied", "Not a service participant.");
    }
    const state = related.get("status");
    if (input.serviceType === "ride" &&
        !["completed", "cancelled", "no_driver_found"].includes(state)) {
      throw new HttpsError("failed-precondition", "Ride case is not ready for dispute.");
    }
    if (input.serviceType === "rental" &&
        !["confirmed", "cancelled"].includes(state)) {
      throw new HttpsError("failed-precondition", "Rental case is not ready for dispute.");
    }
    if (prior.exists) {
      status = prior.get("status") as string;
      return;
    }
    tx.create(disputeRef, {
      serviceType: input.serviceType, serviceId: input.serviceId,
      openedBy: uid, topic: input.topic, description: input.description,
      status: "open", outcome: "not_determined",
      refundStatus: "not_processed",
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    });
    tx.create(db.collection("auditEvents").doc(), {
      type: "service_dispute_opened", actorId: uid, caseId,
      serviceType: input.serviceType, serviceId: input.serviceId,
      createdAt: FieldValue.serverTimestamp()
    });
  });
  return {
    disputeId: caseId, status, refundStatus: "not_processed",
    warning: "This case does not create a refund or deliver emergency alerts."
  };
});

const reviewDisputeInput = z.object({
  disputeId: z.string().regex(/^(ride|rental)_[A-Za-z0-9_-]{8,128}_[A-Za-z0-9_-]{4,128}$/),
  expectedStatus: z.enum(["open", "in_review"]),
  nextStatus: z.enum(["in_review", "resolved", "dismissed"]),
  note: z.string().trim().min(20).max(800)
}).strict();

export const reviewServiceDispute = onCall({
  region: "asia-south1", maxInstances: 8,
  enforceAppCheck: process.env.DRIVE_ENFORCE_APP_CHECK === "true"
}, async request => {
  const adminId = request.auth?.uid;
  if (!adminId || request.auth?.token.admin !== true) {
    throw new HttpsError("permission-denied", "Admin claim required.");
  }
  const parsed = reviewDisputeInput.safeParse(request.data);
  if (!parsed.success) throw new HttpsError("invalid-argument", "Invalid case review.");
  const data = parsed.data;
  if (!canTransitionCase(data.expectedStatus, data.nextStatus)) {
    throw new HttpsError("invalid-argument", "Invalid dispute transition.");
  }
  const db = getFirestore();
  await db.runTransaction(async tx => {
    const disputeRef = db.doc("serviceDisputes/" + data.disputeId);
    const current = await tx.get(disputeRef);
    if (!current.exists) throw new HttpsError("not-found", "Dispute not found.");
    if (current.get("status") !== data.expectedStatus) {
      throw new HttpsError("failed-precondition", "Case changed; refresh first.");
    }
    tx.update(disputeRef, {
      status: data.nextStatus, reviewNote: data.note,
      reviewedBy: adminId, reviewedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    });
    tx.create(db.collection("auditEvents").doc(), {
      type: "service_dispute_review", actorId: adminId,
      caseId: data.disputeId, fromStatus: data.expectedStatus,
      toStatus: data.nextStatus, reason: data.note,
      createdAt: FieldValue.serverTimestamp()
    });
  });
  return {status: data.nextStatus, refundProcessed: false};
});

/**
 * Exact-identifier support lookup: no unrestricted user enumeration and
 * no client-side access to Firebase Auth admin APIs. A successful lookup
 * is recorded in auditEvents without logging the searched email.
 */
const lookupSchema = z.object({
  identifier: z.string().trim().min(5).max(254)
}).strict();

export const lookupAdminUser = onCall({
  region: "asia-south1", maxInstances: 6,
  enforceAppCheck: process.env.DRIVE_ENFORCE_APP_CHECK === "true"
}, async request => {
  const adminId = request.auth?.uid;
  if (!adminId || request.auth?.token.admin !== true) {
    throw new HttpsError("permission-denied", "Admin claim required.");
  }
  const parsed = lookupSchema.safeParse(request.data);
  if (!parsed.success) throw new HttpsError("invalid-argument", "Enter a full UID or email.");
  const db = getFirestore();
  const budget = db.doc("adminLookupBudgets/" + adminId);
  await db.runTransaction(async tx => {
    const prior = await tx.get(budget);
    const last = prior.get("lastAt") as Timestamp | undefined;
    if (last && Date.now() - last.toMillis() < 2000) {
      throw new HttpsError("resource-exhausted", "Wait two seconds between lookups.");
    }
    tx.set(budget, {lastAt: FieldValue.serverTimestamp()}, {merge: true});
  });
  let identity;
  try {
    identity = parsed.data.identifier.includes("@")
      ? await getAuth().getUserByEmail(parsed.data.identifier.toLowerCase())
      : await getAuth().getUser(parsed.data.identifier);
  } catch {
    throw new HttpsError("not-found", "No matching account.");
  }
  const profile = await db.doc("users/" + identity.uid).get();
  await db.collection("auditEvents").add({
    type: "user_lookup", actorId: adminId, subjectId: identity.uid,
    createdAt: FieldValue.serverTimestamp()
  });
  return {
    uid: identity.uid,
    email: identity.email || null,
    phoneMasked: identity.phoneNumber
      ? "•••" + identity.phoneNumber.slice(-4) : null,
    emailVerified: identity.emailVerified,
    disabled: identity.disabled,
    createdAt: identity.metadata.creationTime || null,
    lastSignInAt: identity.metadata.lastSignInTime || null,
    adminClaim: identity.customClaims?.admin === true,
    driverClaim: identity.customClaims?.driver === true,
    accountStatus: profile.get("accountStatus") || "no_profile",
    displayName: profile.get("displayName") || null,
    locale: profile.get("locale") || null
  };
});
