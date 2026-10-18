const {test} = require("node:test");
const assert = require("node:assert/strict");
const {canTransitionCase,disputeDocumentId,initialDisputePriority,canEditCasePriority} = require("../lib/admin_policy");

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

test("safety disputes start high priority, closed cases cannot be reprioritized",()=>{
  assert.equal(initialDisputePriority("safety"),"high");
  assert.equal(initialDisputePriority("payment"),"normal");
  assert.equal(canEditCasePriority("open"),true);
  assert.equal(canEditCasePriority("in_review"),true);
  assert.equal(canEditCasePriority("resolved"),false);
  assert.equal(canEditCasePriority("dismissed"),false);
});
