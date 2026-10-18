# DRIVE Flutter Mobile (Phase 3)

**Status:** Real Firebase-authenticated role-based Flutter app foundation.
Rider maps/booking, driver ride offers/navigation, live tracking, payment, and ML are deliberately not implemented here; see the project phase plan.

- Authentication: email/password (with email verification), Google native sign-in, and international phone OTP.
- User onboarding and protected Firestore profile retrieval through the Phase 2 `ensureProfile` callable.
- Private driver licence/vehicle/photo upload through Storage; driver application and owner application through existing Cloud Functions.
- Rider home plus approved-driver and approved-owner workspaces.
- English/Bangla localization, light/dark themes, accessible Material 3 controls.
- Riverpod dependency injection with separate Firebase Auth repository and feature-oriented presentation code.
- Emulator-first configuration, Flutter unit/widget tests and GitHub Actions workflow.

See the [complete Phase 3 guide](../../docs/PHASE_3_FLUTTER.md).

## First run

First generate the platform scaffold using Flutter (Android/iOS directories are generated with the installed stable SDK), then install packages.

~~~bash
flutter create --project-name drive_mobile --platforms=android,ios .
flutter pub get
flutter gen-l10n
flutter test
flutter run --dart-define=DRIVE_EMULATOR=true
~~~

Launch Firebase emulators from the repository root before running the app. Use the provided [Phase 2 backend guide](../../docs/PHASE_2_FIREBASE.md) to start/seed the backend. For a real Firebase project, follow `docs/PHASE_3_FLUTTER.md` for `--dart-define-from-file` and native Google OAuth configuration. Do **not** commit real local config files.

## Phase 5 driver workflows

The driver GPS, expiring offer, trip navigation, completion and estimated-gross dashboards are documented in [Phase 5](../../docs/PHASE_5_DRIVER.md). After flutter create, run the foreground location permission script: dart run tool/configure_driver_permissions.dart.

## Phase 6 payments and communications

See [Phase 6 guide](../../docs/PHASE_6_PAYMENTS_CHAT_NOTIFICATIONS.md) for cash, Stripe test PaymentSheet, webhook secrets, notifications, chat, ratings and Android native setup (`dart run tool/configure_phase6.dart` after flutter create). Never enable Stripe live keys.
