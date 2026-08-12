/**
 * analysisCache.ts
 *
 * Firestore cache for Stockfish analysis results.
 *
 * Collection: "gameAnalysis"
 * Document ID: game URL encoded as a safe Firestore key
 *   (replacing slashes and dots so Firestore is happy)
 *
 * Schema:
 *   {
 *     blunders: AnalyzedBlunder[],
 *     analyzedAt: Timestamp,
 *     depth: number,
 *   }
 */

import {
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import type { AnalyzedBlunder } from './gameAnalyzer';

const COLLECTION = 'gameAnalysis';
const DEPTH = 12; // must match ANALYSIS_DEPTH in useStockfish.ts

/** Convert game URL to a safe Firestore document ID */
function urlToDocId(gameUrl: string): string {
  // chess.com URLs look like https://www.chess.com/game/live/12345678
  // Take the last numeric segment as the ID — short and unique
  const parts = gameUrl.split('/');
  return parts[parts.length - 1] || gameUrl.replace(/[^a-zA-Z0-9_-]/g, '_');
}

export interface CachedAnalysis {
  blunders: AnalyzedBlunder[];
}

/**
 * Try to load cached blunders for a game from Firestore.
 * Returns null if no cached result exists.
 */
export async function loadCachedAnalysis(
  gameUrl: string,
): Promise<CachedAnalysis | null> {
  try {
    const ref = doc(db, COLLECTION, urlToDocId(gameUrl));
    const snap = await getDoc(ref);
    if (!snap.exists()) return null;
    const data = snap.data();
    // Invalidate cache if it was analyzed at a different depth
    if (data.depth !== DEPTH) return null;
    return { blunders: data.blunders as AnalyzedBlunder[] };
  } catch (e) {
    // Network error or permission denied — degrade gracefully
    console.warn('[cache] load failed:', e);
    return null;
  }
}

/**
 * Save analysis results for a game to Firestore.
 * Silently swallows errors so the app keeps working offline.
 */
export async function saveCachedAnalysis(
  gameUrl: string,
  blunders: AnalyzedBlunder[],
): Promise<void> {
  try {
    const ref = doc(db, COLLECTION, urlToDocId(gameUrl));
    await setDoc(ref, {
      blunders,
      depth: DEPTH,
      analyzedAt: serverTimestamp(),
    });
  } catch (e) {
    console.warn('[cache] save failed:', e);
  }
}
