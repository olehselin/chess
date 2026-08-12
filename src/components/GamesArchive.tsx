import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ProcessedGame } from '../types/chess';
import { fetchArchives, fetchMonthlyGames, processGame, USERNAME } from '../utils/chessApi';
import { analyzePgn, type AnalyzedBlunder } from '../utils/gameAnalyzer';
import { useStockfish } from '../hooks/useStockfish';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function archiveLabel(url: string) {
  const parts = url.split('/');
  const year = parts[parts.length - 2];
  const month = parts[parts.length - 1];
  return new Date(`${year}-${month}-01`).toLocaleDateString('uk-UA', {
    month: 'long',
    year: 'numeric',
  });
}

function cpToPawns(cp: number): string {
  const pawns = cp / 100;
  return pawns >= 0 ? `+${pawns.toFixed(2)}` : pawns.toFixed(2);
}

// ─── Sub-components ──────────────────────────────────────────────────────────

const ResultBadge: React.FC<{ result: ProcessedGame['result'] }> = ({ result }) => {
  const cfg = {
    win: { label: 'Перемога', cls: 'bg-emerald-500/20 text-emerald-400 ring-emerald-500/30' },
    loss: { label: 'Поразка', cls: 'bg-rose-500/20 text-rose-400 ring-rose-500/30' },
    draw: { label: 'Нічия', cls: 'bg-slate-500/20 text-slate-400 ring-slate-500/30' },
  }[result];
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ${cfg.cls}`}>
      {cfg.label}
    </span>
  );
};

const ColorDot: React.FC<{ color: 'white' | 'black' }> = ({ color }) => (
  <span
    className={`inline-block h-2.5 w-2.5 rounded-full ring-1 flex-shrink-0 ${
      color === 'white' ? 'bg-white ring-slate-400/40' : 'bg-slate-700 ring-slate-500/60'
    }`}
  />
);

const TimeClassBadge: React.FC<{ timeClass: ProcessedGame['timeClass'] }> = ({ timeClass }) => {
  const cfg: Record<string, { icon: string; cls: string }> = {
    rapid: { icon: '⏱', cls: 'text-blue-400' },
    blitz: { icon: '⚡', cls: 'text-amber-400' },
    bullet: { icon: '🔫', cls: 'text-rose-400' },
    daily: { icon: '📅', cls: 'text-slate-400' },
  };
  const { icon, cls } = cfg[timeClass] ?? cfg.rapid;
  return <span className={`text-xs font-medium ${cls}`}>{icon} {timeClass}</span>;
};

// ─── Blunder Detail Panel ─────────────────────────────────────────────────────

interface BlunderPanelProps {
  blunders: AnalyzedBlunder[];
  playerColor: 'white' | 'black';
}

const BlunderPanel: React.FC<BlunderPanelProps> = ({ blunders, playerColor }) => {
  const playerBlunders = blunders.filter((b) => b.color === playerColor);
  const opponentBlunders = blunders.filter((b) => b.color !== playerColor);

  const BlunderChip: React.FC<{ b: AnalyzedBlunder }> = ({ b }) => {
    const dropPawns = (b.dropCp / 100).toFixed(1);
    return (
      <div className="flex items-center gap-2 rounded-xl bg-rose-500/10 ring-1 ring-rose-500/25 px-3 py-2">
        <ColorDot color={b.color} />
        <div>
          <div className="flex items-center gap-1.5">
            <span className="font-mono font-bold text-sm text-white">
              {b.moveNumber}. {b.notation}
            </span>
            <span className="text-rose-400 font-bold text-xs">??</span>
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="font-mono text-xs text-slate-500">
              {b.evalBefore !== null ? cpToPawns(b.evalBefore) : '?'}
            </span>
            <span className="text-slate-600 text-xs">→</span>
            <span className="font-mono text-xs text-slate-500">
              {b.evalAfter !== null ? cpToPawns(b.evalAfter) : '?'}
            </span>
            <span className="text-rose-400 font-bold text-xs">−{dropPawns}п</span>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-3">
      {playerBlunders.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-rose-400/80 uppercase tracking-wider mb-2">
            Твої зівки ({playerBlunders.length})
          </p>
          <div className="flex flex-wrap gap-2">
            {playerBlunders.map((b, i) => (
              <BlunderChip key={i} b={b} />
            ))}
          </div>
        </div>
      )}
      {opponentBlunders.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
            Зівки суперника ({opponentBlunders.length})
          </p>
          <div className="flex flex-wrap gap-2">
            {opponentBlunders.map((b, i) => (
              <BlunderChip key={i} b={b} />
            ))}
          </div>
        </div>
      )}
      {blunders.length === 0 && (
        <p className="text-xs text-emerald-400">✓ Зівків не виявлено (поріг: 3.0 п.)</p>
      )}
    </div>
  );
};

// ─── Game Card ────────────────────────────────────────────────────────────────

interface AnalysisState {
  status: 'idle' | 'queued' | 'analyzing' | 'done' | 'error';
  progress: number;
  total: number;
  blunders: AnalyzedBlunder[];
  error?: string;
}

interface GameCardProps {
  game: ProcessedGame;
  analysis: AnalysisState;
  onAnalyze: () => void;
}

const GameCard: React.FC<GameCardProps> = ({ game, analysis, onAnalyze }) => {
  const [expanded, setExpanded] = useState(false);

  const playerBlunderCount = analysis.blunders.filter((b) => b.color === game.playerColor).length;

  return (
    <div
      className={`
        rounded-2xl border border-white/[0.05] bg-slate-900/70
        backdrop-blur-sm transition-all duration-200
        hover:bg-slate-800/60 hover:border-white/[0.09]
      `}
    >
      {/* ── Main row ── */}
      <div className="flex items-center gap-4 px-5 py-4">
        {/* Blunder count / status */}
        <div className="w-14 flex-shrink-0 text-center">
          {analysis.status === 'idle' && (
            <button
              onClick={onAnalyze}
              className="w-full rounded-xl border border-[#81b64c]/30 bg-[#81b64c]/10 py-1.5 text-xs font-semibold text-[#81b64c] hover:bg-[#81b64c]/20 transition-colors"
            >
              Аналіз
            </button>
          )}
          {analysis.status === 'queued' && (
            <div className="flex flex-col items-center gap-1">
              <div className="h-5 w-5 rounded-full border-2 border-slate-700 border-t-slate-500 animate-spin" />
              <span className="text-[10px] text-slate-600">черга</span>
            </div>
          )}
          {analysis.status === 'analyzing' && (
            <div className="flex flex-col items-center gap-1">
              <div className="h-5 w-5 rounded-full border-2 border-[#81b64c]/40 border-t-[#81b64c] animate-spin" />
              {analysis.total > 0 && (
                <span className="text-[10px] text-slate-600">
                  {analysis.progress}/{analysis.total}
                </span>
              )}
            </div>
          )}
          {analysis.status === 'done' && (
            <button
              onClick={() => setExpanded((p) => !p)}
              className="w-full flex flex-col items-center"
            >
              <span
                className={`text-xl font-extrabold ${
                  playerBlunderCount === 0
                    ? 'text-emerald-400'
                    : playerBlunderCount >= 3
                    ? 'text-rose-400'
                    : 'text-amber-400'
                }`}
              >
                {playerBlunderCount}
              </span>
              <span className="text-[10px] text-slate-600">зівків</span>
            </button>
          )}
          {analysis.status === 'error' && (
            <button
              onClick={onAnalyze}
              title={analysis.error}
              className="w-full rounded-xl border border-rose-500/30 bg-rose-500/10 py-1.5 text-xs font-semibold text-rose-400 hover:bg-rose-500/20 transition-colors"
            >
              Retry
            </button>
          )}
        </div>

        {/* Divider */}
        <div className="h-10 w-px bg-white/[0.05] flex-shrink-0" />

        {/* Game info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <ColorDot color={game.playerColor} />
            <span className="font-semibold text-white text-sm truncate">
              vs {game.opponent}
            </span>
            <span className="text-slate-600 text-xs">({game.opponentRating})</span>
            <ResultBadge result={game.result} />
          </div>
          <div className="flex items-center gap-3 mt-1 flex-wrap">
            <TimeClassBadge timeClass={game.timeClass} />
            <span className="text-slate-600 text-xs">{game.date}</span>
            {game.accuracy !== null && (
              <span className="text-xs text-slate-500">
                Точність: <span className="text-slate-300">{game.accuracy.toFixed(0)}%</span>
              </span>
            )}
          </div>
          {game.opening && (
            <p className="text-xs text-slate-700 truncate mt-0.5" title={game.opening}>
              {game.opening}
            </p>
          )}
        </div>

        {/* External link + expand toggle */}
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <a
            href={game.url}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-lg p-1.5 text-slate-700 hover:bg-white/5 hover:text-slate-300 transition-colors"
            onClick={(e) => e.stopPropagation()}
          >
            <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none">
              <path d="M6 3H3a1 1 0 00-1 1v9a1 1 0 001 1h9a1 1 0 001-1v-3M10 2h4m0 0v4m0-4L7 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </a>
          {analysis.status === 'done' && (
            <button
              onClick={() => setExpanded((p) => !p)}
              className="rounded-lg p-1.5 text-slate-600 hover:bg-white/5 hover:text-slate-300 transition-colors"
            >
              <svg
                className={`h-4 w-4 transition-transform duration-300 ${expanded ? 'rotate-180' : ''}`}
                viewBox="0 0 16 16" fill="none"
              >
                <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* ── Progress bar while analyzing ── */}
      {analysis.status === 'analyzing' && analysis.total > 0 && (
        <div className="h-0.5 bg-slate-800 mx-5 mb-3 rounded-full overflow-hidden">
          <div
            className="h-full bg-[#81b64c] transition-all duration-200"
            style={{ width: `${(analysis.progress / analysis.total) * 100}%` }}
          />
        </div>
      )}

      {/* ── Blunder detail panel ── */}
      {expanded && analysis.status === 'done' && (
        <div className="border-t border-white/[0.04] px-5 py-4">
          <BlunderPanel blunders={analysis.blunders} playerColor={game.playerColor} />
        </div>
      )}

      {/* ── Error panel ── */}
      {analysis.status === 'error' && (
        <div className="border-t border-rose-500/10 px-5 py-3">
          <p className="text-xs text-rose-400">{analysis.error}</p>
        </div>
      )}
    </div>
  );
};

// ─── Loading Skeleton ─────────────────────────────────────────────────────────

const Skeleton: React.FC = () => (
  <div className="animate-pulse rounded-2xl border border-white/[0.04] bg-slate-900/50 p-5">
    <div className="flex items-center gap-4">
      <div className="h-8 w-14 rounded-xl bg-slate-800" />
      <div className="h-8 w-px bg-slate-800" />
      <div className="flex-1 space-y-2">
        <div className="h-4 w-48 rounded bg-slate-800" />
        <div className="h-3 w-32 rounded bg-slate-800" />
      </div>
    </div>
  </div>
);

// ─── Stats Header ─────────────────────────────────────────────────────────────

const StatsHeader: React.FC<{ games: ProcessedGame[] }> = ({ games }) => {
  const wins = games.filter((g) => g.result === 'win').length;
  const losses = games.filter((g) => g.result === 'loss').length;
  const draws = games.filter((g) => g.result === 'draw').length;

  return (
    <div className="mb-5 grid grid-cols-4 gap-px overflow-hidden rounded-2xl border border-white/[0.05] bg-white/[0.02]">
      {[
        { label: 'Партій', value: games.length, color: 'text-white' },
        { label: 'Перемог', value: wins, color: 'text-emerald-400' },
        { label: 'Поразок', value: losses, color: 'text-rose-400' },
        { label: 'Нічиїх', value: draws, color: 'text-slate-400' },
      ].map(({ label, value, color }) => (
        <div key={label} className="bg-slate-900/80 px-4 py-3 text-center">
          <div className={`text-2xl font-extrabold ${color}`}>{value}</div>
          <div className="text-xs text-slate-600 mt-0.5">{label}</div>
        </div>
      ))}
    </div>
  );
};

// ─── Month Selector ───────────────────────────────────────────────────────────

const MonthSelector: React.FC<{
  archives: string[];
  selected: string;
  onSelect: (url: string) => void;
}> = ({ archives, selected, onSelect }) => (
  <div className="mb-6 flex flex-wrap gap-2">
    {[...archives].reverse().map((url) => (
      <button
        key={url}
        onClick={() => onSelect(url)}
        className={`rounded-full px-3.5 py-1.5 text-xs font-medium transition-all duration-200 ${
          selected === url
            ? 'bg-[#81b64c] text-white shadow-[0_0_14px_rgba(129,182,76,0.35)]'
            : 'border border-white/[0.07] bg-white/[0.02] text-slate-500 hover:text-slate-200 hover:border-white/20'
        }`}
      >
        {archiveLabel(url)}
      </button>
    ))}
  </div>
);

// ─── Raw game storage for PGN access ─────────────────────────────────────────

interface RawGameData {
  processed: ProcessedGame;
  pgn: string;
}

const defaultAnalysis = (): AnalysisState => ({
  status: 'idle',
  progress: 0,
  total: 0,
  blunders: [],
});

// ─── Main App Component ────────────────────────────────────────────────────────

type ResultFilter = 'all' | 'win' | 'loss' | 'draw';
type SortKey = 'date' | 'result';

export const GamesArchive: React.FC = () => {
  const [archives, setArchives] = useState<string[]>([]);
  const [selectedArchive, setSelectedArchive] = useState('');
  const [rawGames, setRawGames] = useState<RawGameData[]>([]);
  const [loadingArchives, setLoadingArchives] = useState(true);
  const [loadingGames, setLoadingGames] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultFilter, setResultFilter] = useState<ResultFilter>('all');
  const [sortBy, setSortBy] = useState<SortKey>('date');
  const [searchQuery, setSearchQuery] = useState('');

  // Centralised per-game analysis state, keyed by game URL
  const [analysisMap, setAnalysisMap] = useState<Record<string, AnalysisState>>({});

  const { status: sfStatus, evaluate } = useStockfish();

  // Track whether auto-analysis was already kicked off for current game set
  const autoStartedRef = useRef(false);
  // Always-fresh ref to rawGames for the async queue closure
  const rawGamesRef = useRef<RawGameData[]>([]);
  rawGamesRef.current = rawGames;

  // ── Load archives on mount
  useEffect(() => {
    fetchArchives()
      .then((urls) => {
        setArchives(urls);
        if (urls.length > 0) setSelectedArchive(urls[urls.length - 1]);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoadingArchives(false));
  }, []);

  // ── Load games when selected archive changes
  useEffect(() => {
    if (!selectedArchive) return;
    setLoadingGames(true);
    setRawGames([]);
    setAnalysisMap({});
    setError(null);
    autoStartedRef.current = false;

    fetchMonthlyGames(selectedArchive)
      .then((games) => {
        const data: RawGameData[] = games.map((g) => ({
          processed: processGame(g),
          pgn: g.pgn,
        }));
        // Sort newest first
        data.sort((a, b) => b.processed.end_time - a.processed.end_time);
        setRawGames(data);

        // Initialise analysis state for all games
        const initialMap: Record<string, AnalysisState> = {};
        data.forEach((g) => {
          initialMap[g.processed.url] = defaultAnalysis();
        });
        setAnalysisMap(initialMap);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoadingGames(false));
  }, [selectedArchive]);

  // ── Helper: update analysis state for one game
  const updateAnalysis = useCallback(
    (url: string, patch: Partial<AnalysisState>) => {
      setAnalysisMap((prev) => ({
        ...prev,
        [url]: { ...(prev[url] ?? defaultAnalysis()), ...patch },
      }));
    },
    [],
  );

  // ── Core: analyze a single game by URL (used by both auto-queue and manual)
  const analyzeGame = useCallback(
    async (url: string, pgn: string) => {
      updateAnalysis(url, { status: 'analyzing', progress: 0, total: 0, blunders: [] });
      try {
        const { blunders } = await analyzePgn(pgn, evaluate, (current, total) => {
          updateAnalysis(url, { progress: current, total });
        });
        updateAnalysis(url, { status: 'done', blunders });
      } catch (e) {
        updateAnalysis(url, { status: 'error', error: String(e) });
      }
    },
    [evaluate, updateAnalysis],
  );

  // ── Auto-analysis queue: fires once games are loaded AND Stockfish is ready
  useEffect(() => {
    if (sfStatus !== 'ready') return;
    if (rawGames.length === 0) return;
    if (autoStartedRef.current) return;

    autoStartedRef.current = true;

    // Mark all games queued in one batch update
    setAnalysisMap((prev) => {
      const next = { ...prev };
      rawGames.forEach((g) => {
        if (!next[g.processed.url] || next[g.processed.url].status === 'idle') {
          next[g.processed.url] = { ...defaultAnalysis(), status: 'queued' };
        }
      });
      return next;
    });

    // Run sequentially in background
    (async () => {
      for (const game of rawGamesRef.current) {
        await analyzeGame(game.processed.url, game.pgn);
      }
    })();
  }, [sfStatus, rawGames, analyzeGame]);

  // ── Manual trigger (retry or idle games)
  const handleManualAnalyze = useCallback(
    (url: string, pgn: string) => {
      analyzeGame(url, pgn);
    },
    [analyzeGame],
  );

  // ── Overall auto-analysis progress
  const autoProgress = useMemo(() => {
    const vals = Object.values(analysisMap);
    if (vals.length === 0) return null;
    const done = vals.filter((a) => a.status === 'done' || a.status === 'error').length;
    return { done, total: vals.length };
  }, [analysisMap]);

  // ── Filter + sort
  const filteredGames = useMemo(() => {
    let list = [...rawGames];

    if (resultFilter !== 'all') {
      list = list.filter((g) => g.processed.result === resultFilter);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (g) =>
          g.processed.opponent.toLowerCase().includes(q) ||
          (g.processed.opening?.toLowerCase().includes(q) ?? false),
      );
    }
    if (sortBy === 'result') {
      const order = { win: 0, draw: 1, loss: 2 };
      list.sort((a, b) => order[a.processed.result] - order[b.processed.result]);
    }

    return list;
  }, [rawGames, resultFilter, searchQuery, sortBy]);

  // ── Render early states
  if (loadingArchives) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0d0f14]">
        <div className="text-center">
          <div className="text-5xl mb-4 animate-bounce">♟</div>
          <p className="text-slate-500 text-sm">Завантаження архівів…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0d0f14] text-white">
      {/* ── Sticky header ── */}
      <div className="border-b border-white/[0.04] bg-[#0d0f14]/95 backdrop-blur-sm sticky top-0 z-10">
        <div className="mx-auto max-w-3xl px-4 py-3.5 flex items-center gap-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#81b64c]/15 text-xl">♟</div>
            <div>
              <h1 className="text-sm font-bold leading-tight">Chess Archive</h1>
              <p className="text-xs text-slate-500 leading-tight">@{USERNAME}</p>
            </div>
          </div>

          {/* Stockfish status */}
          <div className="flex items-center gap-1.5">
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                sfStatus === 'ready'
                  ? 'bg-emerald-400'
                  : sfStatus === 'loading'
                  ? 'bg-amber-400 animate-pulse'
                  : 'bg-rose-400'
              }`}
            />
            <span className="text-xs text-slate-600">
              {sfStatus === 'ready' ? 'Stockfish готовий' : sfStatus === 'loading' ? 'Завантаження Stockfish…' : 'Помилка Stockfish'}
            </span>
          </div>

          {/* Auto-analysis progress */}
          {autoProgress !== null && autoProgress.done < autoProgress.total && sfStatus === 'ready' && (
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <div className="h-1 w-20 rounded-full bg-slate-800 overflow-hidden">
                <div
                  className="h-full bg-[#81b64c] transition-all duration-500"
                  style={{ width: `${(autoProgress.done / autoProgress.total) * 100}%` }}
                />
              </div>
              <span className="tabular-nums">{autoProgress.done}/{autoProgress.total}</span>
            </div>
          )}
          {autoProgress !== null && autoProgress.done === autoProgress.total && autoProgress.total > 0 && (
            <span className="text-xs text-emerald-500/80">✓ Аналіз завершено</span>
          )}

          <div className="flex-1" />

          {/* Search */}
          <div className="relative">
            <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-600" viewBox="0 0 16 16" fill="none">
              <circle cx="6.5" cy="6.5" r="4.5" stroke="currentColor" strokeWidth="1.5" />
              <path d="M10 10l3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            <input
              className="rounded-xl border border-white/[0.06] bg-white/[0.03] pl-8 pr-3 py-1.5 text-xs text-slate-300 placeholder:text-slate-600 focus:outline-none focus:border-[#81b64c]/40 transition-colors w-44"
              placeholder="Суперник, дебют…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>
      </div>

      {/* ── Main content ── */}
      <div className="mx-auto max-w-3xl px-4 pt-7 pb-16">
        {/* Month selector */}
        {archives.length > 0 && (
          <MonthSelector archives={archives} selected={selectedArchive} onSelect={setSelectedArchive} />
        )}

        {/* Stats */}
        {!loadingGames && rawGames.length > 0 && (
          <StatsHeader games={rawGames.map((g) => g.processed)} />
        )}

        {/* Filters + sort */}
        {!loadingGames && rawGames.length > 0 && (
          <div className="mb-5 flex flex-wrap items-center gap-2">
            {(['all', 'win', 'loss', 'draw'] as ResultFilter[]).map((f) => {
              const labels: Record<ResultFilter, string> = {
                all: 'Всі',
                win: '✅ Виграв',
                loss: '❌ Програв',
                draw: '🤝 Нічия',
              };
              return (
                <button
                  key={f}
                  onClick={() => setResultFilter(f)}
                  className={`rounded-full px-3 py-1.5 text-xs font-medium transition-all duration-150 ${
                    resultFilter === f
                      ? 'bg-[#81b64c] text-white'
                      : 'border border-white/[0.07] bg-white/[0.02] text-slate-500 hover:text-slate-300'
                  }`}
                >
                  {labels[f]}
                </button>
              );
            })}
            <div className="flex-1" />
            {(['date', 'result'] as SortKey[]).map((key) => (
              <button
                key={key}
                onClick={() => setSortBy(key)}
                className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${
                  sortBy === key ? 'bg-slate-700 text-white' : 'text-slate-600 hover:text-slate-400'
                }`}
              >
                {key === 'date' ? '📅 Дата' : '🏆 Результат'}
              </button>
            ))}
          </div>
        )}



        {/* Loading */}
        {loadingGames && (
          <div className="space-y-2.5">
            {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} />)}
          </div>
        )}

        {/* Error */}
        {error && !loadingGames && (
          <div className="rounded-2xl border border-rose-500/20 bg-rose-500/5 p-6 text-center">
            <p className="text-rose-400 text-sm">{error}</p>
          </div>
        )}

        {/* Games list */}
        {!loadingGames && filteredGames.length > 0 && (
          <>
            <p className="text-xs text-slate-700 mb-3">{filteredGames.length} партій</p>
            <div className="space-y-2">
              {filteredGames.map((g) => (
                <GameCard
                  key={g.processed.url}
                  game={g.processed}
                  analysis={analysisMap[g.processed.url] ?? defaultAnalysis()}
                  onAnalyze={() => handleManualAnalyze(g.processed.url, g.pgn)}
                />
              ))}
            </div>
          </>
        )}

        {/* Empty */}
        {!loadingGames && !error && filteredGames.length === 0 && rawGames.length > 0 && (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-white/10 py-16 text-center">
            <div className="text-4xl mb-3">🔍</div>
            <p className="text-slate-500 text-sm">Партій не знайдено</p>
          </div>
        )}

        {!loadingGames && !error && rawGames.length === 0 && (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-white/10 py-16 text-center">
            <div className="text-4xl mb-3">♟</div>
            <p className="text-slate-500 text-sm">У цьому місяці немає партій</p>
          </div>
        )}

        <p className="mt-10 text-center text-xs text-slate-700">
          Stockfish depth 12 · Зівок = падіння оцінки ≥ 3.0 пішаки · chess.com API
        </p>
      </div>
    </div>
  );
};
