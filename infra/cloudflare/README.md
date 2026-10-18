# Cloudflare edge security for DRIVE custom web/API domains

This optional Cloudflare Worker only fronts YOUR explicitly routed
custom HTTP API domain. **It does not automatically front Firebase
Authentication, Firebase callable functions, Firestore, RTDB, FCM or Storage
when the Flutter SDK talks to Google services directly.**

Configure Cloudflare zone DNS proxy (orange cloud), managed WAF rules, bot
rules, rate limits, TLS strict, challenge options and logging; protect the
actual origin through Cloud Armor or equivalent so direct bypass fails.
Never use a Worker secret as the sole Firebase user authorization.

A Worker Rate Limiting binding is per Cloudflare account namespace and
applies AFTER Worker dispatch. It cannot alone absorb all DDoS. Mobile
carrier-grade NAT can put many legitimate users on one IP: monitor
false positives, tune quota and grant appropriate exemptions.

## Run edge unit tests

```powershell
cd CSE412_Drive\infra\cloudflare
npm install
npm test
```

## Deployment (you supply domain/account, not configured in repo)

1. Create a Cloudflare account and add a domain you control.
2. Update ratelimit namespace_id values in wrangler.toml to distinct
   account-specific positive numbers. Do not use the shared example IDs.
3. Configure a server-side HTTPS origin API gateway, with Firebase Auth
   token verification, App Check validation, per-user quotas and checks for
   the x-drive-origin-key secret; lock down origin network access.
4. Set the origin URL and origin secret using Wrangler, on YOUR machine:

```powershell
npx wrangler login
npx wrangler secret put DRIVE_ORIGIN_URL
npx wrangler secret put DRIVE_ORIGIN_AUTH
npx wrangler deploy
```

5. Add your own DNS route/domain to Wrangler or the Workers dashboard,
   with proxy enabled and WAF rules. Test from staging first.
6. Set WAF rate limiting on paths, adaptive challenge for bots, country
   anomaly alerting, budget alerts, Cloud Armor at public Google entry
   points and Firebase App Check rollout.
7. Do not proxy payment webhooks through challenge pages: provider
   signatures and explicit allow-list are required at webhook endpoint.

Only explicitly configured API routes are forwarded. All unrecognized
paths are 404, redirects are blocked, and origin errors fail closed.
See docs/PHASE_7_ML_SCALABILITY_SECURITY.md for migration sequencing.
