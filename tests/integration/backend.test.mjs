import {test, after} from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";

const useFnPackages = createRequire(new URL("../../services/functions/package.json", import.meta.url));
const {initializeApp, getApps, deleteApp} = useFnPackages("firebase-admin/app");
const {getAuth} = useFnPackages("firebase-admin/auth");
const {getFirestore} = useFnPackages("firebase-admin/firestore");
const {getDatabase} = useFnPackages("firebase-admin/database");
const {geohashForLocation} = useFnPackages("geofire-common");
const projectId = "demo-drive-local";
const authEndpoint = "http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:";
const functionsEndpoint = "http://127.0.0.1:5001/" + projectId + "/asia-south1/";
if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST ||
    !process.env.FIREBASE_DATABASE_EMULATOR_HOST) {
  throw new Error("Integration tests must run only inside firebase emulators:exec.");
}
if (!getApps().length) initializeApp({projectId,
  databaseURL: "https://" + projectId + "-default-rtdb.firebaseio.com"});
async function identity(method, email) {
  const response = await fetch(authEndpoint + method + "?key=demo-key", {
    method: "POST", headers: {"Content-Type": "application/json"},
    body: JSON.stringify({email, password: "StrongDemoPass123!", returnSecureToken: true}),
    signal: AbortSignal.timeout(25000)
  });
  const result = await response.json();
  assert.equal(response.ok, true, JSON.stringify(result));
  return {uid: result.localId, token: result.idToken};
}
async function call(name, token, data) {
  const response = await fetch(functionsEndpoint + name, {
    method: "POST", headers: {
      "Content-Type": "application/json", "Authorization": "Bearer " + token
    },
    body: JSON.stringify({data}),
    signal: AbortSignal.timeout(25000)
  });
  const result = await response.json();
  if (!response.ok) throw new Error(name + ": " + JSON.stringify(result));
  return result.result;
}
async function denied(name, token, data) {
  await assert.rejects(() => call(name, token, data));
}
// Close emulated Admin SDK handles so Node test runners can exit cleanly.
after(async () => {
  getDatabase().goOffline();
  await getFirestore().terminate();
  await Promise.all(getApps().map(app => deleteApp(app)));
});
test("Full Phase 2 backend scenario: auth, quote, match, rental locks and SOS", async () => {
  const admin = await identity("signUp", "drive-admin@example.test");
  const rider = await identity("signUp", "drive-rider@example.test");
  const driver = await identity("signUp", "drive-driver@example.test");
  const owner = await identity("signUp", "drive-owner@example.test");
  const otherAdmin = await identity("signUp", "drive-admin-2@example.test");

  await getAuth().setCustomUserClaims(admin.uid, {admin: true});
  await getAuth().setCustomUserClaims(otherAdmin.uid, {admin: true});
  await getAuth().setCustomUserClaims(driver.uid, {driver: true});
  const adminSession = await identity("signInWithPassword", "drive-admin@example.test");
  const otherAdminSession = await identity("signInWithPassword", "drive-admin-2@example.test");
  const driverSession = await identity("signInWithPassword", "drive-driver@example.test");

  const rate = (baseMinor, perKmMinor, perMinuteMinor, minMinor, serviceFeeMinor) => ({
    baseMinor, perKmMinor, perMinuteMinor, minMinor, serviceFeeMinor,
    surgeMultiplier: 1, surgeCap: 2.5
  });
  await getFirestore().doc("pricingConfigs/demo-bdt-v1").set({
    active: true, version: "demo-bdt-v1", currency: "BDT",
    vehicles: {
      bike: rate(3000, 900, 140, 5000, 200),
      car: rate(6000, 1600, 220, 9000, 500),
      premium: rate(12000, 2700, 350, 16000, 1000)
    }
  });
  await getFirestore().doc("appConfig/public").set({activePricingVersion: "demo-bdt-v1"});

  await call("ensureProfile", rider.token, {displayName: "Rider A", locale: "bn"});
  await call("ensureProfile", driverSession.token, {displayName: "Driver B", locale: "en"});
  await call("ensureProfile", owner.token, {displayName: "Owner C", locale: "en"});
  await denied("reviewOwnerApplication", rider.token,
    {uid: owner.uid, approve: true, reason: ""});
  await call("submitOwnerApplication", owner.token, {businessName: "Drive Test Fleet"});
  const ownerApproval = await call("reviewOwnerApplication", adminSession.token,
    {uid: owner.uid, approve: true, reason: ""});
  assert.equal(ownerApproval.status, "approved");
  const vehicle = await call("registerRentalVehicle", owner.token, {
    model: "Compact Car", plate: "DHA-1234", type: "car",
    seatCount: 4, rentalRatePerHourMinor: 8000, area: "Dhaka"
  });
  await call("reviewRentalVehicle", adminSession.token,
    {vehicleId: vehicle.vehicleId, approve: true});

  const startAtMs = Date.now() + 2 * 3600000;
  const endAtMs = startAtMs + 2 * 3600000;
  const rental = await call("createRentalBooking", rider.token, {
    vehicleId: vehicle.vehicleId, startAtMs, endAtMs
  });
  assert.equal(rental.status, "confirmed");
  await denied("createRentalBooking", rider.token, {
    vehicleId: vehicle.vehicleId, startAtMs, endAtMs
  });
  await call("cancelRentalBooking", rider.token, {bookingId: rental.bookingId});
  const reused = await call("createRentalBooking", rider.token, {
    vehicleId: vehicle.vehicleId, startAtMs, endAtMs
  });
  assert.equal(reused.status, "confirmed");

  await getFirestore().doc("driverProfiles/" + driver.uid).set({
    uid: driver.uid, approvalStatus: "approved", online: true,
    vehicleType: "car", ratingAverage: 4.9, acceptanceRate: 0.95
  });
  const pickup = {lat: 23.7806, lng: 90.4074};
  const destination = {lat: 23.8232, lng: 90.421};
  await getDatabase().ref("driverLocations/" + driver.uid).set({
    ...pickup, geohash: geohashForLocation([pickup.lat, pickup.lng]),
    heading: 0, accuracy: 10, updatedAt: Date.now()
  });
  const quote = await call("getFareQuote", rider.token, {
    pickup, destination, vehicleType: "car"
  });
  assert.equal(quote.route.provisional, true);
  const booking = await call("requestRide", rider.token, {
    quoteId: quote.quoteId, idempotencyKey: "ph2integration1"
  });
  const retry = await call("requestRide", rider.token, {
    quoteId: quote.quoteId, idempotencyKey: "ph2integration1"
  });
  assert.equal(retry.rideId, booking.rideId);
  const dispatch = await call("dispatchNearbyDrivers", rider.token, {rideId: booking.rideId});
  assert.ok(dispatch.offeredTo.includes(driver.uid), JSON.stringify(dispatch));
  const accepted = await call("respondToOffer", driverSession.token, {
    offerId: booking.rideId + "_" + driver.uid, accept: true
  });
  assert.equal(accepted.status, "accepted");
  await denied("requestRide", rider.token, {
    quoteId: quote.quoteId, idempotencyKey: "ph2integration2"
  });
  const incident = await call("reportSafetyIncident", rider.token, {
    rideId: booking.rideId, type: "sos", note: "Automated test incident"
  });
  assert.equal(incident.notified, false);
  // Phase 8: only a verified administrator may review an incident.
  await denied("reviewSafetyIncident", rider.token, {
    incidentId: incident.incidentId,
    expectedStatus: "open",
    nextStatus: "in_review",
    note: "Rider account must not administer cases."
  });
  const triage = await call("reviewSafetyIncident", adminSession.token, {
    incidentId: incident.incidentId,
    expectedStatus: "open",
    nextStatus: "in_review",
    note: "Reviewed case documentation for simulated test incident."
  });
  assert.equal(triage.status, "in_review");
  assert.equal(triage.notified, false);
  await denied("reviewSafetyIncident", adminSession.token, {
    incidentId: incident.incidentId,
    expectedStatus: "open",
    nextStatus: "resolved",
    note: "Cannot skip the review status or use stale status."
  });
  const resolved = await call("reviewSafetyIncident", adminSession.token, {
    incidentId: incident.incidentId,
    expectedStatus: "in_review",
    nextStatus: "resolved",
    note: "Completed simulated incident review with case notes."
  });
  assert.equal(resolved.status, "resolved");
  const updatedIncident = await getFirestore().doc("safetyIncidents/" + incident.incidentId).get();
  assert.equal(updatedIncident.get("status"), "resolved");

  // Phase 6 chat is limited to active assigned trip participants.
  const messageId = "08d7ee1a-cf85-4be7-a72c-5412ff6aef9c";
  const message = {rideId: booking.rideId,
    text: "I am waiting near the pickup point", clientMessageId: messageId};
  const chat = await call("sendRideMessage", rider.token, message);
  assert.equal(chat.stored, true);
  const sameMessage = await call("sendRideMessage", rider.token, message);
  assert.equal(sameMessage.messageId, chat.messageId);
  await denied("sendRideMessage", owner.token, {
    rideId: booking.rideId, text: "Not my trip",
    clientMessageId: "d28504d7-c2be-4070-9ee5-377f2f35ba41"
  });
  for (const toStatus of ["driver_arriving", "in_progress", "completed"]) {
    const step = await call("advanceRide", driverSession.token, {rideId: booking.rideId, toStatus});
    assert.equal(step.status, toStatus);
  }
  const finalRide = await getFirestore().doc("rides/" + booking.rideId).get();
  assert.equal(finalRide.get("status"), "completed");
  assert.equal(finalRide.get("finalFareIsProvisional"), true);

  // Phase 6: participant review, cash due, and driver acknowledgement.
  await denied("sendRideMessage", rider.token, {
    rideId: booking.rideId, text: "Chat after completed ride",
    clientMessageId: "a4dbe0d9-2b71-4cf0-bf38-1b478c1072d1"
  });
  await denied("rateCompletedRide", owner.token, {
    rideId: booking.rideId, stars: 5, comment: ""
  });
  const rating = await call("rateCompletedRide", rider.token, {
    rideId: booking.rideId, stars: 5, comment: "Excellent"
  });
  assert.equal(rating.recorded, true);
  await denied("rateCompletedRide", rider.token, {
    rideId: booking.rideId, stars: 1, comment: "Duplicate"
  });
  const driverRating = await call("rateCompletedRide", driverSession.token, {
    rideId: booking.rideId, stars: 4, comment: ""
  });
  assert.equal(driverRating.recorded, true);
  await denied("chooseCashForRide", owner.token, {rideId: booking.rideId});
  await call("chooseCashForRide", rider.token, {rideId: booking.rideId});
  const received = await call("reportCashReceived", driverSession.token,
    {rideId: booking.rideId});
  assert.equal(received.status, "cash_reported_received");
  const payment = await getFirestore().doc("payments/" + booking.rideId).get();
  assert.equal(payment.get("method"), "cash");
  assert.equal(payment.get("status"), "cash_reported_received");
  assert.equal(payment.get("externalVerified"), false);

  // Phase 8 redo: verified participants can file support cases, but cannot
  // forge a refund or move the administrative review workflow.
  const disputePayload = {
    serviceType: "ride", serviceId: booking.rideId, topic: "payment",
    description: "I would like the cash fare recorded for this ride reviewed carefully."
  };
  const dispute = await call("openServiceDispute", rider.token, disputePayload);
  assert.equal(dispute.status, "open");
  assert.equal(dispute.refundStatus, "not_processed");
  const sameCase = await call("openServiceDispute", rider.token, disputePayload);
  assert.equal(sameCase.disputeId, dispute.disputeId);
  await denied("openServiceDispute", owner.token, disputePayload);
  // Phase 8 second pass: authenticated clients cannot claim reviewer ownership.
  const triagePayload = {
    disputeId: dispute.disputeId, expectedStatus: "open",
    priority: "high", assignment: "take",
    reason: "Taking ownership of this reported payment support case."
  };
  await denied("triageServiceDispute", rider.token, triagePayload);
  const ownership = await call("triageServiceDispute", adminSession.token, triagePayload);
  assert.equal(ownership.priority, "high");
  assert.equal(ownership.financialAction, false);
  assert.equal(ownership.emergencyAlertSent, false);
  let triaged = await getFirestore().doc("serviceDisputes/" + dispute.disputeId).get();
  assert.equal(triaged.get("assignedTo"), admin.uid);
  assert.equal(triaged.get("priority"), "high");
  await denied("triageServiceDispute", otherAdminSession.token, {
    ...triagePayload, assignment: "take",
    reason: "A different reviewer must not take an already owned case."
  });
  await denied("triageServiceDispute", otherAdminSession.token, {
    ...triagePayload, assignment: "release",
    reason: "Another administrator cannot release someone else's case."
  });
  await call("triageServiceDispute", adminSession.token, {
    ...triagePayload, priority: "normal", assignment: "release",
    reason: "Returning the case to the unassigned support queue."
  });
  triaged = await getFirestore().doc("serviceDisputes/" + dispute.disputeId).get();
  assert.equal(triaged.get("assignedTo"), null);
  assert.equal(triaged.get("priority"), "normal");
  const triageEvents = await getFirestore().collection("auditEvents")
    .where("caseId", "==", dispute.disputeId).get();
  assert.equal(triageEvents.docs.filter(doc => doc.get("type") === "service_dispute_triage").length, 2);
  await denied("reviewServiceDispute", rider.token, {
    disputeId: dispute.disputeId, expectedStatus: "open",
    nextStatus: "in_review",
    note: "A rider account cannot administer a support case."
  });
  await denied("reviewServiceDispute", adminSession.token, {
    disputeId: dispute.disputeId, expectedStatus: "open",
    nextStatus: "resolved",
    note: "A case must first be placed into the in-review state."
  });
  const firstReview = await call("reviewServiceDispute", adminSession.token, {
    disputeId: dispute.disputeId, expectedStatus: "open",
    nextStatus: "in_review",
    note: "Checking the simulated payment incident details and history."
  });
  assert.equal(firstReview.status, "in_review");
  await denied("reviewServiceDispute", adminSession.token, {
    disputeId: dispute.disputeId, expectedStatus: "open",
    nextStatus: "in_review",
    note: "This attempt uses a stale expected status and must be refused."
  });
  const resolvedCase = await call("reviewServiceDispute", adminSession.token, {
    disputeId: dispute.disputeId, expectedStatus: "in_review",
    nextStatus: "resolved",
    note: "The academic payment case was reviewed, not refunded."
  });
  assert.equal(resolvedCase.refundProcessed, false);
  const caseDoc = await getFirestore().doc(
    "serviceDisputes/" + dispute.disputeId).get();
  assert.equal(caseDoc.get("refundStatus"), "not_processed");
  assert.equal(caseDoc.get("status"), "resolved");
  await denied("triageServiceDispute", adminSession.token, triagePayload);
  assert.equal((await getFirestore().doc("serviceDisputes/" + dispute.disputeId).get())
    .get("status"), "resolved");

  const rentalCase = await call("openServiceDispute", owner.token, {
    serviceType: "rental", serviceId: reused.bookingId, topic: "service",
    description: "The reservation requires a manual owner-support review and follow up."
  });
  assert.equal(rentalCase.status, "open");
  const account = await call("lookupAdminUser", adminSession.token, {
    identifier: "drive-rider@example.test"
  });
  assert.equal(account.uid, rider.uid);
  assert.equal(account.adminClaim, false);
  await denied("lookupAdminUser", rider.token, {
    identifier: "drive-admin@example.test"
  });

  // Phase 8 second pass: pricing publication is server-authorized, atomic,
  // audited, and refuses a stale administrator's loaded configuration.
  const loadedPricing = await getFirestore().doc("pricingConfigs/demo-bdt-v1").get();
  const vehicles = loadedPricing.get("vehicles");
  const firstPublication = {
    version: "demo-bdt-v2", expectedActiveVersion: "demo-bdt-v1", vehicles
  };
  await denied("publishPricingConfig", rider.token, firstPublication);
  const published = await call("publishPricingConfig", adminSession.token, firstPublication);
  assert.equal(published.published, true);
  assert.equal(published.version, "demo-bdt-v2");
  await denied("publishPricingConfig", otherAdminSession.token, {
    version: "demo-bdt-v3", expectedActiveVersion: "demo-bdt-v1", vehicles
  });
  const currentConfig = await getFirestore().doc("appConfig/public").get();
  assert.equal(currentConfig.get("activePricingVersion"), "demo-bdt-v2");
  assert.equal((await getFirestore().doc("pricingConfigs/demo-bdt-v1").get())
    .get("active"), false);
  assert.equal((await getFirestore().doc("pricingConfigs/demo-bdt-v2").get())
    .get("active"), true);
  assert.equal((await getFirestore().doc("pricingConfigs/demo-bdt-v3").get())
    .exists, false);
  const pricingAudits = await getFirestore().collection("auditEvents")
    .where("type", "==", "pricing_published").get();
  assert.equal(pricingAudits.docs.filter(doc => doc.get("version") === "demo-bdt-v2").length, 1);
});
