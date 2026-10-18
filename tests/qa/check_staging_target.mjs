import {validateStaging} from "./staging_policy.mjs";

const issues = validateStaging(
  process.env.DRIVE_STAGING_PROJECT_ID,
  process.env.DRIVE_STAGING_ADMIN_SITE_ID,
  process.env.CONFIRM_DEPLOY,
  process.env.DRIVE_STAGING_APPROVED,
);
if (issues.length) {
  for (const issue of issues) console.error("Blocked: " + issue);
  process.exit(1);
}
const webKeys = ["VITE_FIREBASE_API_KEY", "VITE_FIREBASE_AUTH_DOMAIN",
  "VITE_FIREBASE_PROJECT_ID", "VITE_FIREBASE_APP_ID", "VITE_FIREBASE_STORAGE_BUCKET"];
if (webKeys.some(key => !process.env[key])) {
  console.error("Blocked: Missing public Firebase Web app configuration.");
  process.exit(1);
}
if (process.env.VITE_FIREBASE_USE_EMULATORS !== "false") {
  console.error("Blocked: Staging admin must not target local emulators.");
  process.exit(1);
}
console.log("Validated dedicated staging target and required public web configuration.");
