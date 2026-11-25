import {
  Check,
  CheckCircle2,
  Crown,
  MapPin,
  Play,
  Plus,
  Shuffle,
  Sparkles,
  Trophy,
  Users,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { computeStandings } from '../../shared/statsEngine';
import type {
  Match,
  Player,
  ScoringMode,
  Session,
  SessionFormat,
  TargetScore,
} from '../../shared/types';
import { api } from '../lib/api';
import { copy, type Lang } from '../lib/i18n';

interface SessionsViewProps {
  lang: Lang;
  sessions: Session[];
  players: Player[];
  selectedSessionId: string | null;
  onSelectSession: (id: string | null) => void;
  onOpenScorekeeper: (match: Match) => void;
  onRefreshAll: () => Promise<void>;
  onPlayerCreated: (player: Player) => void;
  onNotify: (msg: string) => void;
}

const FORMAT_META: Record<
  SessionFormat,
  { labelEn: string; labelJa: string; descEn: string; descJa: string }
> = {
  rotating_partners: {
    labelEn: 'Rotating Partners',
    labelJa: 'パートナー回転',
    descEn: 'New partner every round with balanced sit-outs & individual standings',
    descJa: '毎ラウンド新しいペアで対戦・休憩バランス自動調整',
  },
  king_of_court: {
    labelEn: 'King of the Court',
    labelJa: 'キング・オブ・コート',
    descEn: 'Winners move up a court and split partners; losers move down',
    descJa: '勝者が上位コートへ昇格＆ペア分割、敗者は下位コートへ移動',
  },
  set_partners: {
    labelEn: 'Set Partners',
    labelJa: '固定ペア総当り',
    descEn: 'Fixed pairs stay together and rotate opponents across rounds',
    descJa: '固定ペアのまま対戦相手をローテーション',
  },
  open_play: {
    labelEn: 'Open Play',
    labelJa: 'オープンプレイ',
    descEn: 'Flexible drop-in rotation balancing games played and wait queue',
    descJa: '試合数と待機時間を均等化するドロップイン形式',
  },
};

const AVATAR_COLORS = ['#1D4ED8', '#15803D', '#E25747', '#B45309', '#0E7490', '#BE185D', '#3F6212'];

export function SessionsView({
  lang,
  sessions,
  players,
  selectedSessionId,
  onSelectSession,
  onOpenScorekeeper,
  onRefreshAll,
  onPlayerCreated,
  onNotify,
}: SessionsViewProps) {
  const t = copy[lang].sessions;
  const playerMap = useMemo(() => new Map(players.map((p) => [p.id, p])), [players]);
  const [activeSession, setActiveSession] = useState<Session | null>(null);
  const [viewingRound, setViewingRound] = useState<number>(1);
  const [showCreateModal, setShowCreateModal] = useState(false);

  const [quickScoreMatch, setQuickScoreMatch] = useState<Match | null>(null);
  const [quickA, setQuickA] = useState('11');
  const [quickB, setQuickB] = useState('7');

  const [title, setTitle] = useState('');
  const [location, setLocation] = useState('');
  const [format, setFormat] = useState<SessionFormat>('rotating_partners');
  const [courtsCount, setCourtsCount] = useState(2);
  const [scoringMode, setScoringMode] = useState<ScoringMode>('side_out');
  const [targetScore, setTargetScore] = useState<TargetScore>(11);
  const [winByTwo, setWinByTwo] = useState(true);
  const [checkedInIds, setCheckedInIds] = useState<string[]>([]);
  const [quickPlayerName, setQuickPlayerName] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const targetId =
      selectedSessionId ?? sessions.find((s) => s.status === 'active')?.id ?? sessions[0]?.id ?? null;
    if (!targetId) {
      setActiveSession(null);
      return;
    }
    const found = sessions.find((s) => s.id === targetId) ?? null;
    setActiveSession(found);
    if (found) {
      setViewingRound(found.current_round);
    }
  }, [sessions, selectedSessionId]);

  const openCreateModal = () => {
    const today = new Date().toLocaleDateString(lang === 'ja' ? 'ja-JP' : 'en-US', {
      weekday: 'long',
    });
    setTitle(lang === 'ja' ? `桃dinks ${today}セッション` : `桃dinks ${today} Open Play`);
    setLocation(lang === 'ja' ? '真備総合公園 体育館' : 'Mabi General Park Gym');
    setFormat('rotating_partners');
    setCourtsCount(Math.max(1, Math.min(3, Math.floor(players.length / 4))));
    setCheckedInIds(players.slice(0, Math.min(8, players.length)).map((p) => p.id));
    setShowCreateModal(true);
  };

  const toggleCheckedIn = (id: string) => {
    setCheckedInIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const handleQuickAddPlayer = async () => {
    const trimmed = quickPlayerName.trim();
    if (!trimmed) return;
    try {
      const created = await api.createPlayer({
        name: trimmed,
        skill_rating: 3.5,
        avatar_color: AVATAR_COLORS[players.length % AVATAR_COLORS.length],
      });
      onPlayerCreated(created);
      setCheckedInIds((prev) => [...prev, created.id]);
      setQuickPlayerName('');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Failed to add player');
    }
  };

  const handleCreateSession = async () => {
    if (!title.trim() || checkedInIds.length < 4) {
      onNotify('Enter a session title and check in at least 4 players');
      return;
    }
    try {
      setBusy(true);
      const created = await api.createSession({
        title: title.trim(),
        location: location.trim() || undefined,
        format,
        courts_count: courtsCount,
        scoring_mode: scoringMode,
        target_score: targetScore,
        win_by_two: winByTwo,
        player_ids: checkedInIds,
      });
      await onRefreshAll();
      onSelectSession(created.id);
      setShowCreateModal(false);
      onNotify(`Session "${created.title}" created`);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Failed to create session');
    } finally {
      setBusy(false);
    }
  };

  const handleGenerateNextRound = async () => {
    if (!activeSession) return;
    try {
      setBusy(true);
      const res = await api.generateNextRound(activeSession.id);
      await onRefreshAll();
      setViewingRound(res.session.current_round);
      onNotify(`Round ${res.session.current_round} generated`);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Could not generate next round');
    } finally {
      setBusy(false);
    }
  };

  const handleEndSession = async () => {
    if (!activeSession) return;
    try {
      setBusy(true);
      await api.endSession(activeSession.id);
      await onRefreshAll();
      onNotify('Session marked complete');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Could not end session');
    } finally {
      setBusy(false);
    }
  };

  const handleSaveQuickScore = async () => {
    if (!quickScoreMatch) return;
    const a = Number(quickA);
    const b = Number(quickB);
    if (!Number.isFinite(a) || !Number.isFinite(b) || a === b || a < 0 || b < 0) {
      onNotify('Scores must be non-negative and not tied');
      return;
    }
    try {
      setBusy(true);
      await api.quickScoreMatch(quickScoreMatch.id, a, b);
      await onRefreshAll();
      setQuickScoreMatch(null);
      onNotify('Court score saved & standings updated');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Failed to save score');
    } finally {
      setBusy(false);
    }
  };

  const sessionMatches = activeSession?.matches ?? [];
  const roundNumbers = useMemo(() => {
    const set = new Set<number>();
    for (const m of sessionMatches) {
      if (m.round_number) set.add(m.round_number);
    }
    if (activeSession) set.add(activeSession.current_round);
    return Array.from(set).sort((a, b) => a - b);
  }, [sessionMatches, activeSession]);

  const currentRoundMatches = useMemo(
    () =>
      sessionMatches
        .filter((m) => m.round_number === viewingRound)
        .sort((a, b) => (a.court_number ?? 99) - (b.court_number ?? 99)),
    [sessionMatches, viewingRound]
  );

  const sittingOutIds = useMemo(() => {
    if (!activeSession) return [];
    const playingIds = new Set(
      currentRoundMatches.flatMap((m) => m.participants.map((p) => p.player_id))
    );
    return activeSession.players
      .filter((sp) => sp.active && !playingIds.has(sp.player_id))
      .map((sp) => sp.player_id);
  }, [activeSession, currentRoundMatches]);

  const sessionStandings = useMemo(() => {
    if (!activeSession) return [];
    const ids = new Set(activeSession.players.map((sp) => sp.player_id));
    const sessionPlayers = players.filter((p) => ids.has(p.id));
    return computeStandings(sessionPlayers, sessionMatches);
  }, [activeSession, players, sessionMatches]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Navy Banner */}
      <div className="navy-section-banner">
        <div>
          <h1>{t.title}</h1>
          <p className="banner-sub">{t.subtitle}</p>
        </div>
        <button
          type="button"
          id="btn-new-session"
          className="btn btn-lime"
          onClick={openCreateModal}
        >
          <Plus size={16} /> {t.newSession}
        </button>
      </div>

      {/* Session Pill Selector */}
      {sessions.length > 0 && (
        <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 2 }}>
          {sessions.map((s) => (
            <button
              key={s.id}
              type="button"
              className={`nav-pill-btn ${activeSession?.id === s.id ? 'active' : ''}`}
              onClick={() => onSelectSession(s.id)}
            >
              {s.status === 'active' && (
                <span
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: '50%',
                    background:
                      activeSession?.id === s.id ? 'var(--optic-lime)' : 'var(--brand-emerald)',
                  }}
                />
              )}
              {s.title}
            </button>
          ))}
        </div>
      )}

      {!activeSession ? (
        <div className="card empty-state">
          <Users size={36} strokeWidth={1.6} />
          <div style={{ fontWeight: 800, fontSize: '1.05rem', color: 'var(--ink-primary)' }}>
            No sessions yet
          </div>
          <button type="button" className="btn btn-primary" onClick={openCreateModal}>
            <Plus size={16} /> {t.newSession}
          </button>
        </div>
      ) : (
        <>
          {/* Active Session Confirmed Card (Matches Screenshot's Emerald-Bordered Session Card!) */}
          <div
            className={`card ${activeSession.status === 'active' ? 'card-confirmed' : ''}`}
            style={{ display: 'flex', flexDirection: 'column', gap: 14 }}
          >
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'flex-start',
                justifyContent: 'space-between',
                gap: 12,
              }}
            >
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <h2 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 800 }}>
                    {activeSession.title}
                  </h2>
                  <span className={`tag ${activeSession.status === 'active' ? 'tag-live' : ''}`}>
                    {activeSession.status === 'active' ? t.activeBadge : t.completedBadge}
                  </span>
                  <span className="tag">
                    {activeSession.format === 'king_of_court' ? (
                      <Crown size={12} />
                    ) : (
                      <Shuffle size={12} />
                    )}
                    {lang === 'ja'
                      ? FORMAT_META[activeSession.format].labelJa
                      : FORMAT_META[activeSession.format].labelEn}
                  </span>
                </div>
                <div
                  style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: 14,
                    marginTop: 6,
                    fontSize: '0.83rem',
                    color: 'var(--ink-secondary)',
                  }}
                >
                  {activeSession.location && (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      <MapPin size={14} /> {activeSession.location}
                    </span>
                  )}
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    <Users size={14} /> {activeSession.players.length}{' '}
                    {lang === 'ja' ? '名' : 'players'} · {activeSession.courts_count}{' '}
                    {lang === 'ja' ? 'コート' : activeSession.courts_count === 1 ? 'court' : 'courts'}
                  </span>
                  <span>
                    {activeSession.scoring_mode === 'side_out' ? 'Side-Out' : 'Rally'} ·{' '}
                    {activeSession.target_score}pt
                  </span>
                </div>
              </div>

              {activeSession.status === 'active' && (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    id="btn-next-round"
                    className="btn btn-lime btn-sm"
                    onClick={handleGenerateNextRound}
                    disabled={busy}
                  >
                    <Sparkles size={14} /> {t.nextRound} {activeSession.current_round + 1}
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={handleEndSession}
                    disabled={busy}
                  >
                    <CheckCircle2 size={14} /> {t.endSession}
                  </button>
                </div>
              )}
            </div>

            {/* Round Switcher Pills */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
              <div className="segmented">
                {roundNumbers.map((r) => (
                  <button
                    key={r}
                    type="button"
                    className={`segmented-btn ${viewingRound === r ? 'active' : ''}`}
                    onClick={() => setViewingRound(r)}
                  >
                    {lang === 'ja' ? `第${r}ラウンド` : `Round ${r}`}
                  </button>
                ))}
              </div>
              {sittingOutIds.length > 0 && (
                <div style={{ fontSize: '0.82rem', color: 'var(--ink-secondary)' }}>
                  <strong>{t.sittingOut} (R{viewingRound}):</strong>{' '}
                  {sittingOutIds
                    .map((id) => playerMap.get(id)?.name.split(' ')[0] ?? 'Player')
                    .join(', ')}
                </div>
              )}
            </div>
          </div>

          {/* Courts Grid */}
          <div className="grid-2">
            {currentRoundMatches.map((m) => (
              <div
                key={m.id}
                className={`card court-card ${m.status === 'in_progress' ? 'card-confirmed' : ''}`}
              >
                <div className="court-card-header">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontWeight: 800, fontSize: '0.92rem' }}>
                      Court {m.court_number ?? 1}
                    </span>
                    {activeSession.format === 'king_of_court' && m.court_number === 1 && (
                      <span className="tag tag-lime">
                        <Crown size={11} /> King Court
                      </span>
                    )}
                  </div>
                  <span className={`tag ${m.status === 'in_progress' ? 'tag-live' : ''}`}>
                    {m.status === 'completed'
                      ? lang === 'ja'
                        ? '試合終了'
                        : 'Final'
                      : m.status === 'in_progress'
                        ? lang === 'ja'
                          ? '進行中'
                          : 'In Progress'
                        : lang === 'ja'
                          ? '待機中'
                          : 'Ready'}
                  </span>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div className={`court-matchup-row ${m.winner_team === 'A' ? 'winner' : ''}`}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                      <span
                        style={{
                          width: 4,
                          height: 24,
                          borderRadius: 2,
                          background: 'var(--team-a)',
                          flexShrink: 0,
                        }}
                      />
                      <span style={{ fontWeight: 700, fontSize: '0.92rem' }}>{m.team_a_name}</span>
                    </div>
                    <span className="court-matchup-score">{m.team_a_score}</span>
                  </div>

                  <div className={`court-matchup-row ${m.winner_team === 'B' ? 'winner' : ''}`}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                      <span
                        style={{
                          width: 4,
                          height: 24,
                          borderRadius: 2,
                          background: 'var(--team-b)',
                          flexShrink: 0,
                        }}
                      />
                      <span style={{ fontWeight: 700, fontSize: '0.92rem' }}>{m.team_b_name}</span>
                    </div>
                    <span className="court-matchup-score">{m.team_b_score}</span>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 8, marginTop: 2 }}>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    style={{ flex: 1 }}
                    onClick={() => onOpenScorekeeper(m)}
                  >
                    <Play size={14} />{' '}
                    {m.status === 'completed'
                      ? t.reviewCourt
                      : m.status === 'in_progress'
                        ? t.resumeLive
                        : t.scoreLive}
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => {
                      setQuickScoreMatch(m);
                      setQuickA(String(m.team_a_score || activeSession.target_score));
                      setQuickB(String(m.team_b_score || Math.max(0, activeSession.target_score - 4)));
                    }}
                  >
                    {t.quickScore}
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* Live Session Standings */}
          <div className="card">
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: 10,
              }}
            >
              <span
                className="section-heading"
                style={{ margin: 0, display: 'inline-flex', alignItems: 'center', gap: 6 }}
              >
                <Trophy size={14} /> {t.standings}
              </span>
              <span style={{ fontSize: '0.78rem', color: 'var(--ink-muted)' }}>{t.rankNote}</span>
            </div>

            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Player</th>
                    <th className="num">W-L</th>
                    <th className="num">Win %</th>
                    <th className="num">PF</th>
                    <th className="num">PA</th>
                    <th className="num">+/-</th>
                  </tr>
                </thead>
                <tbody>
                  {sessionStandings.map((row, idx) => (
                    <tr key={row.player_id}>
                      <td
                        style={{
                          fontWeight: 800,
                          color: idx === 0 ? 'var(--brand-emerald)' : 'var(--ink-muted)',
                        }}
                      >
                        {idx + 1}
                      </td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                          <span className="avatar avatar-sm" style={{ background: row.avatar_color }}>
                            {row.name
                              .split(' ')
                              .map((n) => n[0])
                              .join('')
                              .slice(0, 2)
                              .toUpperCase()}
                          </span>
                          <span style={{ fontWeight: 700 }}>{row.name}</span>
                        </div>
                      </td>
                      <td className="num">
                        {row.wins}-{row.losses}
                      </td>
                      <td className="num">{row.games_played > 0 ? `${row.win_pct}%` : '—'}</td>
                      <td className="num">{row.points_for}</td>
                      <td className="num">{row.points_against}</td>
                      <td
                        className={`num ${
                          row.point_diff > 0 ? 'diff-pos' : row.point_diff < 0 ? 'diff-neg' : ''
                        }`}
                      >
                        {row.point_diff > 0 ? `+${row.point_diff}` : row.point_diff}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* Quick Score Modal */}
      {quickScoreMatch && (
        <div className="modal-backdrop" onClick={() => setQuickScoreMatch(null)}>
          <div className="modal-card" style={{ maxWidth: 400 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{t.quickScore}</h2>
              <button
                type="button"
                className="btn btn-ghost btn-icon"
                onClick={() => setQuickScoreMatch(null)}
              >
                <X size={18} />
              </button>
            </div>
            <div className="grid-2">
              <div className="field-group">
                <label className="field-label" htmlFor="qs-a">
                  {quickScoreMatch.team_a_name}
                </label>
                <input
                  id="qs-a"
                  type="number"
                  min={0}
                  max={50}
                  className="input"
                  value={quickA}
                  onChange={(e) => setQuickA(e.target.value)}
                />
              </div>
              <div className="field-group">
                <label className="field-label" htmlFor="qs-b">
                  {quickScoreMatch.team_b_name}
                </label>
                <input
                  id="qs-b"
                  type="number"
                  min={0}
                  max={50}
                  className="input"
                  value={quickB}
                  onChange={(e) => setQuickB(e.target.value)}
                />
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setQuickScoreMatch(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleSaveQuickScore}
                disabled={busy}
              >
                <Check size={15} /> Save Score
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create Session Modal */}
      {showCreateModal && (
        <div className="modal-backdrop" onClick={() => setShowCreateModal(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{t.newSession}</h2>
              <button
                type="button"
                className="btn btn-ghost btn-icon"
                onClick={() => setShowCreateModal(false)}
              >
                <X size={18} />
              </button>
            </div>

            <div className="grid-2">
              <div className="field-group">
                <label className="field-label" htmlFor="sess-title">
                  {lang === 'ja' ? 'セッション名' : 'Session Name'}
                </label>
                <input
                  id="sess-title"
                  className="input"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </div>
              <div className="field-group">
                <label className="field-label" htmlFor="sess-loc">
                  {lang === 'ja' ? '会場 / 体育館' : 'Courts / Venue'}
                </label>
                <input
                  id="sess-loc"
                  className="input"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                />
              </div>
            </div>

            <div className="field-group">
              <span className="field-label">{lang === 'ja' ? '形式' : 'Format'}</span>
              <div className="grid-2">
                {(Object.keys(FORMAT_META) as SessionFormat[]).map((key) => (
                  <button
                    key={key}
                    type="button"
                    className={`player-select-chip ${format === key ? 'selected' : ''}`}
                    style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 3, padding: 11 }}
                    onClick={() => setFormat(key)}
                  >
                    <span style={{ fontWeight: 800, fontSize: '0.86rem' }}>
                      {lang === 'ja' ? FORMAT_META[key].labelJa : FORMAT_META[key].labelEn}
                    </span>
                    <span
                      style={{
                        fontSize: '0.73rem',
                        fontWeight: 500,
                        color: 'var(--ink-secondary)',
                      }}
                    >
                      {lang === 'ja' ? FORMAT_META[key].descJa : FORMAT_META[key].descEn}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            <div className="grid-3">
              <div className="field-group">
                <label className="field-label" htmlFor="sess-courts">
                  Courts
                </label>
                <select
                  id="sess-courts"
                  className="select"
                  value={courtsCount}
                  onChange={(e) => setCourtsCount(Number(e.target.value))}
                >
                  {[1, 2, 3, 4, 5, 6].map((n) => (
                    <option key={n} value={n}>
                      {n} {n === 1 ? 'Court' : 'Courts'}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field-group">
                <label className="field-label" htmlFor="sess-scoring">
                  Scoring
                </label>
                <select
                  id="sess-scoring"
                  className="select"
                  value={scoringMode}
                  onChange={(e) => setScoringMode(e.target.value as ScoringMode)}
                >
                  <option value="side_out">Side-Out (0-0-2)</option>
                  <option value="rally">Rally Scoring</option>
                </select>
              </div>
              <div className="field-group">
                <label className="field-label" htmlFor="sess-target">
                  Play To
                </label>
                <select
                  id="sess-target"
                  className="select"
                  value={targetScore}
                  onChange={(e) => setTargetScore(Number(e.target.value) as TargetScore)}
                >
                  <option value={11}>11 pts</option>
                  <option value={15}>15 pts</option>
                  <option value={21}>21 pts</option>
                </select>
              </div>
            </div>

            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: '0.84rem', fontWeight: 700 }}>
              <input
                type="checkbox"
                checked={winByTwo}
                onChange={(e) => setWinByTwo(e.target.checked)}
              />
              {lang === 'ja' ? '2点差勝利ルール' : 'Require Win by 2'}
            </label>

            <div className="field-group">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span className="field-label">
                  {lang === 'ja' ? '参加チェックイン' : 'Check-In Players'} ({checkedInIds.length} / min 4)
                </span>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() =>
                    setCheckedInIds(
                      checkedInIds.length === players.length ? [] : players.map((p) => p.id)
                    )
                  }
                >
                  {checkedInIds.length === players.length ? 'Clear All' : 'Select All'}
                </button>
              </div>
              <div className="player-chip-grid">
                {players.map((p) => {
                  const selected = checkedInIds.includes(p.id);
                  return (
                    <button
                      key={p.id}
                      type="button"
                      className={`player-select-chip ${selected ? 'selected' : ''}`}
                      onClick={() => toggleCheckedIn(p.id)}
                    >
                      <span className="avatar avatar-sm" style={{ background: p.avatar_color }}>
                        {p.name
                          .split(' ')
                          .map((n) => n[0])
                          .join('')
                          .slice(0, 2)
                          .toUpperCase()}
                      </span>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {p.name}
                      </span>
                    </button>
                  );
                })}
              </div>

              <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                <input
                  className="input"
                  placeholder={lang === 'ja' ? 'ゲスト名を追加...' : 'Quick add guest player...'}
                  value={quickPlayerName}
                  onChange={(e) => setQuickPlayerName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      void handleQuickAddPlayer();
                    }
                  }}
                />
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={handleQuickAddPlayer}
                >
                  <Plus size={14} /> Add
                </button>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setShowCreateModal(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                id="btn-confirm-create-session"
                className="btn btn-primary"
                onClick={handleCreateSession}
                disabled={busy || checkedInIds.length < 4}
              >
                {lang === 'ja' ? '作成＆第1ラウンド生成' : 'Create & Generate Round 1'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
