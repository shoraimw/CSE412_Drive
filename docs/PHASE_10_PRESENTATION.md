# DRIVE — Phase 10 Final Presentation (14 slides, 10–12 minutes)

**Audience:** CSE412 faculty and peers • **Ground rules:** Never show real KYC or secrets. Label every proposed/future feature honestly. Slides are a reproducible outline for PowerPoint/PDF.

## Slide-by-slide structure and spoken notes

### 1. Title (30s)
- **DRIVE — Smart Ride-Sharing & Vehicle Rental**
- CSE412 Software Engineering, EWU
- Team members / IDs [fill in]
- **Speaker:** "We designed and tested a role-based ride-hailing and vehicle-rental academic prototype."

### 2. Problem and motivation (45s)
- Separate rider/driver/owner tools add complexity.
- Approved driver identity and double-booked rentals need trusted controls.
- Financial/safety state should never be editable by the client.
- **Speaker:** "Our focus was trustworthy workflows, not a commercial launch claim."

### 3. Users and objectives (45s)
- Rider, verified driver, vehicle owner, trusted administrator.
- Secure onboarding, matching, rentals, auditable operations.
- Show BDT as demo base currency.
- **Speaker:** "Each role can access only its own authorized data."

### 4. Requirements traceability (50s)
- 12 top-level features from requirements PDF.
- Implemented core: booking/rentals/driver/admin source.
- Partial: sharing, GPS, ML, payment, safety; unimplemented Tourist.
- **Speaker:** "Source completion and deployment acceptance are different statuses."

### 5. Technology stack (40s)
- Flutter, Firebase Auth/Functions/Firestore/RTDB/Storage, React/Vite.
- FastAPI advisory ML; optional Cloudflare edge for custom API domain.
- **Speaker:** "Trusted operations run on Cloud Functions, not the mobile phone."

### 6. System architecture (60s)
- Client → Auth → Cloud Functions → data stores.
- Firestore durable state; RTDB location; Storage private docs.
- Admin web uses trusted staff claims.
- **Speaker:** "The server owns critical state changes and authorization."

### 7. Rider and driver workflow (60s)
- Map pickup/destination → trusted quote → request.
- Geohash candidate selection → expiring offer → one approved driver.
- Driver ride lifecycle, participant GPS.
- **Speaker:** "We prevent duplicate acceptance using trusted server state."

### 8. Vehicle rental workflow (55s)
- Owner approval + listing approval → rental marketplace.
- Duration/price preview → backend price + transactional slot locks.
- Overlap conflict refusal and cancellation.
- **Speaker:** "Rental locks protect the vehicle from two concurrent reservations."

### 9. Admin and safety review (50s)
- 12-view admin dashboard: approvals, cases, support, pricing and audit.
- Trusted account lookup; two-admin dispute ownership; stale pricing rejection.
- Incident review is internal only, **not emergency dispatch**.
- **Speaker:** "Operator actions are traceable, and a case does not issue a refund."

### 10. ML/edge engineering (45s)
- Advisory FastAPI ETA/fare/demand experiment; no approved trained model.
- Optional Cloudflare Worker for controlled custom API routes; not direct Firebase SDK.
- **Speaker:** "We separate future scalability design from measured capability."

### 11. QA and CI outcomes (75s)
- Automated Firebase emulator, Flutter, admin, FastAPI and Worker tests.
- Phase 9 gate success: run 39129534777.
- Dispatch geohash index namespace failure found and corrected.
- **Speaker:** "We report actual automated evidence, not invented performance numbers."

### 12. Deployment readiness (45s)
- Staging workflow manually guarded; requires Firebase staging account and WIF.
- Real devices / App Check / WAF / k6 / rollback **pending**.
- **Speaker:** "No real staging deployment or million-user benchmark is claimed."

### 13. Live demo roadmap (70s)
- Start local emulators → Flutter emulated rider → driver/owner → admin.
- Show rejected unauthorized operations and dispute/pricing concurrency.
- Screenshots or pre-recorded local demo permitted if live demo unavailable.
- **Speaker:** "For demonstration, only local test accounts and fake data."

### 14. Conclusion, future work and Q&A (60s)
- Multi-role trustworthy architecture and tests.
- Missing: cost-sharing, real multicurrency, Women Safety, Tourist Mode and real SOS.
- **Speaker:** "Future work is a staged, measurable and secure path to complete requirements."

## Timing

Slides 1–14 approximately 11 minutes; leave 3–5 minutes for faculty questions. Cite the source PDFs/requirements matrix and GitHub Actions run on the closing/appendix slide.

## Presenter checklist

- Fill true team names, course ID, date and instructor.
- Replace placeholder screenshots with screenshots from **your own test setup** only.
- Prepare browser/mobile capture on stable demo network; no real payment or phone number.
- Display CI run and point out last successful SHA.
- Be ready to say plainly which features are partial or not implemented.

See [viva and demo guide](PHASE_10_DEMO_VIVA.md).
