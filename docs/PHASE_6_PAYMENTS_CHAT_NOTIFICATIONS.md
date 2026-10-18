# DRIVE — Phase 6 Restart: Payments, Chat, Notifications and Ratings

**Course:** East West University · CSE412 Software Development · Fall 2026  
**Status:** Rebuilt on the existing Phases 1–5. No work in subsequent phases is required or rolled back.  
**Payment safety:** BDT in integer minor units, academic demo only. Stripe TEST keys ONLY; no live card capture, no real fund settlement.

## 1. What changed in this Phase 6 restart

The original Phase 6 included a native Flutter Stripe PaymentSheet dependency. GitHub Actions Android release compilation failed in stripe_android with missing Kotlin pushProvisioning classes. In this restart, DRIVE uses **Stripe-hosted Checkout TEST mode** launched securely in the device's browser. This removes the incompatible native card plugin while preserving server-calculated fares, Stripe test card payments, signature-verified webhooks, and trip-scoped payment records.

The original Firebase Messaging 17 client uses **Firebase Installation IDs (FIDs)**. The prior backend incorrectly treated them as registration tokens in an older Firebase Admin SDK. Now the backend uses firebase-admin 14+ with fids (not tokens) for multicast delivery. Google's Admin SDK supports FID targeting. FCM delivery is best effort, not guaranteed.

Retained and reconnected:
- Driver/rider-authenticated trip chat with one server-stored message per client UUID; no direct Firestore writes.
- One rating (1–5 stars and optional comment) per participant per completed ride.
- Cash choice by rider and a separate, explicitly **unverified** cash-received attestation by assigned driver.
- Stripe-hosted TEST Checkout via server callable, idempotency by ride plus attempt, and payment confirmation from **signed checkout.session webhook events only**.
- Private Firestore in-app notification feed for driver offers, trip status and chat; optional push to registered devices.
- Payment status and estimate "receipt" page (not a tax invoice).
- Existing separate rider/driver/owner tabs and Phase 4/5 trip access controls.

## 2. Files and architectural boundaries

~~~text
services/functions/
  src/index.ts                    # exports Phase 6 callables/triggers
  src/payments.ts                 # cash, Checkout session, signed webhook
  src/engagement.ts               # chat, rating, notifications and FID push
  package.json                    # Firebase Admin 14+ and Functions 7+
apps/mobile/
  lib/features/trip_services/
    data/trip_services_repository.dart
    presentation/trip_checkout_screen.dart
    presentation/trip_chat_screen.dart
    presentation/notifications_screen.dart
  lib/core/config/firebase_bootstrap.dart
  tool/configure_phase6.dart
  pubspec.yaml
firebase/firestore.rules
firebase/firestore.indexes.json
firebase.json                      # optional Hosting for return pages
hosting/payment/success/index.html
hosting/payment/cancel/index.html
tests/firebase/firestore.test.mjs
tests/integration/backend.test.mjs
docs/PHASE_6_PAYMENTS_CHAT_NOTIFICATIONS.md
~~~

**Server-authoritative invariants**
1. Only a completed ride's rider selects cash or starts Stripe TEST checkout.
2. Fare is read from the server's trusted completed-ride finalFare, not client-supplied.
3. A ride can have exactly one payment method/record; cash cannot be overwritten by a card choice or vice versa.
4. Cash acknowledgement never sets externally verified or Stripe paid status.
5. Stripe links are created on the backend only with a sk_test key, are reused or rotated with server-controlled idempotency, and are opened only if the returned host is a trusted Stripe Checkout domain.
6. A browser return to success is NOT payment verification; only valid checkout.session.completed / async_payment_succeeded events with payment_status=paid, correct session ID, ride, payer, currency and amount set paid_test.
7. Webhook event IDs are stored once; late failed events cannot downgrade paid_test.
8. Messages are accessible only to the assigned rider/driver/admin. Chat is transport encrypted by Firebase but NOT end-to-end encrypted.
9. Stars/comments are bound to actual ride participants and authored role; clients cannot rate arbitrary accounts.
10. Firestore rules prohibit clients from directly editing rides, payments, ratings, messages or notifications.

## 3. Payment flow

~~~mermaid
sequenceDiagram
  autonumber
  actor Rider
  participant App as Flutter
  participant FN as Firebase Functions
  participant DB as Firestore
  participant Stripe as Stripe TEST Checkout
  Rider->>App: Open completed trip checkout
  App->>DB: Subscribe payment status
  alt Cash
    Rider->>FN: chooseCashForRide(rideId)
    FN->>DB: Save cash_due
    Note over FN,DB: Driver must independently report cash receipt
  else Card TEST
    Rider->>FN: prepareStripeTestCheckout(rideId)
    FN->>DB: Validate ride and reserve stripe_test payment
    FN->>Stripe: Create TEST Checkout session with server fare
    FN-->>App: HTTPS checkout URL (no secret key)
    App->>Stripe: Open hosted checkout in browser
    Stripe-->>Rider: Redirect to informational return page
    Note over App: Never mark paid from the redirect
    Stripe->>FN: Signed checkout.session event
    FN->>DB: Verify signature, ride, amount, payer and session
    FN->>DB: Set paid_test only for paid event
    DB-->>App: Updated payment status
  end
~~~

### Payment state definitions

| Method | State | Meaning |
|---|---|---|
| none | not initiated | No payment selection |
| cash | cash_due | Rider chose payment directly to driver |
| cash | cash_reported_received | Assigned driver attested receipt; unverified |
| stripe_test | initializing | Backend reserving payment / creating hosted session |
| stripe_test | checkout_open | Stripe-hosted TEST checkout available |
| stripe_test | payment_failed | Authenticated Stripe webhook reported failure |
| stripe_test | paid_test | Signed Stripe event verified **test** payment; no real funds |

Neither cash_reported_received nor checkout_open is equivalent to verified live settlement.

## 4. Windows local setup

Prerequisites: Git, Node.js 22, Java 21, Flutter stable, Android Studio and the Firebase Emulator Suite. No Stripe or Google Maps keys are necessary for **cash, messaging, ratings and in-app notifications** tested with emulator accounts.

PowerShell at repository root:

~~~powershell
git clone https://github.com/shoraimw/CSE412_Drive.git
cd CSE412_Drive
npm install
npm --prefix services/functions install
npm run build
npm run emulators
~~~

In a second PowerShell terminal:

~~~powershell
cd CSE412_Drive\apps\mobile
flutter create --project-name drive_mobile --platforms=android,ios .
flutter pub get
flutter gen-l10n
dart run tool/configure_phase6.dart
flutter analyze
flutter test
flutter run --dart-define=DRIVE_EMULATOR=true
~~~

The native configurator retains the app display name, Android notification permission, Kotlin/file-picker workaround and native Flutter setup. **No Flutter Stripe native plugin is required.** Its Gradle push-provisioning failure no longer blocks this architecture.

### Emulator cash, chat and rating demo

1. Start the Emulator Suite.
2. Sign in as two distinct verified test accounts (rider, approved driver).
3. Create and complete a trip through Phases 4–5 (or through the existing integration test).
4. While the ride is assigned, send chat messages from both accounts. A third account must not read the message collection.
5. Once the trip is completed, rider selects Cash. Driver opens the same trip and presses Report Cash Received.
6. Confirm that payments/rideId has method=cash and status=cash_reported_received with externalVerified=false.
7. Both participants leave one 1–5-star rating. Repeat submission must fail.
8. See in-app notifications in the Notifications screen. The emulator does not deliver real FCM push messages.

The integration test covers cash, chat and ratings through privileged server operations, not by weakening client rules.

## 5. Real Stripe TEST checkout setup

**Important:** Stripe availability/acceptance of BDT and country/merchant eligibility depend on your Stripe account. This source is a TEST demonstration and does not imply an account in Bangladesh can accept live BDT cards.

Create a Stripe test account and obtain from Stripe Developers → API Keys and Webhooks:

- Stripe secret test key (prefix sk_test_) for server-only use.
- Stripe webhook signing secret (prefix whsec_) for server-only use.
- A test-only webhook destination pointing to the Firebase Cloud Function stripeTestWebhook in region asia-south1.
- A public HTTPS Firebase Hosting domain to display the informational browser-return pages.

Go to Firebase Console and register/enable Functions, Firestore, Auth and Hosting. Cloud Functions production deploy requires Blaze billing; use a separate test Firebase project, not your live product account.

At repository root, log into Firebase and configure **server secrets** (do not paste values into GitHub):

~~~powershell
npx firebase-tools login
npx firebase-tools functions:secrets:set STRIPE_TEST_SECRET_KEY --project YOUR_FIREBASE_PROJECT_ID
npx firebase-tools functions:secrets:set STRIPE_TEST_WEBHOOK_SECRET --project YOUR_FIREBASE_PROJECT_ID
~~~

Create your own local, Git-ignored server environment configuration file at services/functions/.env.YOUR_FIREBASE_PROJECT_ID with ONE setting:

~~~text
DRIVE_CHECKOUT_RETURN_BASE_URL=https://YOUR_FIREBASE_PROJECT_ID.web.app
~~~

Use your actual configured public HTTPS Hosting URL. These strings are illustrative variable names, not working credentials.

Deploy hosting and backend (review billing and Firestore rules first):

~~~powershell
npx firebase-tools deploy --project YOUR_FIREBASE_PROJECT_ID --only hosting,firestore,functions
~~~

**Checkout callback pages** live at:

- https://YOUR_FIREBASE_PROJECT_ID.web.app/payment/success
- https://YOUR_FIREBASE_PROJECT_ID.web.app/payment/cancel

They never mark a payment successful. The app watches Firestore, and webhook status is the sole trusted source. Set the Stripe dashboard webhook endpoint to the deployed stripeTestWebhook function URL, not the Hosting success page.

Subscribe at least to:
- checkout.session.completed
- checkout.session.async_payment_succeeded
- checkout.session.async_payment_failed

Use Stripe-provided test cards in hosted Checkout. Never enter real card numbers during an academic demonstration. After returning to DRIVE, the rider/driver can inspect the payment status in the Trip Checkout screen.

**Note:** A signed event can be delayed. The app must not call an operation to force-set paid_test; keep the payment record pending and wait for webhook retries. The signed webhook URL is callable without Firebase login by necessity, but rejects invalid signatures.

## 6. Firebase Cloud Messaging (optional)

The Flutter client currently uses firebase_messaging v17 and its onRegistered event to obtain a **Firebase Installation ID (FID)**. Admin SDK 14+ uses fids for targeted messages. The client forwards the FID only through authenticated callable functions and can unregister at sign-out.

Steps for real push:
1. Enable Cloud Messaging API for your Firebase project and ensure service identity permissions.
2. Register Android application and Play Services; register iOS app, APNs signing key, push capability and notification permissions.
3. Sign in to DRIVE, allow notifications, and observe a server-only pushInstallations/{uid}/instances/{hash} entry.
4. Create a real driver offer, trip status change or chat message.
5. Confirm an in-app notifications/{id} record appears for the intended user.
6. Check pushStatus. sent_to_fcm means FCM accepted a send attempt, **not** that the device displayed it. The emulator records emulator_not_sent or no_registered_device as appropriate.

Push payloads do not contain raw chat message text or precise GPS. FCM delivery is best effort and may fail due to OS/battery, network, permissions or APNs setup.

## 7. APIs and client screens

| Function | Auth and behavior |
|---|---|
| chooseCashForRide | Completed ride's rider; cash_due |
| reportCashReceived | Assigned driver only; cash_reported_received, unverified |
| prepareStripeTestCheckout | Completed ride's rider; returns trusted HTTPS hosted test URL |
| stripeTestWebhook | POST, Stripe signed raw body; server controls paid_test status |
| sendRideMessage | Assigned active-trip participant only, <=1000 chars, UUID idempotency |
| rateCompletedRide | Completed trip participant only, 1–5 stars, once per role |
| registerPushToken | Authenticated FID enrollment; role not admin |
| unregisterPushToken | Authenticated device FID removal |
| onDriverOfferCreated | Creates private driver in-app alert |
| onRideStatusChanged | Creates participant trip-state alerts |
| onRideMessageCreated | Creates recipient chat-message alert |
| deliverPushNotification | Tries FCM FID multicast, stores best-effort outcome |

Flutter pages:
- TripCheckoutScreen: completed ride summary, cash and Stripe TEST options, payment status and rating.
- TripChatScreen: 100-message scoped chat view, input validation and server send.
- NotificationsScreen: signed-in user's private notification feed.

## 8. Security, tests and acceptance

~~~powershell
# At repository root
npm --prefix services/functions run build
npm --prefix services/functions test
npm run test:rules
npm run test:integration

# In apps/mobile
flutter analyze
flutter test
flutter build apk --release --dart-define=DRIVE_EMULATOR=true
~~~

Tests/checks:
- Third user denied private chat/notifications/payments.
- Client cannot directly edit paid_test, cash or ride status.
- Rider/driver message submitted once per UUID; duplicates idempotent.
- Chat after completed ride rejected.
- Duplicate rating rejected; rating target derived from ride.
- Cash reported by stranger rejected; driver cash attestation is unverified.
- Stripe key missing or live key supplied refused.
- Forged Stripe webhook signature refused; checkout session event must match ride, payer and amount.
- Repeated webhook event ignored; out-of-order failure cannot reverse paid_test.
- FID messages are sent using Admin SDK 14+ fids, not legacy token-only multicast.
- Android release build completes without the discontinued Stripe native plugin.

**Do not claim that automated builds prove external Stripe/FCM delivery.** A proper manual demo needs valid test-account credentials, a deployed webhook URL, and enrolled Android/iOS devices. GitHub Actions logs are the actual evidence for analyzer and compilation.

## 9. Phase 6 exit criteria

- [x] Cash selection and separate driver attestation
- [x] Server-generated Stripe-hosted TEST checkout URL
- [x] Signed Stripe webhook and payment-state isolation
- [x] Participant-only chat + one rating per completed participant
- [x] Private notifications and FID-compatible FCM dispatch
- [x] Informational Hosting return pages
- [x] Flutter payment/notifications UI reconnected
- [x] No card numbers or secret keys in Git
- [ ] Confirm all CI runs green
- [ ] Validate Stripe test card and webhook on actual test Firebase project
- [ ] Validate FCM delivery on configured devices
- [ ] Validate real-device Android and iOS runtime

Stop after Phase 6. Continue to any subsequent phase only when specifically requested.
