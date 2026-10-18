# DRIVE — Phase 9: Integration QA, release gates and staging deployment

**Project:** CSE412 DRIVE ride-hailing and rental platform. **Status:** Phase 9 automation/source is implemented; staging deployment and real-device acceptance require team-controlled infrastructure. This is NOT proof of production readiness.

## 1. Handoff from Phase 8

The Phase 8 feature source includes 12 React admin views, private driver/vehicle documentation, account lookup, disputes and triage, controlled versioned pricing, security rules and an audit log. Existing admin web build, bundle scan, backend TypeScript build, focused support policy tests and focused Firebase rules jobs have passed. The full Phase 8 Firebase emulator suite **passed** on 18 Oct 2026 ([backend CI](https://github.com/shoraimw/CSE412_Drive/actions/runs/39129170751)), alongside the [green cross-platform quality gate](https://github.com/shoraimw/CSE412_Drive/actions/runs/39129170587). The prior cancelled/failed runs are not counted as passes. Remaining live staging/manual acceptance is tracked in [issue #1](https://github.com/shoraimw/CSE412_Drive/issues/1).

Refund payouts, account suspensions, chargebacks, real-world SOS delivery and whole-platform analytics are **separately unimplemented product capabilities**, not disguised as completed Phase 8 workflows.

## 2. Phase 9 delivery now in Git

- `.github/workflows/phase9-quality-gate.yml` runs repository safety, React unit/build/audit, complete Firebase backend emulator suite, Flutter analyze/tests, ML pytest and Cloudflare Worker security tests. An always-running gate fails if **any** dependency is failed, cancelled or skipped.
- `tests/qa/staging_policy.mjs` refuses production, generic and demo deployment targets and insists on explicit approval.
- `tests/qa/scan_tracked_secrets.mjs` checks tracked filenames and common real-secret formats; this is only one defense layer.
- `.github/workflows/phase9-staging-release.yml` offers **manual, staging-only** GCP Workload Identity deployment behind a GitHub Environment, requires a passing full quality gate on the same commit, and smoke-tests only the team's configured staging admin Hosting site after publishing.
- Phase 8 emulator scenarios cover non-admin denial, two-admin dispute ownership, immutable audit events, closure and stale simultaneous pricing publication.

Running these workflows does not deploy Firebase/Cloudflare automatically or make current credentials magically available.

## 3. QA requirements-to-test matrix

| System / PDF requirement | Automated test gate | Manual sign-off still required |
|---|---|---|
| Login / roles / onboarding | Flutter tests; Firebase Auth + rules/emulator integration | Email, Google OAuth and phone OTP on real Android/iOS |
| Rider quote, booking and state | Backend integration tests + Flutter analyze | Real Maps API route, map, fare quote, cancellation, location |
| Driver dispatch, offer, live tracking | Backend integration + RTDB rules | Two real devices, GPS permissions, stale background location |
| Vehicle listing and rental overlap | Backend transaction/integration tests | Owner, renter and admin screens; date/time-zone and dispute UX |
| Stripe TEST and cash | Webhook signature unit tests; cash state integration | End-to-end Stripe sandbox checkout/webhook/refund policy |
| Disputes, audit and case access | Phase 8 two-admin backend tests; Firestore rules | KYC privacy, case ownership, staff process, accessibility |
| Admin pricing and concurrency | Domain tests; emulator stale-write tests | Two browser sessions publishing simultaneously |
| ML model API | Python unit/API/training tests | Consented historic data, bias/drift evaluation, model approval |
| Cloudflare / DDoS resilience | Worker unit tests; safe k6 staging health probe | Domain/WAF/quotas/App Check/load measurements and pen-test |
| Women Safety, emergency, Tourist, shared rides | Current partial/not implemented | Not eligible for complete-product sign-off yet |

A passed gate proves only the specific checks executed, not every user journey or traffic capacity.

## 4. Continuous integration

The [Phase 9 quality gate](../.github/workflows/phase9-quality-gate.yml) runs on push to main, pull request or manual dispatch. Each job has least-privilege `contents: read` access and does not need cloud credentials.

**Local Windows PowerShell**

```powershell
git pull origin main
node --test tests/qa/*.test.mjs
node tests/qa/scan_tracked_secrets.mjs
npm install
npm --prefix services/functions install
npm test
cd apps/admin
npm install
npm test
npm run build
npm run audit:bundle
```

Flutter: see `apps/mobile/README.md` and Phase 3 instructions. ML/edge: see `services/ml/README.md` and `infra/cloudflare/README.md`.

Fail the gate on any failed, cancelled, timed-out or skipped dependency. Keep GitHub Actions logs and commit SHA as evidence. Build/artifact success is not staging acceptance.

## 5. Manual STAGING deploy only (not production)

1. Create a **separate billing-limited Firebase/GCP project and admin Hosting site** with names containing `staging` or `stg` (e.g. `drive-staging-bd` and `drive-staging-admin`). A production project is explicitly rejected.
2. In GitHub, create Environment `drive-staging` with required reviewers. Restrict to `main` and configure isolated credentials/permissions. A GitHub Environment with no required reviewers does not itself provide manual approval.
3. Set environment variables: `DRIVE_STAGING_APPROVED=true`, `DRIVE_STAGING_PROJECT_ID`, `DRIVE_STAGING_ADMIN_SITE_ID`, `DRIVE_STAGING_FIREBASE_API_KEY`, `DRIVE_STAGING_FIREBASE_AUTH_DOMAIN`, `DRIVE_STAGING_FIREBASE_APP_ID`, `DRIVE_STAGING_STORAGE_BUCKET`, optional `DRIVE_STAGING_RECAPTCHA_SITE_KEY`. Web app config is client-public, but avoid mixing it with service account keys.
4. Set environment secrets `DRIVE_STAGING_WIF_PROVIDER` and `DRIVE_STAGING_DEPLOYER_SA`. Configure Google Workload Identity Federation to trust ONLY this repository, branch and environment; give that service account the **minimum reviewed staging permissions**.
5. Confirm the **Phase 9 Quality Gate** has passed for the exact Git commit on main. Manually dispatch **Phase 9 Manual Staging Release** on main. Enter exactly `STAGING ONLY`. The job validates destinations, checks CI status before authenticating, deploys backend/rules, builds/admin-bundle-audits, publishes the separate admin Hosting site, then checks the public staging HTML and security headers. It does **not** ship live Stripe keys or deploy Cloudflare Worker.
6. Run Phase 8 [acceptance checklist](PHASE_8_ADMIN_OPERATIONS.md) with two admin accounts plus rider, driver, renter and owner test accounts. Capture approval, private Storage preview, denied unauthorized requests, audit, pricing race and error cases.

**Important:** Staging deployment requires environment setup and owner permissions; these cannot be simulated as success from source code. If your organisation cannot set Workload Identity/GitHub Environment controls, keep deployment disabled and run the emulator locally.

## 6. Reliability, security and rollback

- Keep production secrets, service account JSON and Stripe signing secrets out of GitHub source and web bundles; use managed secret storage and rotate on exposure.
- Check App Check and role claims at backend boundaries; direct Firebase Auth/Firestore traffic is not routed via the optional Cloudflare Worker. No service can promise DDoS immunity.
- Observe p50/p95/p99 latency, errors, Firebase reads/writes, concurrency, cost, geolocation write rate and WAF blocks. Set budget alerts and log-retention/redaction policy before load testing.
- Use only the included **staging-only, five-user k6 health test** for initial connectivity. Never test a third-party/production host or claim that this probes matching throughput or one million simultaneous users.
- Keep changes reversible: version and commit all backend/Hosting config, retain approved prior Hosting releases, review Firestore rules migrations, and restore from verified backups where needed. Functions/stateful data migrations are not automatically rolled back by redeploying old client code.
- Payment disputes, refunds and SOS **must not** invoke financial or emergency systems until separately implemented, authorized, signed off and tested.

## 7. Phase 9 exit gate

- [x] Central multi-surface CI quality-gate configuration authored
- [x] Offline staging guard and tests authored
- [x] Tracked-secret scanning baseline authored
- [x] Manual staging-only deploy pipeline authored
- [x] QA coverage matrix and Windows commands documented
- [x] Full CI quality gate green for Phase 8 handoff — [run 39129170587](https://github.com/shoraimw/CSE412_Drive/actions/runs/39129170587); new revisions must pass again
- [x] Full Phase 8 Firebase integration/emulator checks green — [run 39129170751](https://github.com/shoraimw/CSE412_Drive/actions/runs/39129170751)
- [ ] Firebase staging project configured, deployed and signed off by team
- [ ] Real two-device and admin role/access acceptance passed
- [ ] Security/WAF/App Check/quotas reviewed and tested
- [ ] Load evidence and rollback exercise documented
- [ ] Unfinished product requirements from traceability matrix delivered or explicitly excluded from final demo

Phase 9 is now in progress. **Do not conflate source-complete Phase 8 with production deployment or a fully implemented 12-feature product.**

## 8. Post-deploy smoke evidence

The staging workflow now runs `tests/qa/smoke_staging_admin.mjs` against the **exact configured** `https://<DRIVE_STAGING_ADMIN_SITE_ID>.web.app/` origin only. It forbids redirects, requires HTTP 200/HTML, verifies the React mount point, DENY framing, nosniff, no-referrer and report-only CSP. This detects missing static artifacts and missing response headers, but **not** Firebase login, KYC access or trip behavior. Those remain explicit human-approved acceptance tasks.

Run the pure, offline smoke policy tests using:

```powershell
node --test tests/qa/*.test.mjs
```
