# DRIVE — Phase 11: Customer-Facing Web Platform

**Status:** Initial React/Vite customer-web foundation committed; CI pending. Not deployed and not yet full requirement-complete.
**Repository:** `shoraimw/CSE412_Drive`
**Purpose:** Add a customer-facing, responsive website to the existing DRIVE system without duplicating the mobile app's database or creating a second source of truth.

## Product decision

The existing `apps/admin` is the operations console. It is not the public rider website. Phase 11 now adds `apps/web` as a separate customer-facing application; Admin remains a separately protected application.

## Current implementation status (first slice)

Committed source includes a responsive landing/ride/rental/trip UI, Firebase Web SDK bootstrap, email/password sign-up/sign-in and password reset, Google popup sign-in, Phone OTP flow, trusted `ensureProfile`, authenticated Places autocomplete/resolution, server-generated fare quotes, idempotent ride requests and dispatch attempt, approved rental listing browse/reservations/cancellation, own ride/payment subscriptions, cash choice and Stripe TEST checkout. Unit tests, Netlify SPA/security config, a setup README and a dedicated GitHub Actions test/build workflow are also included.

This is an initial integration slice, not a full website release. Browser-based active-trip tracking/chat/ratings, complete account/profile UX, bilingual localization, driver/owner web portal, promotional codes, rental payment, live bKash/SSLCommerz, complete shared-ride/women safety/tourist workflows and production acceptance remain outstanding. GitHub Actions status must be checked for the current commit before claiming CI passed.

## Recommended stack

- React + TypeScript + Vite in `apps/web`.
- Netlify for static frontend build/deploy, branch previews, generated `*.netlify.app` URL and HTTPS.
- The SAME Firebase project as the Flutter mobile app and Admin: Firebase Authentication, Cloud Firestore, Realtime Database where required, Cloud Functions in `asia-south1`, and Storage.
- Use existing server-authoritative Cloud Function APIs for fares, booking, matching, rental booking, checkout and protected state changes. Do not implement trusted fare or payment decisions in browser code.
- Keep `apps/admin` as a separate deployment and access boundary.
- Add `netlify.toml` with SPA route fallback, security headers and explicit build/publish paths. Add a Netlify deploy-preview and production environment separation.

## Customer-facing website scope

### Public pages
- DRIVE home/landing page, service explanation, Bike/Car/Premium, vehicle rental, safety/FAQ and contact/support information.
- Responsive desktop/mobile layout, keyboard accessibility, reduced-motion support, clear loading/empty/error states, English and Bangla.

### Authentication and profile
- Email/password sign-up and sign-in, Google sign-in, phone verification where supported, email verification and password reset.
- Use Firebase Auth; never store passwords in Firestore or client storage.
- Create/update user profile through the existing trusted `ensureProfile` callable. Respect role/approval claims from the backend, never trust client-supplied admin/driver roles.

### Rider web flow
- Authenticated pickup/destination search with Places autocomplete and place resolution.
- Fare estimates for supported vehicle categories via `getFareQuote`.
- Server-owned quote IDs, expiry and idempotency keys; submit ride via `requestRide`; dispatch via `dispatchNearbyDrivers` only where the existing contract authorizes it.
- My rides, live trip status, participant-only tracking/chat, cancellation under server policy, ratings and receipts/history where available.
- A web browser must request location permission explicitly. Do not expose another rider's or driver's precise location outside an authorized active trip.

### Rental flow
- Browse only approved, rental-enabled vehicles; show server-owned rental price and availability.
- Authenticated reservation using `createRentalBooking` and cancellation using `cancelRentalBooking`; rely on server-side slot locks to prevent overlapping bookings.
- Owner onboarding and listing management only to the extent existing trusted APIs support them. Do not create direct client writes to approval fields.

### Payments
- Cash where supported and existing Stripe TEST checkout/webhook workflow for eligible completed rides.
- Payment gateway secrets and webhook signing secrets stay server-side; never place them in `VITE_*` variables or a browser bundle.
- Add a provider adapter boundary for bKash/SSLCommerz. Live integration requires the team's merchant account, provider-approved credentials, signed webhook verification, idempotent payment state transitions, reconciliation and end-to-end sandbox tests. "Ready for adapter" is not the same as a live gateway.
- Do not collect or store card numbers/CVV in the DRIVE website.

## Shared data model and source of truth

Use the existing Firebase project and existing collections, not a separate Netlify database:
- `users`, `driverProfiles`, `driverApplications`, `ownerProfiles`
- `vehicles`, `rides`, `rentalBookings`, `payments`
- `tripLocations` in Realtime Database for scoped live tracking
- existing message, rating, dispute and safety records where access rules permit

Exact collection fields and writes must follow `docs/PHASE_1_SRS_ARCHITECTURE.md`, `docs/PHASE_2_FIREBASE.md`, `docs/PHASE_4_RIDER.md`, `docs/PHASE_5_DRIVER.md`, `docs/PHASE_6_PAYMENTS_CHAT_NOTIFICATIONS.md` and the current Functions schemas. If a requested feature has no authorized backend API, implement that API and tests first; do not bypass the backend with direct client writes.

## Security and robustness gates

- Firestore/Realtime Database/Storage rules enforce user ownership and trip-participant access.
- Cloud Functions validate authentication, role, App Check where configured, input schema, fare/quote ownership, status transitions and idempotency.
- No admin service account or private API secret in the client bundle.
- Rate limits and abuse controls at backend boundaries; privacy-minimized logs; bounded queries and pagination.
- Firebase Emulator Suite integration tests plus web unit tests and build in GitHub Actions.
- Test auth providers, account/role denial, expired quote, duplicate booking/payment retries, rental overlap, unauthorized ride/location reads, webhook signature failures, and mobile/web consistency against the same staging project.
- Use a dedicated staging Firebase/GCP project first. Do not connect an untested web app directly to production users.

## Hosting and cost reality

Netlify Free is a reasonable initial option for a static React website. Current published plan: $0/month with a hard 300-credit monthly limit; if the limit is reached, projects pause until the next billing cycle. Netlify-managed HTTPS is included. A custom domain name can cost extra.

Netlify hosts the website frontend; it does not make Firebase services, Google Maps APIs, SMS verification or payment processing free. Firebase Cloud Functions requires the Blaze billing plan, which includes eligible no-cost quotas plus pay-as-you-go charges beyond quotas. Set billing alerts, quotas and operational spend controls before deploying. Budget alerts are not guaranteed hard spending caps.

Do not promise production availability or millions of concurrent users on the free tier. Measure traffic, Firebase usage, maps/SMS calls and payment-provider costs, then upgrade hosting or backend capacity as required.

## Deployment plan

1. Create `apps/web`; implement UI shell and route-level error/loading states.
2. Reuse Firebase configuration patterns and callable contracts, while keeping emulator mode restricted to localhost.
3. Implement authentication/profile and role-aware route guards.
4. Implement rider fare quote/booking/trip history and rental browse/booking.
5. Integrate cash and Stripe TEST where existing backend supports it; add bKash/SSLCommerz only after merchant credentials and provider requirements are available.
6. Add tests, CI, secret scanning, Netlify build configuration and a staging-only deployment gate.
7. Link the GitHub repository to the user's Netlify account; set the base directory to `apps/web`, build command `npm run build`, publish directory `dist`, and add public Firebase Web app environment variables for the staging project.
8. Verify every acceptance test on desktop and Android mobile browsers. Only then connect a custom domain or approve production rollout.

## Acceptance criteria

- Public pages load and work on mobile and desktop without horizontal overflow.
- Sign-up, email/password, Google and phone auth each pass provider-configured tests; unsupported/missing configuration shows a helpful error rather than a dead-end screen.
- A rider can create a server quote, request a ride, see the saved trip and only access their own history.
- A renter can browse approved vehicles, book an available slot and see an overlap rejection from the server.
- A retry cannot create duplicate rides, bookings or charges.
- Cash and Stripe TEST flows match server payment state; invalid webhook signatures are rejected.
- A normal user cannot access admin routes, private KYC files, other users' rides or unauthorized live GPS.
- CI passes; Netlify staging build works; manual release sign-off records the actual deployed commit and remaining unsupported features.
- The same Firebase data is visible to the authorized mobile app and Admin console; no second source of truth is created.

## Out of scope until separately implemented and tested

Real payment settlement/refunds/payouts, full multi-currency FX, complete shared-ride fare splitting, complete Women Safety and Tourist Mode, external emergency dispatch, approved production ML predictions, and million-user load claims remain gated by the requirements traceability matrix.
