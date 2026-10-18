# DRIVE Admin Console — Phase 8

Full React + TypeScript + Vite admin operations workspace. See [Phase 8 documentation](../../docs/PHASE_8_ADMIN_OPERATIONS.md).

## What you can do

- Sign in with Firebase Auth and a trusted `admin: true` claim.
- Review pending drivers (including private Firebase Storage documents), owners and rental vehicle listings.
- Approve/reject with a recorded rationale through Cloud Functions.
- Review read-only bounded ride, rental and payment records (no direct financial writes).
- Triage recorded safety incidents with a server-audited open → in_review → resolved/dismissed workflow.
- Publish a new server-validated BDT pricing version.
- Inspect a bounded, read-only audit trail and recent sampled analytics.

The dashboard deliberately cannot settle payments, refund a live transaction, grant itself admin privileges or notify emergency responders. Overview numbers are **recent samples**, not platform-wide totals.

## Windows PowerShell quickstart

~~~powershell
cd CSE412_Drive\apps\admin
npm install
Copy-Item .env.example .env.local
notepad .env.local
npm test
npm run build
npm run dev
~~~

For local Firebase Emulator Suite, point the public Firebase client settings in .env.local at your emulator project and set VITE_FIREBASE_USE_EMULATORS=true. This is honored only on localhost/127.0.0.1; sign in with a pre-existing Auth Emulator account that has a server-issued admin custom claim.

To read private documents, set VITE_FIREBASE_STORAGE_BUCKET, and ensure Firebase Storage emulator or production Storage is reachable and the bucket is CORS-configured for your admin web origin. The app retrieves short-lived in-memory blobs; it does not store service-account credentials or Firebase token-bearing download URLs.

For production App Check, register your web app with reCAPTCHA Enterprise before setting VITE_RECAPTCHA_ENTERPRISE_SITE_KEY and enabling backend enforcement. Use a restricted HTTPS admin domain, trusted roles, WAF and a reviewed MFA policy.

See docs/PHASE_8_ADMIN_OPERATIONS.md for deployment commands, test cases and remaining operational gaps.

## Phase 8 redo: local build and deployment

The full implementation and security constraints are in
[Phase 8 Admin Operations](../../docs/PHASE_8_ADMIN_OPERATIONS.md).

```powershell
cd CSE412_Drive\apps\admin
npm install
Copy-Item .env.example .env.local
notepad .env.local
npm test
npm run build
npm run audit:bundle
npm run dev
```

The dev server binds to 127.0.0.1 by default. The server-only admin APIs are
`lookupAdminUser`, `reviewServiceDispute`, `reviewSafetyIncident`, and the
existing trust-reviewed approval/pricing callables. The customer-facing
`openServiceDispute` is also callable only by the verified participant.

To deploy, use a SEPARATE Firebase Hosting site and
`firebase.admin.json` target `drive-admin`; see the main Phase 8 guide.
Production Firebase Auth/App Check, domain, security headers and live KYC
document access require testing. No real refund, settlement or emergency
notification is performed through this admin dashboard.
