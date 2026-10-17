import {test} from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";

const useFnPackages = createRequire(new URL("../../services/functions/package.json", import.meta.url));
const {initializeApp, getApps} = useFnPackages("firebase-admin/app");
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
    body: JSON.stringify({email, password: "StrongDemoPass123!", returnSecureToken: true})
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
    body: JSON.stringify({data})
  });
  const result = await response.json();
  if (!response.ok) throw new Error(name + ": " + JSON.stringify(result));
  return result.result;
}
async function denied(name, token, data) {
  await assert.rejects(() => call(name, token, data));
}
test("Full Phase 2 backend scenario: auth, quote, match, rental locks and SOS", async () => {
  const admin = await identity("signUp", "drive-admin@example.test");
  const rider = await identity("signUp", "drive-rider@example.test");
  const driver = await identity("signUp", "drive-driver@example.test");
  const owner = await identity("signUp", "drive-owner@example.test");

  await getAuth().setCustomUserClaims(admin.uid, {admin: true});
  await getAuth().setCustomUserClaims(driver.uid, {driver: true});
  const adminSession = await identity("signInWithPassword", "drive-admin@example.test");
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
  for (const toStatus of ["driver_arriving", "in_progress", "completed"]) {
    const step = await call("advanceRide", driverSession.token, {rideId: booking.rideId, toStatus});
    assert.equal(step.status, toStatus);
  }
  const finalRide = await getFirestore().doc("rides/" + booking.rideId).get();
  assert.equal(finalRide.get("status"), "completed");
  assert.equal(finalRide.get("finalFareIsProvisional"), true);
});
