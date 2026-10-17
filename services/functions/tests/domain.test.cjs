const {test} = require("node:test");
const assert = require("node:assert/strict");
const {
  haversineKm, approximateRoute, calculateFare,
  reservationSlots, validStateTransition, scoreDriver
} = require("../lib/domain.js");

test("Haversine returns zero for identical positions", () => {
  const point = {lat: 23.7806, lng: 90.4074};
  assert.equal(haversineKm(point, point), 0);
});
test("Route quote is explicitly provisional and rejects zero-length trips", () => {
  const a = {lat: 23.7806, lng: 90.4074};
  const b = {lat: 23.82, lng: 90.42};
  const route = approximateRoute(a, b);
  assert.equal(route.provisional, true);
  assert.ok(route.distanceMeters > 4000);
  assert.throws(() => approximateRoute(a, a));
});
test("Fare policy handles surge with integer minor units", () => {
  const rate = {baseMinor: 5000, perKmMinor: 1200,
    perMinuteMinor: 200, minMinor: 7000,
    serviceFeeMinor: 500, surgeMultiplier: 1.5, surgeCap: 2.5};
  const fare = calculateFare(10000, 900, rate);
  assert.equal(fare.distanceMinor, 12000);
  assert.equal(fare.durationMinor, 3000);
  assert.equal(fare.surgeExtraMinor, 10250);
  assert.equal(fare.totalMinor, 30750);
  assert.equal(fare.currency, "BDT");
  assert.throws(() => calculateFare(-1, 900, rate));
  assert.throws(() => calculateFare(10000, 900, {...rate, surgeMultiplier: 9}));
});
test("Overlapping partial-hour rentals use a shared reservation slot", () => {
  const hour = 60 * 60 * 1000;
  const a = reservationSlots(12 * hour + 1000, 13 * hour + 1000);
  const b = reservationSlots(13 * hour, 14 * hour);
  assert.deepEqual(a, ["12", "13"]);
  assert.deepEqual(b, ["13"]);
  assert.ok(a.some(x => b.includes(x)));
  assert.throws(() => reservationSlots(14 * hour, 13 * hour));
});
test("Only permitted actor/state ride transitions are accepted", () => {
  assert.equal(validStateTransition("accepted", "driver_arriving", "driver"), true);
  assert.equal(validStateTransition("accepted", "completed", "driver"), false);
  assert.equal(validStateTransition("matching", "cancelled", "rider"), true);
  assert.equal(validStateTransition("in_progress", "cancelled", "rider"), false);
});
test("Matching score prefers nearby drivers when quality is equal", () => {
  assert.ok(scoreDriver(1, 4.8, 0.9) > scoreDriver(7, 4.8, 0.9));
});
