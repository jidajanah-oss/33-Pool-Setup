import {
  getApp,
  getApps,
  initializeApp,
  type FirebaseApp,
} from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";
import { getFirestore, type Firestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey:
    import.meta.env.VITE_FIREBASE_API_KEY?.trim() ||
    "AIzaSyBG31vFFSWD3rKHfl9vNHitSdzi0dhqS7A",
  authDomain:
    import.meta.env.VITE_FIREBASE_AUTH_DOMAIN?.trim() ||
    "pool-setup.firebaseapp.com",
  projectId:
    import.meta.env.VITE_FIREBASE_PROJECT_ID?.trim() ||
    "pool-setup",
  storageBucket:
    import.meta.env.VITE_FIREBASE_STORAGE_BUCKET?.trim() ||
    "pool-setup.firebasestorage.app",
  messagingSenderId:
    import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID?.trim() ||
    "325613897812",
  appId:
    import.meta.env.VITE_FIREBASE_APP_ID?.trim() ||
    "1:325613897812:web:dec7c3447965f8a93a45c1",
};

export const isFirebaseConfigured = true;

const app: FirebaseApp =
  getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);

const auth: Auth = getAuth(app);
const db: Firestore = getFirestore(app);

export { app, auth, db };

export function requireFirebaseAuth(): Auth {
  return auth;
}

export function requireFirestore(): Firestore {
  return db;
}
