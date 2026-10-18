# DRIVE — Functional Requirements Traceability

**Baseline:** 412_Project_Requirement.pdf (submitted 6 October 2026), plus docs/PHASE_1_SRS_ARCHITECTURE.md.

This matrix prevents the project from being described as complete merely because some server functions exist. A requirement is complete only when the user workflow, backend rules, security, tests, and necessary integrations are validated.

## The 12 feature groups in the submitted PDF

| PDF order | Original requirement | Detailed SRS mapping | Current source status | Main remaining work |
|---:|---|---|---|---|
| 1 | Authentication & Security | FR-01 | **Implemented baseline / partial hardening** | Validate real Firebase configuration and device OTP/OAuth; suspicious-account detection and security review remain. |
| 2 | User Management | FR-02–FR-04 | **Partial** | Complete profile/role/admin tools; owner listing editing/photos and full admin approval UI. |
| 3 | Vehicle Rental | FR-05 | **Renter/owner UI, backend and admin approval source implemented; validation pending** | Run latest emulator tests, configure admin Firebase Web app, and smoke-test rental flows; rental payments remain in payment requirements. |
| 4 | Smart Ride Booking | FR-06 | **Implemented in source; provider validation pending** | Test with real Google Maps/Routes keys and a real Firebase project. |
| 5 | Smart Ride Match & Cost Sharing | FR-07–FR-08 | **Partial** | Nearby driver matching and offers exist; multi-passenger shared rides, capacity/detour rules and individual fare split remain. |
| 6 | Real-Time Ride Tracking | FR-09 | **Partial** | Foreground live GPS flow exists; validate physical devices, Maps config and background/battery behavior. |
| 7 | Smart Fare Prediction | FR-10 and FR-24 | **Partial** | Server-side rule-based fare quotes exist; Phase 7 experimental private ML prediction endpoints and UI preview exist; real traffic/demand, audited models, provider validation and evaluation remain. |
| 8 | AI Route Optimization | FR-11 | **Partial** | Google Routes and navigation integration exist; AI/graph optimization, route alternatives and refresh behavior need completion. Phase 7 ETA model is not route optimization. |
| 9 | Multi-Currency Payment | FR-12–FR-13 | **Partial** | Cash and Stripe TEST for completed rides are implemented in source; currency conversion, supported currency selector, rental payment and complete history remain. |
| 10 | Women Safety Mode | FR-14 | **Not implemented as a complete workflow** | Safety preferences, eligible driver preference, trusted contacts and live trip sharing. |
| 11 | Smart Emergency & Safe Trip System | FR-15 | **Partial** | SOS incident records exist; external contact/admin delivery and automatic route-deviation/long-stop detection need integration and tests. |
| 12 | Tourist Mode | FR-16 | **Not implemented** | Attractions, nearby facilities, preferences and multi-stop travel planning. |

## Cross-cutting detailed SRS requirements

| SRS ID | Requirement | Status / boundary |
|---|---|---|
| FR-17 | Cancellation and timeout handling | Basic ride/rental cancellation, expiry and server state transitions exist; comprehensive policy/no-show handling needs more tests. |
| FR-18 | In-app trip communication | Trip-participant chat source and Firestore read restrictions exist; device integration and retention policy validation remain. |
| FR-19 | Notifications | Private in-app records and best-effort FCM path exist; APNs/FCM credentials and real-device delivery are not yet verified. |
| FR-20 | Ratings, reviews, history | Ride ratings and rider/driver trip history exist; rental reviews and full unified history remain. |
| FR-21 | Driver earnings and payouts | Estimated gross from completed rides only; not net earnings, settlement or payout. |
| FR-22 | Admin operations | Phase 8 React dashboard now includes driver/owner/vehicle approvals, audited safety triage, pricing version publishing, private document review and read-only ride/rental/payment history. Refunds, disputes, suspensions and full operational staffing remain. |
| FR-23 | Admin analytics | Phase 8 shows only bounded recent samples (maximum 40 per collection) and status distribution. Whole-platform totals, data warehouse and operational BI remain. |
| FR-24 | ML and anomaly insights | Phase 7 FastAPI experimental ML source, temporal training and anomaly baseline exist; no deployed, approved real-data ML models. |
| FR-25 | Localization and accessibility | English/Bangla and themes exist; newly added rental screens include English/Bangla labels. Full accessibility review remains. |

## Phase 7 scalability and DDoS hardening boundary

The original PDF specifies scalability, security and performance but not a numerical million-user target. Phase 7 includes App Check integration (enforcement is deployment-gated), a private Cloud Run ML service, and an optional Cloudflare Worker for a custom API domain. The Worker is NOT deployed and direct Firebase SDK endpoints are NOT proxied through Cloudflare. Million-user load capability has not been validated. See [Phase 7 guide](PHASE_7_ML_SCALABILITY_SECURITY.md).

## Non-functional requirement gates

- **Performance/scalability:** do not claim p95 targets or scale until load tests have been run and results recorded.
- **Security/privacy:** Firestore rules and server-authoritative callables are present; perform emulator authorization tests and a secrets/API-key review.
- **Availability/integrity:** verify retries, idempotency and concurrency for booking, rental locks and payments.
- **Portability:** Flutter source supports Android/iOS scaffolding; a successful APK build and real-device smoke test are separate acceptance gates. iOS builds require macOS/Xcode.
- **Usability/accessibility:** check English/Bangla flows, empty/error states, large text, screen reader labels and contrast.
- **ML governance:** predictions require a baseline, versioning, evaluation and safe fallback before being called production-ready.

## Vehicle Rental acceptance checklist (current requirement)

- [x] Renter can open the rental marketplace from the rider screen.
- [x] Filter approved listings by vehicle category, area text and maximum hourly price.
- [x] Select rental start/end dates and times; client validates future start, 90-day advance limit and 72-hour maximum.
- [x] Show hourly rate and estimated total; backend independently calculates authoritative total.
- [x] Server checks owner/vehicle approval and prevents self-rental, using transaction locks to prevent overlapping bookings.
- [x] Renter can view rental bookings and cancel before the start time.
- [x] Approved owner can submit a car/bike/premium listing and see its approval status.
- [x] Owner can view bookings and cancel a future reservation.
- [x] Public listings do not expose registration/plate data.
- [x] React admin dashboard UI approves/rejects pending vehicle listings through server callable (CI and real-project smoke test still required).
- [ ] Firebase emulator integration tests for renter booking/cancellation pass on the latest commit.
- [ ] Real Firebase configuration and end-to-end device smoke test pass.

**Current work order:** finish/validate Vehicle Rental; then proceed through ride booking, shared ride/cost sharing, tracking, fare, route optimization, multi-currency payments, women safety, emergency/safe-trip, and Tourist Mode. Revisit every partial cross-cutting requirement before final release.

## Phase 8 Admin Operations

The existing React vehicle-approval foundation has been expanded into a protected admin operations dashboard with the workflows described in [Phase 8 documentation](PHASE_8_ADMIN_OPERATIONS.md). Role claims remain server-assigned, Firestore audit records cannot be client-modified, private KYC document previews use Firebase Storage rules, and safety triage records a human review without claiming emergency notification delivery. Admin analytics remain **bounded recent samples**; they are not exhaustive production metrics.
