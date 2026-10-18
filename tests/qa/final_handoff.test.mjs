import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync, existsSync} from "node:fs";

// Test that submission/release documents exist AND don't erase the external
// acceptance boundary. This is structural CI, not a human acceptance signature.
test("final handoff preserves all release evidence and student deliverables",()=>{
  const docs=[
    "docs/REQUIREMENTS_TRACEABILITY.md",
    "docs/PHASE_9_ACCEPTANCE_TEST_PLAN.md",
    "docs/PHASE_9_RELEASE_SIGNOFF.md",
    "docs/PHASE_10_FINAL_REPORT.md",
    "docs/PHASE_10_PRESENTATION.md",
    "docs/PHASE_10_DEMO_VIVA.md"
  ];
  for (const path of docs) {
    assert.ok(existsSync(path), "Required document missing: "+path);
    const body=readFileSync(path,"utf8");
    assert.ok(body.length>400, "Empty / placeholder deliverable: "+path);
  }
  const sign=readFileSync("docs/PHASE_9_RELEASE_SIGNOFF.md","utf8");
  assert.match(sign,/NO-GO/);
  assert.match(sign,/NOT DEPLOYED/);
  const report=readFileSync("docs/PHASE_10_FINAL_REPORT.md","utf8");
  assert.match(report,/not complete|not implemented/i);
  assert.match(report,/39129534777/);
  const testPlan=readFileSync("docs/PHASE_9_ACCEPTANCE_TEST_PLAN.md","utf8");
  assert.match(testPlan,/TC22/);
  assert.match(testPlan,/NOT RUN/);
});
