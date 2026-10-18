import {readFileSync} from "node:fs";
import {test, before, after, beforeEach} from "node:test";
import assert from "node:assert/strict";
import {initializeTestEnvironment, assertFails, assertSucceeds} from "@firebase/rules-unit-testing";
import {doc, setDoc, updateDoc, getDoc, getDocs, collection, serverTimestamp} from "firebase/firestore";

let env;
before(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-drive-local",
    firestore: {host: "127.0.0.1", port: 8080,
      rules: readFileSync("firebase/firestore.rules", "utf8")}
  });
});
beforeEach(async () => env.clearFirestore());
after(async () => env.cleanup());
test("Rider reads only own user document", async () => {
  await env.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), "users/alice"), {
      uid: "alice", displayName: "Alice", locale: "en",
      accountStatus: "active", createdAt: new Date()
    });
  });
  const alice = env.authenticatedContext("alice");
  const bob = env.authenticatedContext("bob");
  await assertSucceeds(getDoc(doc(alice.firestore(), "users/alice")));
  await assertFails(getDoc(doc(bob.firestore(), "users/alice")));
});
test("Rider cannot elevate to admin or mutate a fare", async () => {
  await env.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), "users/alice"), {
      uid: "alice", displayName: "Alice", locale: "en",
      accountStatus: "active", roles: ["rider"], createdAt: new Date()
    });
    await setDoc(doc(context.firestore(), "rides/ride1"), {
      riderId: "alice", driverId: null, status: "matching",
      fare: {totalMinor: 10000}
    });
  });
  const db = env.authenticatedContext("alice").firestore();
  await assertFails(updateDoc(doc(db, "users/alice"), {roles: ["admin"]}));
  await assertFails(updateDoc(doc(db, "rides/ride1"), {status: "completed"}));
  await assertFails(updateDoc(doc(db, "rides/ride1"), {"fare.totalMinor": 0}));
  await assertSucceeds(updateDoc(doc(db, "users/alice"), {
    displayName: "Alice Updated", updatedAt: serverTimestamp()
  }));
});
test("Driver offers are visible only to targeted approved-claim driver", async () => {
  await env.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), "driverOffers/r1_driver1"), {
      rideId: "r1", driverId: "driver1", status: "pending"
    });
  });
  const driver = env.authenticatedContext("driver1", {driver: true}).firestore();
  const rider = env.authenticatedContext("alice").firestore();
  await assertSucceeds(getDoc(doc(driver, "driverOffers/r1_driver1")));
  await assertFails(getDoc(doc(rider, "driverOffers/r1_driver1")));
  await assertFails(getDocs(collection(rider, "driverOffers")));
});
test("Admin with trusted claim can inspect protected records", async () => {
  await env.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), "driverApplications/driver1"), {
      uid: "driver1", status: "pending"
    });
  });
  const admin = env.authenticatedContext("admin1", {admin: true}).firestore();
  await assertSucceeds(getDoc(doc(admin, "driverApplications/driver1")));
  await assertFails(setDoc(doc(admin, "driverApplications/driver1"), {status: "approved"}));
});

test("Trip chat read access is participant-only and all direct writes are denied", async () => {
  await env.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), "rides/ridechat12"), {
      riderId: "alice", driverId: "driver1", status: "accepted"
    });
    await setDoc(doc(context.firestore(), "rides/ridechat12/messages/m1"), {
      rideId: "ridechat12", senderId: "alice", recipientId: "driver1",
      text: "Meet by the gate"
    });
  });
  const rider = env.authenticatedContext("alice").firestore();
  const driver = env.authenticatedContext("driver1").firestore();
  const outsider = env.authenticatedContext("mallory").firestore();
  await assertSucceeds(getDoc(doc(rider, "rides/ridechat12/messages/m1")));
  await assertSucceeds(getDoc(doc(driver, "rides/ridechat12/messages/m1")));
  await assertFails(getDoc(doc(outsider, "rides/ridechat12/messages/m1")));
  await assertFails(setDoc(doc(rider, "rides/ridechat12/messages/m2"),
    {text: "Direct write must be refused"}));
});
test("Trip payment is visible to payer and driver, never mutable by clients", async () => {
  await env.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), "payments/ride12345"), {
      payerId: "alice", driverId: "driver1", status: "cash_due",
      method: "cash", amountMinor: 12000
    });
    await setDoc(doc(context.firestore(), "notifications/n1"), {
      uid: "alice", title: "New trip status"
    });
  });
  const alice = env.authenticatedContext("alice").firestore();
  const driver = env.authenticatedContext("driver1").firestore();
  const other = env.authenticatedContext("mallory").firestore();
  await assertSucceeds(getDoc(doc(alice, "payments/ride12345")));
  await assertSucceeds(getDoc(doc(driver, "payments/ride12345")));
  await assertFails(getDoc(doc(other, "payments/ride12345")));
  await assertFails(updateDoc(doc(alice, "payments/ride12345"),
    {status: "paid_test"}));
  await assertSucceeds(getDoc(doc(alice, "notifications/n1")));
  await assertFails(getDoc(doc(other, "notifications/n1")));
  await assertFails(setDoc(doc(alice, "notifications/hacked"),
    {uid: "alice", title: "Forged notification"}));
});
