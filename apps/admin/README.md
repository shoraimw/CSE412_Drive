# DRIVE Admin Dashboard — FR-03 baseline

React + TypeScript + Vite. Current implemented workflow: secure sign-in, server-claim verification, pending vehicle listing, approve/reject through the Firebase callable `reviewRentalVehicle`.

## Run on Windows

```powershell
cd CSE412_Drive\apps\admin
npm install
Copy-Item .env.example .env.local
# Edit .env.local with Firebase Web app settings from Firebase Console.
npm run dev
```

Only the public Firebase Web app config belongs in `.env.local`. Never put a service account, Firebase Admin SDK private key, Stripe secret or webhook secret in the browser bundle.

The signed-in account must have a server-assigned `admin: true` custom claim. The UI does not grant admin rights. The callable independently enforces administrator authorization. Firestore rules allow administrators to query vehicle listings; client writes remain denied.

Build:

```powershell
npm run build
```

This is the FR-03 vehicle approval slice, not yet the complete admin system for user/driver verification, disputes, refunds, pricing and analytics.
