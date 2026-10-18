# DRIVE — Phase 4: Rider Map, Booking and Trip Tracking

East West University · CSE412 Software Engineering · Fall 2026

**Scope:** rider pickup/destination, real Google routing when configured, trusted fare estimates, bookings, matching offers, live trip state, driver GPS subscriptions, cancellations, and safety incident recording.

**Phase completion distinction:** Flutter analyzer and tests passed on commit bc26b84. Google Routes, Google Maps, and Firebase Cloud Functions still need real project credentials and device testing. Driver availability/offer acceptance and continuous driver GPS publishing are introduced in Phase 5; do not claim completed end-to-end physical ride matching yet.

## 1. Files

~~~text
services/functions/src/maps.ts
services/functions/src/index.ts
apps/mobile/pubspec.yaml
apps/mobile/lib/core/config/firebase_bootstrap.dart
apps/mobile/lib/core/providers.dart
apps/mobile/lib/features/home/presentation/home_screen.dart
apps/mobile/lib/features/rider/domain/route_models.dart
apps/mobile/lib/features/rider/data/rider_repository.dart
apps/mobile/lib/features/rider/presentation/rider_home_screen.dart
apps/mobile/lib/features/rider/presentation/trip_tracking_screen.dart
apps/mobile/tool/configure_native_maps.dart
apps/mobile/test/route_models_test.dart
~~~

## 2. Backend APIs and main flows

The TypeScript Cloud Functions server includes:

| API | Input | Output and validation |
|---|---|---|
| autocompletePlaces | query (3–100 chars), UUID session token | Up to 8 Bangladeshi Places API New predictions; authenticated |
| resolvePlace | Google place ID, same session token | Verified coordinate and address |
| getFareQuote | pickup and destination coordinates, vehicle category | Routes API road route, duration, encoded polyline and server-configured BDT fare; 5-minute quote expiry |
| requestRide | trusted quote ID and request UUID | One active ride per rider; idempotent matching ride |
| dispatchNearbyDrivers | rider-owned ride ID | Geohash proximity candidates, eligible drivers and time-limited offers |
| cancelRide | current ride ID | Backend-validated pre-trip cancellation, zero fee in current demo rule |
| finalizeUnmatchedRide | matching ride ID | Exits search only after pending offers have had time to expire |
| reportSafetyIncident | participant's ride ID, incident type | Persisted incident; never claims an external emergency contact was notified |

The server API key is not included in mobile app code, Firestore public data or Dart defines. Google Routes uses the Compute Routes API with a narrow response field mask: route distance, traffic-aware duration and encoded polyline. Bike currently uses Google DRIVE routing as an approximation for motorcycle timing where motorcycle-specific routing is unsupported. All monetary amounts are BDT in integer minor units, and the backend controls fare and pricing version.

### Demo-only fallback

When FUNCTIONS_EMULATOR is active *and no server Maps API key is configured*, the fare function deliberately uses the existing provisional great-circle algorithm. It labels the route/fare as a demo estimate. Real deployed functions **do not** silently turn Google Routes errors into misleading approximate prices.

## 3. API keys, billing, and security

Create or use the Google Cloud project linked to your Firebase project and billing. Enable Maps SDK for Android, Maps SDK for iOS (only for iOS builds), Places API (New), and Routes API. Configure budget alerts and API quotas.

Use **separate keys**:

1. Android Maps SDK key — restrict to Maps SDK for Android, Android app package and its signing SHA fingerprint.
2. iOS Maps SDK key — restrict to Maps SDK for iOS and the iOS bundle identifier.
3. Server Maps API key — restrict API scope to Places API (New) and Routes API; keep in Firebase Secret Manager.

Cloud Functions deploy for a real Firebase project:

~~~powershell
cd CSE412_Drive
npm install
npm --prefix services/functions install
npm run build
npx firebase-tools login
npx firebase-tools functions:secrets:set GOOGLE_MAPS_SERVER_KEY --project YOUR_FIREBASE_PROJECT_ID
npx firebase-tools deploy --only functions --project YOUR_FIREBASE_PROJECT_ID
~~~

The secret command prompts for your **own** value. These commands should be run only after you create the real Firebase project, set up Authentication, Firestore and Realtime Database, deploy security rules, and choose Firebase Blaze billing. Your secret is never to be committed.

For development with Firebase emulators **and actual Places/Routes**, create an untracked local file at:

~~~text
services/functions/.secret.local
~~~

Containing the line (replace the example on your own workstation):

~~~text
GOOGLE_MAPS_SERVER_KEY=your-own-restricted-server-key
~~~

That file is Git-ignored. Without the key, autocomplete correctly reports unconfigured, but manual coordinates and the provisional emulator fare still work.

## 4. Windows setup and launch

Install the current stable Flutter SDK, Android Studio/emulator, Node.js 22, Java 21, Git and Firebase CLI. Confirm the installed Flutter Android SDK is at least API 24.

From your existing clone:

~~~powershell
cd CSE412_Drive
git pull origin main
npm install
npm --prefix services/functions install
npm run build
npm run emulators
~~~

Keep Firebase emulators running in one PowerShell window. In a second PowerShell window:

~~~powershell
cd CSE412_Drive\apps\mobile
flutter create --project-name drive_mobile --org com.drive.cse412 --platforms=android,ios .
flutter pub get
flutter gen-l10n
flutter analyze
flutter test
flutter run --dart-define=DRIVE_EMULATOR=true
~~~

With no Google Maps SDK key, the app displays a clear map configuration notice instead of trying to show an unconfigured map. You can still select two sets of coordinates, get provisional quotes, create matching rides and watch statuses in the Firebase emulator.

### Enable an actual Google Map in the Android emulator

Set a properly restricted *Android Maps SDK* key as a local environment variable. These examples are values you must supply from your own Google Cloud account:

~~~powershell
cd CSE412_Drive\apps\mobile
$env:DRIVE_ANDROID_MAPS_KEY = "your-own-android-maps-key"
dart run tool/configure_native_maps.dart
flutter run --dart-define=DRIVE_EMULATOR=true --dart-define=DRIVE_MAPS_READY=true
~~~

The key configurator adds INTERNET/ACCESS_FINE_LOCATION permissions and Android Maps metadata to the generated Android manifest and writes a Git-ignored XML resource under android/app/src/main/res/values/drive_maps_keys.xml. It does not commit your key.

For a **real Firebase project**, configure the Phase 3 Firebase local config under apps/mobile/config/firebase.local.json and use:

~~~powershell
flutter run --dart-define-from-file=config/firebase.local.json --dart-define=DRIVE_MAPS_READY=true
~~~

Do not enable DRIVE_EMULATOR when connecting to real Firebase. A valid Google Maps SDK key is required regardless of whether Firebase is emulated.

### iOS

iOS builds require a Mac with Xcode and CocoaPods. Generate native files with Flutter create, use an iOS deployment target of at least 15, and set DRIVE_IOS_MAPS_KEY in your local terminal before running the same Dart native-key configurator. It configures AppDelegate's Maps SDK initializer, iOS location permission text, and the local ignored Xcode DriveMapsKeys.xcconfig. Register the correct iOS bundle identifier and Firebase App ID.

## 5. User journey and acceptance criteria

1. Login through Phase 3 Firebase Auth and complete the rider profile.
2. Select pickup and destination using Places search, phone GPS (explicit permission), manual coordinates, or map taps.
3. Select Bike, Car or Premium; a change invalidates the previous quote.
4. Estimate fare. When configured, backend fetches a Google road route and stores the fare and pricing configuration with 5-minute expiry; screen shows BDT total, distance, minutes, and route polyline.
5. Confirm a ride. Backend validates quote ownership and expiry, creates at most one active ride per rider, and uses a client UUID idempotency key.
6. Dispatch matching offers to nearby approved online drivers, ranked by distance, rating, and acceptance rate. The rider can retry after a cooldown; no-drivers state remains explicit.
7. Follow ride status in Firestore through accepted, driver_arriving, in_progress, completed, cancelled, no_driver_found. Status is server-owned.
8. When a driver accepts and publishes GPS under trip access, display driver coordinates/marker. If the last update is older than 30 seconds, label it stale rather than live. Phase 5 adds driver GPS and offer UI.
9. Cancel pre-trip rides through Cloud Functions, or finalize an expired unmatched search after all outstanding offers expire.
10. Rider SOS records an incident with backend authorization. The UI clearly states that **no external emergency service or contact was notified**. Never substitute this for real emergency calling.

## 6. Main screens

~~~text
RIDER MAP + BOOKING
+---------------------------------------+
| Google Map: pickup/destination pins   |
|      route polyline and camera        |
+---------------------------------------+
| Where are you going?                  |
| [ Pickup address / GPS / manual ]     |
| [ Destination / map pin ]             |
| [ Bike | Car | Premium ]              |
| [ Estimate fare ]                     |
|                                       |
| [ BDT amount · km · minutes ]          |
| [ Provisional warning if applicable ] |
| [ Confirm ride request ]              |
+---------------------------------------+

RIDER TRACKING
+---------------------------------------+
| Google Map and latest driver position |
+---------------------------------------+
| Trip ID        [ matching / accepted ]|
| Distance / quoted amount              |
| GPS: waiting / live / stale           |
| [ Retry match ] [ Cancel ride ]       |
| [ Record SOS incident (demo only) ]   |
+---------------------------------------+
~~~

Design details: Material 3, rounded card surfaces and consistent green accent, dropdown/segmented vehicle selection, explicit loading and cancellation confirmation, auto-complete suggestions with 420 ms debounce and session IDs, location permission fallback, an unconfigured-map information state, expiry warnings, live tracking state and honest safety status.

## 7. Testing

Flutter automated CI tests cover app compilation, Dart analysis, input validation, quote JSON conversion and minor-unit formatting, quote expiration, Google encoded polyline decoding, and component widget tests.

~~~powershell
cd CSE412_Drive\apps\mobile
flutter analyze
flutter test
~~~

Backend/emulator tests use the Phase 2 commands:

~~~powershell
cd CSE412_Drive
npm --prefix services/functions run build
npm run test:unit
npm run test:rules
npm run test:integration
~~~

| Case | Expected |
|---|---|
| Manual Dhaka pickup/destination in unconfigured emulator | Provisional quote and visible warning |
| Live Google place search with key | Suggestions and resolved coordinates |
| Invalid/missing place | Recoverable error; no invented place |
| Quote expired | Confirm prevented, ask for new quote |
| Bike vs Car vs Premium | Recalculated quote |
| Same booking key submitted twice | Same ride ID |
| Second simultaneous active booking | Rejected server-side |
| No eligible drivers | Clear waiting/retry state, no false assignment |
| Approved driver accepts unexpired offer | Rider sees accepted driver/state |
| GPS update through authorized RTDB path | Driver marker moves |
| GPS older than 30 seconds | Stale indicator |
| Unauthorized rider requests another trip's GPS | Access denied by RTDB rules |
| SOS action | Incident created, external notifications explicitly not claimed |
| Firestore client tries overwriting fare/status | Rules reject |
| Missing native Maps key | App still supports manual-coordinate emulator testing |

The CI suite does **not** hit billable external Google services and cannot prove physical-device GPS, third-party ETA accuracy, real payment, or a driver accepting offers. End-to-end driver-rider demo will be tested after Phase 5.

## 8. Requirements traceability and phase boundary

The source requirement-analysis PDF explicitly calls for smart ride booking, matching/cost sharing, live tracking, fare prediction and AI route optimization. This phase implements foundational ride booking, matching, tracking and traffic-aware route estimates. Shared passenger cost splitting, women safety enhancements, tourist mode, full multi-currency payment, live SOS notification delivery and rated driver earnings remain in the defined later-phase roadmap.

**Phase 4 source and Flutter CI are complete.** Google credentials, actual cloud deployment, end-to-end driver device validation and final UX acceptance remain outside this source-only phase. Next: **Phase 5 — Driver flow** (online GPS, expiring offers, route navigation, trip lifecycle and earnings).
