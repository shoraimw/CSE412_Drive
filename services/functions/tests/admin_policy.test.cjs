const {test} = require("node:test");
const assert = require("node:assert/strict");
const {canTransitionCase,disputeDocumentId} = require("../lib/admin_policy");

test("support cases must be taken into review before a resolution",()=>{
  assert.equal(canTransitionCase("open","resolved"),false);
  assert.equal(canTransitionCase("open","dismissed"),false);
  assert.equal(canTransitionCase("open","in_review"),true);
  assert.equal(canTransitionCase("in_review","resolved"),true);
  assert.equal(canTransitionCase("in_review","dismissed"),true);
  assert.equal(canTransitionCase("resolved","open"),false);
});
test("support case identity is deterministic and scoped to its opener",()=>{
  const a=disputeDocumentId("ride","ride12345678","rider12345");
  const b=disputeDocumentId("ride","ride12345678","rider12345");
  const c=disputeDocumentId("ride","ride12345678","driver12345");
  assert.equal(a,b);
  assert.notEqual(a,c);
  assert.throws(()=>disputeDocumentId("ride","bad/id","rider12345"));
});
