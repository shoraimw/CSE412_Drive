import {test} from "node:test";
import assert from "node:assert/strict";
import {stagingAdminUrl,validateStagingAdminResponse} from "./staging_smoke_policy.mjs";

test("staging smoke origin must be the approved admin Firebase Hosting site",()=>{
  assert.equal(stagingAdminUrl("drive-staging-bd","drive-staging-admin",
    "STAGING ONLY","true").href,"https://drive-staging-admin.web.app/");
  assert.throws(()=>stagingAdminUrl("drive-prod","drive-prod-admin",
    "STAGING ONLY","true"));
  assert.throws(()=>stagingAdminUrl("drive-staging-bd","https://untrusted.example",
    "STAGING ONLY","true"));
  assert.throws(()=>stagingAdminUrl("drive-staging-bd","drive-staging-admin",
    "STAGING ONLY", ""));
});
test("staging checks enforce HTML mount point and browser safety headers",()=>{
  const headers=new Headers({
    "content-type":"text/html; charset=utf-8",
    "x-content-type-options":"nosniff",
    "x-frame-options":"DENY",
    "referrer-policy":"no-referrer",
    "content-security-policy-report-only":"default-src 'self'"
  });
  const html='<!doctype html><html><body><div id="root"></div></body></html>';
  assert.deepEqual(validateStagingAdminResponse(200,headers,html),[]);
  assert.ok(validateStagingAdminResponse(404,headers,html).length);
  assert.ok(validateStagingAdminResponse(200,new Headers(),html).length);
  assert.ok(validateStagingAdminResponse(200,headers,"<html>Missing app</html>").length);
});
