# DRIVE — Smart Ride-Sharing and Vehicle Rental Platform

DRIVE is a CSE412 Software Engineering project at East West University. It combines on-demand rides, shared trips and cost splitting, vehicle rentals, driver/owner management, live tracking, safety tools, fare estimation, route guidance, and an administrative dashboard.

The specification is based on the team's Fall 2026 Requirement Analysis and the implementation brief.

## Product surfaces

- **Flutter mobile app:** role-aware experiences for riders, drivers, and vehicle owners.
- **React admin dashboard:** driver/vehicle approval, trip and rental operations, pricing, promotions, disputes, refunds, and analytics.
- **Firebase backend:** Authentication, Cloud Firestore, Realtime Database, Cloud Functions (TypeScript), Cloud Messaging, Storage, Remote Config, and App Check.
- **Python ML service:** matching/ranking experiments, fare and ETA prediction, demand forecasting, and anomaly signals.
- **External integrations:** Google Maps Platform and payment adapters (Stripe test mode first; cash supported).

## Delivery status

Implementation is tracked against the submitted requirement PDF and the detailed SRS. A server function alone does not mean a requirement is complete; UI, backend authorization, tests and required external configuration must also be validated.

- **Implemented source foundations:** authentication/roles, Firebase backend, rider booking, driver workflow/GPS, trip communications, ride payments in cash/Stripe TEST, ratings and notification records.
- **Current requirement:** Vehicle Rental (third feature in the submitted PDF; detailed SRS FR-05). Renter marketplace and owner listing/booking screens are implemented in source and are undergoing CI/integration validation.
- **Android APK:** CI is configured to build and upload an emulator-demo APK on a successful Flutter run. A fully connected APK needs your Firebase project configuration; Stripe test mode additionally needs test keys and a matching signed webhook secret.
- **Admin dashboard (Phase 8):** React/Vite operations console with driver/owner/vehicle review, protected driver documents, recorded safety triage, versioned pricing, sampled analytics and read-only operational history. Shared-ride cost splitting, multi-currency payments, Women Safety Mode, complete emergency delivery and Tourist Mode remain; Phase 7 ML services are experimental and not trained on production data.

See the [requirements traceability matrix](docs/REQUIREMENTS_TRACEABILITY.md) for the current state and honest gaps.

## Repository documentation

- [Phase 1: SRS and Architecture](docs/PHASE_1_SRS_ARCHITECTURE.md)
- [Phase 2: Firebase backend, setup, callable API contracts, and emulator tests](docs/PHASE_2_FIREBASE.md)
- [Phase 3: Flutter foundation, authentication, role-aware mobile app](docs/PHASE_3_FLUTTER.md)
- [Phase 4: Rider maps, route quotes, booking and tracking](docs/PHASE_4_RIDER.md)
- [Phase 5: Driver GPS, offers, navigation and estimated gross](docs/PHASE_5_DRIVER.md)
- [Phase 6: Cash and Stripe TEST payments, chat, notifications and ratings](docs/PHASE_6_PAYMENTS_CHAT_NOTIFICATIONS.md)
- [Phase 7: Experimental ML, Cloudflare edge, scalability and abuse protection](docs/PHASE_7_ML_SCALABILITY_SECURITY.md)
- [Phase 8: React admin operations, safety review and pricing](docs/PHASE_8_ADMIN_OPERATIONS.md)
- [Vehicle Rental requirement implementation](docs/FR3_VEHICLE_RENTAL.md)
- [Admin dashboard source](apps/admin/README.md)
- [Functional requirement traceability matrix](docs/REQUIREMENTS_TRACEABILITY.md)

## Important implementation boundary

This is an academic project, not an emergency-response or production payment service. Use sandbox/test payment credentials, restrict API keys, and clearly label demo SOS and safety notifications. Do not store raw payment-card details. Before real-world operation, the product would need legal, privacy, safety, payment, operational, and security reviews.

## Core domain rule

The server is authoritative for driver approval, ride/rental state transitions, fare calculation, payment records, role privileges, and reservation conflict checks. Mobile clients may request actions, but must not directly write trusted business state.

## Phase 2 local quickstart

~~~bash
npm install
npm --prefix services/functions install
npm test
npm run emulators
~~~

Details, Windows PowerShell instructions, security boundaries, and the API reference are in the [Phase 2 guide](docs/PHASE_2_FIREBASE.md). A real Firebase project and deployment are not created automatically.
