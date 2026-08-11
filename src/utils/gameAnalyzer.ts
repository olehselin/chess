/**
 * gameAnalyzer.ts
 *
 * Uses chess.js to replay PGN moves and extract FEN after each half-move (ply),
 * then sends all FENs to the Stockfish Web Worker for evaluation.
 *
 * Blunder detection:
 *   A move is a blunder when eval drops >= 3.0 pawns (300 centipawns)
 *   from the blundering player's perspective.
 *
 * Eval convention (Stockfish UCI):
 *   cp is always from the perspective of the SIDE TO MOVE.
 *   To compare positions we convert everything to White's perspective:
 *     - Before white's move: eval = +cp (white to move, positive = good for white)
 *     - After white's move:  eval = -cp (black to move now, cp positive = good for black = bad for white)
 */

import { Chess } from 'chess.js';

export interface MoveEval {
  moveNumber: number;
  color: 'white' | 'black';
  notation: string;
  fen: string; // FEN AFTER this move
  /** Eval in centipawns from WHITE's perspective AFTER this move. */
  evalCp: number | null;
  /** Mate-in-N (positive=white wins, negative=black wins), null if not mate. */
  mate: number | null;
}

export interface AnalyzedBlunder {
  moveNumber: number;
  color: 'white' | 'black';
  notation: string;
  /** Eval BEFORE this move (white's perspective, centipawns) */
  evalBefore: number | null;
  /** Eval AFTER this move (white's perspective, centipawns) */
  evalAfter: number | null;
  /** Drop in centipawns from the player's POV (positive = position got worse) */
  dropCp: number;
}

export const BLUNDER_THRESHOLD_CP = 300; // 3.0 pawns = 300 centipawns
const MATE_CP = 99_000; // sentinel for forced mate

// ─── Step 1: Extract all FENs from PGN using chess.js ────────────────────────

/**
 * Replays a PGN and returns an array of {moveNumber, color, notation, fen}
 * for every half-move (ply). The FEN is the position AFTER the move.
 */
export function extractMovesFromPgn(pgn: string): Omit<MoveEval, 'evalCp' | 'mate'>[] {
  const chess = new Chess();

  try {
    chess.loadPgn(pgn);
  } catch {
    return [];
  }

  const history = chess.history({ verbose: true });
  if (!history.length) return [];

  // Replay from scratch to get FEN after each move
  const replayChess = new Chess();
  const result: Omit<MoveEval, 'evalCp' | 'mate'>[] = [];

  let moveNumber = 1;
  let halfMove = 0; // 0=white, 1=black per pair

  for (const move of history) {
    replayChess.move(move.san);
    const color: 'white' | 'black' = halfMove % 2 === 0 ? 'white' : 'black';
    if (color === 'black') moveNumber++;

    result.push({
      moveNumber: color === 'white' ? moveNumber : moveNumber - 1,
      // chess.js uses 'w'/'b', map to our naming
      color,
      notation: move.san,
      fen: replayChess.fen(),
    });

    halfMove++;
  }

  // Fix: moveNumber increments after black, but white's moveNumber should stay fixed
  // Let's recalculate properly
  // Reset and redo
  result.length = 0;
  const chess2 = new Chess();
  const history2 = chess.history({ verbose: true });
  
  // Re-extract from original loaded chess
  const originalChess = new Chess();
  originalChess.loadPgn(pgn);
  const allMoves = originalChess.history({ verbose: true });

  const replayBoard = new Chess();
  for (let i = 0; i < allMoves.length; i++) {
    const move = allMoves[i];
    replayBoard.move(move.san);

    // i is 0-indexed: 0,1 = move 1 (white, black); 2,3 = move 2, etc.
    const isWhite = i % 2 === 0;
    const fullMoveNumber = Math.floor(i / 2) + 1;

    result.push({
      moveNumber: fullMoveNumber,
      color: isWhite ? 'white' : 'black',
      notation: move.san,
      fen: replayBoard.fen(),
    });
  }

  return result;
}

// ─── Step 2: Convert Stockfish cp (side-to-move) → White's perspective ────────

/**
 * Converts a Stockfish UCI "cp" value (from side-to-move perspective)
 * into centipawns from WHITE's perspective.
 *
 * In the FEN position AFTER a move, it's the OPPONENT's turn.
 * If the move was white's, opponent = black → cp is from black's POV → negate.
 * If the move was black's, opponent = white → cp is already from white's POV.
 *
 * More precisely: in the FEN AFTER move, sideToMove = opponent.
 * Stockfish cp = from sideToMove POV.
 * White perspective = cp if sideToMove==white, else -cp.
 */
export function toWhitePerspective(
  cpFromSideToMove: number,
  fenAfterMove: string,
): number {
  // FEN field 2: 'w' or 'b' is who moves NEXT (i.e. the opponent of who just moved)
  const sideToMove = fenAfterMove.split(' ')[1];
  // If it's white to move next, Stockfish cp is from white's POV → keep as is
  // If it's black to move next, Stockfish cp is from black's POV → negate for white's POV
  return sideToMove === 'w' ? cpFromSideToMove : -cpFromSideToMove;
}

// ─── Step 3: Detect blunders from evaluated moves ─────────────────────────────

/**
 * Given a list of MoveEval (with evalCp filled in), finds all blunders:
 * moves where the eval dropped >= BLUNDER_THRESHOLD_CP for the player who moved.
 */
export function detectBlunders(moves: MoveEval[]): AnalyzedBlunder[] {
  const blunders: AnalyzedBlunder[] = [];

  for (let i = 0; i < moves.length; i++) {
    const move = moves[i];
    const prevMove = i > 0 ? moves[i - 1] : null;

    const evalBefore = prevMove?.evalCp ?? null;
    const evalAfter = move.evalCp;

    if (evalBefore === null || evalAfter === null) continue;

    let dropCp: number;
    if (move.color === 'white') {
      // White blunders when eval drops for white (goes down)
      dropCp = evalBefore - evalAfter;
    } else {
      // Black blunders when eval rises for white (gets better for white = worse for black)
      dropCp = evalAfter - evalBefore;
    }

    if (dropCp >= BLUNDER_THRESHOLD_CP) {
      blunders.push({
        moveNumber: move.moveNumber,
        color: move.color,
        notation: move.notation,
        evalBefore,
        evalAfter,
        dropCp,
      });
    }
  }

  return blunders;
}

// ─── Step 4: Full pipeline — orchestrated by the React hook ──────────────────

/**
 * Full analysis pipeline for a single game's PGN.
 *
 * 1. Extract all FENs via chess.js
 * 2. Evaluate each FEN via Stockfish (caller provides evaluate fn)
 * 3. Convert evals to white's perspective
 * 4. Detect blunders
 *
 * @param pgn - raw PGN string
 * @param evaluateFen - async function that returns {cp, mate} for a FEN
 * @param onProgress - optional callback (current, total)
 */
export async function analyzePgn(
  pgn: string,
  evaluateFen: (fen: string) => Promise<{ cp: number | null; mate: number | null }>,
  onProgress?: (current: number, total: number) => void,
): Promise<{ moves: MoveEval[]; blunders: AnalyzedBlunder[] }> {
  const rawMoves = extractMovesFromPgn(pgn);
  if (!rawMoves.length) return { moves: [], blunders: [] };

  const moves: MoveEval[] = [];

  for (let i = 0; i < rawMoves.length; i++) {
    const raw = rawMoves[i];
    onProgress?.(i, rawMoves.length);

    const { cp, mate } = await evaluateFen(raw.fen);

    // Convert to white's perspective
    let evalCp: number | null = null;
    if (mate !== null) {
      // Mate: positive = white wins, negative = black wins
      // Stockfish mate from side-to-move: mate=3 means side-to-move mates in 3
      // Convert: if it's black to move and mate=3 → black mates → white is losing → -MATE_CP
      const sideToMove = raw.fen.split(' ')[1];
      if (mate > 0) {
        // Current side to move has forced mate
        evalCp = sideToMove === 'w' ? MATE_CP : -MATE_CP;
      } else {
        // Opponent has forced mate
        evalCp = sideToMove === 'w' ? -MATE_CP : MATE_CP;
      }
    } else if (cp !== null) {
      evalCp = toWhitePerspective(cp, raw.fen);
    }

    moves.push({ ...raw, evalCp, mate });
  }

  onProgress?.(rawMoves.length, rawMoves.length);

  const blunders = detectBlunders(moves);
  return { moves, blunders };
}
