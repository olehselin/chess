import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ProcessedGame } from '../types/chess';
import { fetchArchives, fetchMonthlyGames, processGame, USERNAME } from '../utils/chessApi';
import { analyzePgn, type AnalyzedBlunder } from '../utils/gameAnalyzer';
import { useStockfish } from '../hooks/useStockfish';
import { loadCachedAnalysis, saveCachedAnalysis } from '../utils/analysisCache';

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
              <div className="relative h-6 w-6">
                <div className="absolute inset-0 rounded-full border-2 border-[#81b64c]/20" />
                <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-[#81b64c] animate-spin" />
              </div>
              {analysis.total > 0 && (
                <span className="text-[10px] text-[#81b64c]/70 tabular-nums font-mono">
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

const StatsHeader: React.FC<{
  games: ProcessedGame[];
  analysisMap: Record<string, AnalysisState>;
}> = ({ games, analysisMap }) => {
  // Helper: compute stats for a subset of games
  const calcStats = (subset: ProcessedGame[]) => {
    const wins = subset.filter((g) => g.result === 'win').length;
    const losses = subset.filter((g) => g.result === 'loss').length;
    const draws = subset.filter((g) => g.result === 'draw').length;
    const analysedGames = subset.filter((g) => analysisMap[g.url]?.status === 'done');
    const totalBlunders = analysedGames.reduce(
      (sum, g) =>
        sum + (analysisMap[g.url]?.blunders.filter((b) => b.color === g.playerColor).length ?? 0),
      0,
    );
    const avgBlunders =
      analysedGames.length > 0 ? (totalBlunders / analysedGames.length).toFixed(2) : null;
    return { wins, losses, draws, totalBlunders, avgBlunders, analysedCount: analysedGames.length };
  };

  const rapidGames = games.filter((g) => g.timeClass === 'rapid');
  const blitzGames = games.filter((g) => g.timeClass === 'blitz');

  const rapidStats = calcStats(rapidGames);
  const blitzStats = calcStats(blitzGames);

  // Overall row (all games, no blunder breakdown)
  const totalWins = games.filter((g) => g.result === 'win').length;
  const totalLosses = games.filter((g) => g.result === 'loss').length;
  const totalDraws = games.filter((g) => g.result === 'draw').length;

  const TimeCard: React.FC<{
    label: string;
    icon: string;
    iconCls: string;
    stats: ReturnType<typeof calcStats>;
    count: number;
  }> = ({ label, icon, iconCls, stats, count }) =>
    count === 0 ? null : (
      <div className={`flex-1 rounded-2xl border border-white/[0.05] bg-slate-900/70 p-4 min-w-[160px]`}>
        {/* Header */}
        <div className="flex items-center gap-1.5 mb-3">
          <span className={`text-sm ${iconCls}`}>{icon}</span>
          <span className="text-xs font-semibold text-slate-300">{label}</span>
          <span className="ml-auto text-[10px] text-slate-600 font-mono">{count} партій</span>
        </div>

        {/* Results row */}
        <div className="grid grid-cols-3 gap-1 mb-3">
          {[
            { val: stats.wins, lbl: 'Перемог', cls: 'text-emerald-400' },
            { val: stats.losses, lbl: 'Поразок', cls: 'text-rose-400' },
            { val: stats.draws, lbl: 'Нічиїх', cls: 'text-slate-400' },
          ].map(({ val, lbl, cls }) => (
            <div key={lbl} className="rounded-xl bg-white/[0.03] py-2 text-center">
              <div className={`text-lg font-extrabold leading-none ${cls}`}>{val}</div>
              <div className="text-[9px] text-slate-600 mt-0.5">{lbl}</div>
            </div>
          ))}
        </div>

        {/* Win-rate bar */}
        <div className="mb-3">
          <div className="flex justify-between mb-1">
            <span className="text-[9px] text-slate-600">В/П/Н</span>
            <span className="text-[9px] text-slate-500 font-mono">
              {count > 0 ? Math.round((stats.wins / count) * 100) : 0}% перемог
            </span>
          </div>
          <div className="h-1.5 rounded-full bg-slate-800 overflow-hidden flex">
            <div
              className="bg-emerald-500/70 h-full transition-all duration-700"
              style={{ width: `${count > 0 ? (stats.wins / count) * 100 : 0}%` }}
            />
            <div
              className="bg-slate-500/50 h-full transition-all duration-700"
              style={{ width: `${count > 0 ? (stats.draws / count) * 100 : 0}%` }}
            />
            <div
              className="bg-rose-500/50 h-full transition-all duration-700"
              style={{ width: `${count > 0 ? (stats.losses / count) * 100 : 0}%` }}
            />
          </div>
        </div>

        {/* Blunders */}
        <div className={`rounded-xl border border-white/[0.04] bg-white/[0.02] px-3 py-2 flex items-center justify-between`}>
          <div>
            <div className="text-[9px] text-slate-600 mb-0.5">Зівки (твої)</div>
            <div className={`text-base font-extrabold leading-none ${stats.totalBlunders > 0 ? 'text-rose-400' : 'text-emerald-400'}`}>
              {stats.analysedCount > 0 ? stats.totalBlunders : '—'}
            </div>
          </div>
          <div className="text-right">
            <div className="text-[9px] text-slate-600 mb-0.5">Сер./партія</div>
            <div className="text-base font-extrabold leading-none text-slate-300">
              {stats.avgBlunders ?? '—'}
            </div>
          </div>
        </div>
      </div>
    );

  return (
    <div className="mb-5 space-y-3">
      {/* Compact overall row */}
      <div className="grid grid-cols-4 gap-px overflow-hidden rounded-2xl border border-white/[0.05] bg-white/[0.02]">
        {[
          { label: 'Партій', value: games.length, color: 'text-white' },
          { label: 'Перемог', value: totalWins, color: 'text-emerald-400' },
          { label: 'Поразок', value: totalLosses, color: 'text-rose-400' },
          { label: 'Нічиїх', value: totalDraws, color: 'text-slate-400' },
        ].map(({ label, value, color }) => (
          <div key={label} className="bg-slate-900/80 px-4 py-3 text-center">
            <div className={`text-2xl font-extrabold ${color}`}>{value}</div>
            <div className="text-xs text-slate-600 mt-0.5">{label}</div>
          </div>
        ))}
      </div>

      {/* Per-time-class cards */}
      {(rapidGames.length > 0 || blitzGames.length > 0) && (
        <div className="flex gap-3">
          <TimeCard
            label="Rapid"
            icon="⏱"
            iconCls="text-blue-400"
            stats={rapidStats}
            count={rapidGames.length}
          />
          <TimeCard
            label="Blitz"
            icon="⚡"
            iconCls="text-amber-400"
            stats={blitzStats}
            count={blitzGames.length}
          />
        </div>
      )}
    </div>
  );
};

// ─── Blunders By Month Panel ──────────────────────────────────────────────────

interface MonthlyBlunderStat {
  archiveUrl: string;
  label: string;          // e.g. "серпень 2026"
  totalGames: number;
  analyzedGames: number;
  totalBlunders: number;  // player blunders only (all classes)
  rapid: { totalGames: number; analyzedGames: number; totalBlunders: number };
  blitz: { totalGames: number; analyzedGames: number; totalBlunders: number };
}

const BlundersByMonthPanel: React.FC<{
  stats: MonthlyBlunderStat[];
  loading: boolean;
}> = ({ stats, loading }) => {
  if (loading) {
    return (
      <div className="mb-6 rounded-2xl border border-white/[0.05] bg-slate-900/60 p-5">
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-4">Зівки по місяцях</p>
        <div className="flex items-end gap-1.5 h-24">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex-1 rounded-t-md bg-slate-800 animate-pulse" style={{ height: `${30 + i * 10}%` }} />
          ))}
        </div>
      </div>
    );
  }

  if (stats.length === 0) return null;

  const displayed = [...stats].slice(-12);

  // helpers
  const shortMonth = (archiveUrl: string) => {
    const parts = archiveUrl.split('/');
    const monthNum = parseInt(parts[parts.length - 1], 10);
    const year = parts[parts.length - 2];
    return new Date(`${year}-${String(monthNum).padStart(2, '0')}-01`)
      .toLocaleDateString('uk-UA', { month: 'short' })
      .replace('.', '');
  };

  type TCStats = MonthlyBlunderStat['rapid'];

  const renderSection = (
    icon: string,
    title: string,
    iconCls: string,
    extract: (s: MonthlyBlunderStat) => TCStats,
  ) => {
    const rows = displayed.map((s) => ({ ...s, tc: extract(s) }));
    const hasAny = rows.some((r) => r.tc.totalGames > 0);
    if (!hasAny) return null;

    const maxB = Math.max(
      ...rows.map((r) =>
        r.tc.analyzedGames > 0 ? r.tc.totalBlunders / r.tc.analyzedGames : 0,
      ),
      0.01, // avoid division by zero
    );

    return (
      <div className="mb-4">
        {/* Section title */}
        <div className="flex items-center gap-1.5 mb-3">
          <span className={`text-sm ${iconCls}`}>{icon}</span>
          <span className="text-xs font-semibold text-slate-300">{title}</span>
        </div>

        {/* Bar chart */}
        <div className="flex items-end gap-1.5" style={{ height: '72px' }}>
          {rows.map((r) => {
            if (r.tc.totalGames === 0) {
              return <div key={r.archiveUrl} className="flex-1" />;
            }
            const avgPerGame = r.tc.analyzedGames > 0
              ? r.tc.totalBlunders / r.tc.analyzedGames
              : 0;
            const pct = (avgPerGame / maxB) * 100;
            const avgStr = r.tc.analyzedGames > 0
              ? avgPerGame.toFixed(1)
              : '—';
            const color =
              avgPerGame === 0
                ? 'bg-emerald-500/60'
                : avgPerGame >= 2
                ? 'bg-rose-500/70'
                : 'bg-[#81b64c]/70';
            return (
              <div
                key={r.archiveUrl}
                className="group relative flex-1 flex flex-col items-center justify-end"
                style={{ height: '100%' }}
              >
                {/* Tooltip */}
                <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 z-20 hidden group-hover:flex flex-col items-center pointer-events-none">
                  <div className="rounded-xl bg-slate-800 border border-white/10 px-3 py-2 text-center whitespace-nowrap shadow-xl">
                    <p className="text-white text-xs font-bold">{r.tc.totalBlunders} зівків</p>
                    <p className="text-slate-400 text-[10px]">{avgStr}/партія</p>
                    <p className="text-slate-600 text-[10px]">{r.tc.analyzedGames}/{r.tc.totalGames} проаналізовано</p>
                  </div>
                  <div className="w-2 h-2 bg-slate-800 border-b border-r border-white/10 rotate-45 -mt-1" />
                </div>
                {/* Bar */}
                <div
                  className={`w-full rounded-t-md transition-all duration-500 ${color}`}
                  style={{ height: `${Math.max(pct, r.tc.totalBlunders === 0 ? 8 : 4)}%` }}
                />
              </div>
            );
          })}
        </div>

        {/* X-axis */}
        <div className="flex gap-1.5 mt-1">
          {rows.map((r) => (
            <div key={r.archiveUrl} className="flex-1 text-center">
              <span className="text-[9px] text-slate-700 leading-none">{shortMonth(r.archiveUrl)}</span>
            </div>
          ))}
        </div>

        {/* Table */}
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-white/[0.04]">
                <th className="text-left text-slate-600 font-medium pb-1.5 pr-3">Місяць</th>
                <th className="text-right text-slate-600 font-medium pb-1.5 pr-3">Партій</th>
                <th className="text-right text-slate-600 font-medium pb-1.5 pr-3">Зівків</th>
                <th className="text-right text-slate-600 font-medium pb-1.5">Сер./партія</th>
              </tr>
            </thead>
            <tbody>
              {[...rows].reverse().map((r) => {
                if (r.tc.totalGames === 0) return null;
                const avg = r.tc.analyzedGames > 0
                  ? (r.tc.totalBlunders / r.tc.analyzedGames).toFixed(2)
                  : '—';
                const blunderColor =
                  r.tc.analyzedGames === 0
                    ? 'text-slate-600'
                    : r.tc.totalBlunders === 0
                    ? 'text-emerald-400'
                    : r.tc.totalBlunders / r.tc.analyzedGames >= 2
                    ? 'text-rose-400'
                    : 'text-amber-400';
                return (
                  <tr key={r.archiveUrl} className="border-b border-white/[0.02] hover:bg-white/[0.02] transition-colors">
                    <td className="py-1.5 pr-3 text-slate-400">{r.label}</td>
                    <td className="py-1.5 pr-3 text-right text-slate-500">
                      {r.tc.analyzedGames}/{r.tc.totalGames}
                    </td>
                    <td className={`py-1.5 pr-3 text-right font-bold ${blunderColor}`}>
                      {r.tc.analyzedGames > 0 ? r.tc.totalBlunders : '—'}
                    </td>
                    <td className={`py-1.5 text-right ${blunderColor}`}>{avg}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  return (
    <div className="mb-6 rounded-2xl border border-white/[0.05] bg-slate-900/60 p-5">
      <div className="flex items-center justify-between mb-4">
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">🎯 Зівки по місяцях</p>
        <span className="text-[10px] text-slate-600">тільки твої зівки · аналіз з кешу</span>
      </div>

      {renderSection('⏱', 'Rapid', 'text-blue-400', (s) => s.rapid)}

      {/* Divider between sections if both exist */}
      {displayed.some((s) => s.rapid.totalGames > 0) &&
        displayed.some((s) => s.blitz.totalGames > 0) && (
        <div className="border-t border-white/[0.04] my-4" />
      )}

      {renderSection('⚡', 'Blitz', 'text-amber-400', (s) => s.blitz)}
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

  // Monthly blunder stats
  const [monthlyStats, setMonthlyStats] = useState<MonthlyBlunderStat[]>([]);
  const [loadingMonthlyStats, setLoadingMonthlyStats] = useState(false);

  // Centralised per-game analysis state, keyed by game URL
  const [analysisMap, setAnalysisMap] = useState<Record<string, AnalysisState>>({});

  const { status: sfStatus, evaluate } = useStockfish();

  // Track whether auto-analysis was already kicked off for current game set
  const autoStartedRef = useRef(false);
  // Increments every time a new month is selected — lets old queues self-abort
  const runGenRef = useRef(0);
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

  // ── Load monthly blunder stats from Firestore cache for all archives
  useEffect(() => {
    if (archives.length === 0) return;
    let cancelled = false;
    setLoadingMonthlyStats(true);

    (async () => {
      const results: MonthlyBlunderStat[] = [];

      for (const archive of archives) {
        if (cancelled) break;
        try {
          const games = await fetchMonthlyGames(archive);
          if (cancelled) break;

          let totalBlunders = 0;
          let analyzedGames = 0;

          let rapidTotal = 0, rapidAnalyzed = 0, rapidBlunders = 0;
          let blitzTotal = 0, blitzAnalyzed = 0, blitzBlunders = 0;

          await Promise.all(
            games.map(async (rawGame) => {
              const processed = processGame(rawGame);
              const tc = processed.timeClass;
              if (tc === 'rapid') rapidTotal += 1;
              else if (tc === 'blitz') blitzTotal += 1;

              const cached = await loadCachedAnalysis(processed.url);
              if (cached) {
                analyzedGames += 1;
                const playerB = cached.blunders.filter(
                  (b) => b.color === processed.playerColor,
                ).length;
                totalBlunders += playerB;

                if (tc === 'rapid') { rapidAnalyzed += 1; rapidBlunders += playerB; }
                else if (tc === 'blitz') { blitzAnalyzed += 1; blitzBlunders += playerB; }
              }
            }),
          );

          const parts = archive.split('/');
          const year = parts[parts.length - 2];
          const monthNum = parts[parts.length - 1];
          const label = new Date(`${year}-${monthNum}-01`).toLocaleDateString('uk-UA', {
            month: 'long',
            year: 'numeric',
          });

          results.push({
            archiveUrl: archive,
            label,
            totalGames: games.length,
            analyzedGames,
            totalBlunders,
            rapid: { totalGames: rapidTotal, analyzedGames: rapidAnalyzed, totalBlunders: rapidBlunders },
            blitz: { totalGames: blitzTotal, analyzedGames: blitzAnalyzed, totalBlunders: blitzBlunders },
          });
        } catch {
          // skip failed archive
        }
      }

      if (!cancelled) {
        setMonthlyStats(results);
        setLoadingMonthlyStats(false);
      }
    })();

    return () => { cancelled = true; };
  }, [archives]);

  // ── Load games when selected archive changes
  useEffect(() => {
    if (!selectedArchive) return;

    let cancelled = false;

    const load = async () => {
      setLoadingGames(true);
      setRawGames([]);
      setAnalysisMap({});
      setError(null);
      autoStartedRef.current = false;
      runGenRef.current += 1; // invalidate any running queue from previous month

      try {
        const games = await fetchMonthlyGames(selectedArchive);
        const data: RawGameData[] = games.map((g) => ({
          processed: processGame(g),
          pgn: g.pgn,
        }));
        // Sort newest first
        data.sort((a, b) => b.processed.end_time - a.processed.end_time);

        if (cancelled) return;
        setRawGames(data);

        // Check Firestore cache for all games right away (parallel)
        const initialMap: Record<string, AnalysisState> = {};
        await Promise.all(
          data.map(async (g) => {
            const cached = await loadCachedAnalysis(g.processed.url);
            initialMap[g.processed.url] = cached
              ? { status: 'done', progress: 0, total: 0, blunders: cached.blunders }
              : defaultAnalysis();
          }),
        );

        if (cancelled) return;
        setAnalysisMap(initialMap);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      } finally {
        if (!cancelled) setLoadingGames(false);
      }
    };

    load();
    return () => { cancelled = true; };
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
    async (url: string, pgn: string, gen?: number) => {
      const isStale = () => gen !== undefined && gen !== runGenRef.current;

      // 1. Try Firestore cache first
      const cached = await loadCachedAnalysis(url);
      if (isStale()) return;
      if (cached) {
        updateAnalysis(url, { status: 'done', blunders: cached.blunders });
        return;
      }

      // 2. Run Stockfish
      updateAnalysis(url, { status: 'analyzing', progress: 0, total: 0, blunders: [] });
      try {
        const { blunders, aborted } = await analyzePgn(
          pgn,
          evaluate,
          (current, total) => {
            if (!isStale()) updateAnalysis(url, { progress: current, total });
          },
          () => !isStale(), // stop sending FENs to Stockfish if month changed
        );
        if (isStale() || aborted) return;
        updateAnalysis(url, { status: 'done', blunders });
        // 3. Save to Firestore (fire-and-forget)
        saveCachedAnalysis(url, blunders);
      } catch (e) {
        if (!isStale()) updateAnalysis(url, { status: 'error', error: String(e) });
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
    const myGen = runGenRef.current; // snapshot generation for this batch

    // Mark only uncached (idle) games as queued
    setAnalysisMap((prev) => {
      const next = { ...prev };
      rawGames.forEach((g) => {
        // Only queue games not already resolved from cache
        if (!next[g.processed.url] || next[g.processed.url].status === 'idle') {
          next[g.processed.url] = { ...defaultAnalysis(), status: 'queued' };
        }
      });
      return next;
    });

    // Run sequentially in background — abort if month changed
    (async () => {
      for (const game of rawGamesRef.current) {
        if (myGen !== runGenRef.current) break; // month switched — stop immediately
        await analyzeGame(game.processed.url, game.pgn, myGen);
      }
    })();
  }, [sfStatus, rawGames, analyzeGame]);

  // ── Manual trigger (retry or idle games) — no gen check, always intentional
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

  // ── Background multi-month queue
  // Runs silently after the current month is fully analysed.
  // Fetches each other archive, checks Firestore, and runs Stockfish only for uncached games.
  const bgQueueRunningRef = useRef(false);
  const [bgArchiveLabel, setBgArchiveLabel] = useState<string | null>(null);

  useEffect(() => {
    // Only start when current month is fully done
    const currentDone =
      autoProgress !== null &&
      autoProgress.done === autoProgress.total &&
      autoProgress.total > 0;
    if (!currentDone || sfStatus !== 'ready') return;
    if (bgQueueRunningRef.current) return;
    if (archives.length <= 1) return;

    const myGen = runGenRef.current;
    const others = [...archives].reverse().filter((a) => a !== selectedArchive);
    if (others.length === 0) return;

    bgQueueRunningRef.current = true;

    (async () => {
      try {
        for (const archive of others) {
          if (myGen !== runGenRef.current) break;

          // Show which archive we're working on
          const label = archiveLabel(archive);
          setBgArchiveLabel(label);

          const games = await fetchMonthlyGames(archive).catch(() => []);

          for (const game of games) {
            if (myGen !== runGenRef.current) break;

            const processed = processGame(game);
            const cached = await loadCachedAnalysis(processed.url);
            if (cached) continue; // already in Firestore — skip

            if (myGen !== runGenRef.current) break;

            const { blunders, aborted } = await analyzePgn(
              game.pgn,
              evaluate,
              undefined,
              () => myGen === runGenRef.current,
            );

            if (!aborted && myGen === runGenRef.current) {
              saveCachedAnalysis(processed.url, blunders);
            }
          }
        }
      } finally {
        bgQueueRunningRef.current = false;
        setBgArchiveLabel(null);
      }
    })();
  }, [autoProgress, sfStatus, archives, selectedArchive, evaluate]);

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

          {/* Auto-analysis progress for current month */}
          {autoProgress !== null && autoProgress.done < autoProgress.total && sfStatus === 'ready' && (
            <div className="flex items-center gap-2">
              {/* Spinning indicator */}
              <div className="relative h-4 w-4 flex-shrink-0">
                <div className="absolute inset-0 rounded-full border-2 border-[#81b64c]/20" />
                <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-[#81b64c] animate-spin" />
              </div>
              <div className="flex flex-col leading-none gap-0.5">
                <span className="text-[10px] text-[#81b64c]/90 font-medium">Аналізується…</span>
                <div className="flex items-center gap-1.5">
                  <div className="h-1 w-16 rounded-full bg-slate-800 overflow-hidden">
                    <div
                      className="h-full bg-[#81b64c] transition-all duration-500"
                      style={{ width: `${(autoProgress.done / autoProgress.total) * 100}%` }}
                    />
                  </div>
                  <span className="text-[10px] text-slate-500 tabular-nums font-mono">
                    {autoProgress.done}/{autoProgress.total}
                  </span>
                </div>
              </div>
            </div>
          )}
          {autoProgress !== null && autoProgress.done === autoProgress.total && autoProgress.total > 0 && !bgArchiveLabel && (
            <span className="text-xs text-emerald-500/80">✓ Аналіз завершено</span>
          )}

          {/* Background multi-month progress */}
          {bgArchiveLabel && (
            <div className="flex items-center gap-2">
              <div className="relative h-3.5 w-3.5 flex-shrink-0">
                <div className="absolute inset-0 rounded-full border-[1.5px] border-slate-700" />
                <div className="absolute inset-0 rounded-full border-[1.5px] border-transparent border-t-slate-500 animate-spin" />
              </div>
              <div className="flex flex-col leading-none">
                <span className="text-[10px] text-slate-500">Фоновий аналіз</span>
                <span className="text-[10px] text-slate-600 truncate max-w-[100px]">{bgArchiveLabel}</span>
              </div>
            </div>
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
        {/* Blunders by month */}
        {(loadingMonthlyStats || monthlyStats.length > 0) && (
          <BlundersByMonthPanel stats={monthlyStats} loading={loadingMonthlyStats} />
        )}

        {/* Month selector */}
        {archives.length > 0 && (
          <MonthSelector archives={archives} selected={selectedArchive} onSelect={setSelectedArchive} />
        )}

        {/* Stats */}
        {!loadingGames && rawGames.length > 0 && (
          <StatsHeader games={rawGames.map((g) => g.processed)} analysisMap={analysisMap} />
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

        {/* Games list — split by time class */}
        {!loadingGames && filteredGames.length > 0 && (() => {
          const rapidGames = filteredGames.filter((g) => g.processed.timeClass === 'rapid');
          const blitzGames = filteredGames.filter((g) => g.processed.timeClass === 'blitz');
          const otherGames = filteredGames.filter(
            (g) => g.processed.timeClass !== 'rapid' && g.processed.timeClass !== 'blitz',
          );

          const renderSection = (
            label: string,
            icon: string,
            iconCls: string,
            games: typeof filteredGames,
          ) =>
            games.length > 0 ? (
              <div key={label} className="mb-8">
                <div className="flex items-center gap-2 mb-3">
                  <span className={`text-base leading-none ${iconCls}`}>{icon}</span>
                  <h2 className="text-sm font-semibold text-slate-300">{label}</h2>
                  <span className="ml-1 rounded-full bg-white/[0.05] px-2 py-0.5 text-[10px] text-slate-500 font-mono">
                    {games.length}
                  </span>
                </div>
                <div className="space-y-2">
                  {games.map((g) => (
                    <GameCard
                      key={g.processed.url}
                      game={g.processed}
                      analysis={analysisMap[g.processed.url] ?? defaultAnalysis()}
                      onAnalyze={() => handleManualAnalyze(g.processed.url, g.pgn)}
                    />
                  ))}
                </div>
              </div>
            ) : null;

          return (
            <>
              {renderSection('Rapid', '⏱', 'text-blue-400', rapidGames)}
              {renderSection('Blitz', '⚡', 'text-amber-400', blitzGames)}
              {renderSection('Інші', '🎮', 'text-slate-400', otherGames)}
            </>
          );
        })()}

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
