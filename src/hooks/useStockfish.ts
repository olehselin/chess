/**
 * useStockfish.ts
 *
 * React hook that manages a single Stockfish Web Worker instance.
 * Provides an `evaluate(fen)` function that returns a Promise with the eval result.
 *
 * The worker is initialized once on mount. Multiple calls are serialized
 * via an internal queue so they don't overlap.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

const ANALYSIS_DEPTH = 12; // depth 12 ≈ 1600+ Elo strength, fast enough for rapid games

interface EvalResult {
  cp: number | null;
  mate: number | null;
}

type Resolver = (result: EvalResult) => void;

export type StockfishStatus = 'loading' | 'ready' | 'error';

export function useStockfish() {
  const [status, setStatus] = useState<StockfishStatus>('loading');
  const workerRef = useRef<Worker | null>(null);

  // Queue of pending resolvers — each evaluate() call appends one
  const resolverQueueRef = useRef<Resolver[]>([]);
  const currentResultRef = useRef<EvalResult>({ cp: null, mate: null });

  useEffect(() => {
    const worker = new Worker('/stockfish.js');
    workerRef.current = worker;

    worker.postMessage('uci');

    let uciOk = false;
    let isReady = false;

    worker.onmessage = (e: MessageEvent<string>) => {
      const line: string = typeof e.data === 'string' ? e.data : String(e.data);

      // UCI init handshake
      if (!uciOk && line.includes('uciok')) {
        uciOk = true;
        worker.postMessage('isready');
        return;
      }
      if (!isReady && line.includes('readyok')) {
        isReady = true;
        setStatus('ready');
        return;
      }

      // Parse info lines for score
      if (line.startsWith('info') && line.includes('score')) {
        const cpMatch = line.match(/score cp (-?\d+)/);
        const mateMatch = line.match(/score mate (-?\d+)/);
        if (cpMatch) currentResultRef.current = { cp: parseInt(cpMatch[1], 10), mate: null };
        if (mateMatch) currentResultRef.current = { cp: null, mate: parseInt(mateMatch[1], 10) };
      }

      // bestmove = Stockfish finished this position
      if (line.startsWith('bestmove')) {
        const resolver = resolverQueueRef.current.shift();
        if (resolver) {
          resolver({ ...currentResultRef.current });
          currentResultRef.current = { cp: null, mate: null };
        }
      }
    };

    worker.onerror = () => setStatus('error');

    return () => {
      worker.terminate();
    };
  }, []);

  /**
   * Evaluates a FEN position.
   * Resolves with {cp, mate} when Stockfish returns bestmove.
   */
  const evaluate = useCallback((fen: string): Promise<EvalResult> => {
    return new Promise((resolve) => {
      resolverQueueRef.current.push(resolve);
      const w = workerRef.current;
      if (w) {
        w.postMessage(`position fen ${fen}`);
        w.postMessage(`go depth ${ANALYSIS_DEPTH}`);
      }
    });
  }, []);

  return { status, evaluate };
}
