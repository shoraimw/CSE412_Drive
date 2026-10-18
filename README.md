# DRIVE — Smart Ride-Sharing and Vehicle Rental Platform

DRIVE is a CSE412 Software Engineering project at East West University. It combines on-demand rides, shared trips and cost splitting, vehicle rentals, driver/owner management, live tracking, safety tools, fare estimation, route guidance, and an administrative dashboard.

The specification is based on the team's Fall 2026 Requirement Analysis and the implementation brief.

## Product surfaces

- **Flutter mobile app:** role-aware experiences for riders, drivers, and vehicle owners.
- **React admin dashboard:** driver/vehicle approval, trip and rental operations, pricing, promotions, disputes, refunds, and analytics.
- **Firebase backend:** Authentication, Cloud Firestore, Realtime Database, Cloud Functions (TypeScript), Cloud Messaging, Storage, Remote Config, and App Check.
- **Python ML service:** matching/ranking experiments, fare and ETA prediction, demand forecasting, and anomaly signals.
- **External integrations:** Google Maps Platform and payment adapters (Stripe test mode first; cash supported).

## Phased delivery

1. **Phase 1 — SRS, use cases, UML, data model, and architecture** (current)
2. Phase 2 — Firebase project setup, Firestore rules, indexes, and Cloud Functions
3. Phase 3 — Flutter foundation and authentication
4. Phase 4 — Rider booking, maps, and trip tracking
5. Phase 5 — Driver and vehicle-owner workflows
6. Phase 6 — Payments, chat, notifications, ratings, and safety workflows
7. Phase 7 — Matching, routing, fare/ETA prediction, demand forecasting, and anomaly detection
8. Phase 8 — React admin dashboard
9. Phase 9 — Tests, CI/CD, security checks, and deployment
10. Phase 10 — Final report, presentation, and demo plan

## Repository documentation

- [Phase 1: SRS and Architecture](docs/PHASE_1_SRS_ARCHITECTURE.md)
- [Phase 2: Firebase backend, setup, callable API contracts, and emulator tests](docs/PHASE_2_FIREBASE.md)
- [Phase 3: Flutter foundation, authentication, role-aware mobile app](docs/PHASE_3_FLUTTER.md)
- [Phase 4: Rider maps, route quotes, booking and tracking](docs/PHASE_4_RIDER.md)
- [Phase 5: Driver GPS, offers, navigation and estimated gross](docs/PHASE_5_DRIVER.md)
- [Phase 6: Cash and Stripe TEST payments, chat, notifications and ratings](docs/PHASE_6_PAYMENTS_CHAT_NOTIFICATIONS.md)

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
