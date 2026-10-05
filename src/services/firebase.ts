import { initializeApp, type FirebaseApp } from 'firebase/app';
import { getAuth, type Auth } from 'firebase/auth';
import { getDatabase, type Database } from 'firebase/database';
import { getStorage, type FirebaseStorage } from 'firebase/storage';

const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};
export const configured = Boolean(config.apiKey && config.authDomain && config.databaseURL && config.projectId && config.storageBucket && config.appId);
export const app: FirebaseApp | null = configured ? initializeApp(config) : null;
export const auth: Auth | null = app ? getAuth(app) : null;
export const db: Database | null = app ? getDatabase(app) : null;
export const storage: FirebaseStorage | null = app ? getStorage(app) : null;
export function requireAuth(): Auth { if (!auth) throw new Error('Firebase не настроен'); return auth; }
export function requireDb(): Database { if (!db) throw new Error('Firebase не настроен'); return db; }
export function requireStorage(): FirebaseStorage { if (!storage) throw new Error('Firebase не настроен'); return storage; }
