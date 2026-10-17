#!/usr/bin/env node
/* Load an explicit sample configuration for development, never silently
   modify a production project. Read docs/PHASE_2_FIREBASE.md first. */
const {initializeApp, getApps} = require("firebase-admin/app");
const {getFirestore, FieldValue} = require("firebase-admin/firestore");
const projectId = process.env.GCLOUD_PROJECT || process.env.FIREBASE_PROJECT_ID || "demo-drive-local";
if (!process.env.FIRESTORE_EMULATOR_HOST &&
    process.env.DRIVE_ALLOW_LIVE_SEED !== "I_UNDERSTAND") {
  console.error("Refusing to write a live database. Set DRIVE_ALLOW_LIVE_SEED=I_UNDERSTAND after review.");
  process.exit(1);
}
if (!getApps().length) initializeApp({projectId});
const db = getFirestore();
const version = "demo-bdt-v1";
const rate = (baseMinor, perKmMinor, perMinuteMinor, minMinor, serviceFeeMinor) => ({
  baseMinor, perKmMinor, perMinuteMinor, minMinor, serviceFeeMinor,
  surgeMultiplier: 1, surgeCap: 2.5
});
async function main() {
  await db.doc("pricingConfigs/" + version).set({
    active: true, currency: "BDT", version,
    vehicles: {
      bike: rate(3000, 900, 140, 5000, 200),
      car: rate(6000, 1600, 220, 9000, 500),
      premium: rate(12000, 2700, 350, 16000, 1000)
    },
    cancellationFeeMinor: 0, cancellationPolicy: "phase2_no_fee",
    updatedAt: FieldValue.serverTimestamp()
  });
  await db.doc("appConfig/public").set({
    activePricingVersion: version,
    supportedVehicleTypes: ["bike", "car", "premium"],
    supportedLocales: ["en", "bn"],
    demoMode: true,
    updatedAt: FieldValue.serverTimestamp()
  }, {merge: true});
  console.log("Seeded " + version + " in project " + projectId +
    " (emulator: " + Boolean(process.env.FIRESTORE_EMULATOR_HOST) + ").");
}
main().catch(error => {console.error(error); process.exitCode = 1;});
