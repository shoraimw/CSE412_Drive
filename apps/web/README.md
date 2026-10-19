# DRIVE Customer Website — Phase 11

This is the customer-facing React website. It is separate from \`apps/admin\` and shares the same Firebase backend and server-owned ride/rental/payment functions as the Flutter app. It is an implementation foundation; live integrations require a real Firebase staging project and provider credentials.

## Local setup (Windows PowerShell)

\`\`\`powershell
cd CSE412_Drive
cd apps/web
npm install
Copy-Item .env.example .env.local
notepad .env.local
npm test
npm run build
npm run dev
\`\`\`

Populate \`.env.local\` from your **Firebase Web app configuration** in a dedicated staging project. Do not copy service-account JSON, Stripe secret keys, webhook secrets or Google Maps server keys into this file. All \`VITE_*\` values are bundled into the browser and must be treated as public.

## Implemented in this first slice

- Responsive DRIVE landing page and ride/rental/trip navigation.
- Email/password sign-up/sign-in, password reset, Google popup sign-in and Phone OTP UI.
- Profile initialization via trusted \`ensureProfile\` Cloud Function.
- Places autocomplete and resolution via existing authenticated callables.
- Server-generated BDT fare quote and idempotent ride request, with driver dispatch attempt.
- Approved rental listing browse, reservation through server lock function, and cancellation.
- Own ride/payment history queries and Cash / Stripe TEST checkout for completed eligible rides.
- Localized error messages, responsive states and helper tests.

## Configuration required before live use

1. Enable Email/Password, Google and Phone providers in Firebase Authentication.
2. Add the exact Netlify staging hostname under Firebase Authentication authorized domains. Google OAuth must include the appropriate authorized domain/origin.
3. Configure Firebase App Check for web (reCAPTCHA Enterprise) before enforcing it for this site.
4. Deploy Cloud Functions and rules from the current project. Configure the Google Maps server key as a Functions secret; do not put it in browser env variables.
5. Configure server-side \`DRIVE_CHECKOUT_RETURN_BASE_URL\`, \`STRIPE_TEST_SECRET_KEY\` and \`STRIPE_TEST_WEBHOOK_SECRET\` through approved secret/environment configuration. Stripe TEST webhook events must be received by the deployed function.
6. Create and seed active BDT pricing through trusted backend/Admin. Without this, fare quotes correctly fail rather than invent prices.
7. Test Phone OTP with Firebase's authorized test phone numbers first; real SMS requires appropriate billing/quota and region configuration.

## Vercel

The repo includes `apps/web/vercel.json` for SPA route fallback and baseline security headers. To deploy, import `shoraimw/CSE412_Drive` into Vercel and set **Root Directory** to `apps/web`. Use `npm run build` as the build command and `dist` as the output directory. Add the staging Firebase Web configuration as project environment variables, then deploy a Preview first. Add the preview hostname to Firebase Authentication's authorized domains and verify the end-to-end flow before promoting to Production.

## Netlify

\`netlify.toml\` sets base directory \`apps/web\`, build command \`npm run build\`, publish directory \`dist\`, SPA fallback and baseline security headers. Connect this GitHub repository to the user's Netlify account and choose the customer website deployment. Add the same staging Firebase Web config as Netlify environment variables. Keep emulator mode false in deployed environments.

## Scope limits

- The website does not create admin/driver/owner privileges or bypass server-side authorization.
- Stripe remains TEST only. Live payments or bKash/SSLCommerz require a merchant account, server-side adapter, signed webhooks and separate acceptance tests.
- Browser live GPS/chat, full driver/owner web portal, promo codes, shared ride fare splitting, complete emergency delivery and multi-currency are not claimed as completed by this first slice.
- Do not connect production data until the staging acceptance suite passes.
