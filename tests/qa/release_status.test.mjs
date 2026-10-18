import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
test("release register states actual evidence and blocks unverified staging sign-off",()=>{
  const status=readFileSync("docs/PROJECT_RELEASE_STATUS.md","utf8");
  const sign=readFileSync("docs/PHASE_9_RELEASE_SIGNOFF.md","utf8");
  assert.match(status,/39130983258/);
  assert.match(status,/NOT DONE/);
  assert.match(status,/External acceptance blocked/);
  assert.match(status,/\- \[ \] Dedicated staging Firebase/);
  assert.match(sign,/NO-GO/);
  assert.match(sign,/NOT DEPLOYED/);
});
