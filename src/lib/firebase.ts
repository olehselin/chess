// src/lib/firebase.ts
// ─────────────────────────────────────────────────────────────
// Paste YOUR firebaseConfig here (from Firebase Console →
// Project Settings → Your apps → SDK setup and configuration)
// ─────────────────────────────────────────────────────────────

import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: "AIzaSyB7zxn-vGuDsK7JBXBjixOCEEkAqeRf-a8",
  authDomain:  "chess-oleh.firebaseapp.com",
  projectId: "chess-oleh",
  storageBucket: "chess-oleh.firebasestorage.app",
  messagingSenderId: "1073156742185",
  appId:  "1:1073156742185:web:dcf565f157bae699e7d038",
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
