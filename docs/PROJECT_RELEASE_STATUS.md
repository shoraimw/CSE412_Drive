# DRIVE — Project Release Status & Evidence Register

**Checked:** 18 October 2026 · **Default branch:** `main` · **Repository:** https://github.com/shoraimw/CSE412_Drive

## Executive decision

**Source + automated checks: SUCCESS. Entire ten-phase public release: NOT DONE.**

Evidence:
- [Phase 9 full CI gate — PASS on `0fcbd246`](https://github.com/shoraimw/CSE412_Drive/actions/runs/39130983258): all 7 jobs succeeded, including Flutter test/analyze/build, admin React test/build, Firebase emulator integration, Python ML tests, Cloudflare edge tests and repository safety.
- [Firebase full integration — PASS on `1ee5f50`](https://github.com/shoraimw/CSE412_Drive/actions/runs/39130460902) and later included in green Phase 9 gate.
- Non-production APK artifact `drive-phase9-emulator-demo-apk` published by run `39130983258`, artifact ID `12137254782`, 28,230,807 bytes, GitHub retention until 2026-11-01. Android local-emulator build only.
- **No completed Phase 9 Manual Staging Release workflow run found at check time.** No Firebase staging project, Cloudflare live domain/WAF, Maps keys, physical-device proof or release approval supplied.

## Ten-phase status

| Phase | Delivered and verified | Outstanding | Phase decision |
|---|---|---|---|
| 1 — SRS/architecture | Detailed SRS, data/state design and academic scope | Faculty approval | Source complete |
| 2 — Firebase backend | Unit, security rules and full emulator integration PASS | Actual staging Firebase deploy, IAM/quotas | Source/CI complete |
| 3 — Flutter base | Analyzer, widget tests, Android demo build PASS | OAuth/OTP and real-device acceptance | Source/CI complete |
| 4 — Rider | Booking/quote/map and ride state source; emulator tests PASS | Live Maps/physical route validation | Source/CI complete |
| 5 — Driver | Offers, on/offline, dispatch, GPS source, integration PASS | Two physical-device GPS/permissions validation | Source/CI complete |
| 6 — Payments/chat/FCM | Cash/Stripe TEST webhook code, messaging, alerts; unit tests PASS | Hosted Stripe sandbox and real FCM/device delivery; no live refunds | Source/CI partial integration |
| 7 — ML & Cloudflare | Experimental FastAPI tests and edge Worker tests PASS | Trained/approved model, private Cloud Run and real Cloudflare/WAF deployment | Experimental source only |
| 8 — Admin | React build, trusted approval, audited disputes/pricing, emulator tests PASS | Live staff/KYC and two-browser staging acceptance | Source/CI complete |
| 9 — QA/release | Cross-platform gate, safe staging deploy workflow, evidence/test plan, Android APK PASS | Staging deployment, device/security/load/rollback evidence and sign-off | **External acceptance blocked** |
| 10 — Final report/demo | Academic report PDF, PPTX, source docs, demo/viva, release signoff template drafted | Team identities, screenshots, actual demo rehearsal, faculty sign-off | **Submission draft ready; final approval pending** |

## Critical distinctions and blocker owners

1. **Cloud/infrastructure owner needed:** Create separate staging Firebase/GCP project and admin Hosting site; configure GitHub `drive-staging` Environment with approvers and scoped OIDC/WIF service account; add public Firebase web config and authorized Auth domains. Run manual `STAGING ONLY` release and verify HTTPS smoke test. Never send passwords or secret keys to chat. [Issue #3](https://github.com/shoraimw/CSE412_Drive/issues/3).
2. **QA team with physical phones needed:** Two Android devices, driver/rider GPS, OTP/OAuth, maps, Storage KYC, checkout TEST/FCM, multi-admin concurrency and accessibility test evidence. [22-case plan](PHASE_9_ACCEPTANCE_TEST_PLAN.md).
3. **Security/operations owner needed:** App Check enforcement, provider quotas/budget, WAF/custom domain if applicable, independent authorization checks, staging-only k6 health probe with actual latency report, backup/restore and rollback exercise.
4. **Team/faculty needed:** Confirm reduced academic demo scope or implement remaining originally requested top-level features. From [requirements matrix](REQUIREMENTS_TRACEABILITY.md): shared rider cost-splitting, real multi-currency payment, full Women Safety Mode, real trusted-contact SOS, Tourist Mode, approved real-data ML and route optimization remain unfinished. Obtain approval and sign [blank sign-off form](PHASE_9_RELEASE_SIGNOFF.md).

## Final release criteria

- [x] Full multi-language automated CI on build SHA, including Android demo APK.
- [x] Auth/rules/backend emulator test evidence, React build and bundle audit.
- [x] Local runbook, acceptance matrix, rollback plan description and draft submission files.
- [ ] Dedicated staging Firebase/Hosting actually deployed with verified secrets/quotas and a successful staging workflow run.
- [ ] Real-device, provider and browser end-to-end results recorded and approved.
- [ ] Staging WAF/App Check/quotas/backup rollback acceptance and budget-limited performance evidence.
- [ ] All outstanding functional requirements implemented **or** reduced demonstration scope approved in writing.
- [ ] Faculty and owner sign-offs.

**Do NOT label entire DRIVE project `DONE` before outstanding lines above pass or scope is explicitly accepted.**

## Downloads and current documentation

- [Final report source](PHASE_10_FINAL_REPORT.md)
- [Presentation and speaker notes source](PHASE_10_PRESENTATION.md)
- [Demo instructions + viva](PHASE_10_DEMO_VIVA.md)
- [Phase 9 QA plan](PHASE_9_ACCEPTANCE_TEST_PLAN.md)
- [Release sign-off form](PHASE_9_RELEASE_SIGNOFF.md)
- [Full requirements status](REQUIREMENTS_TRACEABILITY.md)
