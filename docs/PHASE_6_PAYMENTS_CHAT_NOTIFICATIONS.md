# DRIVE — Phase 6: Payments, Chat, FCM Notifications, Receipts and Ratings

CSE412 Software Development · East West University · Academic demonstration
Repository: https://github.com/shoraimw/CSE412_Drive

## 1. Functional scope

This phase extends completed rider/driver trips from Phases 4–5 with:

- One-time cash payment selection on a **completed** ride, and driver-reported cash received. A report is **not** externally verified or reconciled.
- Stripe **TEST MODE ONLY** PaymentIntent creation from a **server-trusted** fare; Flutter PaymentSheet for payment entry; signed Stripe webhooks for authenticated test-payment status.
- One-on-one trip chat while the trip is assigned and active. Send messages through a Cloud Function with validated text, participant check and client idempotency UUID. Only participants/admin can view the message collection through Firestore rules.
- Private in-app notification feed for offers, ride state changes and trip chat. When configured on real devices, best-effort Firebase Cloud Messaging. Flutter Messaging v17 uses Firebase Installation IDs (FID); no legacy getToken call is required.
- Post-trip rating 1–5 and optional comment, once per participant per completed ride.
- A summary/receipt screen showing the recorded server fare and a clearly labeled payment status. No tax-compliant receipt PDF is asserted.
- Rider completed-trip history and driver completed-trip payment/rating access.
- Payment read access for both rider and assigned driver, with client writes forbidden.
- TypeScript build tests, Firebase rules/integration test code, Flutter analyzer/widget tests, and native Android Stripe configuration.

**Not provided or claimed:** live-card charging, withdrawal/payouts, tax invoices, refunds, SMS delivery, end-to-end encrypted messaging, guaranteed FCM push receipt, live Stripe merchant BDT compatibility, fully connected bKash/SSLCommerz, or reconciliation of cash. Those require merchant accounts/provider approvals, external setup and further production work.

## 2. Repository files

~~~text
services/functions/
  src/index.ts
  src/payments.ts
  src/engagement.ts
  package.json
apps/mobile/
  pubspec.yaml
  lib/core/config/firebase_bootstrap.dart
  lib/core/providers.dart
  lib/features/home/presentation/home_screen.dart
  lib/features/rider/presentation/rider_home_screen.dart
  lib/features/rider/presentation/trip_tracking_screen.dart
  lib/features/driver/presentation/driver_screen.dart
  lib/features/trip_services/
    data/trip_services_repository.dart
    presentation/trip_chat_screen.dart
    presentation/trip_checkout_screen.dart
    presentation/notifications_screen.dart
  tool/configure_phase6.dart
firebase/
  firestore.rules
  firestore.indexes.json
tests/
  firebase/firestore.test.mjs
  integration/backend.test.mjs
.github/workflows/phase3-flutter.yml
docs/PHASE_6_PAYMENTS_CHAT_NOTIFICATIONS.md
~~~

## 3. Phase 6 data flow

~~~mermaid
sequenceDiagram
  autonumber
  actor Rider
  participant Mobile as Flutter App
  participant FN as Cloud Functions
  participant FS as Firestore
  participant Stripe as Stripe Test API
  participant Driver as Driver App

  Rider->>Mobile: Open a completed trip
  Mobile->>FS: Listen payments/rideId
  alt Cash
    Rider->>FN: chooseCashForRide(rideId)
    FN->>FS: Verify completed ride, create cash_due
    Driver->>FN: reportCashReceived(rideId)
    FN->>FS: cash_reported_received (unverified)
  else Stripe test
    Rider->>FN: prepareStripeTestPayment(rideId)
    FN->>FS: Reserve server fare, test method
    FN->>Stripe: Create test PaymentIntent with idempotency
    FN-->>Mobile: clientSecret (never persisted in Firestore)
    Mobile->>Stripe: Stripe PaymentSheet
    Stripe->>FN: Signed payment_intent.succeeded webhook
    FN->>FS: Validate intent, amount, currency, payer and event ID
    FN->>FS: Write paid_test and verifiedAt
    FS-->>Mobile: Updated payment status
  end
  Rider->>FN: rateCompletedRide (1–5)
  FN->>FS: One immutable rating per author and completed ride
~~~

### Payment collection

Collection payments/{rideId} is server-owned.

| Field | Meaning |
|---|---|
| rideId | Same ID as the trusted completed ride |
| payerId | Rider UID from the ride, not arbitrary user input |
| driverId | Assigned driver UID |
| method | cash or stripe_test |
| amountMinor | Integer BDT paisa from stored finalFare |
| currency | BDT |
| status | cash_due, cash_reported_received, initializing, requires_payment, processing, payment_failed, or paid_test |
| externalVerified | False for cash; true only for successful, verified Stripe TEST webhook |
| stripeIntentId | Server-set Stripe PaymentIntent ID; not a secret |
| createdAt/updatedAt | Server timestamps |

The server rejects payment choice until the ride status is completed. It also prevents swapping payment methods after a payment record is created. Stripe uses a payment-intent idempotency key derived from the ride ID. No live Stripe secret is accepted; the server key must begin with sk_test_ and the Flutter publishable key with pk_test_.

**Stripe PaymentSheet completion is not proof of payment.** The mobile app waits for payments/{rideId} to show paid_test after a verified signed webhook. The webhook rejects invalid signatures and mismatched intent/amount/payer/currency and de-duplicates processed event IDs.

A Stripe PaymentIntent may be unavailable for BDT on your particular merchant account or payment methods. Do not assume country/currency or account activation support. A test-mode merchant account supporting the configured presentment currency is required to validate this path.

## 4. Required configuration

### Step A — Create a Stripe test account

Use https://dashboard.stripe.com/test and confirm the merchant account supports BDT in test mode. Obtain:

- Publishable key pk_test_... — ONLY the Flutter app, not a server secret.
- Secret key sk_test_... — Firebase Secret Manager ONLY.
- Webhook signing secret whsec_... — Firebase Secret Manager ONLY.

The existing account's normal Firebase/Google Maps setup is still required for running the whole ride-hailing app. Do **not** put a sk_test secret, webhook secret or real service-account key inside Flutter, Git, dart-defines or a user-visible chat.

### Step B — Secure Cloud Functions secrets

In your project root PowerShell, authenticate Firebase CLI and set the two secrets interactively:

~~~powershell
cd CSE412_Drive
npx firebase-tools login
npx firebase-tools functions:secrets:set STRIPE_TEST_SECRET_KEY --project YOUR_FIREBASE_PROJECT_ID
npx firebase-tools functions:secrets:set STRIPE_TEST_WEBHOOK_SECRET --project YOUR_FIREBASE_PROJECT_ID
npx firebase-tools deploy --only functions,firestore --project YOUR_FIREBASE_PROJECT_ID
~~~

Cloud Functions production deployment requires Blaze billing. Stripe webhooks also require an HTTPS endpoint reachable by Stripe, not a local private emulator URL.

Register the public endpoint for the function stripeTestWebhook in Stripe Dashboard, e.g. your deployed Cloud Functions URL for region asia-south1. Subscribe only to:

~~~text
payment_intent.succeeded
payment_intent.payment_failed
~~~

Use the exact URL shown by your Firebase deployment, not a guessed hostname. A Stripe CLI forwarding session for local development may show a *different* whsec value than a Dashboard webhook; use the secret matching the actual sender.

### Step C — Local Firebase emulators

You can demonstrate **cash**, trip chat, ratings and in-app notification records without Stripe, Google or FCM production keys.

In PowerShell terminal 1:

~~~powershell
cd CSE412_Drive
git pull origin main
npm install
npm --prefix services/functions install
npm run build
npm run emulators
~~~

For optional local Stripe TEST payment testing, add the two test secrets to your ignored services/functions/.secret.local file, one value per line:

~~~text
STRIPE_TEST_SECRET_KEY=your-own-sk_test-key
STRIPE_TEST_WEBHOOK_SECRET=your-own-whsec-key
~~~

For a local webhook, use the Stripe CLI (installed and authenticated separately):

~~~powershell
stripe listen --events payment_intent.succeeded,payment_intent.payment_failed --forward-to http://127.0.0.1:5001/demo-drive-local/asia-south1/stripeTestWebhook
~~~

The Stripe CLI prints a webhook signing secret. Put its current whsec value into the emulator's .secret.local configuration and restart Firebase emulators if necessary. Do not claim Stripe TEST payment success if the webhook has not updated Firestore.

### Step D — Flutter setup

In a separate PowerShell terminal:

~~~powershell
cd CSE412_Drive\apps\mobile
flutter create --project-name drive_mobile --org com.drive.cse412 --platforms=android,ios .
flutter pub get
flutter gen-l10n
dart run tool/configure_driver_permissions.dart
dart run tool/configure_phase6.dart
flutter analyze
flutter test
flutter run --dart-define=DRIVE_EMULATOR=true
~~~

The native Phase 6 configurator changes Android MainActivity to FlutterFragmentActivity, selects an AppCompat parent for Flutter Android styles, adds Android POST_NOTIFICATIONS permission, and writes Stripe shrinker rules to proguard-rules.pro. It does not write or generate real API keys.

For live Firebase + Stripe TEST only, add the additional key to your locally ignored apps/mobile/config/firebase.local.json:

~~~json
{
  "STRIPE_TEST_PUBLISHABLE_KEY": "your-own-pk_test-key"
}
~~~

Merge this new key with the existing Firebase config object from Phase 3. This is an illustrative partial JSON fragment; do not replace the full Firebase config with only this field. Run:

~~~powershell
flutter run --dart-define-from-file=config/firebase.local.json
~~~

The app rejects pk_live_ keys by design. Never enable live Stripe mode as part of the university demonstration.

### Native requirements

- Android: Gradle plugin 8+, Kotlin 1.8+, FlutterFragmentActivity, AppCompat theme; build and re-install the native app after changes. Review Stripe's Android minSdk (>=21) and the currently installed Google Maps/Firebase SDK minimums.
- iOS: Mac + Xcode/CocoaPods. Configure an iOS deployment target supported by all plugins and the existing Maps integration (recommend >=15). Add Firebase APNs key and enable Xcode Push Notifications capability and required entitlements for push delivery.
- Android 13+: allow runtime notification permission.
- Firebase Messaging 17 registers and emits a Firebase Installation ID (FID) through the onRegistered stream. This identifier is stored server-side only for authorized device delivery and can be unregistered on sign-out.
- Firebase Cloud Messaging is deliberately bypassed in Firebase Emulator mode. In-app notifications still appear in Firestore if notification triggers fire, with pushStatus indicating emulator_not_sent.

## 5. API contract and permissions

| Callable / trigger | Input and permission |
|---|---|
| sendRideMessage | Auth participant of an active assigned trip, rideId + text (1–1000 chars) + UUID |
| rateCompletedRide | Auth participant of completed ride; one rating per author; 1–5 stars and optional comment max 500 |
| chooseCashForRide | Rider of completed ride; one payment record per ride |
| reportCashReceived | Assigned driver for cash_due; records a driver attestation only |
| prepareStripeTestPayment | Rider of completed ride; server calculates trusted amount; secret only bound to function |
| stripeTestWebhook | Raw signed Stripe webhook, event deduplication, intent/amount/currency/payer validation |
| registerPushToken | Auth user, registered FID + mobile platform; stored under user's private token collection |
| unregisterPushToken | Auth owner of that FID |
| onDriverOfferCreated | Trigger creates private offer notification |
| onRideStatusChanged | Trigger creates private status notifications for rider/driver |
| onRideMessageCreated | Trigger creates generic message notification without revealing chat text |
| deliverPushNotification | Trigger sends FCM when configured, updates pushStatus; never claims delivery to a person |

Firestore:

- rides/{rideId}/messages/{messageId} read only by ride participant or admin; all writes server-only.
- payments/{rideId} read by payer or assigned driver or admin; all writes server-only.
- ratings/{rideId}_{authorId} read by author/target/admin, writes server-only.
- notifications/{notificationId} read by owner/admin, writes server-only.
- pushTokens/{uid}/tokens/{fidHash}, stripeWebhookEvents/{id} and other internal payment state accessible to backend only.
- No endpoint accepts a client-specified payment amount or allows ratings for arbitrary target IDs.

## 6. End-to-end app workflows

### Trip chat

1. Rider and driver complete the matching/acceptance flow from Phase 5.
2. Rider opens Trip tracking → Chat with driver. Driver opens assigned trip → Chat with rider.
3. Text messages appear in a server-timestamped Firestore stream. Only participants may read; the backend validates sender and target.
4. The same client message UUID avoids duplicate messages on retries. After the trip ends, read history remains available to its participants, but new chat messages are refused.

### Cash settlement (demonstration)

1. Driver completes trip (accepted → arriving → in_progress → completed).
2. Rider reopens the trip from Completed trips → Payment and rating → Choose cash.
3. The server creates cash_due from the ride's final stored fare.
4. Driver reopens completed trip → Report cash received.
5. The backend sets cash_reported_received and externalVerified=false.

**Interpretation:** This is a driver-submitted record, not independently verified financial settlement. It does not prove cash was exchanged.

### Stripe TEST

1. With valid test keys and a supported test Stripe account, rider selects Stripe TEST in checkout.
2. Server creates/resumes the test PaymentIntent using the trusted ride total; app opens Stripe PaymentSheet.
3. Stripe sends signed test webhook; backend verifies and updates paid_test.
4. Both rider and driver can see the updated payment status in Firestore.

No real card is charged with Stripe test mode. Use Stripe's official published test-card numbers; never use live card credentials when demonstrating.

### Ratings and notifications

1. After completion, rider and driver can each submit one star rating and comment.
2. Firestore rejects direct rating writes; the callable validates role/status/one-per-author constraints.
3. App header notification bell opens private notifications feed.
4. FCM push delivery attempts are tracked as sent_to_fcm / not_delivered / no_registered_device / delivery_error / emulator_not_sent. sent_to_fcm means accepted by FCM, **not guaranteed notification shown or read**.

## 7. Tests

Run full Flutter check:

~~~powershell
cd CSE412_Drive\apps\mobile
flutter analyze
flutter test
~~~

Run Cloud Functions build and unit tests:

~~~powershell
cd CSE412_Drive
npm --prefix services/functions run build
npm run test:unit
~~~

The tests/firebase/firestore.test.mjs suite now includes trip chat read privacy and payment/notification read-only permissions. The tests/integration/backend.test.mjs test scenario also covers active-trip chat, rejection of outsiders, rating once, cash payment selection and driver receipt attestation. With Firebase emulators installed and running as required:

~~~powershell
npm run test:rules
npm run test:integration
~~~

CI: Phase 4 server TypeScript build workflow validates compilation and domain unit tests; Flutter CI checks package resolution, native configuration script, analyzer and widget/unit tests. Full emulator integration and live Stripe webhook/FCM provider tests require explicit success evidence before claiming these services are end-to-end validated.

| ID | Scenario | Expected |
|---|---|---|
| P6-01 | Stranger reads active trip message | Denied |
| P6-02 | Authorized user calls sendRideMessage | Stored once |
| P6-03 | Same UUID retried with identical text | Same stored message |
| P6-04 | Chat after trip completion | New send refused |
| P6-05 | User rates a trip before completion | Denied |
| P6-06 | Completed ride rated twice by same author | Duplicate denied |
| P6-07 | Driver rates different rider ID | Target is determined by trusted ride, not user input |
| P6-08 | Rider selects cash | cash_due |
| P6-09 | Outsider marks cash received | Denied |
| P6-10 | Driver confirms cash due | cash_reported_received and externalVerified=false |
| P6-11 | Client changes payment status directly | Firestore rules deny |
| P6-12 | Stripe secret absent / live key supplied | Safe precondition failure |
| P6-13 | Stripe PaymentIntent test successful + webhook valid | paid_test only after signed webhook |
| P6-14 | Stripe forged signature / wrong amount / duplicate event | Reject or safely ignore |
| P6-15 | Notifications read by unrelated user | Denied |
| P6-16 | Firebase emulator notifications | In-app feed records; no fake FCM delivery |
| P6-17 | Android native setup script run twice | Idempotent modifications |
| P6-18 | Stripe PaymentSheet installed and configured on Android | Requires real native test build, not only flutter analyze |

## 8. Constraints and later work

- PCI scope and card data: PaymentSheet is provider-hosted; never store full card details in DRIVE Firestore or logs.
- Stripe test mode: does not settle real revenue and merchant BDT support varies; current phase has no live payment credentials.
- Cash: driver-reported receipt is not external verification. Real reconciliation, finance-ledger posting and refunds require separate finance/admin controls.
- Notifications: sending to FCM is best effort; login credentials, phone configuration, APNs and OS permissions can affect delivery.
- Trip messages: protected by Firebase rules, but **not end-to-end encrypted**. Avoid sending passwords, national identity numbers or card details.
- Ratings: one per role/ride; aggregate rating/reliability recalculation and moderation belong in later hardening.
- Local Bangladeshi gateways: bKash/SSLCommerz integration requires merchant credentials, contracts, payout terms and webhook verification. An unsafe imitation payment flow has not been created.
- OS-specific push and Stripe native builds, webhook signing tests, manual two-account sessions and billing must be validated before production launch.

## 9. Phase exit and next phase

Delivered source: secure payment callables, signed Stripe TEST webhook, cash acknowledgement, chat, post-ride ratings, in-app/FCM notifications, rider/driver UI, Firestore indexes/rules, automated tests and setup instructions.

Validation status is determined by the latest actual GitHub Actions runs, not asserted from source availability alone. Device-specific live integration and provider credentials are outside the committed university demo source.

**Next requirement: Vehicle Rental** (third feature in the submitted PDF; detailed SRS FR-05). Continue through the source requirements before moving to the later ML phase.
