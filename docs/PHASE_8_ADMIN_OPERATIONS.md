# DRIVE — Phase 8 Redo: React Operations, Account Support and Disputes

**Course:** CSE412 Software Engineering · East West University · Fall 2026
**Status:** Rebuilt Phase 8 source with account diagnostics, participant-initiated disputes, server-side audit, safer hosting and cursor pagination. Production project credentials, deployment, real Stripe refunds and end-to-end operator acceptance are separate steps.

## Phase 8 redo summary

The admin console was already present with approvals, pricing, recent activity and safety review. This redo retains those features and fills practical operations gaps instead of overwriting or bypassing existing server rules.

- **Exact account lookup:** Enter a complete Firebase UID or email. An authenticated admin-only callable checks current Firebase Auth and the associated public-profile fields. It masks phone numbers, returns no tokens/passwords, logs successful searches and limits requests to one every two seconds per administrator. No unrestricted customer export or account suspension is included.
- **Service dispute lifecycle:** Riders/drivers can create completed/cancelled ride cases, and renters/owners can create cases for confirmed/cancelled rental bookings. A deterministic service/submitter key makes case creation idempotent. Customers submit issue category and 25–1200 character text. Only the reporter and trusted administrator can read the case; browser writes are blocked.
- **Admin review:** A support case must follow open → in_review → resolved/dismissed, with a 20–800 character backend-validated rationale, expected-status guard against concurrent updates, and immutable audit event. Reviewing a dispute **never creates a Stripe refund**, changes payable fare, issues a payout, or notifies emergency services.
- **Better operations browsing:** Firestore historical tables use cursor pagination in batches of 30. Client deduplicates records when newer items arrive during paging. Overview remains a deliberately bounded 40-row per-collection sample, not global analytics.
- **Safer admin operations:** Admin callable requests refresh the Firebase ID token, rejected admin sessions can sign out and switch account, pricing cannot publish demo fallback values while active rates are unavailable, and the local Vite development server binds to localhost.
- **Release hardening:** A public web-bundle audit checks for common server secrets/keys after Vite build. Separate Hosting target configuration sets security headers and report-only CSP. ReCAPTCHA/App Check, Cloudflare and protected backend traffic require actual user-controlled accounts, domains and test projects.

### Revised admin screens

The dashboard contains **12 views**: Overview, Account lookup, Driver approvals, Owner approvals, Vehicle approvals, Ride operations, Rental operations, Payment records, Safety incidents, Service disputes, Pricing controls and Audit history.

The rider completed-trip checkout and renter/owner booking histories now have a **Report an issue** action connected to the trusted dispute callable. Customer support is an internal workflow; do not represent it as automatic financial reconciliation or safety dispatch.

### Server APIs added or hardened

| Callable | Who may call | What it changes |
|---|---|---|
| lookupAdminUser | Trusted admin claim | Audited exact Auth/account lookup; no account role mutation |
| openServiceDispute | Verified participant | Creates one private case per participant/service; no refund |
| reviewServiceDispute | Trusted admin claim | Audited status decision with optimistic concurrency |
| reviewSafetyIncident | Trusted admin claim (existing) | Internal triage only; not emergency delivery |
| reviewDriverApplication / reviewOwnerApplication / reviewRentalVehicle | Trusted admin (existing) | Trusted review and audit |
| publishPricingConfig | Trusted admin (existing) | Versioned pricing; loaded rates must be available in UI before publishing |

### Security checks

Firestore rules allow a dispute to be read only by its original reporter or a trusted admin and deny all direct writes. Audit event reads are admin-only; no client can forge them. The Firebase Auth Admin SDK is never bundled into the React application. Both front-end and Functions validation guard inputs, but Cloud Functions and Firestore rules are authoritative.

A case marked resolved means support reviewed it—not that cash, cards or rentals were refunded. Financial reconciliation/refund tools need provider-level integration, dual authorization and accounting policies. Likewise, safety incidents remain internal records until emergency notification workflows are built and tested.

## 1. Goal and requirements mapping

The submitted Group 5 requirement analysis describes Authentication & Security, User Management, Vehicle Rental, Smart Ride Booking, Matching/Cost Sharing, Live Ride Tracking, Smart Fare Prediction, AI Route Optimization, Multi-Currency Payment, Women Safety Mode, Smart Emergency/Safe Trip and Tourist Mode. The implementation SRS expands this into administrator operations (FR-22) and admin analytics (FR-23).

Phase 8 is **operations and safety triage**, not a replacement for incomplete product features. Admin personnel can review trusted records and approve onboarding, but cannot silently forge settlements, overwrite rides, or claim that an SOS was delivered to outside emergency contacts.

### 12 dashboard tabs

| Tab | Data/API | Implemented workflow | Remaining |
|---|---|---|---|
| Overview | Sampled Firestore rides/rentals/payments/incidents | Limited recent status cards and ride distribution | Whole-platform counts need BigQuery or sharded aggregation |
| Account lookup | lookupAdminUser (new) | Exact UID/email search, masked account details, auditing and rate limits | Moderation/suspension and staff review policy |
| Driver approvals | driverApplications pending | Review three private uploaded documents; approve/reject through reviewDriverApplication | Full KYC compliance policies/human training |
| Owner approvals | ownerProfiles pending | Approve/reject through reviewOwnerApplication | Broader business verification and monitoring |
| Vehicle approvals | vehicles pending | Approve/reject through reviewRentalVehicle; capture audit reason | Rich photo/ownership verification |
| Ride operations | rides | Cursor-paginated ride states, categories, quoted/final fare | Trip interventions and geo privacy workflow |
| Rental operations | rentalBookings | Cursor-paginated booking states and booked fare | Manual override policies and refunds |
| Payment records | payments | Cursor-paginated cash and Stripe TEST statuses, strictly read-only | Settlement, real refunds and payout ledger |
| Safety incidents | safetyIncidents | open → in_review → resolved/dismissed, rationales, audit | External incident response and trusted-contact delivery |
| Service disputes | serviceDisputes and callable workflow (new) | Participant submission and audited admin review | Actual refund/provider reconciliation, appeals and SLAs |
| Pricing controls | appConfig/public and pricingConfigs | Load current BDT rates, validate and publish a new version via server | Discount/tax policy, approvals/change management |
| Audit history | auditEvents | Cursor-paginated server-originated decisions | Archival/export, SIEM pipeline |

Records in the browsing and overview tabs are **bounded samples**, not whole-platform analytics. Sampling reduces Firestore reads but does not prove capacity for millions of users.

## 2. Repository structure

    apps/admin/
      src/AccountLookup.tsx          // protected exact user lookup
      src/App.tsx                    // responsive role-gated React admin workspace
      src/admin_api.ts              // bounded Firestore subscriptions, backend callables
      src/admin_domain.ts           // numeric fare validation and formatting
      src/admin_domain.test.ts      // Vitest unit tests
      src/PrivateDocuments.tsx      // private in-memory application docs
      src/firebase.ts              // Firebase Web config/emulators/optional App Check
      src/style.css                 // layout, tables, cards, responsive navigation
      .env.example
      package.json
    services/functions/src/admin_ops.ts    // audited safety/dispute decisions and account lookup
    services/functions/src/admin_policy.ts // case state transitions with unit tests
    services/functions/src/index.ts        // existing trusted driver/owner/vehicle/pricing reviews
    firebase/firestore.rules               // admin-only audit log read
    tests/firebase/firestore.test.mjs      // audit security rules
    tests/integration/backend.test.mjs     // admin review state transition cases
    firebase.admin.json                   // separate administrative Hosting target
    .github/workflows/phase7-admin.yml    // React build plus browser-bundle secret check
    docs/PHASE_8_ADMIN_OPERATIONS.md

## 3. Architecture and security

### Administrator authentication

1. Admin logs in with an existing Firebase Authentication account.
2. Client requests a refreshed Firebase ID token and checks trusted admin=true custom claim.
3. All admin Firestore reads still require server-enforced Firestore admin rules, regardless of client UI.
4. All approvals, rate publishing, and incident changes use Cloud Functions callables which check admin claim again. The frontend NEVER sets admin claims or directly writes prices/ride/payments.
5. Login/UI does not elevate ordinary rider/driver users.
6. For production Web App Check rollout, configure the public reCAPTCHA Enterprise site key for an enrolled Firebase Web app.

**Server-only writes**: driver/owner/vehicle status, pricing versions, safety status, audit events, cash and Stripe payment records, and trip assignments.

**Audit**: existing driver/owner review and pricing functions create auditEvents. Phase 8 adds audit for vehicle approval and safety case review. Audit Firestore rules allow admin reads but deny all client writes, including admin client writes.

### Human safety decisions

The reportSafetyIncident caller currently stores a case but does **not** send an emergency alert to police or a trusted contact. Admin case review must NOT claim that such an alert occurred.

Allowed workflow:

    open --> in_review --> resolved
                       --> dismissed

Every admin change requires a 10–400-character reason in the React UI; the backend independently validates note length 10–800, enforces transition order and compares expectedStatus in a transaction. Conflicting or stale decisions are rejected. Each successful change writes an audit record with actor UID and server time.

### Private driver documents

The driver application contains three Storage paths under applications/{uid}/. A legitimate administrator uses the Firebase Storage SDK to fetch image or PDF bytes under the existing Storage security rules; unauthorized users cannot read these objects.

- Images JPEG, PNG and WebP: loaded as short-lived browser blob URLs, displayed only after clicking Document N.
- PDFs: explicit local download link for authorized review, not a permanent publicly accessible URL.
- The reviewer does not use Firebase Storage token-bearing getDownloadURL links.
- The browser releases each temporary blob URL when closed or unmounted.
- **KYC file immutability (redo):** new applicant files receive unique UUID-based Storage object paths. Storage rules permit create but reject overwrite/update by any client, including an applicant, so previously reviewed evidence cannot be silently replaced. Rejected applicants upload new files on their next submission. Old files still need an explicit retention/cleanup schedule.
- Firebase Web config must supply VITE_FIREBASE_STORAGE_BUCKET; production Storage getBlob may require bucket CORS configuration.
- Existing upload validation caps file size. In the long-term, add malware scanning, photo redaction, document review retention and staff access logs.

**Privacy caution**: authorized downloads are sensitive and must follow policy. The browser UI is not a full records-retention/KYC compliance system.

## 4. Windows local setup

Install Node.js 22, Git, Java 21, Firebase Emulator Suite and current npm. Keep the existing repo; don't clone over local changes.

First terminal, root of repo:

~~~powershell
cd CSE412_Drive
git pull origin main
npm install
npm --prefix services/functions install
npm run build
npm run emulators
~~~

Second terminal (web dashboard):

~~~powershell
cd CSE412_Drive\apps\admin
npm install
Copy-Item .env.example .env.local
notepad .env.local
npm test
npm run build
npm run dev
~~~

Open the local Vite URL (usually http://localhost:5173). Run it only on your localhost during emulator testing.

### Local .env.local example (emulator use only)

~~~text
VITE_FIREBASE_API_KEY=demo-key
VITE_FIREBASE_AUTH_DOMAIN=demo-drive-local.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=demo-drive-local
VITE_FIREBASE_APP_ID=1:123456789:web:demo
VITE_FIREBASE_STORAGE_BUCKET=demo-drive-local.firebasestorage.app
VITE_FIREBASE_USE_EMULATORS=true
VITE_RECAPTCHA_ENTERPRISE_SITE_KEY=
~~~

The values above are **illustrative Firebase client settings**, not live credentials. You may need to register the matching web app config in Firebase Console for production; no service account keys or payment-provider secrets belong in these VITE_ variables.

Only localhost and 127.0.0.1 are permitted by the code's emulator toggle. If you serve the bundle publicly, ensure VITE_FIREBASE_USE_EMULATORS=false.

### Create an admin account safely in the emulator

1. Create/sign up a test user in the Auth Emulator (via a test login flow or the Firebase Emulator UI).
2. In a separate PowerShell, at repo root, set the emulator and project variables:

~~~powershell
$env:GCLOUD_PROJECT = "demo-drive-local"
$env:FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099"
node services/functions/scripts/grant-admin.cjs existing-admin@example.test
~~~

3. Sign out/in again to refresh the custom ID token.
4. Sign into the React dashboard with this pre-existing test account.

The grant-admin script blocks live admin elevation unless an explicitly reviewed override is set. Never expose that script to the web frontend or to unauthenticated users.

## 5. Connect a REAL Firebase project

For a staging deployment:

1. Register a Firebase Web app and enable supported Auth providers.
2. Configure project Firebase Hosting, Firestore, Cloud Functions, and Storage.
3. Deploy the latest backend callables and **reviewed rules** before exposing the dashboard.
4. Use the project's public Firebase Web config in apps/admin/.env.local; remove VITE_FIREBASE_USE_EMULATORS=true.
5. Configure VITE_RECAPTCHA_ENTERPRISE_SITE_KEY only after registering the Web app with reCAPTCHA Enterprise / Firebase App Check. Validate token issuance before enforcing App Check on Firestore/Storage/Functions.
6. Have an authorized project administrator issue and rotate trusted admin custom claims using a secure, audited operational process.
7. Host admin at a restricted domain with Cloudflare WAF, MFA policy, access controls and restricted origin. Phase 7 Cloudflare Worker does not protect direct Firestore SDK requests; configure App Check, Firestore/Storage rules and Firebase project quotas separately.
8. Do not host your public web admin with an accessible backend service-account key.

**Cloudflare**: You can put the admin *static website/domain* behind your own Cloudflare zone. Use strict TLS, WAF, rate-limit login HTTP endpoints if routed through your custom edge, and a separate SSO/Zero Trust access control where appropriate. Direct Firebase Auth/Firestore/Storage continue to reach Google independently.

## 6. How to use each workflow

### Drivers

- Go to Driver approvals and open the documents for the selected pending application.
- Complete manual verification according to your agreed KYC policy.
- Press Approve or Reject; enter a factual review rationale; confirm.
- The Cloud Function updates application + driver profile in a Firestore transaction, audits it, and sets a server-issued custom driver claim.
- The driver refreshes their ID token for the Driver app tab to become accessible.

### Owners and vehicles

- Owner application approvals update ownerProfiles via an admin-only callable.
- Vehicles are approved separately; only approved and rentalEnabled records become available to the renter marketplace.
- Vehicle registration/plate details are not exposed in public listing cards.
- A rejected vehicle listing cannot be manually edited into approval by its owner.

### Pricing

- Pricing controls load the active server BDT pricing plan via appConfig/public and pricingConfigs/version.
- Enter baseMinor, perKmMinor, perMinuteMinor, minMinor, serviceFeeMinor, surgeMultiplier and surgeCap separately for bike/car/premium.
- All money fields are BDT minor units (BDT × 100). Typed validation rejects negative/noninteger values and surge multiplier above cap.
- Enter a unique 4–48-character version ID. Type PUBLISH followed by the exact version to confirm.
- publishPricingConfig writes a new immutable version, switches appConfig/public activePricingVersion and retires the old active version in one transaction with an audit entry.
- Existing accepted ride quotes are not silently recalculated.

### Operations and finance

- View last 60 ride/rental records, recent payment methods and recorded payment statuses.
- No client-side action can force paid_test, report income as verified, cancel a live ride, issue a refund or mutate a rental lock.
- Cash receipt is a driver declaration, not independently verified.
- Stripe TEST payments are for demonstration, not real funds. Full refund/dispute/commission and payouts require a separate regulated implementation.

### Safety cases and audit

- A case in open state can only be moved to in_review.
- From in_review, a reviewer may mark resolved or dismissed with a note.
- Never claim an emergency contact was notified. The storage field alertDeliveryStatus remains not_configured until a real verified delivery provider and consent workflow are built.
- Audit History shows most recent server-originated events, bounded at 60 records.

## 7. Functional coverage and remaining gaps

Phase 8 improves requirement group 2 (User Management), group 3 (Vehicle Rental administration), and operational aspects of requirements 10 and 11 (Women Safety and incident oversight), plus SRS FR-22/FR-23.

**Scope limitations intentionally preserved**:
- FR-22: complete refund operations, payment disputes, account suspensions, full staffed moderation and verification policy not implemented.
- FR-23: Overview counts are last 40 records per collection, NOT totals. No BigQuery/warehouse or distributed aggregate counters yet.
- Safety: incident records/review are NOT emergency dispatch.
- Full multi-currency, shared-passenger cost splitting, tourist travel plans and production AI route optimization remain unfinished.
- Cloudflare/API rate limits from Phase 7 are not deployed without your domain and settings.
- No production claim of million users or DDoS immunity is appropriate until measured and reviewed.

## 8. CI, tests and acceptance

Frontend (Windows):

~~~powershell
cd CSE412_Driveappsadmin
npm install
npm test
npm run build
~~~

Backend (root):

~~~powershell
cd CSE412_Drive
npm --prefix services/functions run build
npm run test:unit
npm run test:rules
npm run test:integration
~~~

Security acceptance scenarios:

| ID | Scenario | Expected |
|---|---|---|
| A8-01 | Non-admin logs in | Signed out, cannot access any admin collections |
| A8-02 | Admin reads pending driver docs | Allowed only under trusted Storage admin claim |
| A8-03 | Rider tries reading admin auditEvents | Denied by rules |
| A8-04 | Admin client directly writes audit event | Denied |
| A8-05 | Driver approval with valid rationale | Server validates; profile/claim updated; audit recorded |
| A8-06 | Owner approval | Status changed server-side |
| A8-07 | Vehicle approval | Trusted callable updates vehicle and audit; rejects stale duplicates |
| A8-08 | Safety case open → resolved directly | Denied |
| A8-09 | Safety case open → in_review → resolved | Allowed, audited |
| A8-10 | Safety case stale second review | Denied |
| A8-11 | Pricing version invalid | Client and server reject |
| A8-12 | Pricing version existing | Server rejects |
| A8-13 | Payment admin view | Read-only; no actions to fake settled balance |
| A8-14 | Recent metrics | Clearly labeled sample, never platform totals |
| A8-15 | React responsive navigation and keyboard buttons | Manual accessibility and mobile layout review |
| A8-16 | Emulator vs production environment | No emulator calls from deployed public website |

Automated unit tests cover domain pricing validation, formatting and sampled status aggregation. Firebase rules/integration test additions cover audit authorization and safety-case backend transitions. Web build/CI is independent of the larger Firebase emulator suite; do not claim emulator tests passed until the entire run is green.

## Rebuilt admin Hosting deployment (staging first)

Do NOT replace the public payment-success Hosting deployment. This project has a separate *optional* Firebase Hosting configuration at `firebase.admin.json`; its `drive-admin` target must point to a Hosting site you own. It is **not** deployed automatically.

```powershell
cd CSE412_Drive
git pull origin main
npm --prefix apps/admin install
npm --prefix apps/admin run build
npm --prefix apps/admin run audit:bundle

npx firebase-tools login
npx firebase-tools hosting:sites:create YOUR_ADMIN_SITE_ID --project YOUR_PROJECT_ID
npx firebase-tools target:apply hosting drive-admin YOUR_ADMIN_SITE_ID --project YOUR_PROJECT_ID
npx firebase-tools deploy --config firebase.admin.json --only hosting:drive-admin --project YOUR_PROJECT_ID
```

Ensure your Admin Web Firebase app uses only public Firebase Web API configuration, a properly registered App Check reCAPTCHA Enterprise site key and a **trusted admin:true claim** granted from secure server-side administrator tooling. Keep service accounts, payment gateway secrets and webhook signing secrets out of the browser and environment files. The bundle scanner detects common secret patterns but is not a substitute for manual code review or secret-scanning pipelines.

Security headers include nosniff, DENY framing, no-referrer, no device permissions, no-store for HTML and a **report-only CSP**. CSP is not enforced until its production Auth, reCAPTCHA, Storage and Cloud Functions cross-origin requests have been evaluated. On an external Cloudflare-proxied custom admin hostname, enable WAF, managed DDoS protection, per-session bot rules and origin controls; direct Firebase SDK traffic remains outside Cloudflare's protection and requires App Check and Firebase security rules.

### Local admin access

Use a separate verified Firebase Auth account and grant admin custom claim from trusted development/backend scripts. For local Auth Emulator only (after account creation):

```powershell
$env:GCLOUD_PROJECT="demo-drive-local"
$env:FIREBASE_AUTH_EMULATOR_HOST="127.0.0.1:9099"
node services/functions/scripts/grant-admin.cjs existing-admin@example.test
```

Refresh the admin ID token or sign out/in after claim creation. Never grant a live administrator role from a browser or a production client app. Before real deployment, require stronger staff authentication and documented role separation/incident review policy.

## 9. Phase completion checklist

- [x] React dashboard with 12 operational tabs
- [x] Exact user lookup with trusted claims, rate limits and an audit record
- [x] Participant-submitted ride/rental disputes and audited admin review
- [x] Cursor pagination for operational records and duplicate suppression
- [x] Separate admin Hosting target and browser bundle secret-pattern audit
- [x] Trusted admin login and protected data reads
- [x] Driver, owner and vehicle approval workflows
- [x] Private document review with no durable token URLs
- [x] Safety triage callable, optimistic concurrency and audit
- [x] Versioned BDT pricing editing and strict confirmation
- [x] Read-only ride, rental, payment and audit views
- [x] Recent sampled analytics, explicitly not total platform data
- [x] Firebase local emulator and App Check web configuration switches
- [x] Unit tests, build workflow, backend and rules test sources
- [ ] Live staging Firebase, Storage CORS and private-document review validation
- [ ] Firebase emulator suite passing CI with new security tests
- [ ] Whole-platform analytics warehouse and distributed aggregate counters
- [ ] Real provider refunds, payout ledger, dispute financial resolution, 24/7 emergency response
- [ ] Security review, multi-admin separation of duties, audit retention and scale testing

**Next phase:** Phase 9 — systematic QA, tests, deployment automation and production-readiness preparation. Phase 9 is not started until the user says next.
