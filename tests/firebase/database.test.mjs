import {readFileSync} from "node:fs";
import {test, before, after, beforeEach} from "node:test";
import {initializeTestEnvironment, assertSucceeds, assertFails} from "@firebase/rules-unit-testing";
import {ref, set, get} from "firebase/database";
let env;
before(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-drive-local",
    database: {host: "127.0.0.1", port: 9000,
      rules: readFileSync("firebase/database.rules.json", "utf8")}
  });
});
beforeEach(async () => env.clearDatabase());
after(async () => env.cleanup());
test("Only approved-claim driver writes their own valid location", async () => {
  const location = {lat: 23.78, lng: 90.41, heading: 90,
    accuracy: 5, geohash: "w21zxx", updatedAt: Date.now()};
  const driver = env.authenticatedContext("driver1", {driver: true}).database();
  const rider = env.authenticatedContext("alice").database();
  await assertSucceeds(set(ref(driver, "driverLocations/driver1"), location));
  await assertFails(set(ref(rider, "driverLocations/driver1"), location));
  await assertFails(set(ref(driver, "driverLocations/driver2"), location));
  await assertFails(set(ref(driver, "driverLocations/driver1"), {...location, lat: 123}));
  await assertFails(get(ref(rider, "driverLocations/driver1")));
});
test("Assigned participants see only their trip location", async () => {
  await env.withSecurityRulesDisabled(async context => {
    const db = context.database();
    await set(ref(db, "tripAccess/ride1/alice"), true);
    await set(ref(db, "tripAccess/ride1/driver1"), true);
    await set(ref(db, "rideDriver/ride1"), "driver1");
  });
  const driver = env.authenticatedContext("driver1", {driver: true}).database();
  const rider = env.authenticatedContext("alice").database();
  const other = env.authenticatedContext("mallory").database();
  const position = {lat: 23.78, lng: 90.41, updatedAt: Date.now()};
  await assertSucceeds(set(ref(driver, "tripLocations/ride1"), position));
  await assertSucceeds(get(ref(rider, "tripLocations/ride1")));
  await assertFails(get(ref(other, "tripLocations/ride1")));
  await assertFails(set(ref(other, "tripLocations/ride1"), position));
});
