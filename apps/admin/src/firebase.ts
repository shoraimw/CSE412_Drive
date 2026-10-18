import {initializeApp} from "firebase/app";
import {getAuth, connectAuthEmulator} from "firebase/auth";
import {getFirestore, connectFirestoreEmulator} from "firebase/firestore";
import {getFunctions, connectFunctionsEmulator} from "firebase/functions";
import {getStorage, connectStorageEmulator} from "firebase/storage";
import {initializeAppCheck, ReCaptchaEnterpriseProvider} from "firebase/app-check";

const required = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};
const storageBucket = import.meta.env.VITE_FIREBASE_STORAGE_BUCKET;
const webAppCheckSiteKey = import.meta.env.VITE_RECAPTCHA_ENTERPRISE_SITE_KEY;
export const firebaseReady = Object.values(required).every(
  value => typeof value === "string" && value.trim().length > 0,
);
const app = firebaseReady ? initializeApp({
  ...required,
  ...(storageBucket ? {storageBucket} : {}),
}) : null;
export const auth = app ? getAuth(app) : null;
export const db = app ? getFirestore(app) : null;
export const functions = app ? getFunctions(app, "asia-south1") : null;
export const storage = app && storageBucket ? getStorage(app) : null;
const useLocalEmulator = import.meta.env.VITE_FIREBASE_USE_EMULATORS === "true";
if (useLocalEmulator && typeof location !== "undefined" &&
    ["localhost", "127.0.0.1"].includes(location.hostname)) {
  if (auth) connectAuthEmulator(auth, "http://127.0.0.1:9099", {disableWarnings:true});
  if (db) connectFirestoreEmulator(db,"127.0.0.1",8080);
  if (functions) connectFunctionsEmulator(functions,"127.0.0.1",5001);
  if (storage) connectStorageEmulator(storage,"127.0.0.1",9199);
} else if (app && webAppCheckSiteKey) {
  // Register your Firebase Web app with reCAPTCHA Enterprise in Firebase
  // Console BEFORE enabling App Check enforcement for Firestore or Storage.
  initializeAppCheck(app,{
    provider:new ReCaptchaEnterpriseProvider(webAppCheckSiteKey),
    isTokenAutoRefreshEnabled:true,
  });
}
