// ─── Chess.com API Types ─────────────────────────────────────────────────────

export type GameResult = 'win' | 'loss' | 'draw' | 'resigned' | 'timeout' | 'abandoned' | 'agreed' | 'stalemate' | 'insufficient' | 'repetition' | string;

export interface ChesscomPlayer {
  rating: number;
  result: GameResult;
  username: string;
}

export interface ChesscomGame {
  url: string;
  pgn: string;
  time_control: string;
  end_time: number;
  rated: boolean;
  time_class: 'bullet' | 'blitz' | 'rapid' | 'daily';
  rules: string;
  white: ChesscomPlayer;
  black: ChesscomPlayer;
  accuracies?: {
    white: number;
    black: number;
  };
}

export interface ChesscomMonthlyGames {
  games: ChesscomGame[];
}

export interface ChesscomArchives {
  archives: string[];
}

// ─── Processed Game Types ────────────────────────────────────────────────────

export type PlayerColor = 'white' | 'black';

export interface BlunderMove {
  moveNumber: number;
  color: PlayerColor;
  notation: string;
}

export interface ProcessedGame {
  url: string;
  date: string;
  end_time: number;
  opponent: string;
  opponentRating: number;
  playerColor: PlayerColor;
  playerRating: number;
  result: 'win' | 'loss' | 'draw';
  timeClass: ChesscomGame['time_class'];
  timeControl: string;
  opening: string | null;
  accuracy: number | null;
}

// ─── Blunder / PGN Parser Types ──────────────────────────────────────────────

export interface ParsedMove {
  moveNumber: number;
  color: PlayerColor;
  notation: string;
  /** Eval in pawns AFTER this move (from White's perspective), null if no [%eval] tag. */
  evalAfter: number | null;
  isMate: boolean;
  mateIn: number | null;
  hasDoubleMark: boolean;
}

export interface Blunder {
  moveNumber: number;
  color: PlayerColor;
  notation: string;
  /** Eval before this move (pawns, White's perspective). */
  evalBefore: number | null;
  /** Eval after this move (pawns, White's perspective). */
  evalAfter: number | null;
  /** Magnitude of eval drop from the blundering player's POV (positive = worse). */
  evalDrop: number | null;
  reason: 'annotation' | 'eval_drop' | 'annotation_and_eval';
  description: string;
}
