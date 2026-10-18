const {test} = require("node:test");
const assert = require("node:assert/strict");
const Stripe = require("stripe");

// These tests operate completely offline: no Stripe secret or remote account
// is contacted. A signed payload is the only accepted server-side evidence.
test("Stripe test webhooks require a valid raw-body signature", () => {
  const secret = "whsec_drive_local_signature_check";
  const payload = JSON.stringify({
    id: "evt_phase6_unit", object: "event", type: "checkout.session.completed",
    data: {object: {id: "cs_test_example", object: "checkout.session"}}
  });
  const stripe = new Stripe("sk_test_only_for_local_unit_verification");
  const header = stripe.webhooks.generateTestHeaderString({payload, secret});
  const verified = stripe.webhooks.constructEvent(payload, header, secret);
  assert.equal(verified.id, "evt_phase6_unit");
  assert.equal(verified.type, "checkout.session.completed");
  assert.throws(() => stripe.webhooks.constructEvent(
    payload.replace("cs_test_example", "cs_test_tampered"), header, secret
  ));
  assert.throws(() => stripe.webhooks.constructEvent(
    payload, header, "whsec_wrong_secret"
  ));
});
