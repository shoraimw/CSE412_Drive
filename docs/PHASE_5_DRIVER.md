# DRIVE — Phase 5: Driver App and Live Trip Operations

**Course:** CSE412 Software Development, East West University  
**Baseline:** Phase 1 SRS, Phase 2 backend, Phase 3 Flutter foundation, Phase 4 rider booking.

## 1. Delivered functionality

This phase replaces the Phase 3 driver placeholder with a driver workspace backed by Firebase:

1. Approved drivers can go online/offline. The server checks approval and blocks going offline with an active assigned trip.
2. An online driver with foreground location permission publishes GPS coordinates, geohash, heading, accuracy, speed and RTDB server timestamp. Sampling uses a 20 m movement threshold.
3. RTDB disconnect cleanup is registered. Nearby matching filters out candidate positions older than 30 seconds.
4. The app subscribes to only that driver's targeted, 45-second driverOffers records, displays route endpoints and the quoted amount, and allows accept/decline.
5. The backend transaction checks unexpired offer, approval, matching ride, vehicle category and driverBusy lock.
6. Accepted trips provide Google Maps external navigation to pickup or destination, with server-validated transitions accepted → driver_arriving → in_progress → completed.
7. While an assigned trip is active, driver GPS also publishes to tripLocations/rideId. Only server-authorized participants can read the position.
8. The earnings panel shows **estimated gross quoted value** from up to 100 recently completed rides: today and past seven calendar days. This is not collected cash, net earnings, commission accounting, payout history, or guaranteed settlement.
9. The new controls have English and Bangla labels. Existing Material 3 dark/light themes, accessibility and retry/loading patterns apply.
10. The project includes a platform-permission configurator and tests for geohash and earnings calculations.

**Not implemented:** background location service, guaranteed 24/7 GPS, FCM push notifications, real payout ledger, masked phone calls and demand forecast heatmap. They require later phases and production work.

## 2. Files

~~~text
apps/mobile/
  pubspec.yaml
  lib/features/driver/
    domain/geohash.dart
    domain/driver_earnings.dart
    data/driver_repository.dart
    presentation/driver_screen.dart
  lib/features/home/presentation/home_screen.dart
  lib/l10n/app_en.arb
  lib/l10n/app_bn.arb
  tool/configure_driver_permissions.dart
  test/driver_domain_test.dart
services/functions/src/index.ts
docs/PHASE_5_DRIVER.md
~~~

Flutter remains a single role-aware rider/driver/vehicle-owner codebase. An account cannot self-approve as a driver.

## 3. Driver/rider workflow

~~~mermaid
sequenceDiagram
  autonumber
  actor Driver
  participant App as Driver Flutter
  participant Functions as Cloud Functions
  participant FS as Firestore
  participant RTDB as Realtime Database
  participant Rider as Rider Flutter

  Driver->>App: Toggle online
  App->>Functions: setDriverAvailability(true)
  Functions->>FS: Verify approved driver
  App->>App: Request foreground GPS access
  loop While online and GPS updates arrive
    App->>RTDB: Publish driverLocations with geohash and timestamp
  end
  Rider->>Functions: Request ride and dispatch drivers
  Functions->>RTDB: Geohash query for nearby candidates
  Functions->>FS: Check eligibility and driverBusy
  Functions->>FS: Create targeted expiring offer
  FS-->>App: Driver offer stream
  Driver->>App: Accept before timeout
  App->>Functions: respondToOffer
  Functions->>FS: Transactionally assign driver and trip
  Functions->>RTDB: Set trip participant access
  FS-->>Rider: Assigned status
  App->>App: Open Maps external navigation
  Driver->>Functions: Arrival, start and finish transitions
  loop While assigned and publishing
    App->>RTDB: tripLocations/rideId
    RTDB-->>Rider: Authorized driver position
  end
  Functions->>FS: Completed trip and released active locks
~~~

## 4. Windows setup

Prerequisites: Flutter stable, Android Studio + emulator, Node.js 22, Java 21, Git, and the Phase 2 Firebase Emulator Suite.

Terminal A at repository root:

~~~powershell
cd CSE412_Drive
git pull origin main
npm install
npm --prefix services/functions install
npm run build
npm run emulators
~~~

Terminal B inside mobile app:

~~~powershell
cd CSE412_Drive\apps\mobile
flutter create --project-name drive_mobile --org com.drive.cse412 --platforms=android,ios .
flutter pub get
flutter gen-l10n
dart run tool/configure_driver_permissions.dart
flutter analyze
flutter test
flutter run --dart-define=DRIVE_EMULATOR=true
~~~

The permissions script modifies generated native AndroidManifest.xml to include INTERNET, ACCESS_COARSE_LOCATION and ACCESS_FINE_LOCATION, and adds NSLocationWhenInUseUsageDescription to iOS Info.plist. It does **not** add background-location or Android foreground-service permissions.

The driver app needs Firebase Auth, Firestore, Functions and RTDB. No special additional Google Maps SDK key is needed for external navigation using Google Maps URLs. The Phase 4 rider embedded map and real Routes/Places still need restricted Google Maps keys and Google Cloud billing.

### Two-device local demonstration

Launch two Android Emulators and run the app on each, using the actual device IDs returned from Flutter:

~~~powershell
flutter devices
flutter run -d DRIVER_EMULATOR_ID --dart-define=DRIVE_EMULATOR=true
flutter run -d RIDER_EMULATOR_ID --dart-define=DRIVE_EMULATOR=true
~~~

Run each command in a separate terminal, after starting the shared Firebase emulators. Android emulators reach the host via 10.0.2.2. Use Android Emulator Extended Controls → Location to set the driver's coordinates near the rider's pickup (within 8 km).

Create separate Firebase Authentication accounts, complete their profiles and verify the email links through the Auth Emulator UI.

### Admin approval

The driver must first upload their licence, vehicle documents and photo through Account → Become a Driver. An authorized administrator then calls the existing reviewDriverApplication Cloud Function with that driver's UID, approve=true and reason. Backend validates the pending application, records the review decision, and grants a driver custom claim. The driver refreshes their ID token or signs out and in.

**Do not change role flags from a rider/driver client or weaken security rules to make a demo work.** The React admin review UI arrives in Phase 8. The Phase 2 emulator integration test demonstrates server-authorized claims and ride matching for isolated test users.

### Walkthrough

1. Driver logs in, opens approved Driver tab, grants foreground GPS access and toggles Online. The screen shows GPS or an error.
2. Rider logs in on the other emulator, selects a nearby pickup and destination, chooses a matching category and confirms a quote.
3. Rider dispatch triggers geohash matching. The approved online driver receives the targeted offer in Firestore.
4. Driver accepts before the 45-second timeout. Another driver cannot claim the same ride concurrently.
5. Driver opens Navigate to Pickup in an external Maps app, taps Mark Driving to Pickup, then Start Trip, then Finish Trip.
6. Rider's location marker updates from RTDB as long as GPS publishes and trip access is active. A position older than 30 seconds is shown as stale.
7. On completion, the trip status becomes completed and active locks are released. Driver's estimated gross totals update. No real payment/payout happens yet.

## 5. Trusted API contract

| Operation | Authorization and outcome |
|---|---|
| setDriverAvailability | Approved driver only; cannot go offline with an active assigned trip |
| driverLocations/UID | Only the signed-in claimed driver writes their validated location in RTDB; no general read access |
| driverOffers/offerId | Backend creates targeted expiring offer; driver reads only offers addressed to them |
| respondToOffer | Transaction checks online/approved, ride status, expiry, matching vehicle and driverBusy lock |
| rides/rideId | Rider and assigned driver read own trip; no direct client edits to fare/assignment/state |
| advanceRide | Only assigned driver executes allowed state transitions |
| cancelRide | Allowed pre-trip ride participant; demonstration zero-fee policy |
| tripLocations/rideId | Only assigned driver writes; only explicit tripAccess participants read |
| completed rides | Driver reads own history for informational gross estimates; no payout implementation |

Rates and fare quotes remain server-owned, as defined in Phase 4.

## 6. GPS, performance, privacy and limits

- Driver location is gathered only with while-in-use permission. The system does not guarantee that a driver who switches to external navigation continues publishing while the DRIVE app is backgrounded.
- A 20-meter Geolocator distance filter reduces unnecessary writes; production requires device-specific battery and latency benchmarks.
- Driver position is private. Geohash enables spatial candidate queries; trusted Firestore approval and availability are checked before sending offers. Outdated positions are ignored.
- Publishing an assignment GPS can briefly fail if the backend has not yet granted trip access after matching; the UI indicates GPS errors and later fixes can retry.
- RTDB onDisconnect removes presence on connection loss, while normal Offline removes it explicitly; stalled online profiles alone do not qualify for a match without a fresh GPS timestamp.
- Continuous emergency dispatch, spoof-resistant GPS, fraud decisions and true payout reconciliation are not provided in this phase.
- The earnings view is based on a maximum of 100 recent driver rides and excludes unsettled financial adjustments. It must never be presented as actual income or balances.

## 7. Tests and acceptance criteria

Run Flutter tests:

~~~powershell
cd CSE412_Drive\apps\mobile
flutter analyze
flutter test
~~~

Run backend compilation, unit and Firebase emulator tests:

~~~powershell
cd CSE412_Drive
npm --prefix services/functions run build
npm run test:unit
npm run test:rules
npm run test:integration
~~~

| Test | Expected |
|---|---|
| Unapproved driver goes online | Denied by backend |
| Approved driver with permission goes online | Fresh geohash GPS in RTDB |
| GPS permission denied | Clear error, cannot claim GPS tracking |
| Offline toggle | Presence removed; GPS stream stopped |
| Driver assigned a trip tries going offline | Backend rejects |
| Nearby matching sends offer | Targeted driver sees expiring offer |
| Non-target driver accepts offer | Backend rejects |
| Offer expires before acceptance | Backend rejects |
| Driver already assigned another trip | Concurrency lock rejects |
| Accepted→arriving→in_progress→completed | Accepted transitions and terminal state |
| Accepted→completed directly | Rejected |
| Assigned driver publishes GPS | Authorized rider sees it |
| Stranger subscribes to trip GPS | RTDB denies |
| Launch directions | External navigation opens with selected coordinate |
| Simulated completed-ride gross | Daily and 7-day values accurate |
| Driver labels switched to Bangla | Localized text displays |

Automated domain tests include the standard geohash sample 42.6, -5.6 → ezs42, invalid coordinates, and local calendar earnings boundaries. CI covers analyzer and Flutter tests; real OS permissions, external Maps navigation and two-device GPS still require manual demonstration evidence.

## 8. Definition of completion

- [x] GPS/presence client and protected backend availability
- [x] Expiring offer inbox and accept/decline
- [x] Transaction-protected trip acceptance
- [x] External Maps directions to pickup/destination
- [x] Server-owned start/end trip controls
- [x] Rider-authorized trip GPS publishing
- [x] Estimated gross dashboard for recent completed rides
- [x] English/Bangla new driver labels
- [x] Native permission tool, domain tests and setup instructions
- [ ] Full manual two-device validation with your Firebase project and device GPS
- [ ] Background tracking and settled payouts (not Phase 5 scope)

**Next: Phase 6 — Cash and Stripe test payments, notifications, chat, receipts and ratings.**
