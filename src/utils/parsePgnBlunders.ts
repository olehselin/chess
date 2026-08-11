import type { Blunder, ParsedMove, PlayerColor } from '../types/chess';

// ─── Constants ───────────────────────────────────────────────────────────────

/** Minimum evaluation drop (in pawns) to classify a move as a blunder */
const BLUNDER_THRESHOLD_PAWNS = 3.0;

/**
 * A large sentinel value representing a forced mate advantage.
 * Used so mate evals can be compared numerically.
 */
const MATE_EVAL_VALUE = 999;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Converts a raw eval string from PGN into a numeric value in pawns.
 * Mate values are mapped to ±MATE_EVAL_VALUE.
 *
 * Examples:
 *   "0.17"  → [0.17, false, null]
 *   "-3.50" → [-3.5, false, null]
 *   "#3"    → [999, true, 3]
 *   "#-2"   → [-999, true, -2]
 *
 * @returns [numericValue, isMate, mateIn]
 */
function parseEvalString(raw: string): [number | null, boolean, number | null] {
  if (!raw || !raw.trim()) return [null, false, null];

  const trimmed = raw.trim();

  // Mate annotation: #N (positive = current side to move wins, negative = loses)
  const mateMatch = trimmed.match(/^#(-?\d+)$/);
  if (mateMatch) {
    const n = parseInt(mateMatch[1], 10);
    // In Stockfish convention: #3 means White forces mate in 3, #-3 means Black forces mate in 3
    // Positive mateIn = advantage for the side annotating (White in standard PGN eval)
    const value = n > 0 ? MATE_EVAL_VALUE : -MATE_EVAL_VALUE;
    return [value, true, n];
  }

  // Numeric eval (can have leading + or -, decimal point)
  const numericMatch = trimmed.match(/^([+-]?\d+(?:\.\d+)?)$/);
  if (numericMatch) {
    return [parseFloat(numericMatch[1]), false, null];
  }

  return [null, false, null];
}

/**
 * Strips PGN header tags (lines of the form [Key "Value"])
 * WITHOUT removing inline comment annotations like { [%eval 0.17] }.
 *
 * Strategy: remove only lines that match header tag format, not inline brackets.
 */
function stripPgnHeaders(pgn: string): string {
  // Headers are always at the top of the PGN, on their own lines, in the form [Key "Value"]
  // We remove them line-by-line to preserve curly-brace comment content.
  const lines = pgn.split('\n');
  const bodyLines = lines.filter((line) => {
    const trimmed = line.trim();
    // A PGN header line starts with [ and ends with ] with a string value inside
    return !trimmed.match(/^\[[\w]+\s+"[^"]*"\]$/);
  });

  return bodyLines
    .join(' ')
    .replace(/\s*1-0\s*$|\s*0-1\s*$|\s*1\/2-1\/2\s*$|\s*\*\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// ─── Move Parser ─────────────────────────────────────────────────────────────

/**
 * Regex to match a white move.
 *
 * Pattern: "N. SAN[??][ { ...comment with [%eval V]... }]"
 * - Does NOT match "N..." (that's a black move)
 * - The negative lookahead (?!\.) ensures we don't match "1..." patterns
 *
 * Capture groups:
 *  1 → move number
 *  2 → SAN notation
 *  3 → ?? annotation (optional)
 *  4 → eval value string (optional, inside { [%eval ...] })
 */
const WHITE_MOVE_RE =
  /(\d+)\.(?!\.)\s*([KQRBNP]?[a-h]?[1-8]?x?[a-h][1-8](?:=[QRBN])?|O-O-O|O-O)(\?\?)?(?:\s*\{[^}]*\[%eval\s+([+-]?\d+(?:\.\d+)?|#-?\d+)[^\]]*\][^}]*\})?/g;

/**
 * Regex to match a black move.
 *
 * Pattern: "N... SAN[??][ { ...comment with [%eval V]... }]"
 *
 * Capture groups:
 *  1 → move number
 *  2 → SAN notation
 *  3 → ?? annotation (optional)
 *  4 → eval value string (optional)
 */
const BLACK_MOVE_RE =
  /(\d+)\.\.\.\s*([KQRBNP]?[a-h]?[1-8]?x?[a-h][1-8](?:=[QRBN])?|O-O-O|O-O)(\?\?)?(?:\s*\{[^}]*\[%eval\s+([+-]?\d+(?:\.\d+)?|#-?\d+)[^\]]*\][^}]*\})?/g;

/**
 * Parses ALL half-moves from a PGN string using a two-pass regex approach.
 *
 * Pass 1: Match white moves (e.g., "1. e4 { [%eval 0.17] }")
 * Pass 2: Match black moves (e.g., "1... e5 { [%eval 0.17] }")
 * Finally: merge and sort by ply order (move number, white before black).
 */
function parseAllMoves(pgn: string): ParsedMove[] {
  const body = stripPgnHeaders(pgn);
  const moves: ParsedMove[] = [];

  let m: RegExpExecArray | null;

  // ── Pass 1: White moves ───────────────────────────────────────────────────
  WHITE_MOVE_RE.lastIndex = 0;
  while ((m = WHITE_MOVE_RE.exec(body)) !== null) {
    const moveNumber = parseInt(m[1], 10);
    const notation = m[2];
    const hasDoubleMark = m[3] === '??';
    const evalRaw = m[4] ?? null;
    const [evalAfter, isMate, mateIn] = parseEvalString(evalRaw ?? '');

    moves.push({
      moveNumber,
      color: 'white',
      notation,
      evalAfter,
      isMate,
      mateIn,
      hasDoubleMark,
    });
  }

  // ── Pass 2: Black moves ───────────────────────────────────────────────────
  BLACK_MOVE_RE.lastIndex = 0;
  while ((m = BLACK_MOVE_RE.exec(body)) !== null) {
    const moveNumber = parseInt(m[1], 10);
    const notation = m[2];
    const hasDoubleMark = m[3] === '??';
    const evalRaw = m[4] ?? null;
    const [evalAfter, isMate, mateIn] = parseEvalString(evalRaw ?? '');

    moves.push({
      moveNumber,
      color: 'black',
      notation,
      evalAfter,
      isMate,
      mateIn,
      hasDoubleMark,
    });
  }

  // ── Sort by ply order ─────────────────────────────────────────────────────
  moves.sort((a, b) => {
    if (a.moveNumber !== b.moveNumber) return a.moveNumber - b.moveNumber;
    return a.color === 'white' ? -1 : 1; // white before black within same move
  });

  return moves;
}

// ─── Eval Drop Computation ───────────────────────────────────────────────────

/**
 * Computes the evaluation drop from the blundering player's perspective.
 *
 * PGN eval is always from White's perspective (positive = White is better).
 *
 * - White blunders → eval goes DOWN after their move (e.g., +1.0 → -2.0: drop = 3.0)
 * - Black blunders → eval goes UP after their move  (e.g., -0.5 → +2.5: drop = 3.0)
 *
 * @returns positive number = how much the position got worse for the player,
 *          null if either eval is unavailable.
 */
function computeEvalDrop(
  prevEval: number | null,
  currentEval: number | null,
  color: PlayerColor,
): number | null {
  if (prevEval === null || currentEval === null) return null;

  if (color === 'white') {
    // White's eval dropped → bad for white
    return prevEval - currentEval;
  } else {
    // Eval rose (more positive) after black's move → bad for black
    return currentEval - prevEval;
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Parses a PGN string and returns all detected blunders.
 *
 * Detection methods:
 *  1. Explicit annotation: move ends with `??`
 *  2. Evaluation drop: eval changes by ≥ 3.0 pawns (300 centipawns) after the move
 *     (using `[%eval ...]` annotations in PGN comments)
 *
 * Forced mate positions:
 *  - `[%eval #N]` is converted to ±999 sentinel so it participates in numeric comparisons.
 *  - Going from +999 (winning mate) to -3.5 (losing) registers as a huge drop → blunder.
 *
 * @param pgnString — raw PGN text (may include headers, clock annotations, eval tags, etc.)
 * @returns Array of Blunder objects sorted by move order
 */
export function parsePgnBlunders(pgnString: string): Blunder[] {
  if (!pgnString.trim()) return [];

  const moves = parseAllMoves(pgnString);
  const blunders: Blunder[] = [];

  for (let i = 0; i < moves.length; i++) {
    const move = moves[i];
    const prevMove = i > 0 ? moves[i - 1] : null;

    const prevEval = prevMove?.evalAfter ?? null;
    const currentEval = move.evalAfter;

    const drop = computeEvalDrop(prevEval, currentEval, move.color);
    const isEvalBlunder = drop !== null && drop >= BLUNDER_THRESHOLD_PAWNS;
    const isAnnotationBlunder = move.hasDoubleMark;

    if (!isEvalBlunder && !isAnnotationBlunder) continue;

    // Determine blunder reason
    let reason: Blunder['reason'];
    if (isAnnotationBlunder && isEvalBlunder) {
      reason = 'annotation_and_eval';
    } else if (isAnnotationBlunder) {
      reason = 'annotation';
    } else {
      reason = 'eval_drop';
    }

    // Build human-readable description
    const parts: string[] = [];
    if (isAnnotationBlunder) parts.push('Marked as blunder (??)');
    if (isEvalBlunder && drop !== null) {
      parts.push(`Eval dropped by ${drop.toFixed(1)} pawns`);
    }
    const description = parts.join(' · ') || 'Blunder detected';

    blunders.push({
      moveNumber: move.moveNumber,
      color: move.color,
      notation: move.notation,
      evalBefore: prevEval,
      evalAfter: currentEval,
      evalDrop: drop,
      reason,
      description,
    });
  }

  return blunders;
}
