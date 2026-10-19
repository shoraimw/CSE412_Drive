# DRIVE web live-fix checklist

The Vercel deployment only publishes the React frontend. It does not automatically enable Firebase sign-in providers, authorize the Vercel domain, deploy Cloud Functions, configure Google Maps secrets, or seed fare pricing.

## 1. Firebase Authentication

Open Firebase Console for project `drive-staging-284b1`.

1. Authentication → Sign-in method: enable Email/Password, Google, and Phone.
2. Authentication → Settings → Authorized domains: add the exact production hostname `drive-customer-aam793d3j-studyhelp0007-7593.vercel.app` (hostname only; no `https://` or path).
3. Also add the stable alias `drive-customer-web.vercel.app` if it will be used.
4. For Google sign-in, confirm the provider's support email is configured.
5. For Phone, verify SMS quota/billing/region settings. First test with Firebase Authentication's fictional test phone numbers.

## 2. Deploy backend functions to the STAGING project

The repository's `.firebaserc` intentionally defaults to `demo-drive-local`. Never deploy to that alias for hosted use. From a trusted Windows terminal with Firebase CLI installed and access to the staging project:

```powershell
firebase login
cd CSE412_Drive
cd services/functions
npm ci
npm run build
cd ../..
firebase deploy --only functions --project drive-staging-284b1
```

The Firebase project must have billing enabled as required for Cloud Functions. Review the deploy plan and project ID carefully before confirming.

## 3. Google Maps server secret

Autocomplete and place resolution are authenticated server callables and require the Places API key as a Functions secret. Set it only from a trusted terminal; never place it in Vercel's `VITE_*` variables or commit it:

```powershell
firebase functions:secrets:set GOOGLE_MAPS_SERVER_KEY --project drive-staging-284b1
firebase deploy --only functions --project drive-staging-284b1
```

Enable Places API (New) and Routes API in the linked Google Cloud project. Restrict the server key to the required APIs and keep it private.

## 4. Fare quotes and test payments

- Seed/publish a valid active pricing configuration using the approved Admin flow or the documented trusted seed script, after reviewing its values. Fare quotes correctly fail if no active pricing exists.
- Stripe test checkout requires `STRIPE_TEST_SECRET_KEY`, `STRIPE_TEST_WEBHOOK_SECRET`, and `DRIVE_CHECKOUT_RETURN_BASE_URL` configured server-side. Never put payment secrets in Vercel browser variables.
- Cash and Stripe callable functions must be deployed to `asia-south1`.

## 5. Vercel

Vercel project root: `apps/web`; build command `npm run build`; output `dist`. The browser Firebase configuration uses `VITE_FIREBASE_*` variables. After changing variables, trigger a new deployment so Vite bundles the new values.

## 6. Acceptance test

1. Open the deployed site and click Sign in. Confirm the modal opens.
2. Test Email/Password with a dedicated test account.
3. Test Google after authorizing the Vercel hostname.
4. Test Phone OTP with a Firebase fictional test phone number first.
5. Sign in, type at least three characters into pickup/destination, select a Places result.
6. Request a fare quote only after active BDT pricing has been seeded.
7. Test rides/payments only in staging. Do not treat a successful static deployment as a production-ready ride-hailing service.
