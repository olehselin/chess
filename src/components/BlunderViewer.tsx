import React, { useMemo, useState } from 'react';
import type { Blunder } from '../types/chess';
import { parsePgnBlunders } from '../utils/parsePgnBlunders';

// ─── Sub-Components ───────────────────────────────────────────────────────────

interface EvalBadgeProps {
  value: number | null;
  label: string;
}

const EvalBadge: React.FC<EvalBadgeProps> = ({ value, label }) => {
  if (value === null) return null;

  const isPositive = value > 0;
  const isMate = Math.abs(value) >= 900;

  let displayText: string;
  let colorClass: string;

  if (isMate) {
    displayText = value > 0 ? '+M' : '-M';
    colorClass = isPositive ? 'text-emerald-400' : 'text-rose-400';
  } else {
    displayText = value > 0 ? `+${value.toFixed(2)}` : value.toFixed(2);
    colorClass =
      value > 1 ? 'text-emerald-400' : value < -1 ? 'text-rose-400' : 'text-slate-300';
  }

  return (
    <div className="flex flex-col items-center gap-0.5">
      <span className="text-xs text-slate-500 uppercase tracking-wider">{label}</span>
      <span className={`font-mono font-semibold text-sm ${colorClass}`}>{displayText}</span>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────

interface ReasonBadgeProps {
  reason: Blunder['reason'];
}

const ReasonBadge: React.FC<ReasonBadgeProps> = ({ reason }) => {
  const config = {
    annotation: {
      label: '?? Annotation',
      className: 'bg-rose-500/20 text-rose-300 border border-rose-500/40',
    },
    eval_drop: {
      label: '📉 Eval Drop',
      className: 'bg-amber-500/20 text-amber-300 border border-amber-500/40',
    },
    annotation_and_eval: {
      label: '?? + 📉 Double',
      className: 'bg-rose-600/25 text-rose-200 border border-rose-500/60',
    },
  }[reason];

  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${config.className}`}
    >
      {config.label}
    </span>
  );
};

// ─────────────────────────────────────────────────────────────────────────────

interface BlunderCardProps {
  blunder: Blunder;
  index: number;
}

const BlunderCard: React.FC<BlunderCardProps> = ({ blunder, index }) => {
  const isWhite = blunder.color === 'white';

  return (
    <div
      className="
        group relative overflow-hidden rounded-2xl border border-white/[0.06]
        bg-gradient-to-br from-slate-800/80 to-slate-900/80
        p-5 backdrop-blur-sm
        transition-all duration-300
        hover:border-rose-500/30 hover:shadow-[0_0_30px_rgba(239,68,68,0.12)]
        hover:translate-y-[-2px]
      "
    >
      {/* Decorative glow accent */}
      <div className="pointer-events-none absolute -top-16 -right-16 h-48 w-48 rounded-full bg-rose-600/10 blur-3xl transition-all duration-500 group-hover:bg-rose-600/20" />

      {/* Index badge + move info header */}
      <div className="relative flex items-start justify-between gap-3">
        {/* Left: index + move info */}
        <div className="flex items-center gap-3">
          {/* Blunder index bubble */}
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-rose-500/20 ring-1 ring-rose-500/40">
            <span className="text-xs font-bold text-rose-400">#{index + 1}</span>
          </div>

          <div>
            {/* Move number + colour */}
            <div className="flex items-center gap-2">
              <span className="text-slate-400 text-sm">
                Move <span className="font-semibold text-white">{blunder.moveNumber}</span>
              </span>
              {/* Player colour chip */}
              <span
                className={`inline-flex items-center gap-1 rounded-full px-2 py-px text-xs font-medium ${
                  isWhite
                    ? 'bg-slate-200/10 text-slate-200 ring-1 ring-slate-300/30'
                    : 'bg-slate-900/60 text-slate-400 ring-1 ring-slate-600/40'
                }`}
              >
                <span
                  className={`h-2 w-2 rounded-full ${isWhite ? 'bg-white' : 'bg-slate-700'}`}
                />
                {isWhite ? 'White' : 'Black'}
              </span>
            </div>

            {/* SAN notation */}
            <div className="mt-1 flex items-baseline gap-1.5">
              <span className="font-mono text-2xl font-bold tracking-tight text-white">
                {blunder.notation}
              </span>
              <span className="font-mono text-lg font-bold text-rose-400">??</span>
            </div>
          </div>
        </div>

        {/* Right: reason badge */}
        <div className="shrink-0">
          <ReasonBadge reason={blunder.reason} />
        </div>
      </div>

      {/* Divider */}
      <div className="relative my-4 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />

      {/* Eval section */}
      <div className="relative flex items-center justify-between">
        <div className="flex items-center gap-6">
          <EvalBadge value={blunder.evalBefore} label="Before" />

          {/* Arrow */}
          {blunder.evalBefore !== null && blunder.evalAfter !== null && (
            <div className="flex flex-col items-center gap-0.5">
              <svg
                className="h-4 w-4 text-rose-400"
                viewBox="0 0 16 16"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  d="M8 2L14 8L8 14M2 8H14"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
          )}

          <EvalBadge value={blunder.evalAfter} label="After" />

          {/* Drop indicator */}
          {blunder.evalDrop !== null && (
            <div className="flex flex-col items-center gap-0.5">
              <span className="text-xs text-slate-500 uppercase tracking-wider">Drop</span>
              <span className="font-mono font-bold text-sm text-rose-400">
                −{blunder.evalDrop.toFixed(1)}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Description */}
      <p className="relative mt-3 text-xs text-slate-500 leading-relaxed">{blunder.description}</p>
    </div>
  );
};

// ─── Empty State ─────────────────────────────────────────────────────────────

const EmptyState: React.FC = () => (
  <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-white/10 bg-white/[0.02] py-16 px-8 text-center">
    <div className="mb-4 text-5xl">♟️</div>
    <h3 className="text-lg font-semibold text-white">No Blunders Found</h3>
    <p className="mt-2 max-w-sm text-sm text-slate-500">
      This game has no moves annotated with <span className="font-mono text-rose-400">??</span> and
      no evaluation drops of ≥ 3.0 pawns were detected.
    </p>
  </div>
);

// ─── Stats Bar ────────────────────────────────────────────────────────────────

interface StatsBarProps {
  blunders: Blunder[];
}

const StatsBar: React.FC<StatsBarProps> = ({ blunders }) => {
  const white = blunders.filter((b) => b.color === 'white').length;
  const black = blunders.filter((b) => b.color === 'black').length;
  const annotated = blunders.filter(
    (b) => b.reason === 'annotation' || b.reason === 'annotation_and_eval',
  ).length;
  const evalDrop = blunders.filter(
    (b) => b.reason === 'eval_drop' || b.reason === 'annotation_and_eval',
  ).length;

  const Stat: React.FC<{ label: string; value: number; accent?: string }> = ({
    label,
    value,
    accent = 'text-white',
  }) => (
    <div className="flex flex-col items-center">
      <span className={`text-2xl font-bold ${accent}`}>{value}</span>
      <span className="text-xs text-slate-500 mt-0.5">{label}</span>
    </div>
  );

  return (
    <div className="mb-6 grid grid-cols-4 divide-x divide-white/10 rounded-2xl border border-white/[0.06] bg-slate-800/50 py-4">
      <Stat label="Total" value={blunders.length} accent="text-rose-400" />
      <Stat label="White" value={white} accent="text-slate-200" />
      <Stat label="Black" value={black} accent="text-slate-400" />
      <Stat label="?? Tagged" value={annotated} accent="text-amber-400" />
    </div>
  );
};

// ─── PGN Input Area ──────────────────────────────────────────────────────────

interface PgnInputProps {
  value: string;
  onChange: (v: string) => void;
}

const PgnInput: React.FC<PgnInputProps> = ({ value, onChange }) => (
  <div className="mb-6">
    <label className="mb-2 block text-sm font-medium text-slate-400">PGN Input</label>
    <textarea
      className="
        h-36 w-full resize-none rounded-xl border border-white/[0.08]
        bg-slate-900/60 px-4 py-3 font-mono text-xs text-slate-300
        placeholder:text-slate-600
        focus:border-rose-500/50 focus:outline-none focus:ring-1 focus:ring-rose-500/30
        transition-colors duration-200
      "
      placeholder="Paste PGN here…"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  </div>
);

// ─── Filter Bar ───────────────────────────────────────────────────────────────

type FilterType = 'all' | 'white' | 'black' | 'annotation' | 'eval_drop';

interface FilterBarProps {
  active: FilterType;
  onChange: (f: FilterType) => void;
}

const FILTERS: { key: FilterType; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'white', label: '⬜ White' },
  { key: 'black', label: '⬛ Black' },
  { key: 'annotation', label: '?? Marked' },
  { key: 'eval_drop', label: '📉 Eval Drop' },
];

const FilterBar: React.FC<FilterBarProps> = ({ active, onChange }) => (
  <div className="mb-5 flex flex-wrap gap-2">
    {FILTERS.map(({ key, label }) => (
      <button
        key={key}
        onClick={() => onChange(key)}
        className={`
          rounded-full px-3.5 py-1.5 text-xs font-medium transition-all duration-200
          ${
            active === key
              ? 'bg-rose-500 text-white shadow-[0_0_12px_rgba(239,68,68,0.4)]'
              : 'border border-white/10 bg-white/5 text-slate-400 hover:border-white/20 hover:text-slate-200'
          }
        `}
      >
        {label}
      </button>
    ))}
  </div>
);

// ─── Main Component ───────────────────────────────────────────────────────────

export interface BlunderViewerProps {
  pgnString: string;
}

export const BlunderViewer: React.FC<BlunderViewerProps> = ({ pgnString: initialPgn }) => {
  const [pgn, setPgn] = useState(initialPgn);
  const [filter, setFilter] = useState<FilterType>('all');

  const allBlunders = useMemo(() => parsePgnBlunders(pgn), [pgn]);

  const blunders = useMemo(() => {
    switch (filter) {
      case 'white':
        return allBlunders.filter((b) => b.color === 'white');
      case 'black':
        return allBlunders.filter((b) => b.color === 'black');
      case 'annotation':
        return allBlunders.filter(
          (b) => b.reason === 'annotation' || b.reason === 'annotation_and_eval',
        );
      case 'eval_drop':
        return allBlunders.filter(
          (b) => b.reason === 'eval_drop' || b.reason === 'annotation_and_eval',
        );
      default:
        return allBlunders;
    }
  }, [allBlunders, filter]);

  return (
    <div className="min-h-screen bg-[#0a0c10] px-4 py-10 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-2xl">
        {/* ── Header ── */}
        <div className="mb-8 text-center">
          <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-rose-500/30 bg-rose-500/10 px-3 py-1 text-xs font-semibold text-rose-400">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-rose-400" />
            Chess Blunder Detector
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight text-white sm:text-4xl">
            Game{' '}
            <span className="bg-gradient-to-r from-rose-400 to-orange-400 bg-clip-text text-transparent">
              Analysis
            </span>
          </h1>
          <p className="mt-2 text-sm text-slate-500">
            Paste a PGN with <code className="text-rose-400">??</code> annotations or{' '}
            <code className="text-amber-400">[%eval]</code> tags to detect blunders automatically.
          </p>
        </div>

        {/* ── PGN input ── */}
        <PgnInput value={pgn} onChange={setPgn} />

        {/* ── Stats bar ── */}
        {allBlunders.length > 0 && <StatsBar blunders={allBlunders} />}

        {/* ── Filter bar ── */}
        {allBlunders.length > 0 && <FilterBar active={filter} onChange={setFilter} />}

        {/* ── Results heading ── */}
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-slate-500">
            Blunders detected
          </h2>
          {blunders.length > 0 && (
            <span className="rounded-full bg-rose-500/20 px-2.5 py-0.5 text-xs font-bold text-rose-400">
              {blunders.length}
            </span>
          )}
        </div>

        {/* ── Cards or empty state ── */}
        {blunders.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="flex flex-col gap-4">
            {blunders.map((blunder, i) => (
              <BlunderCard
                key={`${blunder.moveNumber}-${blunder.color}`}
                blunder={blunder}
                index={i}
              />
            ))}
          </div>
        )}

        {/* ── Footer note ── */}
        <p className="mt-10 text-center text-xs text-slate-700">
          Blunder threshold: eval drop ≥ 3.0 pawns · No external chess libraries used
        </p>
      </div>
    </div>
  );
};
