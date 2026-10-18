# SAFE staged load testing (k6)

These tests must only target HTTPS staging services you own, beginning with
staging. or staging- in the hostname. This script refuses production or public
third-party targets and runs at five virtual users for one minute. It tests an
edge /healthz only, NOT database booking capacity.

```powershell
k6 run -e DRIVE_STAGING_URL=https://staging.your-owned-domain.example tests/load/k6_staging_health.js
```

Run gradually larger experiments in a **separately isolated paid staging
project** only after you have billing alerts, WAF and provider approvals.
Collect p50/p95/p99, error rate, Cloud Run cold starts, DB read/write
amplification, firestore index pressure, RTDB bandwidth, App Check errors,
connection counts, Cloudflare WAF actions and total provider spend.

No million-user capacity claim may be made from this health-only script.
