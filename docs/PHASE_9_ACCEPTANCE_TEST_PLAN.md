# DRIVE Phase 9 — Formal QA & Staging Acceptance Plan

**Version:** 1.0 • **Project:** CSE412 DRIVE • **Evidence cutoff:** 18 October 2026 • **Status:** Automated CI successful. Manual staging and real-device acceptance **NOT YET EXECUTED**.

## What has actually passed

The latest verified Phase 9 central CI checks on commit `c0e3575697cfacd5293c792c9285cfdee468ef8c`: [GitHub Actions 39129534777](https://github.com/shoraimw/CSE412_Drive/actions/runs/39129534777). Backend full Firebase emulator run on the same commit: [39129534843](https://github.com/shoraimw/CSE412_Drive/actions/runs/39129534843).

| Check | Actual result | Evidence |
|---|---|---|
| Admin web unit tests, TypeScript/Vite build and bundle audit | PASS | Actions 39129534777 / admin-web |
| Flutter analyzer and Dart/widget tests | PASS | Actions 39129534777 / mobile |
| Firebase unit rules and callable/emulator integration | PASS | Actions 39129534843 |
| FastAPI ML unit/API tests | PASS | Actions 39129534777 / ml |
| Cloudflare Worker security unit tests | PASS | Actions 39129534777 / cloudflare-edge |
| Tracked-secret pattern check + staging policy tests | PASS | Actions 39129534777 / repository-safety |
| Real staging deployment, user acceptance, manual penetration tests | **NOT TESTED** | External prerequisites missing |
| Device GPS latency/load, payment provider sandbox, real FCM delivery | **NOT TESTED** | Device/provider/project required |

### Test environment

Automated tests: GitHub-hosted Ubuntu, Node 22, Java 21, Flutter stable, Python 3.12, local Firebase emulators for `demo-drive-local`; cloud tests do **not** use live API keys. `tests/integration/backend.test.mjs` covers trusted backend flows, including custom claims, rentals, dispatch, disputes, concurrency and pricing. The demo Firebase database is **not** a deployable production instance.

## Test cases — run and RECORD results

All manual rows below start **NOT RUN**, never PASS by assumption. Record `PASS / FAIL / BLOCKED / NOT RUN`, test date (Asia/Dhaka), tester, environment name, redacted screenshots/log links, and issue/bug ID. Do not enter actual secret keys in evidence.

| ID | Role / requirement | Exact test and expected result | Priority | Manual result |
|---|---|---|---|---|
| TC01 | Rider registration | New test email account; verify email gate; invalid login rejected | P0 | NOT RUN |
| TC02 | Google / OTP Auth | Configure registered SHA/OAuth; log in with test device; verify access and rate-limit | P0 | NOT RUN |
| TC03 | Driver approval | Pending driver submits private doc; unapproved denied dispatch; admin approval changes eligible status | P0 | NOT RUN |
| TC04 | Rental owner | Owner lists vehicle; unapproved hidden; approved public listing omits plate | P0 | NOT RUN |
| TC05 | Rental conflict | Two renters request overlapping intervals; at most one succeeds; cancellation frees slot | P0 | NOT RUN |
| TC06 | Ride quote | Set pickup/target; trusted backend quote in BDT; client cannot overwrite fare | P0 | NOT RUN |
| TC07 | Driver matching | Two approved drivers online; dispatch offers within expiry; only one successful acceptance | P0 | NOT RUN |
| TC08 | GPS privacy | Only driver writes assigned trip GPS, only participant reads; outsider denied; stale GPS UI signalled | P0 | NOT RUN |
| TC09 | Ride lifecycle | request → offered → accepted → started → completed; wrong-state mutation denied | P0 | NOT RUN |
| TC10 | Payment TEST | Test Stripe Checkout session + signed webhook idempotency; no live payment; cash path separately tested | P0 | NOT RUN |
| TC11 | SOS boundary | Rider reports simulated incident; admin review audit; UI explicitly states no external dispatch | P0 | NOT RUN |
| TC12 | Dispute ownership | Rider files dispute; admin A owns, admin B cannot override; release and resolve audit immutable | P0 | NOT RUN |
| TC13 | Admin authorization | Non-admin cannot read/write KYC, price, ops, audit or call privileged functions | P0 | NOT RUN |
| TC14 | Pricing race | Two admin browsers read same active version; first publishes; stale second rejected | P0 | NOT RUN |
| TC15 | KYC confidentiality | Admin private document preview works only while authorized; no public lasting object URL | P0 | NOT RUN |
| TC16 | Localization/UI | Check English/Bangla, large font, keyboard focus, screen reader, screen sizes | P1 | NOT RUN |
| TC17 | Hosted admin | HTTPS 200, React mount point, no-store HTML and security headers, sign-in works | P0 | NOT RUN |
| TC18 | Staging hardening | App Check staged, Cloudflare WAF configured if custom domain used, budgets, quotas and logs reviewed | P0 | NOT RUN |
| TC19 | Load test | ONLY authorized, owned isolated staging; run `tests/load/k6_staging_health.js` 5 VUs; record latency/error/cost | P1 | NOT RUN |
| TC20 | Rollback | Staging Hosting version rollback and state restoration from a verified test backup; independent Functions/rules recovery | P0 | NOT RUN |
| TC21 | Android installation | Install emulated APK on two Android devices; separate Firebase emulator vs hosted config clearly identified | P0 | NOT RUN |
| TC22 | Failure handling | Kill emulator network/disable Maps key; no fabricated trip price, misleading payment or emergency confirmation | P0 | NOT RUN |

### Security and DDoS QA

- Verify provider-level DDoS controls, Firebase Auth throttling, Firestore/RTDB/Storage security rules, identity/App Check, Cloud Functions request limits, managed WAF if custom domain, alerts, IAM separation, secret rotation and budget caps. A Cloudflare Worker never covers direct Firebase SDK endpoints.
- Use a security professional's staging scope and written authorization for vulnerability scanning. Avoid production DDoS testing.
- Record rate limiting by client, authenticated UID and origin, respecting mobile users sharing NAT IPs.
- Check that account lookup logs/audit redact phone numbers and do not store tokens.

### Scaling acceptance is measurement-based

Initial k6 script tests ONLY `/healthz`, at **5 virtual users for 60 seconds**. A healthy result cannot prove app ride-matching throughput or million-user operation. Before any larger load test, set maximum spend, owner authorization, abort criteria and a separate non-production environment. Gather p50/p95/p99; error rate; active drivers; realtime location fanout; Firestore reads/writes; cloud compute cold starts; Auth/RTDB quotas; incident rates; Cloudflare/WAF actions.

### Severity and final sign-off rule

- **P0 / Critical:** unauthorized access, duplicate trip/rental assignment, trusted pricing bypass, payment signature spoof, identity leak, incorrect SOS promise, failed rollback. **Cannot release**.
- **P1 / Major:** crash, unusable rider/driver flows, language/accessibility blockers. Requires explicit supervisor sign-off or repair.
- **P2 / Minor:** cosmetic and documentation issues. Track and defer with owner/date.
- **Gate:** All automated checks green on release SHA **AND** relevant P0 manual tests pass in staging, no unresolved Critical, owner signs off test evidence, backup and rollback verified. If credentials or devices are missing, record **BLOCKED**, not PASS.

## Staging owner checklist

1. Set up isolated Firebase/GCP **staging** project, Apps, quotas, budget caps, admin Hosting site and test-only Auth users.
2. Create GitHub `drive-staging` Environment (required reviewers/main-only), set environment variables and WIF secrets from [Phase 9 deployment guide](PHASE_9_QA_RELEASE.md). **Never paste them into chat/commits.**
3. Verify Phase 9 CI gate green for **the exact target SHA**.
4. Manually run [staging release workflow](../.github/workflows/phase9-staging-release.yml), input `STAGING ONLY`; keep its run URL.
5. Review read-only Hosting smoke test output, then manually execute and evidence TC01–TC22.
6. Fill [release sign-off template](PHASE_9_RELEASE_SIGNOFF.md). Only the project owner can approve real release.

Pending work tracked in [Phase 9 staging issue #3](https://github.com/shoraimw/CSE412_Drive/issues/3).
