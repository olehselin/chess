import type { ChesscomGame, PlayerColor, ProcessedGame } from '../types/chess';

export const USERNAME = 'gitcheckmate';
const ARCHIVES_URL = `https://api.chess.com/pub/player/${USERNAME}/games/archives`;

// ─── PGN Header Extraction ───────────────────────────────────────────────────

function getHeader(pgn: string, key: string): string | null {
  const re = new RegExp(`\\[${key}\\s+"([^"]+)"\\]`);
  return pgn.match(re)?.[1] ?? null;
}

// ─── Game Processing ──────────────────────────────────────────────────────────

function parseResult(game: ChesscomGame): 'win' | 'loss' | 'draw' {
  const playerColor = game.white.username.toLowerCase() === USERNAME ? 'white' : 'black';
  const playerResult = playerColor === 'white' ? game.white.result : game.black.result;

  if (playerResult === 'win') return 'win';
  if (
    ['agreed', 'stalemate', 'insufficient', 'repetition', '50move', 'timevsinsufficient'].includes(
      playerResult,
    )
  )
    return 'draw';
  return 'loss';
}

export function processGame(game: ChesscomGame): ProcessedGame {
  const isWhite = game.white.username.toLowerCase() === USERNAME;
  const playerColor: PlayerColor = isWhite ? 'white' : 'black';
  const opponent = isWhite ? game.black : game.white;
  const player = isWhite ? game.white : game.black;

  const date = new Date(game.end_time * 1000).toLocaleDateString('uk-UA', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });

  const ecoUrl = getHeader(game.pgn, 'ECOUrl');
  const opening = ecoUrl
    ? decodeURIComponent(ecoUrl.split('/').pop() ?? '').replace(/-/g, ' ')
    : null;

  const accuracy = game.accuracies
    ? isWhite
      ? game.accuracies.white
      : game.accuracies.black
    : null;

  return {
    url: game.url,
    date,
    end_time: game.end_time,
    opponent: opponent.username,
    opponentRating: opponent.rating,
    playerColor,
    playerRating: player.rating,
    result: parseResult(game),
    timeClass: game.time_class,
    timeControl: game.time_control,
    opening,
    accuracy,
  };
}

// ─── API Fetching ─────────────────────────────────────────────────────────────

export async function fetchArchives(): Promise<string[]> {
  const res = await fetch(ARCHIVES_URL);
  if (!res.ok) throw new Error(`Failed to fetch archives: ${res.status}`);
  const data = await res.json();
  return data.archives as string[];
}

export async function fetchMonthlyGames(archiveUrl: string): Promise<ChesscomGame[]> {
  const res = await fetch(archiveUrl);
  if (!res.ok) throw new Error(`Failed to fetch games: ${res.status}`);
  const data = await res.json();
  return (data.games as ChesscomGame[]).filter((g) => g.rules === 'chess');
}
