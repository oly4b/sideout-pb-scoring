import {
  Activity,
  Calendar,
  Clock,
  Play,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import type { Match, Player, Session } from '../../shared/types';
import { api } from '../lib/api';
import { copy, type Lang } from '../lib/i18n';

interface HistoryViewProps {
  lang: Lang;
  matches: Match[];
  players: Player[];
  sessions: Session[];
  onResumeMatch: (match: Match) => void;
  onRefreshAll: () => Promise<void>;
  onNotify: (msg: string) => void;
}

function formatDate(iso: string, lang: Lang): string {
  return new Date(iso).toLocaleDateString(lang === 'ja' ? 'ja-JP' : 'en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatMinutes(sec: number): string {
  if (!sec || sec < 60) return `${sec || 0}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}m ${s}s`;
}

function ScoreProgressionChart({ match }: { match: Match }) {
  const rallies = match.rallies ?? [];
  if (rallies.length === 0) {
    return (
      <div
        style={{
          padding: 20,
          textAlign: 'center',
          fontSize: '0.84rem',
          color: 'var(--ink-muted)',
          background: 'var(--bg-subtle)',
          borderRadius: 'var(--radius-sm)',
        }}
      >
        Recorded via Quick Score — rally-by-rally timeline not available.
      </div>
    );
  }

  const width = 500;
  const height = 160;
  const padX = 28;
  const padY = 16;
  const maxScore = Math.max(match.target_score, match.team_a_score, match.team_b_score, 11);

  const pointsA = [{ seq: 0, score: 0 }, ...rallies.map((r) => ({ seq: r.seq, score: r.team_a_score }))];
  const pointsB = [{ seq: 0, score: 0 }, ...rallies.map((r) => ({ seq: r.seq, score: r.team_b_score }))];
  const totalSeq = Math.max(1, rallies.length);

  const toX = (seq: number) => padX + (seq / totalSeq) * (width - padX * 2);
  const toY = (score: number) => height - padY - (score / maxScore) * (height - padY * 2);

  const pathA = pointsA
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${toX(p.seq).toFixed(1)} ${toY(p.score).toFixed(1)}`)
    .join(' ');
  const pathB = pointsB
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${toX(p.seq).toFixed(1)} ${toY(p.score).toFixed(1)}`)
    .join(' ');

  return (
    <div className="chart-container">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        style={{ width: '100%', height: 'auto', display: 'block' }}
        role="img"
        aria-label="Score progression chart"
      >
        {[0, Math.round(maxScore / 2), maxScore].map((tick) => (
          <g key={tick}>
            <line
              x1={padX}
              y1={toY(tick)}
              x2={width - padX}
              y2={toY(tick)}
              stroke="var(--border-subtle)"
              strokeDasharray="3 3"
            />
            <text
              x={padX - 6}
              y={toY(tick) + 3}
              fontSize="10"
              textAnchor="end"
              fill="var(--ink-muted)"
            >
              {tick}
            </text>
          </g>
        ))}

        <path d={pathA} fill="none" stroke="var(--team-a)" strokeWidth="2.8" strokeLinejoin="round" />
        <path d={pathB} fill="none" stroke="var(--team-b)" strokeWidth="2.8" strokeLinejoin="round" />
      </svg>
      <div
        style={{
          display: 'flex',
          justifyContent: 'center',
          gap: 18,
          fontSize: '0.78rem',
          fontWeight: 700,
          marginTop: 6,
        }}
      >
        <span style={{ color: 'var(--team-a)' }}>● {match.team_a_name}</span>
        <span style={{ color: 'var(--team-b)' }}>● {match.team_b_name}</span>
      </div>
    </div>
  );
}

export function HistoryView({
  lang,
  matches,
  players,
  sessions,
  onResumeMatch,
  onRefreshAll,
  onNotify,
}: HistoryViewProps) {
  const t = copy[lang].history;
  const sessionMap = useMemo(() => new Map(sessions.map((s) => [s.id, s])), [sessions]);
  const [search, setSearch] = useState('');
  const [playerFilter, setPlayerFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'completed' | 'in_progress'>('all');
  const [inspectMatch, setInspectMatch] = useState<Match | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Match | null>(null);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);

  const filtered = useMemo(() => {
    return matches.filter((m) => {
      if (statusFilter === 'completed' && m.status !== 'completed') return false;
      if (statusFilter === 'in_progress' && m.status === 'completed') return false;
      if (playerFilter !== 'all' && !m.participants.some((p) => p.player_id === playerFilter)) {
        return false;
      }
      if (search.trim()) {
        const q = search.toLowerCase();
        const sessTitle = m.session_id ? sessionMap.get(m.session_id)?.title ?? '' : '';
        const haystack = `${m.team_a_name} ${m.team_b_name} ${sessTitle}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [matches, statusFilter, playerFilter, search, sessionMap]);

  const completedCount = matches.filter((m) => m.status === 'completed').length;
  const totalRallies = matches.reduce((acc, m) => acc + (m.rallies?.length ?? 0), 0);

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    if (deleteConfirmText.trim().toUpperCase() !== 'DELETE') return;
    try {
      setDeleting(true);
      await api.deleteMatch(deleteTarget.id);
      setDeleteTarget(null);
      setDeleteConfirmText('');
      setInspectMatch(null);
      await onRefreshAll();
      onNotify(lang === 'ja' ? '試合履歴を削除しました' : 'Match deleted from history');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Failed to delete match');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <section className="section-card is-strong-border">
        <div className="section-card-header">
          <div className="section-card-title">
            <Activity size={16} />
            <div>
              <h1>{t.title}</h1>
              <div className="section-card-sub">{t.subtitle}</div>
            </div>
          </div>
          <span className="section-card-sub tabular-nums">
            {matches.length} {t.totalMatches}
          </span>
        </div>

        <div className="section-subbar" style={{ gap: 10 }}>
          <div style={{ position: 'relative', flex: '1 1 220px' }}>
            <Search
              size={15}
              style={{
                position: 'absolute',
                left: 11,
                top: '50%',
                transform: 'translateY(-50%)',
                color: 'var(--ink-muted)',
              }}
            />
            <input
              className="input"
              style={{ paddingLeft: 34 }}
              placeholder={t.searchPlaceholder}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <select
            className="select"
            style={{ width: 'auto', minWidth: 165 }}
            value={playerFilter}
            onChange={(e) => setPlayerFilter(e.target.value)}
          >
            <option value="all">{t.allPlayers}</option>
            {players.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>

          <div className="segmented">
            {(['all', 'completed', 'in_progress'] as const).map((s) => (
              <button
                key={s}
                type="button"
                className={`segmented-btn ${statusFilter === s ? 'active' : ''}`}
                onClick={() => setStatusFilter(s)}
              >
                {s === 'all' ? t.all : s === 'completed' ? t.final : t.live}
              </button>
            ))}
          </div>
        </div>

        <div className="section-card-body">
          <div className="stat-strip">
            <div className="stat-box">
              <div className="section-heading" style={{ margin: 0 }}>{t.totalMatches}</div>
              <div className="stat-value tabular-nums">{matches.length}</div>
            </div>
            <div className="stat-box">
              <div className="section-heading" style={{ margin: 0 }}>{t.completed}</div>
              <div className="stat-value tabular-nums">{completedCount}</div>
            </div>
            <div className="stat-box">
              <div className="section-heading" style={{ margin: 0 }}>{t.ralliesLogged}</div>
              <div className="stat-value tabular-nums">{totalRallies}</div>
            </div>
            <div className="stat-box">
              <div className="section-heading" style={{ margin: 0 }}>{t.sessions}</div>
              <div className="stat-value tabular-nums">{sessions.length}</div>
            </div>
          </div>
        </div>
      </section>

      {filtered.length === 0 ? (
        <div className="card empty-state">
          <Activity size={34} strokeWidth={1.6} />
          <div style={{ fontWeight: 800, color: 'var(--ink-primary)' }}>No matching games</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {filtered.map((m) => {
            const session = m.session_id ? sessionMap.get(m.session_id) : null;
            return (
              <div
                key={m.id}
                className={`card card-interactive ${m.status === 'in_progress' ? 'card-confirmed' : ''}`}
                style={{ cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 10 }}
                onClick={() => setInspectMatch(m)}
              >
                <div
                  style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 8,
                    fontSize: '0.78rem',
                    color: 'var(--ink-muted)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span className={`tag ${m.status === 'in_progress' ? 'tag-live' : ''}`}>
                      {m.status === 'completed'
                        ? t.final
                        : m.status === 'in_progress'
                          ? t.live
                          : 'Ready'}
                    </span>
                    {session && (
                      <span style={{ fontWeight: 700, color: 'var(--ink-secondary)' }}>
                        {session.title} · R{m.round_number} C{m.court_number}
                      </span>
                    )}
                    {!session && <span>Quick {m.game_type === 'doubles' ? 'Doubles' : 'Singles'}</span>}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      <Calendar size={13} /> {formatDate(m.completed_at ?? m.started_at, lang)}
                    </span>
                    {m.duration_seconds > 0 && (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        <Clock size={13} /> {formatMinutes(m.duration_seconds)}
                      </span>
                    )}
                  </div>
                </div>

                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr auto 1fr',
                    alignItems: 'center',
                    gap: 12,
                  }}
                >
                  <div style={{ fontWeight: m.winner_team === 'A' ? 800 : 600, fontSize: '0.96rem' }}>
                    <span style={{ color: 'var(--team-a)', marginRight: 6 }}>●</span>
                    {m.team_a_name}
                  </div>
                  <div
                    style={{
                      fontFamily: 'var(--font-display)',
                      fontSize: '1.85rem',
                      fontWeight: 800,
                      letterSpacing: '0.03em',
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    <span style={{ color: m.winner_team === 'A' ? 'var(--brand-emerald)' : 'inherit' }}>
                      {m.team_a_score}
                    </span>
                    <span style={{ margin: '0 8px', color: 'var(--ink-muted)' }}>–</span>
                    <span style={{ color: m.winner_team === 'B' ? 'var(--brand-emerald)' : 'inherit' }}>
                      {m.team_b_score}
                    </span>
                  </div>
                  <div
                    style={{
                      textAlign: 'right',
                      fontWeight: m.winner_team === 'B' ? 800 : 600,
                      fontSize: '0.96rem',
                    }}
                  >
                    {m.team_b_name}
                    <span style={{ color: 'var(--team-b)', marginLeft: 6 }}>●</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {inspectMatch && (
        <div className="modal-backdrop" onClick={() => setInspectMatch(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Match Summary</h2>
              <button
                type="button"
                className="btn btn-ghost btn-icon"
                onClick={() => setInspectMatch(null)}
              >
                <X size={18} />
              </button>
            </div>
            <div className="modal-body">

            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '14px 16px',
                borderRadius: 'var(--radius-md)',
                background: 'var(--bg-subtle)',
                gap: 12,
              }}
            >
              <div>
                <div style={{ fontWeight: 800, color: 'var(--team-a)' }}>{inspectMatch.team_a_name}</div>
                <div style={{ fontSize: '0.76rem', color: 'var(--ink-muted)' }}>Team A</div>
              </div>
              <div
                style={{
                  fontFamily: 'var(--font-display)',
                  fontSize: '2.4rem',
                  fontWeight: 800,
                  lineHeight: 1,
                }}
              >
                {inspectMatch.team_a_score} – {inspectMatch.team_b_score}
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontWeight: 800, color: 'var(--team-b)' }}>{inspectMatch.team_b_name}</div>
                <div style={{ fontSize: '0.76rem', color: 'var(--ink-muted)' }}>Team B</div>
              </div>
            </div>

            <div>
              <div className="section-heading">Score Progression</div>
              <ScoreProgressionChart match={inspectMatch} />
            </div>

            {inspectMatch.rallies.length > 0 && (
              <div>
                <div className="section-heading">
                  Rally Log ({inspectMatch.rallies.length} rallies)
                </div>
                <div className="rally-timeline">
                  {inspectMatch.rallies.map((r) => (
                    <div key={r.id} className="rally-row">
                      <span style={{ color: 'var(--ink-muted)', fontWeight: 700, minWidth: 28 }}>
                        #{r.seq}
                      </span>
                      <span style={{ flex: 1, fontWeight: 600 }}>
                        {r.rally_winner === 'A' ? inspectMatch.team_a_name : inspectMatch.team_b_name}{' '}
                        <span style={{ color: 'var(--ink-muted)', fontWeight: 500 }}>
                          (
                          {r.event_type === 'point'
                            ? 'Point'
                            : r.event_type === 'server_change'
                              ? '2nd Server'
                              : 'Side Out'}
                          )
                        </span>
                      </span>
                      <span className="rally-callout-mono">{r.callout}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
              <button
                type="button"
                id="btn-delete-match"
                className="btn btn-danger btn-sm"
                onClick={() => {
                  setDeleteConfirmText('');
                  setDeleteTarget(inspectMatch);
                }}
              >
                <Trash2 size={14} /> {lang === 'ja' ? '試合を削除' : 'Delete Match'}
              </button>
              <div style={{ display: 'flex', gap: 8 }}>
                {inspectMatch.status !== 'completed' && (
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={() => {
                      const m = inspectMatch;
                      setInspectMatch(null);
                      onResumeMatch(m);
                    }}
                  >
                    <Play size={14} /> Resume Live
                  </button>
                )}
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => setInspectMatch(null)}
                >
                  Close
                </button>
              </div>
            </div>
            </div>
          </div>
        </div>
      )}
      {deleteTarget && (
        <div
          className="modal-backdrop"
          onClick={() => {
            if (!deleting) setDeleteTarget(null);
          }}
        >
          <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 440 }}>
            <div className="modal-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--danger)' }}>
                <Trash2 size={18} />
                <h2 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 800 }}>
                  {lang === 'ja' ? '試合削除の確認' : 'Confirm Match Deletion'}
                </h2>
              </div>
              <button
                type="button"
                className="btn btn-ghost btn-icon"
                onClick={() => setDeleteTarget(null)}
                disabled={deleting}
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>
            <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <p style={{ margin: 0, fontSize: '0.88rem', lineHeight: 1.5 }}>
                {lang === 'ja' ? (
                  <>
                    <strong>
                      {deleteTarget.team_a_name} vs {deleteTarget.team_b_name}
                    </strong>{' '}
                    ({deleteTarget.team_a_score} – {deleteTarget.team_b_score}) を削除します。この操作は取り消せません。
                  </>
                ) : (
                  <>
                    You are about to permanently delete{' '}
                    <strong>
                      {deleteTarget.team_a_name} vs {deleteTarget.team_b_name}
                    </strong>{' '}
                    ({deleteTarget.team_a_score} – {deleteTarget.team_b_score}). This cannot be
                    undone.
                  </>
                )}
              </p>
              {deleteTarget.status === 'completed' && (
                <div
                  style={{
                    padding: '10px 12px',
                    borderRadius: 'var(--radius-sm)',
                    background: 'var(--danger-soft)',
                    border: '1px solid rgba(225, 29, 72, 0.25)',
                    fontSize: '0.8rem',
                    color: 'var(--danger)',
                    fontWeight: 700,
                  }}
                >
                  {lang === 'ja'
                    ? '完了済みの試合を削除すると、プレイヤーのレーティングと順位が再計算されます。'
                    : 'Deleting a completed match will recalculate player ratings and standings.'}
                </div>
              )}
              <div className="field-group">
                <label className="field-label" htmlFor="delete-match-confirm">
                  {lang === 'ja'
                    ? '続行するには DELETE と入力してください'
                    : 'Type DELETE to confirm'}
                </label>
                <input
                  id="delete-match-confirm"
                  type="text"
                  className="input"
                  value={deleteConfirmText}
                  onChange={(e) => setDeleteConfirmText(e.target.value)}
                  placeholder="DELETE"
                  autoComplete="off"
                />
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setDeleteTarget(null)}
                  disabled={deleting}
                >
                  {lang === 'ja' ? 'キャンセル' : 'Cancel'}
                </button>
                <button
                  type="button"
                  id="btn-confirm-delete-match"
                  className="btn btn-danger"
                  onClick={() => void handleConfirmDelete()}
                  disabled={deleting || deleteConfirmText.trim().toUpperCase() !== 'DELETE'}
                >
                  <Trash2 size={15} />{' '}
                  {lang === 'ja' ? '完全に削除する' : 'Delete Match'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
