import {stagingAdminUrl,validateStagingAdminResponse} from "./staging_smoke_policy.mjs";

const url=stagingAdminUrl(
  process.env.DRIVE_STAGING_PROJECT_ID,
  process.env.DRIVE_STAGING_ADMIN_SITE_ID,
  process.env.CONFIRM_DEPLOY,
  process.env.DRIVE_STAGING_APPROVED
);
const response=await fetch(url, {
  method:"GET", redirect:"error", signal:AbortSignal.timeout(15000),
  headers:{"Cache-Control":"no-cache"}
});
const html=await response.text();
const failures=validateStagingAdminResponse(response.status,response.headers,html);
if(failures.length) {
  failures.forEach(e=>console.error("Staging smoke check FAILED: "+e));
  process.exit(1);
}
console.log("Read-only staging admin smoke checks passed: "+url.origin);
console.log("This does not prove logged-in, financial, safety or device workflows.");
