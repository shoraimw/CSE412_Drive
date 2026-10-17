# DRIVE — Phase 1: Software Requirements Specification and Architecture

**Course:** CSE412 Software Engineering, East West University  
**Semester:** Fall 2026  
**Product:** DRIVE — Smart Ride-Sharing and Vehicle Rental Platform  
**Specification baseline:** Team Requirement Analysis submitted 6 October 2026, plus the implementation brief supplied for this project  
**Status:** Phase 1 design baseline; implementation begins in later phases

## 1. Purpose and source of requirements

This document turns the submitted requirement analysis into a buildable system specification. The team PDF describes DRIVE as a smart car-rental and ride-sharing platform. It explicitly includes authentication, user management, vehicle rental, smart ride booking, driver matching and cost sharing, live tracking, fare prediction, route optimization, multi-currency payments, Women Safety Mode, emergency/safe-trip support, Tourist Mode, and non-functional/domain requirements.

The implementation brief adds concrete mobile, backend, admin, payment, ML, testing, and CI/CD expectations. Requirements are labelled as follows:

- **PDF baseline:** explicitly present in the submitted Requirement Analysis.
- **Implementation extension:** explicitly present in the project brief and used to make the system implementable.
- **Design decision:** an engineering choice that resolves an ambiguity; it is not claimed to be wording from the PDF.

## 2. Product vision and scope

DRIVE connects passengers with approved drivers for on-demand rides and shared trips. It also lets users discover and rent eligible vehicles offered by approved vehicle owners. A role-aware Flutter application serves riders, drivers, and vehicle owners; a React web dashboard serves administrators. Firebase provides identity, trusted business operations, persistent data, real-time location distribution, files, and notifications. A small FastAPI service provides ML predictions and experimentation.

### 2.1 In scope

1. Account registration, sign-in, verification, profiles, and role-based access.
2. Driver onboarding, identity/vehicle-document upload, and admin approval.
3. Vehicle-owner onboarding, vehicle listing, availability, and rental management.
4. Ride pickup/destination selection, vehicle category selection, fare estimate, booking, matching, cancellation, tracking, completion, receipts, history, and reviews.
5. Shared-ride eligibility and per-passenger cost calculation.
6. Driver availability, ride requests, accept/decline timeout, navigation hand-off, earnings, and payout records.
7. Vehicle rental search, booking, availability conflict prevention, owner decisions, rental lifecycle, and payment records.
8. Live location, ETA, trip sharing, trusted contacts, SOS, route-deviation/long-stop warnings, and Women Safety Mode.
9. Pricing configuration, surge multiplier, promotions, cancellation rules, dispute/refund workflow, and operational analytics.
10. Tourist recommendations and multi-stop travel planning.
11. Dijkstra/A* demonstration, nearest-driver ranking, fare/ETA models, demand forecasting, and anomaly signals.
12. English/Bangla localization, accessibility, dark mode, offline/error states, automated testing, CI, and deployment documentation.

### 2.2 Out of scope for the academic MVP

- Guaranteed emergency dispatch or replacement for local emergency services.
- Production payment settlement, real payouts, or storage of card numbers/CVV.
- Guaranteed protection against every form of GPS spoofing or fraud.
- Guaranteed ML accuracy before collecting and evaluating representative data.
- A production-scale call-masking carrier integration. The design provides a call-provider abstraction; a demo may use a safe contact/phone hand-off.
- Production legal, insurance, regulatory, and transport-operator certification.

These exclusions do not remove the requested user-facing flows from the design. They distinguish a demonstrable academic implementation from a production service.

## 3. Stakeholders and user roles

| Role | Main goals | Important permissions |
|---|---|---|
| Guest | Understand DRIVE and register/sign in | Read public help, start authentication |
| Rider/passenger | Book, share, track, pay for, and review rides; rent vehicles | Manage own profile, bookings, trusted contacts, and own payment history |
| Driver | Complete approved rides safely and track earnings | Go online only after approval; accept assigned offers; update own location and allowed trip transitions |
| Vehicle owner | List vehicles and manage rental requests | Manage own vehicles, availability, rental decisions, and own rental earnings |
| Administrator | Operate and protect the marketplace | Approve/reject onboarding, manage pricing/promotions, investigate disputes, manage users and trips, issue permitted refunds, view analytics |
| Support/safety operator | Respond to incidents and disputes | Access only assigned operational data according to least-privilege policy |
| External providers | Maps, payment, push delivery | Receive only the minimum information needed for a requested operation |

**Authorization rule:** a client-selected role or a user-editable profile field never grants privileged access. Admin privileges are assigned server-side. Driver/owner eligibility is checked against trusted approval records on every sensitive operation.

## 4. Assumptions and constraints

1. The first demonstration market is Bangladesh, with BDT as the default display/settlement currency. Currency support is modelled separately so more currencies can be added.
2. One Flutter codebase supports role-aware navigation for rider, driver, and vehicle owner. A user may hold more than one non-admin role, subject to approval.
3. React is used for the admin web dashboard.
4. Firebase Authentication handles supported sign-in methods. Phone OTP availability, quotas, billing, and platform configuration must be checked in the Firebase project.
5. Google Maps Platform is used for map rendering, Places autocomplete, geocoding, Directions/ETA, and route display. API keys must be restricted by platform/API and server keys must not be shipped in the app.
6. Firebase Cloud Functions in TypeScript are the trusted business/API boundary. The Flutter and React clients must not directly set trusted ride status, fares, payment status, approval status, or refund decisions.
7. Realtime Database is used for frequently changing driver presence/location; Firestore stores durable business records.
8. ML outputs are advisory. If the model service is unavailable, the application falls back to deterministic matching/fare rules and Google route estimates where available.
9. All prices, cancellation fees, surge caps, shared-trip detour limits, and safety thresholds are configurable. No monetary value is hard-coded as a universal policy.
10. The system must show clear loading, empty, permission-denied, offline, and recoverable-error states.

## 5. Functional requirements

Priority: **P0** = required for the core demonstration; **P1** = important extension; **P2** = advanced/ML or future-ready feature. All requirements below are part of the product scope, even where implementation is staged.

| ID | Requirement | Priority | Acceptance summary |
|---|---|---:|---|
| FR-01 | Authentication and account security | P0 | A user can register/sign in with configured email/password, phone OTP, or Google; invalid/unverified attempts are rejected with clear feedback. |
| FR-02 | User profile and role management | P0 | Users can maintain permitted profile fields; driver/owner approval is separate from account creation; admin privilege cannot be self-assigned. |
| FR-03 | Driver onboarding and approval | P0 | A driver submits required profile, licence, vehicle papers, and photo; only an approved driver with an eligible vehicle can go online. |
| FR-04 | Vehicle-owner and vehicle management | P0 | An approved owner can create/edit their vehicle listing, rental price, photos, location, and availability; other owners' records cannot be changed. |
| FR-05 | Vehicle rental | P0 | Users can search by location, type, price, and time range; a confirmed rental atomically reserves availability so overlapping bookings cannot both succeed. |
| FR-06 | Smart ride booking | P0 | A rider selects pickup, destination, and category, sees route/fare/ETA estimates, and receives a ride ID and status after requesting. |
| FR-07 | Driver matching | P0 | The backend finds eligible nearby drivers and ranks them; a driver cannot be assigned conflicting active rides. No-driver-found and timeout states are handled. |
| FR-08 | Shared ride and cost sharing | P1 | Eligible passengers with compatible routes may share a vehicle when capacity and configured detour rules allow; each passenger sees their own fare breakdown. |
| FR-09 | Real-time tracking | P0 | During an active ride, an authorized rider sees the assigned driver's latest location, route, status, and ETA updates; unauthorized users cannot subscribe to private trip data. |
| FR-10 | Fare estimate and final fare | P0 | The server calculates a transparent estimate and final breakdown using the active pricing configuration, route distance/time, vehicle type, surge, fees, discounts, and configured taxes. |
| FR-11 | Route guidance and optimization | P1 | The app displays a Google route and alternatives when available; Dijkstra/A* is demonstrated on a sample graph; route recommendations can refresh when updated traffic/route data is available. |
| FR-12 | Payments and receipts | P0 | Cash is recorded as a payment method; card flow runs in provider test mode; payment status is server-verified; users can view receipts and payment history. |
| FR-13 | Multi-currency display/payment abstraction | P1 | The user can see supported currency options; each quote stores currency, conversion rate/source, and expiry; actual charging is limited to provider-supported currencies. |
| FR-14 | Women Safety Mode | P1 | A rider can enable available safety preferences, see driver verification details, and share trip information with trusted contacts. Availability limitations are communicated honestly. |
| FR-15 | Emergency and safe-trip workflow | P0 | An SOS action creates a timestamped incident, captures the latest available trip/location context, and attempts configured contact/admin notifications; route deviation or long-stop rules can raise reviewable warnings. |
| FR-16 | Tourist Mode | P2 | A user can discover nearby attractions/facilities and plan routes between selected stops using available Places and Directions data. |
| FR-17 | Cancellation and timeout handling | P0 | Rider/driver cancellation follows server-owned state and configurable fee rules; expired offers and no-shows produce explicit terminal or recoverable states. |
| FR-18 | In-app trip communication | P1 | Authorized rider/driver participants can exchange trip-scoped messages; messages are inaccessible to unrelated users and access ends according to retention policy. |
| FR-19 | Notifications | P0 | Relevant booking, arrival, cancellation, payment, rental, safety, and approval events create in-app/push notifications where delivery is supported. |
| FR-20 | Ratings, reviews, and history | P0 | Only a participant in a completed trip/rental can submit an eligible review; duplicate reviews are prevented; users can inspect their own history. |
| FR-21 | Driver earnings and payout records | P1 | Drivers can see daily/weekly ride totals, fees, and payout records; demo payouts are clearly marked as simulated unless a real provider is integrated. |
| FR-22 | Admin operations | P0 | Authorized admins can approve/reject drivers and owners, review vehicles, manage users/trips/rentals, pricing/promos, disputes, refunds, and safety incidents. |
| FR-23 | Admin analytics | P1 | The dashboard reports ride/rental volume, gross amount, active drivers, cancellations, and other metrics with clear date ranges and definitions. |
| FR-24 | ML and anomaly insights | P1 | Versioned prediction endpoints expose matching score, fare/ETA estimate, demand forecast, and anomaly signals; model failures have safe fallbacks and outputs are logged for evaluation. |
| FR-25 | Localization and accessibility | P0 | Primary workflows support English and Bangla labels, readable contrast, scalable text, accessible controls, and light/dark themes. |

### 5.1 Fare calculation contract

The server owns the pricing calculation. A baseline formula is:

**Pre-discount fare** = base fare + (billable distance × per-km rate) + (billable minutes × per-minute rate) + service fee.

**Surged fare** = max(minimum fare, pre-discount fare × configured surge multiplier).

**Payable fare** = max(0, surged fare − eligible discount + configured taxes/other fees).

The implementation must define rounding, billable distance/time, tolls, waiting charges, minimum fare, maximum surge, and refund/cancellation treatment in a versioned pricing configuration. The estimate is not the final charge. The final calculation uses validated trip data and records the pricing configuration version used.

### 5.2 Driver-matching contract

1. Exclude drivers who are offline, unapproved, using an ineligible vehicle, stale in location, or already committed to a conflicting trip.
2. Use a geohash/radius query as a candidate-generation step; verify actual geographic distance after retrieval.
3. Rank eligible candidates with a configurable score, for example: distance, driver rating, recent acceptance rate, and estimated pickup time.
4. Send a time-limited offer. Acceptance must be claimed atomically by the backend so two concurrent requests cannot assign the same driver.
5. If no driver accepts, expand the search radius within configured limits or return a clear no-driver-found result.
6. Store score inputs and algorithm version for debugging; do not treat an ML score as a safety guarantee.

## 6. User stories and acceptance criteria

| Story | User story | Acceptance criteria |
|---|---|---|
| US-01 | As a new user, I want to create and verify an account so I can use DRIVE securely. | Given valid registration data, when verification succeeds, then a profile is created and the user reaches the correct role-aware home screen. Invalid codes or duplicate accounts show actionable errors. |
| US-02 | As a rider, I want pickup/destination autocomplete so I can request the right trip. | Given location permission or manually selected pins, when I select valid endpoints, then the map shows both points and a route estimate. Permission denial still allows manual location entry. |
| US-03 | As a rider, I want to compare vehicle categories and fares before booking. | Given valid endpoints, when fare estimation succeeds, then Bike/Car/Premium options display estimated price, ETA, and breakdown. If routing fails, the app does not invent a route-based quote. |
| US-04 | As a rider, I want a nearby eligible driver matched to me. | Given at least one eligible online driver, when I request a ride, then the server creates one assignment and both parties receive the matching trip ID. Concurrent accept attempts cannot create two assignments. |
| US-05 | As a driver, I want to accept or decline an offer before it expires. | Given a valid offer, when I accept before expiry and the offer remains unclaimed, then the server assigns it once. Expired, cancelled, or already-claimed offers are rejected. |
| US-06 | As a rider, I want to track the arriving driver and active trip. | Given an assigned active trip, when location updates arrive, then the authorized rider sees the latest location and status. A stale/offline state is visibly indicated rather than showing a false live position. |
| US-07 | As a rider, I want to cancel under a clear policy. | Given a cancellable trip, when I cancel, then the server evaluates the configured policy, updates state once, records any applicable fee, and notifies affected parties. Repeated cancellation requests are idempotent. |
| US-08 | As a rider, I want to share a ride and split costs. | Given compatible route, capacity, and detour limits, when a shared group is formed, then each participant sees their own fare and group state. If constraints fail, the app offers a solo ride instead. |
| US-09 | As a vehicle owner, I want to rent out my vehicle without double booking. | Given an approved available vehicle, when a rental is confirmed, then availability locks are acquired atomically for the requested interval. A conflicting request is rejected. |
| US-10 | As a driver/owner, I want approval status and required document feedback. | Given submitted documents, when an admin approves or rejects the application, then the applicant receives status and, for rejection, a safe reason/instructions. Unapproved accounts cannot publish/serve protected inventory. |
| US-11 | As a rider, I want to pay and receive a receipt. | Given a completed bill, when payment succeeds or cash is recorded according to policy, then the server stores a payment record and a receipt. A client cannot mark a card payment successful by writing Firestore directly. |
| US-12 | As a rider, I want safety options during a trip. | Given an active trip, when I use trip sharing or SOS, then an incident/share record is created and configured notifications are attempted. The UI explains if network/provider limitations prevent delivery. |
| US-13 | As an admin, I want to review driver/vehicle applications. | Given an admin account, when I approve/reject an application, then the decision is audited and the applicant's trusted approval state changes server-side. Non-admin requests are denied. |
| US-14 | As an admin, I want to configure fares and promotions. | Given a valid pricing configuration, when I publish it, then new quotes use that version and existing quotes retain their original version until expiry. Invalid negative rates or unreasonable surge limits are rejected. |
| US-15 | As a user, I want English/Bangla and accessible controls. | Given either supported locale and a configured theme, when I navigate core screens, then labels, errors, and controls remain legible, keyboard/screen-reader accessible where supported, and no core action relies on colour alone. |
| US-16 | As an admin/support operator, I want anomaly and safety alerts to be reviewable. | Given a route deviation, unusual stop, repeated cancellation, or suspicious location pattern, when a threshold is met, then the system creates a signal with evidence and confidence; it does not automatically accuse or permanently ban a user based only on a model score. |

## 7. Use cases

### UC-01 — Register/sign in

- **Primary actor:** Guest.
- **Preconditions:** Firebase Authentication is configured; the selected sign-in provider is enabled.
- **Main flow:** User selects a method → enters required credentials/OTP → provider verifies identity → backend creates/loads profile → role/approval status is loaded → app opens the permitted home screen.
- **Alternatives:** Invalid OTP/password, cancelled Google sign-in, rate limit, network failure, disabled account.
- **Postcondition:** Authenticated session exists only after provider verification; no role privilege is inferred from client input.

### UC-02 — Request and match a ride

- **Primary actor:** Rider. **Supporting actors:** Driver, Maps provider.
- **Preconditions:** Rider is authenticated and allowed to book; pickup/destination are valid; pricing config is active.
- **Main flow:** Select endpoints/category → request route and estimate → confirm request → backend validates request and creates a ride → candidate drivers are ranked → an offer is sent → first valid acceptance is atomically assigned → rider/driver receive status updates.
- **Alternatives:** Invalid route, no eligible drivers, all offers expire, rider cancels, driver becomes unavailable, duplicate network retry.
- **Postcondition:** One ride has a consistent state and at most one active driver assignment.

### UC-03 — Complete a trip and settle payment

- **Primary actor:** Rider/driver.
- **Preconditions:** A driver is assigned; ride is in a state that permits start.
- **Main flow:** Driver arrives → pickup is confirmed → driver starts trip → location/status updates are published → driver ends trip → backend validates transition and computes final fare → payment method is processed/recorded → receipt and review eligibility are created.
- **Alternatives:** GPS/network outage, payment failure, dispute, safety incident, cancellation/no-show.
- **Postcondition:** Ride reaches a valid terminal state; fare and payment records are auditable and not client-editable.

### UC-04 — Reserve a rental vehicle

- **Primary actor:** Rider/renter. **Supporting actor:** Vehicle owner.
- **Preconditions:** Vehicle and owner are approved; vehicle is listed and eligible for the requested interval.
- **Main flow:** Search/filter vehicles → inspect details → choose rental interval → server checks and locks availability → owner approval is collected if required → booking is confirmed → payment/deposit policy is recorded → handover and return events update the booking.
- **Alternatives:** Vehicle unavailable, owner rejects/times out, payment fails, overlapping booking race, renter cancels.
- **Postcondition:** No two confirmed bookings hold the same vehicle/time slot.

### UC-05 — Submit and approve a driver/owner application

- **Primary actor:** Driver or owner. **Supporting actor:** Admin.
- **Main flow:** Applicant completes profile → uploads documents to a protected Storage path → application enters pending review → admin inspects metadata/documents → admin approves or rejects with reason → backend writes an audit event and updates eligibility → applicant is notified.
- **Postcondition:** Protected actions are enabled only when all required approvals are valid.

### UC-06 — Trigger SOS or share a trip

- **Primary actor:** Rider; driver may also have an incident action.
- **Preconditions:** A trip exists; trusted contact is configured for contact notification.
- **Main flow:** User triggers SOS/share → backend validates participant and trip → creates a time-stamped incident/share token → captures latest available location and trip context → attempts push/SMS/deep-link notifications through configured providers → authorized operator can review the incident.
- **Alternatives:** Device offline, location permission denied, notification provider unavailable, trip already ended.
- **Postcondition:** The app displays whether the request was recorded and whether delivery could be confirmed. The feature does not promise emergency dispatch.

### UC-07 — Manage pricing, disputes, and refunds

- **Primary actor:** Admin.
- **Preconditions:** Admin authorization is validated server-side.
- **Main flow:** Admin opens a trip/rental/payment record → inspects audit/history → changes a versioned pricing/promo rule or records a dispute decision → refund request is sent to the payment adapter where supported → result is stored and user notified.
- **Postcondition:** Every privileged change records actor, timestamp, reason, and affected record; unsupported refunds remain explicitly pending/manual.

## 8. Domain and state-transition rules

### 8.1 Ride lifecycle

Permitted happy path:

**requested → matching → accepted → driver_arriving → in_progress → completed**

Allowed terminal/exception states include **cancelled**, **no_driver_found**, **expired**, and **disputed** (dispute is preferably a separate case linked to a completed ride). Only the backend may commit trusted state transitions. Every transition checks the current state, actor, assignment, and relevant timestamps. Retries must be idempotent.

### 8.2 Rental lifecycle

**requested → awaiting_owner (when owner approval is required) → confirmed → active → completed**

Exception states: **rejected**, **cancelled**, **expired**, **disputed**. A rental cannot become confirmed unless the vehicle is approved, the owner is eligible, the requested interval is valid, and the required availability locks are acquired.

### 8.3 Payment lifecycle

**created → pending → succeeded** or **failed**. Refunds are represented separately as **requested → processing → succeeded/failed**. Cash has an explicit cash-recorded/collected state; it must not be falsely represented as a successful online gateway charge.

### 8.4 Required business invariants

1. Only approved drivers with an eligible vehicle can go online or start a trip.
2. A driver cannot hold conflicting active assignments.
3. A ride has at most one assigned driver at a time.
4. A vehicle cannot have overlapping confirmed rental intervals.
5. The server owns fare, discount, cancellation fee, payment status, approval, refund, and earnings calculations.
6. A client can read/write only data allowed by identity, role, trip participation, and ownership.
7. Only trip participants can read private trip location/chat; only eligible completed-trip participants can review.
8. Document files are private by default and are readable only by the applicant and authorized reviewers.
9. Pricing/promo changes are versioned and audited.
10. A model anomaly is a review signal, not conclusive proof of fraud or grounds for an irreversible automated penalty.
11. Safety notifications are best-effort and must show honest delivery status.
12. Rental/ride state transitions and payment side effects must be idempotent against retries.

## 9. Non-functional requirements

The PDF names performance, usability, scalability, security, and portability. The targets below operationalize those quality attributes for implementation and testing.

| ID | Attribute | Requirement / measurable target |
|---|---|---|
| NFR-01 | Performance | On a healthy supported network, target p95 under 2 seconds from an accepted driver-location update to display by an authorized subscribed rider. Measure separately from device GPS sampling and third-party routing latency. |
| NFR-02 | API response | Core non-map business requests target p95 under 2 seconds in the test environment at the documented test load; slow third-party operations return a loading/error state rather than blocking indefinitely. |
| NFR-03 | Availability and resilience | A failed map, payment, ML, or notification provider must not corrupt the ride/rental state. Use timeouts, retries with backoff, idempotency keys, and deterministic fallbacks where safe. |
| NFR-04 | Security | Enforce authentication, server-side authorization, Firestore/Storage rules, App Check where supported, validation, least privilege, and secrets management. No private service/API secret is committed to Git. |
| NFR-05 | Privacy | Collect only required identity/location data; disclose location use; limit trip-location visibility to authorized participants; define retention and deletion policy before production use. |
| NFR-06 | Scalability | Use indexed queries, paginated admin lists, bounded real-time subscriptions, RTDB for high-frequency ephemeral location, and aggregate analytics rather than unbounded client scans. |
| NFR-07 | Battery/network | Driver location sampling adapts to online/arriving/in-trip state, distance moved, and OS permissions; location publishing pauses when offline and resumes safely. |
| NFR-08 | Usability | Core booking/rental actions are reachable with clear labels, confirmations for destructive actions, skeleton/loading states, empty/error states, and recovery guidance. |
| NFR-09 | Accessibility | Support scalable text, semantic labels, adequate contrast, keyboard navigation on web, screen-reader-friendly controls, and status indicators not conveyed by colour alone. |
| NFR-10 | Portability | Flutter supports the selected Android/iOS targets; React dashboard supports current desktop browsers. Device/API availability is validated in setup documentation. |
| NFR-11 | Localization | English and Bangla strings are externalized; currency, date, number, and direction formatting use locale-aware formatters. |
| NFR-12 | Maintainability | Clean Architecture in Flutter, feature modules, typed request/response contracts, linting, tests, code review, and documented architecture decisions. |
| NFR-13 | Observability | Record structured logs, correlation IDs, transition/audit events, provider failures, and aggregate latency metrics without logging passwords, OTPs, payment secrets, or unnecessary precise location history. |
| NFR-14 | Integrity | Critical operations use transactions/conditional updates and idempotency; concurrency tests cover ride assignment, rental slot reservation, payments, and refunds. |
| NFR-15 | ML governance | Store model/version and relevant evaluation metadata; compare predictions with baselines; monitor drift; provide safe fallbacks and human review for safety/fraud signals. |

## 10. UML and system diagrams

### 10.1 Use-case diagram

~~~mermaid
flowchart LR
  Guest[Guest]
  Rider[Rider / Passenger]
  Driver[Driver]
  Owner[Vehicle Owner]
  Admin[Administrator]
  Maps[Google Maps Platform]
  Pay[Payment Provider]
  Notify[Push / Contact Notification Provider]

  UC1((Register / Sign in))
  UC2((Manage Profile))
  UC3((Search / Rent Vehicle))
  UC4((Request Ride))
  UC5((Estimate Fare / ETA))
  UC6((Match Driver))
  UC7((Track / Share Trip))
  UC8((SOS / Safety Mode))
  UC9((Share Ride / Split Fare))
  UC10((Go Online / Accept Offer))
  UC11((Start / End Trip))
  UC12((Manage Vehicle / Rental))
  UC13((Pay / View Receipt))
  UC14((Review / History))
  UC15((Approve Accounts))
  UC16((Manage Pricing / Promo))
  UC17((Resolve Dispute / Refund))
  UC18((View Analytics))
  UC19((Tourist Recommendations))

  Guest --> UC1
  Rider --> UC1
  Rider --> UC2
  Rider --> UC3
  Rider --> UC4
  Rider --> UC5
  Rider --> UC7
  Rider --> UC8
  Rider --> UC9
  Rider --> UC13
  Rider --> UC14
  Rider --> UC19
  Driver --> UC2
  Driver --> UC10
  Driver --> UC11
  Driver --> UC7
  Driver --> UC8
  Driver --> UC14
  Owner --> UC2
  Owner --> UC12
  Admin --> UC15
  Admin --> UC16
  Admin --> UC17
  Admin --> UC18
  UC4 --> UC5
  UC4 --> UC6
  UC3 --> UC13
  UC11 --> UC13
  UC5 --> Maps
  UC7 --> Maps
  UC19 --> Maps
  UC13 --> Pay
  UC8 --> Notify
~~~

### 10.2 Class diagram

~~~mermaid
classDiagram
  class User {
    +String uid
    +String displayName
    +String email
    +String phone
    +String locale
    +String accountStatus
  }
  class RiderProfile {
    +String uid
    +List savedPlaces
    +List trustedContactIds
    +Boolean womenSafetyEnabled
  }
  class DriverProfile {
    +String uid
    +String approvalStatus
    +Boolean online
    +Double ratingAverage
    +Double acceptanceRate
  }
  class OwnerProfile {
    +String uid
    +String approvalStatus
  }
  class Vehicle {
    +String vehicleId
    +String ownerId
    +String type
    +String approvalStatus
    +String availabilityStatus
    +Int seatCount
  }
  class Ride {
    +String rideId
    +String riderId
    +String driverId
    +String status
    +GeoPoint pickup
    +GeoPoint destination
    +String vehicleType
    +String pricingVersion
    +Money estimatedFare
    +Money finalFare
  }
  class SharedRideGroup {
    +String groupId
    +String status
    +String routeKey
    +Double maxDetourPercent
  }
  class RideParticipant {
    +String riderId
    +String rideId
    +Money allocatedFare
    +String participantStatus
  }
  class RentalBooking {
    +String bookingId
    +String renterId
    +String vehicleId
    +DateTime startAt
    +DateTime endAt
    +String status
    +Money total
  }
  class Payment {
    +String paymentId
    +String subjectType
    +String subjectId
    +String method
    +String status
    +Money amount
    +String providerReference
  }
  class Rating {
    +String ratingId
    +String subjectId
    +String authorId
    +Int score
    +String comment
  }
  class SafetyIncident {
    +String incidentId
    +String tripId
    +String reporterId
    +String type
    +String status
    +DateTime createdAt
  }
  class PricingConfig {
    +String version
    +String vehicleType
    +Double baseFare
    +Double perKm
    +Double perMinute
    +Double surgeCap
  }

  User "1" --> "0..1" RiderProfile
  User "1" --> "0..1" DriverProfile
  User "1" --> "0..1" OwnerProfile
  OwnerProfile "1" --> "0..*" Vehicle
  DriverProfile "1" --> "0..*" Ride : assigned driver
  RiderProfile "1" --> "0..*" Ride : requests
  Vehicle "1" --> "0..*" RentalBooking
  RiderProfile "1" --> "0..*" RentalBooking : rents
  Ride "1" --> "0..*" Payment
  RentalBooking "1" --> "0..*" Payment
  Ride "1" --> "0..*" Rating
  Ride "1" --> "0..*" SafetyIncident
  SharedRideGroup "1" --> "1..*" RideParticipant
  PricingConfig ..> Ride : prices
~~~

### 10.3 Ride-request sequence diagram

~~~mermaid
sequenceDiagram
  autonumber
  actor Rider
  participant App as Flutter App
  participant CF as Cloud Functions
  participant FS as Firestore
  participant RT as Realtime Database
  participant Maps as Google Maps
  participant Driver as Driver App
  participant Push as FCM

  Rider->>App: Select pickup, destination, vehicle type
  App->>Maps: Request route and ETA
  Maps-->>App: Route, distance, estimated duration
  App->>CF: Create ride request + estimate inputs
  CF->>FS: Validate rider and active pricing version
  CF->>FS: Create ride in requested/matching state
  CF->>RT: Query eligible nearby driver locations
  CF->>FS: Load trusted driver eligibility and availability
  CF->>CF: Filter and rank candidates
  CF->>Push: Send expiring offer to candidate driver
  Push-->>Driver: Ride offer
  Driver->>CF: Accept offer with ride/offer ID
  CF->>FS: Transactionally claim ride and driver
  alt Claim succeeds
    CF->>FS: Set assigned driver and accepted status
    CF->>Push: Notify rider and driver
    CF-->>App: Assigned ride + driver summary
  else Offer expired or already claimed
    CF-->>Driver: Reject stale offer
    CF->>CF: Try next candidate or finish matching
  end
  loop While trip is active
    Driver->>RT: Publish location
    RT-->>App: Authorized location update
  end
~~~

### 10.4 ER / Firestore relationship diagram

Firestore is document-oriented, not a relational database. The diagram shows logical references; some display fields are intentionally denormalized into ride/rental snapshots so historical receipts remain stable if a profile changes.

~~~mermaid
flowchart TD
  Users[users/{uid}]
  Drivers[driverProfiles/{uid}]
  Owners[ownerProfiles/{uid}]
  Vehicles[vehicles/{vehicleId}]
  Rides[rides/{rideId}]
  Participants[sharedRideGroups/{groupId}/participants/{uid}]
  Rentals[rentalBookings/{bookingId}]
  Payments[payments/{paymentId}]
  Ratings[ratings/{ratingId}]
  Chats[rides/{rideId}/messages/{messageId}]
  Incidents[safetyIncidents/{incidentId}]
  Prices[pricingConfigs/{version}]
  Promos[promoCodes/{promoId}]
  Docs[Cloud Storage: private driver-owner documents]
  Locations[Realtime Database: driverLocations/{uid}]
  Events[rideEvents/{eventId}]
  Locks[vehicleReservationLocks/{vehicleId_slotKey}]

  Users --> Drivers
  Users --> Owners
  Owners --> Vehicles
  Drivers --> Rides
  Users --> Rides
  Rides --> Events
  Rides --> Chats
  Rides --> Payments
  Rides --> Ratings
  Rides --> Incidents
  Vehicles --> Rentals
  Users --> Rentals
  Rentals --> Payments
  Rentals --> Locks
  Rides --> Participants
  Prices --> Rides
  Promos --> Payments
  Drivers -. documents .-> Docs
  Owners -. documents .-> Docs
  Drivers -. live presence .-> Locations
~~~

### 10.5 High-level architecture diagram

~~~mermaid
flowchart TB
  subgraph Clients
    Mobile[Flutter App: Rider / Driver / Owner]
    Admin[React Admin Dashboard]
  end

  subgraph TrustedBackend[Trusted application boundary]
    Functions[Firebase Cloud Functions - TypeScript]
    Rules[Firestore / Storage Security Rules]
    ML[FastAPI ML Service]
  end

  subgraph Firebase
    Auth[Firebase Authentication]
    Firestore[(Cloud Firestore: durable business data)]
    RTDB[(Realtime Database: live presence/location)]
    Storage[(Cloud Storage: private documents/media)]
    FCM[Firebase Cloud Messaging]
    Config[Remote Config / App Check]
  end

  subgraph External
    Maps[Google Maps: Maps, Places, Routes, Geocoding]
    Payments[Payment Adapter: Cash / Stripe Test / future local gateway]
    Contacts[Push / SMS / deep-link contact notifications]
  end

  Mobile --> Auth
  Admin --> Auth
  Mobile --> Functions
  Admin --> Functions
  Mobile --> RTDB
  Mobile --> Maps
  Functions --> Firestore
  Functions --> RTDB
  Functions --> Storage
  Functions --> FCM
  Functions --> ML
  Functions --> Maps
  Functions --> Payments
  Functions --> Contacts
  Mobile --> Config
  Admin --> Config
  Rules -. enforce .-> Firestore
  Rules -. enforce .-> Storage
~~~

## 11. Firestore and Realtime Database data contract

The following collection names form the initial schema. Firestore is document-oriented; some display fields are intentionally denormalized into ride/rental snapshots so historical receipts remain stable if a profile changes.

| Path | Important fields | Access / purpose |
|---|---|---|
| users/{uid} | displayName, email, phone, locale, photoUrl, accountStatus, createdAt | User reads/updates permitted profile fields only; privileged status is server-owned |
| driverProfiles/{uid} | approvalStatus, documentStatus, vehicleIds, rating, acceptanceRate, approvedAt | Driver and authorized admins; online eligibility checked by backend |
| ownerProfiles/{uid} | approvalStatus, payoutStatus, createdAt | Owner and authorized admins |
| vehicles/{vehicleId} | ownerId, type, make/model, registration metadata, seatCount, photos, approvalStatus, rentalRate, availabilityStatus, serviceArea | Owner reads/writes own allowed fields; public listing exposes only approved safe fields |
| driverApplications/{uid} | submittedAt, reviewStatus, reviewerId, reasonCode, audit timestamps | Applicant sees own status; only admin reviews/decides |
| rides/{rideId} | riderId, driverId, pickup/destination, route summary, vehicleType, status, estimate, finalFare, pricingVersion, currency, timestamps | Participants read allowed fields; server owns status/fare/assignment |
| rideEvents/{eventId} | rideId, actorId, eventType, fromStatus, toStatus, createdAt, metadata | Append-only audit/event history; server writes |
| sharedRideGroups/{groupId} | status, route summary, capacity, detour limit, participant IDs | Participants see allowed group data; server controls admission/fare split |
| sharedRideGroups/{groupId}/participants/{uid} | riderId, pickup/destination, allocatedFare, status | Participant and backend under rules |
| rentalBookings/{bookingId} | renterId, ownerId, vehicleId, startAt, endAt, status, price snapshot, deposit/policy snapshot | Renter/owner read relevant booking; server controls reservation state |
| vehicleReservationLocks/{lockId} | vehicleId, slotStart, bookingId, lockStatus, createdAt | Server-only reservation concurrency control |
| payments/{paymentId} | subjectType, subjectId, payerId, amountMinor, currency, method, provider, providerReference, status, idempotencyKey, timestamps | Payer reads own records; trusted backend writes status |
| pricingConfigs/{version} | currency, vehicle rates, minimum fare, service fee, surge bounds, cancellation rules, effectiveAt, createdBy | Public safe quote fields; only admin via server can publish |
| promoCodes/{promoId} | codeHash/code, rules, startsAt, expiresAt, maxUses, status | Read through quote/redeem function; admin writes |
| promoRedemptions/{id} | promoId, uid, subjectId, discountMinor, createdAt | User sees own redemption; server enforces limits |
| ratings/{ratingId} | subjectId, authorId, targetId, score, comment, createdAt | Eligible author and relevant profile summary; one review per eligible subject/author |
| rides/{rideId}/messages/{messageId} | senderId, body, createdAt, delivery metadata | Ride participants only, while access policy permits |
| trustedContacts/{uid}/contacts/{contactId} | displayName, encrypted/validated contact value, relationship, consent flags | User and server only; never publicly queryable |
| safetyIncidents/{incidentId} | tripId, reporterId, type, latestLocation, route context, status, createdAt, assignedOperatorId | Reporter and authorized safety/admin roles; strict access and audit |
| disputes/{disputeId} | subjectType, subjectId, openedBy, reason, status, decision, audit events | Parties see permitted case details; admin/support resolves |
| notifications/{notificationId} | uid, type, titleKey, bodyArgs, readAt, createdAt, deepLink | Only the recipient can read/mark own notification |
| dailyMetrics/{dateKey} | aggregate counts and totals | Admin/analytics service only; aggregate data, not unrestricted user tracking |
| demandForecasts/{zone_timeKey} | zoneId, timeBucket, predictedDemand, modelVersion, generatedAt | Drivers/admin see safe aggregate heat-map data |
| appConfig/public | supported vehicle types, locales, safe public flags | Read-only public configuration; no secrets |
| Realtime Database driverLocations/{uid} | lat, lng, geohash, heading, speed, accuracy, updatedAt, availability | Driver writes only own validated location; reads are restricted to matching/active-trip use cases |

### 11.1 Storage and indexing rules

- Store driver licences, vehicle papers, and private application photos in private Storage paths scoped to UID/application; do not make these files publicly readable.
- Use server-generated IDs for rides, rentals, payments, incidents, and audit events.
- Create composite indexes for common queries, such as rides by rider/status/createdAt, rides by driver/status, rental bookings by vehicle/startAt/endAt, applications by reviewStatus/submittedAt, and notifications by uid/createdAt.
- Avoid a collection-wide scan for nearby drivers. RTDB/geohash candidate retrieval is followed by trusted eligibility checks in the backend.
- For rental conflicts, the booking function acquires all relevant fixed-duration reservation slots in a transaction and rejects any already-held slot. The implementation must cap interval length and batch safely within Firestore transaction/write limits.
- Keep payment-provider secrets in Secret Manager or server environment configuration; never store them in Firestore documents readable by clients.
- Keep precise location only for the operational period required by the trip and approved retention policy; aggregate or delete it afterward.

## 12. Proposed repository structure

This is the target structure for the phased implementation; directories will be introduced when their phase is implemented.

~~~text
CSE412_Drive/
├── README.md
├── docs/
│   ├── PHASE_1_SRS_ARCHITECTURE.md
│   ├── ADR/
│   ├── api/
│   ├── testing/
│   └── report/
├── apps/
│   ├── mobile/                 # Flutter rider/driver/owner app
│   └── admin-web/              # React administrator dashboard
├── services/
│   ├── functions/              # Firebase Cloud Functions (TypeScript)
│   └── ml-api/                 # FastAPI + evaluated model artifacts
├── packages/
│   └── contracts/              # Shared API schemas and event names
├── firebase/
│   ├── firestore.rules
│   ├── firestore.indexes.json
│   ├── storage.rules
│   └── database.rules.json
└── .github/
    └── workflows/              # CI checks added in Phase 9
~~~

## 13. Security design

1. **Identity:** Firebase Authentication verifies the principal; account status is checked for sensitive actions.
2. **Authorization:** Firestore/Storage rules deny by default. Cloud Functions repeat authorization checks; hiding a button is not security.
3. **Privileged roles:** Admin claims are set only through a trusted administrative process. A client cannot set its own admin or approval status.
4. **Validation:** Validate IDs, status transitions, coordinates, fare inputs, time intervals, currency, promo eligibility, document types/sizes, and request rate.
5. **Concurrency:** Use transactions/conditional state checks for driver assignment, rental locks, promo redemption, and idempotent payment/refund requests.
6. **Secrets:** Store server API keys and gateway secrets in server-side secret storage. Restrict Google Maps keys by application and API; use separate client/server keys.
7. **Payments:** Never accept client assertions as proof of payment. Verify gateway callbacks/signatures on the server and never store card PAN/CVV.
8. **Location privacy:** Use least-privilege RTDB rules and short-lived trip access. Do not expose all drivers' exact locations to every authenticated user.
9. **Documents:** Use private Storage, content-type/size validation, signed/authorized access, and audit logs for admin review.
10. **Abuse resistance:** Rate-limit sensitive actions, apply App Check where available, record repeated cancellations/location anomalies, and route suspicious cases for review.
11. **Safety:** SOS delivery status must be truthful; the app must not imply emergency services have been contacted unless a provider confirms that operation.
12. **Audit:** Log privileged approvals, fare changes, refunds, account suspensions, and incident access with actor, timestamp, and reason.

## 14. Architecture decisions

| Decision | Choice | Reason |
|---|---|---|
| AD-01 | Flutter, role-aware single mobile codebase | Shares map, auth, design-system, and domain code while preserving separate rider/driver/owner navigation and permissions |
| AD-02 | React for admin | Responsive web interface, table/filter workflows, and charting suit operational management |
| AD-03 | Firestore for durable records; RTDB for live location | Separates transactional business data from high-frequency presence/location updates |
| AD-04 | Cloud Functions as trusted business boundary | Centralizes validation, authorization, idempotency, matching, pricing, and provider calls |
| AD-05 | FastAPI for ML only | Isolates Python model dependencies; the main app continues to function when ML is unavailable |
| AD-06 | Server-calculated price snapshots | Preserves auditability and prevents client-side price manipulation |
| AD-07 | Provider adapters for payments and notifications | Supports cash and Stripe test mode now while keeping future bKash/SSLCommerz integration separate |
| AD-08 | Google Maps for production-like routes plus local graph demo | Uses real road data for the app while making Dijkstra/A* understandable and testable for coursework |
| AD-09 | Versioned configuration and model metadata | Allows repeatable quotes, safe rollbacks, and fair evaluation |
| AD-10 | Safety/anomaly signals require review | Avoids presenting imperfect heuristics or ML scores as definitive judgments |

## 15. Phase 1 verification checklist

- [x] The submitted PDF's functional requirements are represented: authentication/security, user management, vehicle rental, smart booking, matching/cost sharing, live tracking, fare prediction, route optimization, multi-currency payments, Women Safety Mode, emergency/safe-trip system, and Tourist Mode.
- [x] The PDF's non-functional categories are represented: performance, usability, scalability, security, and portability.
- [x] The PDF's domain rules are represented: role-based access, verified drivers, no conflicting rides, no overlapping rentals, valid fares, and safe payment handling.
- [x] Implementation-brief additions are represented: chat/call-ready abstraction, notifications, reviews/history, promotions/cancellation, earnings, admin disputes/refunds/analytics, ML, localization, dark mode, and CI/CD roadmap.
- [x] User stories and acceptance criteria are written.
- [x] Use cases, lifecycle rules, use-case diagram, class diagram, sequence diagram, Firestore relationship diagram, and architecture diagram are included.
- [x] Initial Firestore/Realtime Database collection contract and target repository structure are defined.
- [x] Security, privacy, concurrency, and academic-demo boundaries are documented.

## 16. Items fixed for implementation unless the team changes them

- First demo market/currency: Bangladesh / BDT.
- First online payment integration: Stripe test mode only where the account/project supports it; cash is supported. The payment adapter remains ready for a separately configured local gateway.
- Ride assignment, fare calculation, rental conflict checking, approval, and payment state are server-authoritative.
- The initial app supports rider, driver, and owner roles; admin access is web-based.
- Safety alerts and ML anomaly detection are best-effort academic features and must not be marketed as guaranteed protection.
- Phase 1 introduces documentation only. Firebase keys, Maps keys, Stripe test secrets, and deployment configuration are added in the implementation phases and must never be committed as real secrets.

**Phase 1 exit criterion:** the team agrees that this SRS, its business rules, and the data/architecture diagrams are the baseline for Phase 2. Any requirement change after this point should be recorded as a versioned decision rather than silently changing the implementation.
