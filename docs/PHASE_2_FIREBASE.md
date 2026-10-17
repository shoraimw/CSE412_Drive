# DRIVE Phase 2 — Firebase Backend: Setup, APIs, Rules and Testing

**Course:** East West University, CSE412 Software Engineering  
**Repository:** https://github.com/shoraimw/CSE412_Drive  
**Phase:** 2 of 10  
**First demonstration environment:** Bangladesh / BDT (amounts are integer paisa)  
**Cloud Functions region:** asia-south1

> This phase implements the secure backend foundation, not the entire deployed ride-hailing platform. Flutter screens, Google road routing, payment integrations, push delivery, live map UI, and ML services arrive in later phases. Do not treat the Phase 2 provisional route estimate, no-fee cancellation policy, or SOS record as a production-ready safety/payment product.

## 1. Implemented backend features

- Firebase Auth-gated callable functions; no client-created admin privileges.
- Profile creation and user-facing locale support.
- Driver registration with three uploaded documents; pending/rejected/approved admin review, custom-claim issuance and mandatory approval checks.
- Vehicle-owner registration and admin review; rental listing and approval.
- Cloud Firestore durable collections with deny-by-default security rules.
- Realtime Database geohash-indexed driver location and trip-scoped participant access.
- Cloud Storage private application documents with file size/type/access restrictions.
- Versioned, admin-published BDT fare policy; provisional quotes using server-side great-circle estimate, clearly marked non-road-route.
- Ride creation with idempotency key, one active ride per rider, candidate discovery (geohash bounding windows), ranked time-limited offers, transaction-based acceptance, trip state transitions and cancellation.
- Rental bookings with hourly lock documents and transactional conflict prevention.
- Safety incident records that do **not** claim external notifications have been sent.
- Domain unit tests, Firebase Security Rules tests, and an end-to-end emulator integration test.

## 2. Repository layout

~~~text
CSE412_Drive/
├── .firebaserc
├── .gitignore
├── firebase.json
├── package.json
├── firebase/
│   ├── firestore.rules
│   ├── firestore.indexes.json
│   ├── database.rules.json
│   └── storage.rules
├── services/
│   └── functions/
│       ├── package.json
│       ├── tsconfig.json
│       ├── src/
│       │   ├── domain.ts
│       │   └── index.ts
│       ├── tests/domain.test.cjs
│       └── scripts/
│           ├── seed-config.cjs
│           └── grant-admin.cjs
├── tests/
│   ├── firebase/
│   │   ├── firestore.test.mjs
│   │   ├── database.test.mjs
│   │   └── storage.test.mjs
│   └── integration/backend.test.mjs
└── .github/workflows/phase2-backend.yml
~~~

## 3. Prerequisites

- Node.js 22 LTS and npm.
- Java 21 or another Firebase Emulator-supported JDK.
- Git for Windows/GitHub Desktop or any Git client.
- A Firebase account and console project **only for real deployment**. The local emulator uses a special non-deployable demo project.
- Google Cloud billing: **Cloud Functions production deployment requires the Firebase Blaze plan**. Set billing budgets/alerts before enabling billable APIs.

No credit card, Google Maps API key, Stripe key, bKash key, or service-account JSON is needed to execute **local Phase 2 emulator tests**. Firebase client config values will be generated/configured in Phase 3. Map keys arrive in Phase 4; payment provider test credentials arrive in Phase 6.

## 4. Windows setup (PowerShell)

Open PowerShell in a working directory:

~~~powershell
git clone https://github.com/shoraimw/CSE412_Drive.git
cd CSE412_Drive
node --version
java -version

npm install
npm --prefix services/functions install
npm run build
npm run emulators
~~~

Keep the emulator process running. Open http://127.0.0.1:4000 to see the Emulator UI. The application is not supposed to display Flutter screens yet.

To load example pricing while the emulator is running, open a **second PowerShell terminal** in the same repository:

~~~powershell
$env:GCLOUD_PROJECT = "demo-drive-local"
$env:FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080"
node services/functions/scripts/seed-config.cjs
~~~

This creates pricing policy `demo-bdt-v1` and `appConfig/public` **in the local Firestore emulator**. The sample rates are demonstration values, not real Dhaka market prices.

## 5. Linux/macOS setup

~~~bash
git clone https://github.com/shoraimw/CSE412_Drive.git
cd CSE412_Drive
npm install
npm --prefix services/functions install
npm run build
npm run emulators
~~~

In a second terminal:

~~~bash
export GCLOUD_PROJECT=demo-drive-local
export FIRESTORE_EMULATOR_HOST=127.0.0.1:8080
node services/functions/scripts/seed-config.cjs
~~~

## 6. Run the automated tests

Install dependencies in both root and functions directories first. Then run:

~~~bash
npm run test:unit
npm run test:rules
npm run test:integration
~~~

Or use:

~~~bash
npm test
~~~

- **Unit tests:** checks great-circle distance, provisional route calculation, integer minor-unit fare arithmetic, overlapping rental slot handling, allowed ride state transitions, and matching-score ordering.
- **Firestore rules tests:** confirms a user reads only their own profile, cannot promote themselves, cannot write rides/fares, and an administrator can inspect but cannot bypass server-owned writes via a client.
- **Realtime Database rules tests:** confirms only an eligible driver-claim holder can write their own location, other people cannot read candidate locations, and only a trip participant can read a published trip position.
- **Storage rules tests:** checks private upload ownership, authorized reviewer read access, outsider denial, and invalid file type denial.
- **Integration test:** creates emulated users and admin/driver claims, publishes demo pricing, exercises user/owner approval, vehicle approval, rental overlap rejection and cancellation, fare quote, idempotent ride request, geohash offer, driver acceptance, safety record, and trip completion.

The integration test prepares its own isolated demo data, so it does **not** need the manual seed script. Firebase CLI manages emulator startup/shutdown. No production project is contacted.

Important: these tests are included as runnable code, but they require downloading npm packages and Firebase emulator binaries. Build, rules, and end-to-end status should be confirmed after running them on a configured workstation or CI; no green result is assumed until a test runner reports one.

## 7. Callable Functions API contract

Every callable below requires a Firebase Authentication ID token. For production apps use the Firebase client SDK `httpsCallable`, not a hand-written HTTP request. Names shown are deployed to `asia-south1`.

| Callable name | Input JSON example | Authorization / returned value |
|---|---|---|
| ensureProfile | `{"displayName":"Rider A","locale":"bn"}` | Signed-in user; returns UID/profileReady |
| submitDriverApplication | `{"vehicleType":"car","vehiclePlate":"DHA-1234","vehicleModel":"Sedan","documentPaths":["applications/UID/licence.jpg","applications/UID/vehicle.pdf","applications/UID/photo.jpg"]}` | Applicant; paths must exist in the private Storage bucket |
| reviewDriverApplication | `{"uid":"UID","approve":true,"reason":""}` | Admin claim only; returns status and instructs token refresh |
| submitOwnerApplication | `{"businessName":"My Fleet"}` | Signed-in user; creates pending owner application |
| reviewOwnerApplication | `{"uid":"UID","approve":true,"reason":""}` | Admin claim only; updates owner approval |
| registerRentalVehicle | `{"model":"Sedan","plate":"DHA-1234","type":"car","seatCount":4,"rentalRatePerHourMinor":8000,"area":"Dhaka"}` | Approved vehicle owner; returns vehicle ID |
| reviewRentalVehicle | `{"vehicleId":"ID","approve":true}` | Admin claim only; vehicle becomes rental-listed when approved |
| setDriverAvailability | `{"online":true}` | Approved driver; clients publish their own indexed location separately |
| publishPricingConfig | `{"version":"bdt-v2","vehicles":{"bike":{...},"car":{...},"premium":{...}}}` | Admin claim only; complete, validated per-category rate objects required |
| getFareQuote | `{"pickup":{"lat":23.7806,"lng":90.4074},"destination":{"lat":23.82,"lng":90.42},"vehicleType":"car"}` | Rider; returns quote ID, provisional route, fare, 5-minute expiry |
| requestRide | `{"quoteId":"ID","idempotencyKey":"unique-client-request-123"}` | Quote owner; creates matching ride, locks one active ride per rider |
| dispatchNearbyDrivers | `{"rideId":"ID"}` | Ride owner; queries up to 8 km, verifies status, ranks candidates, sends 45-second Firestore offers |
| respondToOffer | `{"offerId":"rideId_driverId","accept":true}` | Targeted driver; atomically claims ride and active-driver lock |
| advanceRide | `{"rideId":"ID","toStatus":"driver_arriving"}` | Assigned driver; next: `in_progress`, then `completed` |
| cancelRide | `{"rideId":"ID"}` | Rider or assigned driver; matching/accepted/arriving only, zero fee under current demo policy |
| createRentalBooking | `{"vehicleId":"ID","startAtMs":1795000000000,"endAtMs":1795003600000}` | Renter; time must be future; creates booking and hourly slot locks |
| cancelRentalBooking | `{"bookingId":"ID"}` | Renter or owner; releases booking slots before start |
| reportSafetyIncident | `{"rideId":"ID","type":"sos","note":"Help needed"}` | Participant; returns incident ID and `notified:false` |

In the callable endpoint table, substitute real UID/IDs and future timestamps; values are illustrative, not prepopulated data. The callable functions validate schema and state before writing trusted records.

### 7.1 Example provisional fare calculation

The sample BDT car policy is stored in minor units (100 paisa = 1 BDT): base 6000, per km 1600, per minute 220, and service fee 500. Actual quote amount depends on the server-estimated distance/duration; Google Routes integration in Phase 4 will replace the temporary provisional method.

### 7.2 Important transactional invariants

1. One active ride per rider using `riderActive/{uid}`.
2. One active assigned ride per driver using `driverBusy/{uid}`.
3. Quote expiry and single use; retry of an idempotency key returns the same ride ID.
4. Driver offers expire; only targeted driver accepts an unexpired offer.
5. Rental booking creates one lock for every intersected UTC hour; any occupied slot prevents overlapping confirmation.
6. Fare config is versioned. The estimate stores the version and amount used at request time.
7. Realtime Database `tripAccess/{rideId}/{uid}` and `rideDriver/{rideId}` are server-only authorization tables.
8. Admin and approval privileges are never inferred from a client-editable user profile.
9. Critical Cloud Functions write with Firebase Admin SDK, which bypasses Firestore Rules; functions must validate identity/permission themselves.

## 8. Assign the first admin account

Use Firebase Authentication to create an ordinary account first (via Firebase console for a real project, or Authentication Emulator for a local project). Do **not** include a permanent hard-coded administrator email in the source.

**Emulator PowerShell example**, after creating that emulated Auth user:

~~~powershell
$env:GCLOUD_PROJECT = "demo-drive-local"
$env:FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099"
node services/functions/scripts/grant-admin.cjs admin@example.com
~~~

For a real project, initialize Application Default Credentials with a Google account/service identity authorized for that Firebase project, set `FIREBASE_PROJECT_ID` and `DRIVE_ALLOW_ADMIN_GRANT=I_UNDERSTAND`, then run the same grant script. This is a privileged operation; validate the email and target project carefully. The person must sign out/in or refresh the ID token after the claim changes.

## 9. Firebase Console configuration for real deployment

1. Go to https://console.firebase.google.com/ and create a project for DRIVE. Do not use `demo-drive-local` as a live project ID.
2. Enable Authentication (Email/Password, Phone, Google as applicable). Add permitted app domains and Google OAuth configuration later in Phase 3.
3. Create a Cloud Firestore database and choose the region appropriate for your users.
4. Create a Realtime Database instance and choose its region; record its exact database URL.
5. Set up Cloud Storage and record the bucket name. Some newer buckets use a `.firebasestorage.app` suffix rather than `.appspot.com`.
6. Upgrade to Blaze before deploying Cloud Functions, and configure a billing budget/alert.
7. Sign in to Firebase CLI: `npx firebase-tools login`.
8. Build: `npm --prefix services/functions run build`.
9. Deploy rules/indexes first: `npx firebase-tools deploy --project YOUR_REAL_PROJECT_ID --only firestore,database,storage`.
10. Set project-specific runtime configuration before Functions deployment. Firebase supplies project configuration in its runtime; if bucket/RTDB URL are not correctly supplied, configure `FIREBASE_STORAGE_BUCKET` and `FIREBASE_DATABASE_URL` using the supported deployment environment process.
11. Deploy functions: `npx firebase-tools deploy --project YOUR_REAL_PROJECT_ID --only functions`.
12. Publish the first verified pricing version by using an admin callable or by explicitly running the guarded seed script against the correct project. Do not blindly seed demo rates in a live environment.
13. Verify Cloud Functions IAM, allowed origins, App Check enforcement for production clients, and retention policies before any external rollout.

**Real deployment is not performed in this phase.** It requires your own Firebase project, Cloud billing decision, provider configuration, credentials, and approval.

## 10. Keys, IDs, credentials and locations

| Configuration | Needed in Phase 2 local? | Needed later / notes |
|---|---|---|
| Firebase project ID | Demo ID only | Real project ID from Firebase Console before deploying |
| Firebase Authentication settings | Emulated | Provider setup in Phase 3 |
| Cloud Firestore database | Emulated | Real database location chosen at creation |
| Realtime Database URL | Emulator auto-configured | Use exact project database URL |
| Cloud Storage bucket | Emulator demo bucket | Use exact real bucket name |
| Firebase client `apiKey` / `appId` | No | Generated from project registration in Phase 3; API key is not a server secret, but restrict provider keys appropriately |
| Google Maps SDK/Places/Routes keys | No | Phase 4: separate restricted client and server keys, enable billing/required APIs |
| Stripe publishable/secret keys | No | Phase 6: test mode only, server secret stored outside Git |
| bKash/SSLCommerz credentials | No | Provider adapter integration later |
| Firebase service account private key | No | Never commit. Prefer Application Default Credentials / managed runtime identity |
| Admin custom claim | Yes for admin emulator flows | Set via guarded script on the right user/project |
| FCM credentials | No | Phase 6 notification integration |

Never commit `google-services.json`, `GoogleService-Info.plist`, private service credentials, payment secrets, or real local `.env` files.

## 11. Security and performance limitations explicitly tracked

- **Location:** Driver GPS updates are validated for basic field types/ranges/timestamp and not public. Proving a coordinate is genuine requires Phase 7 anomaly checks, and those checks still cannot guarantee authenticity.
- **Nearby matching:** Geohash queries plus true-distance filtering avoid a whole-database client scan; candidate scan/offer fan-out are bounded. For production scale, add queue workers, retries, geohash query tuning, and dispatcher scheduling.
- **Location latency:** under-2-second p95 is an acceptance target, not a measured result. Collect client-to-client measurements after mobile apps are built.
- **SOS:** Incident recording works; sending push/SMS to contacts is not yet integrated. Do not display “emergency help notified” at this stage.
- **Fare:** Route estimates are provisional, not real Google Directions ETA or a charged final amount.
- **Cancellation fees:** Zero in Phase 2; configure accurate state/time-based policies with receipts/refunds in Phase 6.
- **Rental locking:** Intentionally conservative UTC-hour slot locking prevents overlapping partial-hour bookings but may deny otherwise adjacent rentals; refine policy only after confirming interval semantics.
- **Payment state:** No actual card charge/capture/refund happens in this phase.
- **Role enforcement:** Custom driver token must be refreshed after review; backend also requires the trusted approved profile.
- **External auth/location/Storage:** Emulator tests do not constitute production penetration testing or field-device performance testing.
- **Provider/Billing:** Google/Firebase availability, region support, pricing, and terms must be checked before real deployment.

## 12. Phase 2 acceptance checklist

- [x] Firebase project config and local emulators defined
- [x] Deny-by-default Firestore rules
- [x] RTDB scoped driver and trip-location rules
- [x] Private document Storage rules
- [x] Cloud Functions in TypeScript with request validation
- [x] Admin role/driver/owner/vehicle reviews
- [x] Versioned fare policy and provisional quote
- [x] Idempotent ride request and matching offers
- [x] Transaction-protected driver acceptance
- [x] Authorized trip state changes
- [x] Transaction-protected vehicle rental slots
- [x] Unit, rules, and integration test source code
- [x] Example config and admin-claim scripts
- [ ] Run/install dependencies, execute tests, inspect CI report, configure a Firebase real project
- [ ] Real external Maps/Payments/FCM clients (intentionally later phases)

**Exit criterion:** Phase 2 source builds, emulators start, the unit/rules/integration tests pass, and the team can explain and demonstrate the server-authoritative ride and rental invariants.
