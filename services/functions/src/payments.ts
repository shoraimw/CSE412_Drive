import {getFirestore, FieldValue, Timestamp} from "firebase-admin/firestore";
import {defineSecret} from "firebase-functions/params";
import {onCall, onRequest, HttpsError} from "firebase-functions/v2/https";
import Stripe from "stripe";
import {z} from "zod";

const stripeSecret = defineSecret("STRIPE_TEST_SECRET_KEY");
const stripeWebhookSecret = defineSecret("STRIPE_TEST_WEBHOOK_SECRET");
const region = "asia-south1";
const enforceAppCheck = process.env.DRIVE_ENFORCE_APP_CHECK === "true";
const rideInput = z.object({rideId: z.string().min(8).max(128)}).strict();
const db = () => getFirestore();

function authenticated(request: {auth?: {uid: string}}): string {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in first.");
  return uid;
}
function rideIdFrom(value: unknown): string {
  const parsed = rideInput.safeParse(value);
  if (!parsed.success) throw new HttpsError("invalid-argument", "Invalid ride ID.");
  return parsed.data.rideId;
}
function trustedFare(ride: FirebaseFirestore.DocumentSnapshot): number {
  if (!ride.exists || ride.get("status") !== "completed") {
    throw new HttpsError("failed-precondition", "Complete the ride before paying.");
  }
  if (ride.get("currency") !== "BDT") {
    throw new HttpsError("failed-precondition", "Only BDT is supported in this demo.");
  }
  const fare = ride.get("finalFare") as {totalMinor?: unknown} | undefined;
  const amount = fare?.totalMinor;
  if (typeof amount !== "number" || !Number.isSafeInteger(amount) ||
      amount < 5000 || amount > 100000000) {
    throw new HttpsError("failed-precondition", "The final fare is invalid.");
  }
  return amount;
}
function stripe(): Stripe {
  const key = stripeSecret.value();
  if (!key || !key.startsWith("sk_test_")) {
    throw new HttpsError("failed-precondition",
      "Stripe TEST is not configured; live charges are disabled.");
  }
  return new Stripe(key);
}
function redirectBase(): string {
  const value = process.env.DRIVE_CHECKOUT_RETURN_BASE_URL || "";
  let url: URL;
  try { url = new URL(value); } catch {
    throw new HttpsError("failed-precondition",
      "Configure DRIVE_CHECKOUT_RETURN_BASE_URL with your own HTTPS website.");
  }
  if (url.protocol !== "https:" || !url.hostname ||
      url.username || url.password || url.search || url.hash) {
    throw new HttpsError("failed-precondition",
      "Checkout return URL must be an HTTPS origin/path with no credentials or query.");
  }
  return url.toString().replace(/\/$/, "");
}

/** Rider selects pay-the-driver cash; a choice is not receipt evidence. */
export const chooseCashForRide = onCall({region, enforceAppCheck}, async request => {
  const uid = authenticated(request);
  const rideId = rideIdFrom(request.data);
  const rideRef = db().doc("rides/" + rideId);
  const paymentRef = db().doc("payments/" + rideId);
  let result = "cash_due";
  await db().runTransaction(async tx => {
    const [ride, payment] = await Promise.all([tx.get(rideRef), tx.get(paymentRef)]);
    const amountMinor = trustedFare(ride);
    if (ride.get("riderId") !== uid || !ride.get("driverId")) {
      throw new HttpsError("permission-denied", "Only the rider can choose payment.");
    }
    if (payment.exists) {
      if (payment.get("method") !== "cash" ||
          !["cash_due", "cash_reported_received"].includes(payment.get("status"))) {
        throw new HttpsError("failed-precondition", "A different payment method is locked.");
      }
      result = payment.get("status") as string;
      return;
    }
    tx.create(paymentRef, {
      rideId, payerId: uid, driverId: ride.get("driverId"),
      method: "cash", currency: "BDT", amountMinor,
      status: "cash_due", externalVerified: false,
      createdAt: FieldValue.serverTimestamp()
    });
  });
  return {rideId, method: "cash", status: result};
});

/** Shared rides create one independently tracked cash choice per participant. */
export const chooseCashForSharedRide = onCall({region, enforceAppCheck}, async request => {
  const uid = authenticated(request);
  const rideId = rideIdFrom(request.data);
  const ride = await db().doc("rides/" + rideId).get();
  if (!ride.exists || ride.get("status") !== "completed" || ride.get("sharedRide") !== true) {
    throw new HttpsError("failed-precondition", "Only a completed shared ride can be paid.");
  }
  const riders = (ride.get("riderIds") as string[] | undefined) || [ride.get("riderId") as string];
  if (!riders.includes(uid)) throw new HttpsError("permission-denied", "You are not a passenger in this shared ride.");
  const shares = ride.get("fareShares") as Record<string, unknown> | undefined;
  const amountMinor = shares?.[uid];
  if (typeof amountMinor !== "number" || !Number.isSafeInteger(amountMinor) || amountMinor < 1) {
    throw new HttpsError("failed-precondition", "This passenger's fare share is unavailable.");
  }
  if (ride.get("currency") !== "BDT") {
    throw new HttpsError("failed-precondition", "Shared-ride cash settlement currently supports BDT only.");
  }
  const paymentRef = db().doc("payments/" + rideId + "_" + uid);
  let status = "cash_due";
  await db().runTransaction(async tx => {
    const old = await tx.get(paymentRef);
    if (old.exists) {
      if (old.get("payerId") !== uid || old.get("rideId") !== rideId ||
          old.get("method") !== "cash") {
        throw new HttpsError("failed-precondition", "A different payment method is already recorded.");
      }
      status = String(old.get("status") || "cash_due");
      return;
    }
    tx.create(paymentRef, {
      rideId, payerId: uid, driverId: ride.get("driverId"),
      method: "cash", currency: "BDT", amountMinor,
      sharedRide: true, status: "cash_due", externalVerified: false,
      createdAt: FieldValue.serverTimestamp()
    });
  });
  return {rideId, method: "cash", status, amountMinor,
    warning: "Cash choice is not proof that the driver received the money."};
});

/** Driver attestation, never independent confirmation of cash collection. */
export const reportCashReceived = onCall({region, enforceAppCheck}, async request => {
  const uid = authenticated(request);
  const rideId = rideIdFrom(request.data);
  const ref = db().doc("payments/" + rideId);
  await db().runTransaction(async tx => {
    const payment = await tx.get(ref);
    if (!payment.exists || payment.get("driverId") !== uid ||
        payment.get("method") !== "cash") {
      throw new HttpsError("permission-denied", "This is not your cash trip.");
    }
    if (payment.get("status") === "cash_reported_received") return;
    if (payment.get("status") !== "cash_due") {
      throw new HttpsError("failed-precondition", "Cash acknowledgement not allowed.");
    }
    tx.update(ref, {
      status: "cash_reported_received", cashReportedBy: uid,
      reportedAt: FieldValue.serverTimestamp(), externalVerified: false
    });
  });
  return {rideId, status: "cash_reported_received", externalVerified: false};
});

/**
 * Stripe-hosted TEST Checkout, so native card SDK/build dependencies are not
 * required. The client never receives secret keys or writes payment status.
 * Valid return URLs must be set on the server. Opening a Checkout link does
 * not mean the charge succeeded; only a signed webhook can mark paid_test.
 */
export const prepareStripeTestCheckout = onCall(
  {region, secrets: [stripeSecret], maxInstances: 10, enforceAppCheck}, async request => {
    const uid = authenticated(request);
    const rideId = rideIdFrom(request.data);
    const stripeClient = stripe();
    const returnBase = redirectBase();
    const paymentRef = db().doc("payments/" + rideId);
    const rideRef = db().doc("rides/" + rideId);
    const reserve = await db().runTransaction(async tx => {
      const [ride, prior] = await Promise.all([tx.get(rideRef), tx.get(paymentRef)]);
      const amountMinor = trustedFare(ride);
      if (ride.get("riderId") !== uid || !ride.get("driverId")) {
        throw new HttpsError("permission-denied", "Only the rider can pay.");
      }
      if (!prior.exists) {
        tx.create(paymentRef, {
          rideId, payerId: uid, driverId: ride.get("driverId"),
          method: "stripe_test", currency: "BDT", amountMinor,
          status: "initializing", stripeSessionId: null, attempt: 1,
          externalVerified: false, createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp()
        });
        return {amountMinor, attempt: 1, existing: null as string | null};
      }
      if (prior.get("method") !== "stripe_test" ||
          prior.get("payerId") !== uid || prior.get("amountMinor") !== amountMinor) {
        throw new HttpsError("failed-precondition", "Payment method or amount is locked.");
      }
      const state = prior.get("status") as string;
      if (state === "paid_test") {
        throw new HttpsError("already-exists", "This ride already has a verified test payment.");
      }
      if (!["initializing", "checkout_open", "payment_failed"].includes(state)) {
        throw new HttpsError("failed-precondition", "Unsupported payment state.");
      }
      const expiry = prior.get("checkoutExpiresAt") as Timestamp | undefined;
      const currentSession = prior.get("stripeSessionId") as string | null;
      if (currentSession && expiry && expiry.toMillis() > Date.now() + 10000) {
        return {amountMinor, attempt: Number(prior.get("attempt") || 1), existing: currentSession};
      }
      const updatedAt = prior.get("updatedAt") as Timestamp | undefined;
      if (state === "initializing" && !currentSession &&
          updatedAt && Date.now() - updatedAt.toMillis() < 12000) {
        throw new HttpsError("resource-exhausted", "Checkout is starting; retry shortly.");
      }
      const attempt = Math.min(100, Number(prior.get("attempt") || 1) + 1);
      if (attempt >= 100) throw new HttpsError("resource-exhausted", "Too many checkout attempts.");
      tx.update(paymentRef, {
        status: "initializing", stripeSessionId: null, attempt,
        updatedAt: FieldValue.serverTimestamp()
      });
      return {amountMinor, attempt, existing: null as string | null};
    });

    let session: Stripe.Checkout.Session;
    if (reserve.existing) {
      try {
        session = await stripeClient.checkout.sessions.retrieve(reserve.existing);
      } catch (_) {
        throw new HttpsError("unavailable", "Stripe checkout could not be retrieved.");
      }
    } else {
      try {
        session = await stripeClient.checkout.sessions.create({
          mode: "payment",
          payment_method_types: ["card"],
          client_reference_id: rideId,
          line_items: [{
            quantity: 1,
            price_data: {
              currency: "bdt",
              unit_amount: reserve.amountMinor,
              product_data: {name: "DRIVE ride (TEST MODE)"}
            }
          }],
          metadata: {rideId, payerId: uid},
          payment_intent_data: {metadata: {rideId, payerId: uid}},
          success_url: returnBase + "/payment/success?session_id={CHECKOUT_SESSION_ID}",
          cancel_url: returnBase + "/payment/cancel",
          expires_at: Math.floor(Date.now() / 1000) + 1800
        }, {idempotencyKey: "drive_stripe_checkout_" + rideId + "_" + reserve.attempt});
      } catch (_) {
        throw new HttpsError("unavailable", "Stripe TEST Checkout could not be started.");
      }
      await db().runTransaction(async tx => {
        const current = await tx.get(paymentRef);
        if (current.get("method") !== "stripe_test" ||
            current.get("payerId") !== uid ||
            Number(current.get("attempt")) !== reserve.attempt) {
          throw new HttpsError("failed-precondition", "Checkout state changed.");
        }
        if (current.get("status") === "paid_test") return;
        tx.update(paymentRef, {
          stripeSessionId: session.id, status: "checkout_open",
          checkoutExpiresAt: Timestamp.fromMillis(session.expires_at * 1000),
          updatedAt: FieldValue.serverTimestamp()
        });
      });
    }
    if (!session.url || session.status !== "open") {
      throw new HttpsError("failed-precondition",
        "Checkout is no longer open. Refresh the payment status.");
    }
    return {
      rideId, method: "stripe_test", checkoutUrl: session.url,
      expiresAtMs: session.expires_at * 1000,
      currency: "BDT", amountMinor: reserve.amountMinor
    };
  }
);

/** Verify Stripe raw-body signature and correlate all server-trusted fields.
 * Replays/out-of-order events cannot undo paid_test.
 */
export const stripeTestWebhook = onRequest(
  {region, secrets: [stripeSecret, stripeWebhookSecret],
    maxInstances: 10, cors: false},
  async (request, response) => {
    if (request.method !== "POST") {
      response.status(405).send("Method not allowed");
      return;
    }
    const signingSecret = stripeWebhookSecret.value();
    const signature = request.headers["stripe-signature"];
    if (!signingSecret?.startsWith("whsec_") || typeof signature !== "string") {
      response.status(400).send("Missing Stripe webhook signature.");
      return;
    }
    let event: Stripe.Event;
    try {
      event = stripe().webhooks.constructEvent(request.rawBody, signature, signingSecret);
    } catch (_) {
      response.status(400).send("Invalid Stripe webhook signature.");
      return;
    }
    if (!["checkout.session.completed", "checkout.session.async_payment_succeeded",
          "checkout.session.async_payment_failed"].includes(event.type)) {
      response.status(200).json({received: true, ignored: true});
      return;
    }
    const session = event.data.object as Stripe.Checkout.Session;
    const rideId = session.metadata?.rideId;
    const payerId = session.metadata?.payerId;
    if (!rideId || !/^[a-zA-Z0-9_-]{8,128}$/.test(rideId)) {
      response.status(200).json({received: true, ignored: true});
      return;
    }
    const paid = session.payment_status === "paid";
    // checkout.session.completed can precede payment finalization for
    // asynchronous methods. Only paid means a verified TEST success.
    if (!paid && event.type !== "checkout.session.async_payment_failed") {
      response.status(200).json({received: true, ignored: true});
      return;
    }
    const next = paid ? "paid_test" : "payment_failed";
    const ref = db().doc("payments/" + rideId);
    const eventRef = db().doc("stripeWebhookEvents/" + event.id);
    try {
      await db().runTransaction(async tx => {
        const [payment, processed] = await Promise.all([tx.get(ref), tx.get(eventRef)]);
        if (processed.exists) return;
        if (!payment.exists || payment.get("method") !== "stripe_test" ||
            payment.get("stripeSessionId") !== session.id ||
            payment.get("payerId") !== payerId ||
            payment.get("amountMinor") !== session.amount_total ||
            session.currency !== "bdt" || session.client_reference_id !== rideId) {
          throw new Error("Signed event mismatches the payment reservation.");
        }
        if (payment.get("status") === "paid_test" && next !== "paid_test") {
          tx.create(eventRef, {
            type: event.type, rideId, ignoredAsOutOfOrder: true,
            createdAt: FieldValue.serverTimestamp()
          });
          return;
        }
        tx.update(ref, {
          status: next, externalVerified: next === "paid_test",
          stripeEventId: event.id,
          verifiedAt: next === "paid_test" ? FieldValue.serverTimestamp() : null,
          updatedAt: FieldValue.serverTimestamp()
        });
        tx.create(eventRef, {
          type: event.type, rideId, createdAt: FieldValue.serverTimestamp()
        });
      });
      response.status(200).json({received: true});
    } catch (_) {
      response.status(503).send("Retry webhook after payment reservation is ready.");
    }
  }
);
