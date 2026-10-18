# DRIVE — Phase 7: ML, Cloudflare, Scalability and Abuse Protection

**Course:** East West University, CSE412, Fall 2026.
**Baseline:** 412_Project_Requirement.pdf, submitted 6 October 2026; Phase 1 SRS.
**Status:** Phase 7 source, unit tests, infrastructure templates and capacity design. Not a live production deployment.

## 1. Original functional requirements (complete audit)

The 11-page submitted PDF divides requirements into 12 functional features, five non-functional requirements and domain rules. "Source implemented" means code exists in GitHub, NOT that provider, OS, security, end-to-end or scale testing succeeded.

| PDF feature | Present in repository | Still missing |
|---|---|---|
| 1 Authentication & Security | Firebase Auth email/OTP, roles, claims, Firestore rules; Phase 7 App Check integration | Production App Check enforcement, device verification, suspicious-user monitoring and security audits |
| 2 User Management | Rider, driver and vehicle-owner profiles, onboarding and approvals | Complete operational admin tooling, role changes, unified service history |
| 3 Vehicle Rental | Rental marketplace, owner listing, time-window locks and owner approval | Provider-connected rental payment, real device tests and owner editing/photos |
| 4 Smart Ride Booking | Pickup/destination, Maps API, server fare, ride status | Production Google Maps credential tests and performance tests |
| 5 Smart Ride Match & Cost Sharing | Geohash nearby-driver matching, expiring offers and driver locks | Shared passengers, capacity/detour validation and individually split fares |
| 6 Real-Time Ride Tracking | RTDB trip-scoped foreground GPS, stale position signal | Background consent and battery handling, retention and fan-out scalability |
| 7 Smart Fare Prediction | Rule-based trusted fare; Phase 7 historical ML advisory forecast | Real traffic/demand data, validated model accuracy and approval for production |
| 8 AI Route Optimization | Google Routes and navigation, Phase 7 experimental ETA model | Genuine AI route optimization, alternatives, refresh and evaluation |
| 9 Multi-Currency Payment | BDT cash and Stripe TEST signed webhooks | Multiple currencies, FX conversion, rental payment, live reconciliation |
| 10 Women Safety Mode | Driver verification and limited SOS record foundation | Preference UX, eligible-driver preferences, trusted contact sharing |
| 11 Smart Emergency & Safe Trip | SOS incident recorded, experimental anomaly rules | Actual trusted-contact alerts, real time route monitoring, incident escalation |
| 12 Tourist Mode | Maps/location foundation only | Attractions/facilities, tour preferences and multi-stop travel planning |

**PDF non-functional requirements:** Performance, Usability, Scalability, Security and Portability. PDF domain rules: role authorization, only verified drivers, no conflicting driver assignments or double-booked rental windows, trusted fares, safe payment and trip procedures.

**Critical distinction:** The PDF does not specify a numeric throughput, model accuracy or million-user concurrency target. Those must be proposed, measured and accepted independently. This phase does NOT mark shared rides, Women Safety Mode, Tourist Mode or multi-currency payments complete.

## 2. Phase 7 deliverables in code

    services/ml/app/features.py            — validated features, strict input shape
    services/ml/app/train.py               — historical data training, time-based evaluation
    services/ml/app/main.py                — FastAPI ETA/fare/demand/anomaly API
    services/ml/tests/                     — API, feature contract, safe fallback and model tests
    services/ml/Dockerfile                 — non-root image for IAM-private Cloud Run
    services/functions/src/ml_proxy.ts     — authenticated ownership and rate limiting
    apps/mobile/lib/features/rider/        — optional experimental ML preview
    apps/mobile/lib/core/config/firebase_bootstrap.dart — App Check setup
    infra/cloudflare/                     — optional Worker, rate limits and tests
    tests/load/                            — safe staging-only k6 health load test
    .github/workflows/phase7-ml-edge.yml  — dedicated tests
    docs/PHASE_7_ML_SCALABILITY_SECURITY.md

ML predictions have no authority to edit the actual fare, accepted driver, payout, ride state or safety incidents. If no model is installed, model endpoints return 503. The Cloud Function sends only a server-owned rider quote ID and reuses the baseline quoted fare if ML is unavailable. The Flutter UI labels all ML insights experimental.

## 3. ML data, training and validation

Original PDF describes distance, ride type, traffic, time and demand as inputs but provides NO training dataset. Source now includes a pipeline, not a pre-trained reliable production model.

Required consented, de-identified, time-ordered historical CSV columns:

    distance_km,traffic_index,demand_index,hour_local,weekday,vehicle_type,eta_minutes,observed_fare_minor,requests_next_hour

Train (from services/ml):

    py -3.12 -m venv .venv
    .venv\Scripts\Activate.ps1
    python -m pip install -e ".[test]"
    pytest -q
    python -m app.train --csv data\historical_trips.csv --out models --version candidate-001

Models use HistGradientBoostingRegressor and 80/20 temporal holdout; compare MAE with a median-only baseline. Artifacts store SHA-256 and a manifest, are ignored from Git, and production_approved defaults to false. Experimental artifacts are not loaded by default. Joblib/Pickle can execute code: NEVER load untrusted model files; hash checks do not authenticate the source or replace signing/code review.

The temporary traffic_index=1 and demand_index=1 sent from the backend are NEUTRAL PROXIES, not current road congestion or live demand. A demand model without a real geographic cell feature is not location-specific deployment-ready forecasting. Route-deviation and long-stop outputs are explicitly rule based, not automatic police/contacts notification. Review privacy, consent, geographic bias, safety and drift before any real deployment.

Local service:

    cd CSE412_Drive\services\ml
    uvicorn app.main:app --host 127.0.0.1 --port 8080

GET /healthz returns models_ready=false without models. Prediction endpoints return 503, not invented estimates. The private ML API provides POST /v1/predict/eta, /fare, /demand, /all and /v1/anomaly/route.

## 4. Private Cloud Run deployment

Never deploy the ML API with public unauthenticated access. Build with project credentials you own; use an IAM service identity dedicated to Cloud Functions.

    gcloud config set project YOUR_STAGING_PROJECT
    gcloud run deploy drive-ml --source services/ml --region asia-south1 --no-allow-unauthenticated --min-instances 0 --max-instances 8 --concurrency 16 --cpu 1 --memory 512Mi

The container starts without production model artifacts unless a reviewed pipeline provides them. The callable uses GoogleAuth.getIdTokenClient with the service URL as audience, and the deployed Functions service identity must have ONLY roles/run.invoker on drive-ml:

    gcloud run services add-iam-policy-binding drive-ml --region asia-south1 --member="serviceAccount:YOUR_FUNCTIONS_IDENTITY" --role="roles/run.invoker"

Set DRIVE_ML_SERVICE_URL to the real https Cloud Run service URL in your Functions staging environment. This is a server configuration, not a Flutter parameter. A quote must belong to the signed-in user, must be unexpired and passes an eight-second per-user transaction-backed minimum gap. Service errors and timeouts fail to server baseline without writing bad ML values. Current service caps are budgets, not proof of high-scale performance.

## 5. Cloudflare and DDoS security design

Cloudflare is an optional layer for your **own custom HTTP API/admin website domain**. Cloudflare does NOT automatically protect Firebase Auth, Firestore, Realtime Database, Cloud Functions callable domains, FCM or Storage accessed directly through Flutter SDK.

    Public website / custom API
          ↓
    Cloudflare DNS proxy + WAF + managed DDoS/bot rules
          ↓
    Cloudflare Worker optional route and rate limiting
          ↓
    Protected HTTPS API origin or load balancer (Cloud Armor + origin verification)
          ↓
    Firebase Auth and App Check verification, IAM authorization, server quota
          ↓
    Backend datastore / private Cloud Run ML

Worker source: infra/cloudflare/src/index.js. Wrangler example: infra/cloudflare/wrangler.toml. Tests: infra/cloudflare/tests/edge.test.mjs.

Worker restricts /api/v1/ to GET/POST, caps declared request sizes, blocks redirects and unknown routes, uses per-IP coarse and per-auth-string quotas, requires Authorization and App Check headers to exist, requires HTTPS fixed origin, sends origin-only secret, and never caches protected responses. IMPORTANT: Worker header checks do NOT validate token signatures. Origin MUST validate Firebase ID token, App Check token, roles, origin secret and per-user usage. User token strings can be rotated by attackers; supplement with Cloudflare WAF/Bot rules and origin protection. Mobile carrier-grade NAT creates shared IPs: tune thresholds carefully.

Before deployment, obtain domain, Cloudflare account, origin gateway, secured Cloud Armor/ingress and account-specific rate-limit namespace IDs (example IDs in Wrangler MUST be replaced). Configure Cloudflare managed WAF, DDoS protection, bot rules, analytics, alerts, challenge/exemption policy, TLS strict and DNS proxy. DO NOT indiscriminately challenge Stripe webhooks: signature-verifying provider integrations require deliberate route policies.

    cd CSE412_Drive\infra\cloudflare
    npm install
    npm test
    npx wrangler login
    npx wrangler secret put DRIVE_ORIGIN_URL
    npx wrangler secret put DRIVE_ORIGIN_AUTH
    npx wrangler deploy

Workers Rate Limiting bindings execute after the Worker has started; they complement, but do not replace, edge-network DDoS mitigation. No DDoS protection is absolute.

## 6. Firebase App Check rollout

Flutter Android Play Integrity and Apple App Attest + DeviceCheck fallback are integrated for **non-emulator real clients** using firebase_app_check 0.5.0. Backend callables have opt-in enforcement controlled by DRIVE_ENFORCE_APP_CHECK=true.

**Safe rollout order:**
1. Register legitimate Firebase Android signing keys and Apple App Check providers.
2. Confirm App Check token issuance from real devices in staging.
3. Measure rejected/valid requests before enforcing.
4. Enable DRIVE_ENFORCE_APP_CHECK=true on Functions, deploy and validate login/booking/chat/payment.
5. Enforce Firestore, RTDB and Storage App Check product-by-product only when every required supported client is ready.
6. Maintain rollback/runbook and ensure emulator/debug tokens are never valid as unrestricted production clients.

App Check is not user authentication or a replacement for Firestore rules. Direct Firebase endpoints remain accessible on Firebase's domains: require strong identity/security rules, quotas and abuse monitoring.

## 7. Scaling toward millions of users: roadmap, not current claim

A million registered accounts is different from a million concurrent connected drivers and riders. Actual sizing must derive DAU, concurrent trips, GPS update rates, bookings/minute, location fanout, chat messages, retries, Maps lookups, Firestore reads/writes, RTDB bandwidth and payment provider costs.

| Component | Current bottleneck | High-scale upgrade needed |
|---|---|---|
| Driver geo matching | One RTDB geohash collection plus limited-range query and up to 90 driver profile checks | City/cell sharding, bounded batch lookup, queued dispatch, strict location TTL, failover |
| GPS streaming | Foreground driver location and trip subscriptions | Event coalescing, adaptive sampling, regional shards, retention TTL, listener limits |
| Firestore rides | Active locks and transaction writes | Avoid hot documents, TTL old quotes/keys/offers, partition history, index costs, backpressure |
| External Maps APIs | Route/Places billed lookups | API quotas, cache permitted public data, debounce, per-account budgets |
| Cloud Functions | Stateless callables but budgeted maxInstances | Cloud Tasks, Pub/Sub, cold-start measurement, reserved limits/circuit breakers, regional design |
| ML | Private Cloud Run and quota | Batch non-critical demand jobs, versioned registry, shadow rollout, geographic audit, safe fallback |
| Payments | Stripe TEST and cash reporting | Provider retries, financial ledger, payout and refund reconciliation, audit |
| Safety | Manual SOS and experimental anomaly rules | Priority queue and actually monitored response channel before any safety launch |
| Abuse/DDoS | Rules and optional Cloudflare Worker | Cloud Armor, WAF, App Check enforcement, multi-dimensional quotas, tested incident responses |
| Observability | CI/unit tests | SLO dashboards, distributed tracing, structured redacted logs, alerting, spending caps |

Engineering candidate SLOs for review (NOT PDF promises): p95 website cached response under 300ms in target region, authenticated read API p95 under 700ms, ride booking p95 under 1.5 seconds under defined load, availability objective 99.9% only after redundancy. These are targets, not measurements.

## 8. Safe load testing

Staging-only k6 script: tests/load/k6_staging_health.js.
It REQUIRES an HTTPS host you own with staging. or staging- prefix. It uses five virtual users for one minute, tests ONLY /healthz and refuses arbitrary production targets. This does NOT prove booking throughput, ML performance, direct Firebase scale, millions of users or DDoS immunity.

    k6 run -e DRIVE_STAGING_URL=https://staging.yourdomain.example tests/load/k6_staging_health.js

For realistic load, provision an isolated paid test environment and gradually increase load after quotas/billing alarms. Track p50/p95/p99 latency, auth denied rate, quote/booking failures, Firestore contention and spend, RTDB listener bandwidth, Google Maps quota, Cloud Run concurrency/cold starts, FCM fail rates, WAF actions, false positives and recovery time. Never stress test a live external payment provider.

## 9. Threat model and release gates

| Threat | Controls | Remaining risk |
|---|---|---|
| HTTP volumetric DDoS | Cloudflare WAF/DDoS once configured, origin rate and Cloud Armor | Provider outages, bypass, misconfiguration |
| Firebase direct endpoint abuse | App Check, Auth, quotas, rules, alerts | Compromised devices, account farms and provider overload |
| Fare/payment fraud | Trusted quote, server calculation, signed Stripe webhook | Business fraud and account compromise |
| ML artifact poison | Controlled artifact pipeline, manifest checks, human approval | Poisoned input data, supply chain compromise |
| GPS/user privacy leak | RTDB access scoping, Auth and data minimization | Insider access, long retention or UI leakage |
| Incorrect ML or false SOS | Offline authoritative fallback, advisory-only predictions | Drift, wrong routes or missed real safety incidents |

**Definition of Phase 7 code completion:**
- [x] Original requirement PDF audit and gaps
- [x] Private FastAPI ML training and inference code
- [x] Model absence/error safe fallback, no silent false ML claim
- [x] Authenticated Cloud Run invocation with quote ownership and per-user quota
- [x] Optional Flutter experiment preview
- [x] App Check client activation and staged backend switch
- [x] Cloudflare Worker rate limiting and tests (NOT deployed)
- [x] Guarded staging load test and dedicated CI
- [ ] Real historical consented dataset, evaluated and reviewed models
- [ ] Actual deployed Cloudflare zone/origin gateway and real-device App Check
- [ ] Million-user capacity load tests / DDoS readiness, NOT VERIFIED
- [ ] Full shared ride/cost sharing, Women Safety Mode, Tourist Mode and multi-currency

Do not proceed to later phases without explicit request.
