import {test} from "node:test";
import assert from "node:assert/strict";
import {validateStaging} from "./staging_policy.mjs";

test("staging guard permits deliberate isolated project and admin site", () => {
  assert.deepEqual(validateStaging("drive-staging-bd", "drive-staging-admin",
    "STAGING ONLY", "true"), []);
});
test("staging guard refuses production, generic, demo or missing destinations", () => {
  for (const project of ["drive-prod", "drive-production", "drive-live",
    "demo-drive-local", "drive", "", "../drive-staging"]) {
    assert.ok(validateStaging(project, "drive-staging-admin",
      "STAGING ONLY", "true").length, project);
  }
  assert.ok(validateStaging("drive-staging-bd", "drive-production-admin",
    "STAGING ONLY", "true").length);
});
test("staging deployment requires explicit confirmation and approval", () => {
  assert.ok(validateStaging("drive-staging-bd", "drive-staging-admin",
    "yes", "true").length);
  assert.ok(validateStaging("drive-staging-bd", "drive-staging-admin",
    "STAGING ONLY", "").length);
});
