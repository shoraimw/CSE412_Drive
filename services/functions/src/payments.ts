import {getFirestore, FieldValue} from "firebase-admin/firestore";
import {defineSecret} from "firebase-functions/params";
import {onCall, HttpsError} from "firebase-functions/v2/https";
import {onRequest} from "firebase-functions/v2/https";
import Stripe from "stripe";
import {z} from "zod";

const stripeSecret = defineSecret("STRIPE_TEST_SECRET_KEY");
const stripeWebhookSecret = defineSecret("STRIPE_TEST_WEBHOOK_SECRET");
const region = "asia-south1";
const rideInput = z.object({rideId: z.string().min(8).max(128)}).strict();

function database() { return getFirestore(); }

function rideAmount(doc: FirebaseFirestore.DocumentSnapshot): number {
  if (!doc.exists || doc.get("status") !== "completed") {
    throw new HttpsError("failed-precondition", "Complete the trip before payment.");
  }
  const fare = doc.get("finalFare") as {totalMinor?: unknown} | undefined;
  const amount = fare?.totalMinor;
  if (!Number.isSafeInteger(amount) || typeof amount !== "number" ||
      amount < 5000 || amount > 100000000) {
    throw new HttpsError("failed-precondition", "Ride fare is not valid for payment.");
  }
  if (doc.get("currency") !== "BDT") {
    throw new HttpsError("failed-precondition", "This demo supports only BDT.");
  }
  return amount;
}
function inputRide(input: unknown): string {
  const parsed = rideInput.safeParse(input);
  if (!parsed.success) {
    throw new HttpsError("invalid-argument", "A valid ride ID is required.");
  }
  return parsed.data.rideId;
}
function stripeClient(): Stripe {
  const key = stripeSecret.value();
  if (!key || !key.startsWith("sk_test_")) {
    throw new HttpsError("failed-precondition",
      "Stripe test secret is not configured. Live charges are disabled.");
  }
  return new Stripe(key);
}

export const chooseCashForRide = onCall({region}, async request => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in first.");
  const rideId = inputRide(request.data);
  const rideRef = database().doc("rides/" + rideId);
  const paymentRef = database().doc("payments/" + rideId);
  await database().runTransaction(async tx => {
    const [ride, payment] = await Promise.all([
      tx.get(rideRef), tx.get(paymentRef)
    ]);
    const amountMinor = rideAmount(ride);
    if (ride.get("riderId") !== uid || !ride.get("driverId")) {
      throw new HttpsError("permission-denied", "Only the rider selects payment.");
    }
    if (payment.exists) {
      if (payment.get("method") === "cash" &&
          ["cash_due", "cash_reported_received"].includes(payment.get("status"))) return;
      throw new HttpsError("failed-precondition", "Payment method is already locked.");
    }
    tx.create(paymentRef, {
      rideId, payerId: uid, driverId: ride.get("driverId"),
      method: "cash", currency: "BDT", amountMinor,
      status: "cash_due", createdAt: FieldValue.serverTimestamp(),
      externalVerified: false
    });
  });
  return {rideId, method: "cash", status: "cash_due"};
});

/** Driver attestation, NOT proof that cash changed hands. */
export const reportCashReceived = onCall({region}, async request => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in first.");
  const rideId = inputRide(request.data);
  const paymentRef = database().doc("payments/" + rideId);
  await database().runTransaction(async tx => {
    const payment = await tx.get(paymentRef);
    if (!payment.exists || payment.get("driverId") !== uid ||
        payment.get("method") !== "cash") {
      throw new HttpsError("permission-denied", "No matching cash trip is assigned.");
    }
    if (payment.get("status") === "cash_reported_received") return;
    if (payment.get("status") !== "cash_due") {
      throw new HttpsError("failed-precondition", "Cash report is not available.");
    }
    tx.update(paymentRef, {
      status: "cash_reported_received",
      cashReportedBy: uid, reportedAt: FieldValue.serverTimestamp(),
      externalVerified: false
    });
  });
  return {rideId, status: "cash_reported_received",
    disclaimer: "Driver-reported, not externally verified or reconciled."};
});

/** Server-controlled Stripe PaymentIntent creation, test mode only.
 * With an unverified pending setup, retry with the same idempotency key.
 * Do not store or expose clientSecret in Firestore.
 */
export const prepareStripeTestPayment = onCall(
  {region, secrets: [stripeSecret], maxInstances: 10},
  async request => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Sign in first.");
    const rideId = inputRide(request.data);
    const stripe = stripeClient();
    const paymentRef = database().doc("payments/" + rideId);
    const rideRef = database().doc("rides/" + rideId);
    const result = await database().runTransaction(async tx => {
      const [ride, old] = await Promise.all([tx.get(rideRef), tx.get(paymentRef)]);
      const amountMinor = rideAmount(ride);
      if (ride.get("riderId") !== uid || !ride.get("driverId")) {
        throw new HttpsError("permission-denied", "Only the rider can pay for this trip.");
      }
      if (old.exists) {
        if (old.get("method") !== "stripe_test" ||
            !["initializing", "requires_payment", "processing"].includes(old.get("status"))) {
          throw new HttpsError("failed-precondition",
            "Another payment method or final payment state is recorded.");
        }
        if (old.get("payerId") !== uid || old.get("amountMinor") !== amountMinor) {
          throw new HttpsError("failed-precondition", "Existing payment mismatch.");
        }
      } else {
        tx.create(paymentRef, {
          rideId, payerId: uid, driverId: ride.get("driverId"),
          method: "stripe_test", currency: "BDT", amountMinor,
          status: "initializing", stripeIntentId: null,
          externalVerified: false, createdAt: FieldValue.serverTimestamp()
        });
      }
      return {amountMinor};
    });

    let intent: Stripe.PaymentIntent;
    try {
      intent = await stripe.paymentIntents.create({
        amount: result.amountMinor,
        currency: "bdt",
        automatic_payment_methods: {enabled: true},
        metadata: {rideId, payerId: uid},
        description: "DRIVE university ride demo " + rideId
      }, {idempotencyKey: "drive_test_ride_" + rideId});
    } catch (error) {
      throw new HttpsError("unavailable",
        "Stripe test payment could not be initialized. Retry later.");
    }
    if (!intent.client_secret) {
      throw new HttpsError("internal", "No Stripe PaymentIntent client secret returned.");
    }
    await database().runTransaction(async tx => {
      const current = await tx.get(paymentRef);
      if (current.get("method") !== "stripe_test" ||
          current.get("payerId") !== uid) {
        throw new HttpsError("failed-precondition", "Payment state has changed.");
      }
      const oldId = current.get("stripeIntentId") as string | null;
      if (oldId && oldId !== intent.id) {
        throw new HttpsError("failed-precondition", "Stripe intent changed unexpectedly.");
      }
      if (!["initializing", "requires_payment", "processing"].includes(current.get("status"))) {
        throw new HttpsError("failed-precondition", "Payment already finalized.");
      }
      tx.update(paymentRef, {
        stripeIntentId: intent.id,
        status: intent.status === "processing" ? "processing" : "requires_payment",
        updatedAt: FieldValue.serverTimestamp()
      });
    });
    return {
      rideId, method: "stripe_test",
      clientSecret: intent.client_secret,
      paymentIntentId: intent.id,
      currency: "BDT", amountMinor: result.amountMinor
    };
  }
);

export const stripeTestWebhook = onRequest(
  {region, secrets: [stripeSecret, stripeWebhookSecret],
    maxInstances: 10, cors: false},
  async (request, response) => {
    if (request.method !== "POST") {
      response.status(405).send("Method not allowed");
      return;
    }
    const secret = stripeWebhookSecret.value();
    if (!secret || !secret.startsWith("whsec_") ||
        typeof request.headers["stripe-signature"] !== "string") {
      response.status(400).send("Invalid webhook setup or signature");
      return;
    }
    let event: Stripe.Event;
    try {
      event = stripeClient().webhooks.constructEvent(
        request.rawBody, request.headers["stripe-signature"], secret);
    } catch (_) {
      response.status(400).send("Signature verification failed");
      return;
    }
    if (event.type !== "payment_intent.succeeded" &&
        event.type !== "payment_intent.payment_failed") {
      response.status(200).json({received: true, ignored: true});
      return;
    }
    const intent = event.data.object as Stripe.PaymentIntent;
    const rideId = intent.metadata.rideId;
    if (!rideId || !/^[a-zA-Z0-9_-]{8,128}$/.test(rideId)) {
      response.status(200).json({received: true, ignored: true});
      return;
    }
    const next = event.type === "payment_intent.succeeded" ? "paid_test" : "payment_failed";
    const paymentRef = database().doc("payments/" + rideId);
    const eventRef = database().doc("stripeWebhookEvents/" + event.id);
    try {
      await database().runTransaction(async tx => {
        const [payment, processed] = await Promise.all([
          tx.get(paymentRef), tx.get(eventRef)
        ]);
        if (processed.exists) return;
        if (!payment.exists || payment.get("method") !== "stripe_test" ||
            payment.get("stripeIntentId") !== intent.id ||
            payment.get("amountMinor") !== intent.amount ||
            payment.get("payerId") !== intent.metadata.payerId ||
            intent.currency !== "bdt") {
          throw new Error("Stripe event cannot be linked to the trusted ride payment.");
        }
        const status = payment.get("status") as string;
        if (status === "paid_test" && next !== "paid_test") {
          tx.create(eventRef, {
            type: event.type, rideId, ignoredAsOutOfOrder: true,
            createdAt: FieldValue.serverTimestamp()
          });
          return;
        }
        tx.update(paymentRef, {
          status: next,
          externalVerified: next === "paid_test",
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
      // Non-2xx tells Stripe to retry when a payment record has not yet
      // committed or a transient Firestore error prevented processing.
      response.status(503).send("Webhook processing temporarily unavailable");
    }
  }
);
