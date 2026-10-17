#!/usr/bin/env node
const {initializeApp, getApps} = require("firebase-admin/app");
const {getAuth} = require("firebase-admin/auth");
const email = process.argv[2];
if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
  console.error("Usage: node scripts/grant-admin.cjs existing-admin@example.com");
  process.exit(1);
}
if (!process.env.FIREBASE_AUTH_EMULATOR_HOST &&
    process.env.DRIVE_ALLOW_ADMIN_GRANT !== "I_UNDERSTAND") {
  console.error("Refusing live admin role grant; explicit DRIVE_ALLOW_ADMIN_GRANT=I_UNDERSTAND required.");
  process.exit(1);
}
if (!getApps().length) initializeApp({projectId: process.env.GCLOUD_PROJECT ||
  process.env.FIREBASE_PROJECT_ID || "demo-drive-local"});
async function main() {
  const user = await getAuth().getUserByEmail(email);
  await getAuth().setCustomUserClaims(user.uid, {...(user.customClaims || {}), admin: true});
  console.log("Admin custom claim applied to UID " + user.uid + "; user must refresh ID token.");
}
main().catch(error => {console.error(error); process.exitCode = 1;});
