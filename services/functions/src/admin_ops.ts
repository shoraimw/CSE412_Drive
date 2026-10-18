import {getFirestore, FieldValue} from "firebase-admin/firestore";
import {onCall, HttpsError} from "firebase-functions/v2/https";
import {z} from "zod";

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