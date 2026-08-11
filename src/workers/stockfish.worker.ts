/**
 * stockfish.worker.ts
 *
 * Runs Stockfish WASM in a Web Worker context.
 * Receives messages from the main thread:
 *   { type: 'analyze', fens: string[], depth: number }
 *
 * Sends back:
 *   { type: 'result', index: number, cp: number | null, mate: number | null }
 *   { type: 'done' }
 *   { type: 'error', message: string }
 *   { type: 'ready' }
 */


interface AnalyzeMessage {
  type: 'analyze';
  fens: string[];
  depth: number;
}

// Load Stockfish WASM script into this Worker scope
// eslint-disable-next-line no-var
declare function importScripts(...urls: string[]): void;
importScripts('/stockfish.js');

declare function Stockfish(): Promise<StockfishInstance>;

interface StockfishInstance {
  addMessageListener: (cb: (line: string) => void) => void;
  postMessage: (cmd: string) => void;
}

let sf: StockfishInstance | null = null;

async function initStockfish(): Promise<void> {
  // @ts-ignore - injected by importScripts
  sf = await Stockfish();
  sf!.postMessage('uci');
  await waitFor('uciok');
  sf!.postMessage('isready');
  await waitFor('readyok');
}

function waitFor(token: string): Promise<void> {
  return new Promise((resolve) => {
    const handler = (line: string) => {
      if (line.includes(token)) {
        sf!.addMessageListener((_) => {}); // noop replace — can't remove, so we ignore
        resolve();
      }
    };
    sf!.addMessageListener(handler);
  });
}

/**
 * Evaluates a single FEN position at given depth.
 * Returns centipawns (from the perspective of the side to move) or mate score.
 */
function evaluateFen(fen: string, depth: number): Promise<{ cp: number | null; mate: number | null }> {
  return new Promise((resolve) => {
    let result: { cp: number | null; mate: number | null } = { cp: null, mate: null };

    const handler = (line: string) => {
      // Parse "info depth N ... score cp X" or "score mate X"
      if (line.startsWith('info') && line.includes('score')) {
        const cpMatch = line.match(/score cp (-?\d+)/);
        const mateMatch = line.match(/score mate (-?\d+)/);
        if (cpMatch) result = { cp: parseInt(cpMatch[1], 10), mate: null };
        if (mateMatch) result = { cp: null, mate: parseInt(mateMatch[1], 10) };
      }

      if (line.startsWith('bestmove')) {
        resolve(result);
      }
    };

    sf!.addMessageListener(handler);
    sf!.postMessage(`position fen ${fen}`);
    sf!.postMessage(`go depth ${depth}`);
  });
}

// ─── Main worker message handler ─────────────────────────────────────────────

initStockfish()
  .then(() => {
    postMessage({ type: 'ready' });

    self.addEventListener('message', async (event: MessageEvent<AnalyzeMessage>) => {
      const { fens, depth } = event.data;

      for (let i = 0; i < fens.length; i++) {
        try {
          const result = await evaluateFen(fens[i], depth);
          postMessage({ type: 'result', index: i, ...result });
        } catch (e) {
          postMessage({ type: 'error', message: String(e), index: i });
        }
      }

      postMessage({ type: 'done' });
    });
  })
  .catch((e) => {
    postMessage({ type: 'error', message: String(e) });
  });
