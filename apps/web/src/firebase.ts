import {getApp, getApps, initializeApp} from "firebase/app";
import {getAuth, connectAuthEmulator} from "firebase/auth";
import {getFirestore, connectFirestoreEmulator} from "firebase/firestore";
import {getFunctions, connectFunctionsEmulator} from "firebase/functions";
import {getStorage, connectStorageEmulator} from "firebase/storage";
import {getDatabase, connectDatabaseEmulator, type Database} from "firebase/database";
import {initializeAppCheck, ReCaptchaEnterpriseProvider} from "firebase/app-check";

const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL
};

export const firebaseReady = [
  config.apiKey, config.authDomain, config.projectId, config.appId
].every(value => typeof value === "string" && value.trim().length > 0);

const app = firebaseReady
  ? (getApps().length ? getApp() : initializeApp(config))
  : null;

export const auth = app ? getAuth(app) : null;
export const db = app ? getFirestore(app) : null;
export const functions = app ? getFunctions(app, "asia-south1") : null;
export const storage = app && config.storageBucket ? getStorage(app) : null;
export const rtdb: Database | null = app && config.databaseURL ? getDatabase(app) : null;

const useEmulators = import.meta.env.VITE_FIREBASE_USE_EMULATORS === "true";
const localHost = typeof location !== "undefined" &&
  ["localhost", "127.0.0.1"].includes(location.hostname);

if (app && useEmulators && localHost) {
  if (auth) connectAuthEmulator(auth, "http://127.0.0.1:9099", {disableWarnings: true});
  if (db) connectFirestoreEmulator(db, "127.0.0.1", 8080);
  if (functions) connectFunctionsEmulator(functions, "127.0.0.1", 5001);
  if (storage) connectStorageEmulator(storage, "127.0.0.1", 9199);
  if (rtdb) connectDatabaseEmulator(rtdb, "127.0.0.1", 9000);
} else if (app && import.meta.env.VITE_RECAPTCHA_ENTERPRISE_SITE_KEY) {
  initializeAppCheck(app, {
    provider: new ReCaptchaEnterpriseProvider(
      import.meta.env.VITE_RECAPTCHA_ENTERPRISE_SITE_KEY
    ),
    isTokenAutoRefreshEnabled: true
  });
}

