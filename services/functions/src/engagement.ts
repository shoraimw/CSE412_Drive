import {createHash} from "node:crypto";
import {getFirestore, FieldValue, Timestamp} from "firebase-admin/firestore";
import {getMessaging} from "firebase-admin/messaging";
import {onCall, HttpsError} from "firebase-functions/v2/https";
import {onDocumentCreated, onDocumentUpdated} from "firebase-functions/v2/firestore";
import {z} from "zod";

function db() { return getFirestore(); }
const region = "asia-south1";
const callOptions = {region, maxInstances: 10,
  enforceAppCheck: process.env.DRIVE_ENFORCE_APP_CHECK === "true"};
const rideIdSchema = z.string().min(8).max(128);
const textSchema = z.string().trim().min(1).max(1000);
const allowedStatuses = new Set(["accepted", "driver_arriving", "in_progress"]);

function userId(auth: {uid: string} | undefined): string {
  if (!auth?.uid) throw new HttpsError("unauthenticated", "Sign in to continue.");
  return auth.uid;
}
function validate<T>(schema: z.ZodSchema<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new HttpsError("invalid-argument",
      parsed.error.issues.map(x => x.message).join("; "));
  }
  return parsed.data;
}
function requireRide(ride: FirebaseFirestore.DocumentSnapshot,
    uid: string): {riderId: string; driverId: string; status: string} {
  if (!ride.exists) throw new HttpsError("not-found", "Trip was not found.");
  const riderId = ride.get("riderId") as string;
  const driverId = ride.get("driverId") as string | null;
  const status = ride.get("status") as string;
  if (!driverId || (uid !== riderId && uid !== driverId)) {
    throw new HttpsError("permission-denied", "Not a participant in this ride.");
  }
  return {riderId, driverId, status};
}

/** Chat messages are server-owned. Firebase transit encryption is NOT end-to-end encryption. */
export const sendRideMessage = onCall(callOptions, async request => {
  const uid = userId(request.auth);
  const input = validate(z.object({
    rideId: rideIdSchema,
    text: textSchema,
    clientMessageId: z.string().uuid()
  }).strict(), request.data);
  const rideRef = db().doc("rides/" + input.rideId);
  const msgRef = rideRef.collection("messages").doc(uid + "_" + input.clientMessageId);
  await db().runTransaction(async tx => {
    const [ride, previous] = await Promise.all([tx.get(rideRef), tx.get(msgRef)]);
    const info = requireRide(ride, uid);
    if (!allowedStatuses.has(info.status)) {
      throw new HttpsError("failed-precondition",
        "Trip chat is available only during an assigned active ride.");
    }
    if (previous.exists) {
      if (previous.get("senderId") !== uid || previous.get("text") !== input.text) {
        throw new HttpsError("already-exists", "Message id was reused.");
      }
      return;
    }
    tx.create(msgRef, {
      senderId: uid, recipientId: uid === info.riderId ? info.driverId : info.riderId,
      text: input.text, rideId: input.rideId, createdAt: FieldValue.serverTimestamp()
    });
  });
  return {messageId: msgRef.id, stored: true};
});

/** Completed trips accept one rating per participant; users cannot choose target IDs. */
export const rateCompletedRide = onCall(callOptions, async request => {
  const uid = userId(request.auth);
  const input = validate(z.object({
    rideId: rideIdSchema,
    stars: z.number().int().min(1).max(5),
    comment: z.string().trim().max(500).default("")
  }).strict(), request.data);
  const rideRef = db().doc("rides/" + input.rideId);
  const ratingRef = db().doc("ratings/" + input.rideId + "_" + uid);
  await db().runTransaction(async tx => {
    const [ride, prior] = await Promise.all([tx.get(rideRef), tx.get(ratingRef)]);
    const info = requireRide(ride, uid);
    if (info.status !== "completed") {
      throw new HttpsError("failed-precondition", "Only completed trips can be rated.");
    }
    if (prior.exists) {
      throw new HttpsError("already-exists", "You already rated this trip.");
    }
    tx.create(ratingRef, {
      rideId: input.rideId, authorId: uid,
      targetId: uid === info.riderId ? info.driverId : info.riderId,
      authorRole: uid === info.riderId ? "rider" : "driver",
      stars: input.stars, comment: input.comment,
      createdAt: FieldValue.serverTimestamp()
    });
  });
  return {ratingId: ratingRef.id, recorded: true};
});

export const registerPushToken = onCall(callOptions, async request => {
  const uid = userId(request.auth);
  const input = validate(z.object({
    installationId: z.string().trim().min(12).max(256),
    platform: z.enum(["android", "ios"])
  }).strict(), request.data);
  const fingerprint = createHash("sha256").update(input.installationId).digest("hex");
  await db().doc("pushInstallations/" + uid + "/instances/" + fingerprint).set({
    fid: input.installationId, platform: input.platform,
    updatedAt: FieldValue.serverTimestamp()
  }, {merge: true});
  return {registered: true};
});

export const unregisterPushToken = onCall(callOptions, async request => {
  const uid = userId(request.auth);
  const input = validate(z.object({
    installationId: z.string().trim().min(12).max(256)
  }).strict(), request.data);
  const fingerprint = createHash("sha256").update(input.installationId).digest("hex");
  await db().doc("pushInstallations/" + uid + "/instances/" + fingerprint).delete();
  return {unregistered: true};
});

async function enqueue(uid: string, type: string, title: string,
    body: string, rideId?: string, dedupe?: string): Promise<void> {
  const fingerprint = dedupe ||
    createHash("sha256").update(uid + "|" + type + "|" + (rideId || "") + "|" + body)
      .digest("hex").slice(0, 36);
  await db().doc("notifications/" + fingerprint).create({
    uid, type, title, body, rideId: rideId || null,
    pushStatus: "pending", createdAt: FieldValue.serverTimestamp()
  }).catch(e => {
    if ((e as {code?: number}).code !== 6) throw e;
  });
}

export const onDriverOfferCreated = onDocumentCreated(
  {document: "driverOffers/{offerId}", region}, async event => {
    const offer = event.data?.data();
    const uid = offer?.driverId as string | undefined;
    if (!uid) return;
    await enqueue(uid, "ride_offer", "DRIVE: New request",
      "A new ride request is waiting. Open DRIVE to respond.",
      offer?.rideId as string, "offer_" + event.params.offerId);
  }
);

export const onRideStatusChanged = onDocumentUpdated(
  {document: "rides/{rideId}", region}, async event => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();
    if (!after || before?.status === after.status) return;
    const rideId = event.params.rideId;
    const title = "DRIVE trip status";
    const status = String(after.status).replaceAll("_", " ");
    const users = [after.riderId, after.driverId]
      .filter((uid): uid is string => typeof uid === "string" && uid.length > 0);
    await Promise.all(users.map(uid =>
      enqueue(uid, "ride_status", title, "Trip is now " + status,
        rideId, "status_" + rideId + "_" + after.status + "_" + uid)
    ));
  }
);

export const onRideMessageCreated = onDocumentCreated(
  {document: "rides/{rideId}/messages/{messageId}", region}, async event => {
    const message = event.data?.data();
    if (!message?.recipientId) return;
    // Never put private message text into push notification payloads.
    await enqueue(message.recipientId as string, "ride_chat", "DRIVE: Trip message",
      "You have a new message in your trip chat.",
      event.params.rideId, "chat_" + event.params.rideId + "_" + event.params.messageId);
  }
);

/** Server-controlled notification feed plus best-effort FCM delivery.
 * The UI must not confuse a stored notification with a delivered push.
 */
export const deliverPushNotification = onDocumentCreated(
  {document: "notifications/{notificationId}", region},
  async event => {
    const doc = event.data;
    const data = doc?.data();
    if (!doc || !data || typeof data.uid !== "string") return;
    if (process.env.FUNCTIONS_EMULATOR === "true") {
      await doc.ref.update({pushStatus: "emulator_not_sent"});
      return;
    }
    const tokens = await db().collection("pushInstallations").doc(data.uid)
      .collection("instances").limit(100).get();
    if (tokens.empty) {
      await doc.ref.update({pushStatus: "no_registered_device"});
      return;
    }
    try {
      const list = tokens.docs.map(x => x.get("fid") as string).filter(Boolean);
      const response = await getMessaging().sendEachForMulticast({
        fids: list, notification: {
          title: String(data.title || "DRIVE"),
          body: String(data.body || "Open DRIVE for updates.")
        }, data: {
          type: String(data.type || "notification"),
          rideId: String(data.rideId || "")
        }
      });
      const invalid = [
        "messaging/registration-token-not-registered",
        "messaging/invalid-registration-token"
      ];
      await Promise.all(response.responses.map(async (result, i) => {
        const tokenDoc = tokens.docs[i];
        if (tokenDoc && !result.success &&
            invalid.includes(result.error?.code || "")) {
          await tokenDoc.ref.delete();
        }
      }));
      await doc.ref.update({
        pushStatus: response.successCount > 0 ? "sent_to_fcm" : "not_delivered",
        successCount: response.successCount, failureCount: response.failureCount
      });
    } catch (error) {
      await doc.ref.update({
        pushStatus: "delivery_error",
        // Avoid placing credentials or potentially sensitive FCM errors in Firestore.
        failureCount: tokens.size
      });
    }
  }
);
