# DRIVE — Phase 10 Local Demo Script, Windows Commands and Viva

**Demo integrity:** This script uses Firebase **local emulators**, not live production. Real Firebase credentials have not been provided. Use only fake test identities and test payment mode.

## 1. Prerequisites

- Windows 10/11, Git, Node.js 22+, Java 21, Flutter SDK, Android Studio SDK / Android Emulator, Python 3.11/3.12 if showing ML, an available browser.
- Clone: `git clone https://github.com/shoraimw/CSE412_Drive.git` (or `git pull origin main`).
- Execute commands in separate PowerShell terminals where indicated. Generated Android/iOS platform files and untracked config are intentionally not committed.

## 2. Start trusted backend (PowerShell window A)

```powershell
cd CSE412_Drive
npm install
npm --prefix services/functions install
npm run build
npm run emulators
```

Wait for the emulator UI at `http://127.0.0.1:4000`; Auth :9099, Functions :5001, Firestore :8080, RTDB :9000, Storage :9199. The local-only demo project is `demo-drive-local`. Use the [backend guide](PHASE_2_FIREBASE.md) for trusted seeding of the admin account and pricing rates before testing privileged flows; never grant admin claims in a browser.

## 3. Launch Android app (PowerShell window B)

```powershell
cd CSE412_Drive\apps\mobile
flutter create --project-name drive_mobile --platforms=android,ios .
flutter pub get
dart run tool/configure_phase6.dart
flutter gen-l10n
flutter analyze
flutter test
flutter devices
flutter run --dart-define=DRIVE_EMULATOR=true
```

If the Android emulator cannot reach backend, check the Flutter Firebase bootstrap's documented Android-emulator loopback (`10.0.2.2`) and local firewall. Real phones need an explicitly authorized network-exposed emulator setup or dedicated live staging, **not** the loopback demo switch.

## 4. Admin React dashboard (PowerShell window C)

```powershell
cd CSE412_Drive\apps\admin
npm install
```

Create a **local uncommitted** `.env.local` with matching `demo-drive-local` Firebase web app values as described in [admin README](../apps/admin/README.md), and `VITE_FIREBASE_USE_EMULATORS=true`. Never copy real provider server keys or service-account JSON into Vite env values. Then:

```powershell
npm run dev
```

Open the terminal-displayed local Vite URL. Sign in with the **server-claimed local test admin**; a non-admin account must be blocked. Show driver/owner/vehicle requests, dispute review, bounded analytics and versioned BDT pricing. Account lookup and KYC evidence should use fictional files only.

## 5. Demonstration narrative (8–10 minutes)

1. **Architecture (1 minute):** trace mobile → Auth → Cloud Functions → Firestore/RTDB/Storage; all role-sensitive mutations server-side.
2. **Rider registration and request (2 minutes):** sign in with dummy rider, choose pickup/destination, display estimate, submit request; state is stored in backend.
3. **Driver validation (1 minute):** a driver who lacks approved claim cannot accept/operate; trusted admin approves a test driver and driver sees offer.
4. **Rental conflict (1 minute):** owner creates vehicle, admin approves, renter attempts reservation; overlapping booking rejected, cancellation behavior visible.
5. **Admin operations (2 minutes):** sign in trusted admin, open disputes, show priority/reviewer ownership and immutable audit; demonstrate stale pricing guard using two browser sessions.
6. **Safety boundary (30 seconds):** simulated incident is an internal record, **not a real emergency call**.
7. **QA/CI (1 minute):** show [passing pipeline](https://github.com/shoraimw/CSE412_Drive/actions/runs/39129534777) and discuss the caught RTDB index defect.
8. **Limitations (30 seconds):** no production deployment, real ML prediction approval, shared fares, Women Safety/Tourist completion or million-user guarantee.

If a Maps API key is absent, demonstrate the backend's safe fallback rather than inventing route quality. If emulator data has not been seeded, show a **recorded** test run/safe screenshots and say the live flow was not executed.

## 6. Before the viva

Run:

```powershell
cd CSE412_Drive
npm test
node --test tests/qa/*.test.mjs
node tests/qa/scan_tracked_secrets.mjs
```

Show the PASS/FAIL output, check git SHA and latest GitHub workflow. Record the run date; do not present previous commit results as proof of a changed release.

## 7. Viva: concise answers

**Q1: Why Firebase?** Managed Auth, serverless Functions and database rules reduce operational overhead for an academic MVP, although vendor quotas and cost still need management.

**Q2: Firestore versus RTDB?** Firestore holds durable business data and auditable transactions; RTDB handles lower-latency driver presence and participant trip locations.

**Q3: Can clients edit fare?** No. Cloud Functions compute and persist authoritative pricing; Flutter displays server results.

**Q4: How do you avoid two drivers accepting one ride?** Trusted server-side status checks/atomic transitions ensure a single accepted assignment. The behavior is covered by emulator integration tests.

**Q5: How do you avoid overlapping rental bookings?** Server-controlled slot locks and transaction checks reject conflicting time windows.

**Q6: What stops a rider pretending to be admin?** Firebase custom claims assigned by trusted admin plus server callable guards and Firestore/Storage rules. Client display flags do not grant privileges.

**Q7: What is the geohash index issue?** Dispatch queried RTDB locations by geohash. The Functions emulator used mismatched database namespace/rules; CI caught a missing active index. The emulator configuration was corrected, then integration CI passed.

**Q8: How does Stripe work?** Only TEST Checkout/signed webhook path is implemented; it does not provide live settlement, refunds or payouts.

**Q9: Are ML fare predictions used as official fares?** No. Experimental inference is advisory; approved real-data models and governance are still missing.

**Q10: Is your app DDoS-proof or million-user tested?** No. The optional Cloudflare Worker is not deployed and cannot cover direct Firebase SDK traffic. Production mitigation and capacity require actual staged measurements.

**Q11: Does SOS contact police or a trusted friend?** No. The current SOS records an internal incident for administrative review; real escalation remains future work.

**Q12: Is Phase 9 finished?** Automated QA and release workflow source are complete, but real staging, devices, quotas, WAF and rollback are blocked pending project-owner controls. See [Phase 9 issue #3](https://github.com/shoraimw/CSE412_Drive/issues/3).

**Q13: What did you personally verify?** Separate implemented code, successful CI logs and actual manual tests you personally ran. Do not call an unrun test successful.

**Q14: What would you add next?** Shared-ride fare splitting, multi-currency reconciliation, Women Safety/trusted contacts, Tourist Mode, approved ML, real-device and security/load testing.

**Q15: What is your academic takeaway?** Requirements-to-code traceability, secure server-authoritative workflows, regression testing and explicit acceptance criteria matter as much as user-interface features.

## 8. Final submission checklist

- [ ] Insert actual student names/IDs and supervisor.
- [ ] Use [final report](PHASE_10_FINAL_REPORT.md), [presentation](PHASE_10_PRESENTATION.md), this demo script.
- [ ] Include **current** CI run URL and SHA.
- [ ] Record all manual tests as PASS/FAIL/BLOCKED; do not leave ambiguous.
- [ ] Remove secrets and personal data from screenshots/video.
- [ ] Note live Firebase project and remaining functional gaps accurately.
- [ ] Obtain supervisor sign-off.

Phase 10 academic materials are **draft-ready**; live release acceptance remains Phase 9 issue #3.
