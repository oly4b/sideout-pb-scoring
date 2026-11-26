import {
  ArrowLeftRight,
  Award,
  CheckCircle2,
  LayoutGrid,
  Monitor,
  Play,
  Redo2,
  RefreshCw,
  RotateCcw,
  Undo2,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  computeMomentum,
  createInitialLiveState,
  formatScoreCallout,
  getActiveServerPlayerId,
  getActiveServerSide,
  isGamePoint,
  recordRally,
  redoLastRally,
  swapServerManually,
  swapTeamBoxesManually,
  undoLastRally,
} from '../../shared/pickleballEngine';
import type {
  GameType,
  LiveGameState,
  Match,
  Player,
  ScoringMode,
  TargetScore,
  TeamId,
} from '../../shared/types';
import { api } from '../lib/api';
import { copy, type Lang } from '../lib/i18n';
import { playRallySound, playUndoSound } from '../lib/soundEffects';
import { SideoutMatchStage } from './match/SideoutMatchStage';

interface ScorekeeperViewProps {
  lang: Lang;
  players: Player[];
  activeMatch: Match | null;
  inProgressMatches: Match[];
  onSelectMatch: (match: Match | null) => void;
  onMatchUpdated: (match: Match) => void;
  onBackToSession?: (sessionId: string) => void;
  onNotify: (msg: string) => void;
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function ScorekeeperView({
  lang,
  players,
  activeMatch,
  inProgressMatches,
  onSelectMatch,
  onMatchUpdated,
  onBackToSession,
  onNotify,
}: ScorekeeperViewProps) {
  const t = copy[lang].scorekeeper;
  const playerMap = useMemo(() => new Map(players.map((p) => [p.id, p])), [players]);

  const [gameType, setGameType] = useState<GameType>('doubles');
  const [scoringMode, setScoringMode] = useState<ScoringMode>('side_out');
  const [targetScore, setTargetScore] = useState<TargetScore>(11);
  const [winByTwo, setWinByTwo] = useState(true);
  const [autoSwitchEnds, setAutoSwitchEnds] = useState(true);
  const [teamA1, setTeamA1] = useState<string>(players[0]?.id ?? '');
  const [teamA2, setTeamA2] = useState<string>(players[1]?.id ?? '');
  const [teamB1, setTeamB1] = useState<string>(players[2]?.id ?? '');
  const [teamB2, setTeamB2] = useState<string>(players[3]?.id ?? '');
  const [creating, setCreating] = useState(false);

  const [viewMode, setViewMode] = useState<'court' | 'scoreboard'>('court');
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [liveState, setLiveState] = useState<LiveGameState | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [saving, setSaving] = useState(false);
  const saveTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (players.length >= 4 && !teamA1 && !teamB1) {
      setTeamA1(players[0].id);
      setTeamA2(players[1].id);
      setTeamB1(players[2].id);
      setTeamB2(players[3].id);
    }
  }, [players, teamA1, teamB1]);

  useEffect(() => {
    if (!activeMatch) {
      setLiveState(null);
      setElapsedSeconds(0);
      return;
    }

    const teamAParts = activeMatch.participants.filter((p) => p.team === 'A');
    const teamBParts = activeMatch.participants.filter((p) => p.team === 'B');

    const hydrated: LiveGameState =
      activeMatch.live_state ??
      createInitialLiveState({
        gameType: activeMatch.game_type,
        scoringMode: activeMatch.scoring_mode,
        targetScore: activeMatch.target_score,
        winByTwo: activeMatch.win_by_two,
        initialServingTeam: 'A',
        teamAPlayers: [teamAParts[0]?.player_id ?? null, teamAParts[1]?.player_id ?? null],
        teamBPlayers: [teamBParts[0]?.player_id ?? null, teamBParts[1]?.player_id ?? null],
      });

    setLiveState(hydrated);

    if (activeMatch.status === 'completed') {
      setElapsedSeconds(activeMatch.duration_seconds || 0);
    } else {
      const startedMs = new Date(activeMatch.started_at).getTime();
      setElapsedSeconds(
        Math.max(activeMatch.duration_seconds || 0, Math.floor((Date.now() - startedMs) / 1000))
      );
    }
  }, [activeMatch?.id]);

  useEffect(() => {
    if (!activeMatch || !liveState || liveState.winnerTeam || activeMatch.status === 'completed') {
      return;
    }
    const id = window.setInterval(() => {
      setElapsedSeconds((prev) => prev + 1);
    }, 1000);
    return () => window.clearInterval(id);
  }, [activeMatch?.id, activeMatch?.status, liveState?.winnerTeam]);

  const persistMatchState = (match: Match, next: LiveGameState, immediate = false) => {
    const doSave = async () => {
      try {
        setSaving(true);
        const isDone = next.winnerTeam !== null;
        const updated = await api.updateMatch(match.id, {
          status: isDone ? 'completed' : 'in_progress',
          team_a_score: next.teamAScore,
          team_b_score: next.teamBScore,
          winner_team: next.winnerTeam,
          completed_at: isDone ? new Date().toISOString() : null,
          duration_seconds: elapsedSeconds,
          live_state: next,
          rallies: next.rallies,
        });
        onMatchUpdated(updated);
      } catch (err) {
        onNotify(err instanceof Error ? err.message : 'Failed to save rally');
      } finally {
        setSaving(false);
      }
    };

    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current);
    }
    if (immediate) {
      void doSave();
    } else {
      saveTimerRef.current = window.setTimeout(() => {
        void doSave();
      }, 220);
    }
  };

  const handleRally = (winner: TeamId) => {
    if (!activeMatch || !liveState || liveState.winnerTeam) return;
    const next = recordRally(liveState, winner, activeMatch.id);
    setLiveState(next);
    if (soundEnabled) {
      void playRallySound(next);
    }
    persistMatchState(activeMatch, next, next.winnerTeam !== null);
  };

  const handleUndo = () => {
    if (!activeMatch || !liveState || liveState.rallies.length === 0) return;
    const teamAParts = activeMatch.participants.filter((p) => p.team === 'A');
    const teamBParts = activeMatch.participants.filter((p) => p.team === 'B');
    const next = undoLastRally(
      liveState,
      'A',
      [teamAParts[0]?.player_id ?? null, teamAParts[1]?.player_id ?? null],
      [teamBParts[0]?.player_id ?? null, teamBParts[1]?.player_id ?? null]
    );
    setLiveState(next);
    if (soundEnabled) {
      void playUndoSound();
    }
    persistMatchState(activeMatch, next);
  };

  const handleRedo = () => {
    if (!activeMatch || !liveState || liveState.redoStack.length === 0) return;
    const next = redoLastRally(liveState);
    setLiveState(next);
    persistMatchState(activeMatch, next);
  };

  const handleSwapServer = () => {
    if (!activeMatch || !liveState || liveState.winnerTeam) return;
    const next = swapServerManually(liveState);
    setLiveState(next);
    persistMatchState(activeMatch, next);
  };

  const handleSwapBoxes = (team: TeamId) => {
    if (!activeMatch || !liveState || liveState.gameType !== 'doubles') return;
    const next = swapTeamBoxesManually(liveState, team);
    setLiveState(next);
    persistMatchState(activeMatch, next);
  };

  const handleFinishEarly = async () => {
    if (!activeMatch || !liveState) return;
    const winner: TeamId | null =
      liveState.teamAScore > liveState.teamBScore
        ? 'A'
        : liveState.teamBScore > liveState.teamAScore
          ? 'B'
          : null;
    try {
      setSaving(true);
      const finishedState: LiveGameState = { ...liveState, winnerTeam: winner };
      const updated = await api.updateMatch(activeMatch.id, {
        status: 'completed',
        team_a_score: liveState.teamAScore,
        team_b_score: liveState.teamBScore,
        winner_team: winner,
        completed_at: new Date().toISOString(),
        duration_seconds: elapsedSeconds,
        live_state: finishedState,
        rallies: liveState.rallies,
      });
      setLiveState(finishedState);
      onMatchUpdated(updated);
      onNotify(lang === 'ja' ? '試合履歴を保存しました' : 'Match saved to game history');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to finish match');
    } finally {
      setSaving(false);
    }
  };

  const handleRematch = async () => {
    if (!activeMatch) return;
    try {
      const created = await api.createMatch({
        session_id: activeMatch.session_id,
        round_number: activeMatch.round_number,
        court_number: activeMatch.court_number,
        game_type: activeMatch.game_type,
        scoring_mode: activeMatch.scoring_mode,
        target_score: activeMatch.target_score,
        win_by_two: activeMatch.win_by_two,
        team_a_name: activeMatch.team_a_name,
        team_b_name: activeMatch.team_b_name,
        participants: activeMatch.participants.map((p) => ({
          player_id: p.player_id,
          team: p.team,
          starting_side: p.starting_side,
        })),
      });
      onMatchUpdated(created);
      onSelectMatch(created);
      onNotify(lang === 'ja' ? '再戦を開始しました' : 'Rematch started');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Failed to start rematch');
    }
  };

  const handleStartQuickMatch = async () => {
    const selectedIds =
      gameType === 'doubles' ? [teamA1, teamA2, teamB1, teamB2] : [teamA1, teamB1];
    if (selectedIds.some((id) => !id)) {
      onNotify('Select players for each slot to start');
      return;
    }
    if (new Set(selectedIds).size !== selectedIds.length) {
      onNotify('Each player can only occupy one slot');
      return;
    }

    const label = (id: string) => {
      const p = playerMap.get(id);
      return p?.nickname?.trim() || p?.name.split(' ')[0] || 'Player';
    };

    const teamAName = gameType === 'doubles' ? `${label(teamA1)} & ${label(teamA2)}` : label(teamA1);
    const teamBName = gameType === 'doubles' ? `${label(teamB1)} & ${label(teamB2)}` : label(teamB1);

    try {
      setCreating(true);
      const participants =
        gameType === 'doubles'
          ? [
              { player_id: teamA1, team: 'A' as const, starting_side: 'right' as const },
              { player_id: teamA2, team: 'A' as const, starting_side: 'left' as const },
              { player_id: teamB1, team: 'B' as const, starting_side: 'right' as const },
              { player_id: teamB2, team: 'B' as const, starting_side: 'left' as const },
            ]
          : [
              { player_id: teamA1, team: 'A' as const, starting_side: 'right' as const },
              { player_id: teamB1, team: 'B' as const, starting_side: 'right' as const },
            ];

      const created = await api.createMatch({
        game_type: gameType,
        scoring_mode: scoringMode,
        target_score: targetScore,
        win_by_two: winByTwo,
        team_a_name: teamAName,
        team_b_name: teamBName,
        participants,
      });
      onMatchUpdated(created);
      onSelectMatch(created);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Failed to start match');
    } finally {
      setCreating(false);
    }
  };

  const playerDisplay = (id: string | null, fallback: string) => {
    if (!id) return fallback;
    const p = playerMap.get(id);
    return p?.nickname?.trim() || p?.name.split(' ')[0] || fallback;
  };

  // Match Setup View (compact session-scheduler aligned layout)
  if (!activeMatch || !liveState) {
    return (
      <div className="scorekeeper-shell">

        {inProgressMatches.length > 0 && (
          <section className="section-card is-confirmed">
            <div className="section-card-header">
              <div className="section-card-title">
                <Play size={16} />
                <h2>
                  {t.resumeTitle} ({inProgressMatches.length})
                </h2>
              </div>
              <span className="momo-lime-pill">{t.autoSaved}</span>
            </div>
            <div className="section-card-body">
              <div className="grid-2">
                {inProgressMatches.map((m) => (
                  <div key={m.id} className="court-matchup-row">
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 800, fontSize: '0.9rem' }}>
                        {m.team_a_name} vs {m.team_b_name}
                      </div>
                      <div
                        className="tabular-nums"
                        style={{ fontSize: '0.78rem', color: 'var(--ink-secondary)', marginTop: 2 }}
                      >
                        {m.court_number ? `Court ${m.court_number} · ` : ''}
                        {m.team_a_score} – {m.team_b_score} ·{' '}
                        {m.scoring_mode === 'side_out' ? 'Side-Out' : 'Rally'} ({m.target_score})
                      </div>
                    </div>
                    <button
                      type="button"
                      className="btn btn-lime btn-sm"
                      onClick={() => onSelectMatch(m)}
                    >
                      <Play size={14} /> {t.resume}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}

        <section className="section-card is-strong-border">
          <div className="section-card-header">
            <div className="section-card-title">
              <LayoutGrid size={16} />
              <h2>{t.quickMatchTitle}</h2>
            </div>
            <div className="segmented" style={{ background: 'rgba(15, 23, 42, 0.45)', borderColor: 'rgba(255,255,255,0.15)' }}>
              <button
                type="button"
                className={`segmented-btn ${gameType === 'doubles' ? 'active' : ''}`}
                style={gameType === 'doubles' ? { background: 'var(--optic-lime)', color: 'var(--optic-lime-ink)' } : { color: 'rgba(255,255,255,0.78)' }}
                onClick={() => setGameType('doubles')}
              >
                {t.doubles}
              </button>
              <button
                type="button"
                className={`segmented-btn ${gameType === 'singles' ? 'active' : ''}`}
                style={gameType === 'singles' ? { background: 'var(--optic-lime)', color: 'var(--optic-lime-ink)' } : { color: 'rgba(255,255,255,0.78)' }}
                onClick={() => setGameType('singles')}
              >
                {t.singles}
              </button>
            </div>
          </div>
          <div className="section-card-body" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

          <div className="grid-2">
            <div
              style={{
                padding: 14,
                borderRadius: 'var(--radius-sm)',
                background: 'var(--team-a-soft)',
                border: '1px solid rgba(29, 78, 216, 0.16)',
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
              }}
            >
              <div style={{ fontWeight: 800, fontSize: '0.8rem', color: 'var(--team-a)' }}>
                {t.teamALabel}
              </div>
              <div className="field-group">
                <label className="field-label" htmlFor="quick-a1">
                  {gameType === 'doubles' ? t.rightServer : t.playerA}
                </label>
                <select
                  id="quick-a1"
                  className="select"
                  value={teamA1}
                  onChange={(e) => setTeamA1(e.target.value)}
                >
                  {players.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.skill_rating.toFixed(2)})
                    </option>
                  ))}
                </select>
              </div>
              {gameType === 'doubles' && (
                <div className="field-group">
                  <label className="field-label" htmlFor="quick-a2">
                    {t.leftPartner}
                  </label>
                  <select
                    id="quick-a2"
                    className="select"
                    value={teamA2}
                    onChange={(e) => setTeamA2(e.target.value)}
                  >
                    {players.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({p.skill_rating.toFixed(2)})
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            <div
              style={{
                padding: 14,
                borderRadius: 'var(--radius-sm)',
                background: 'var(--team-b-soft)',
                border: '1px solid rgba(226, 87, 71, 0.2)',
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
              }}
            >
              <div style={{ fontWeight: 800, fontSize: '0.8rem', color: 'var(--team-b)' }}>
                {t.teamBLabel}
              </div>
              <div className="field-group">
                <label className="field-label" htmlFor="quick-b1">
                  {gameType === 'doubles' ? t.rightBox : t.playerB}
                </label>
                <select
                  id="quick-b1"
                  className="select"
                  value={teamB1}
                  onChange={(e) => setTeamB1(e.target.value)}
                >
                  {players.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.skill_rating.toFixed(2)})
                    </option>
                  ))}
                </select>
              </div>
              {gameType === 'doubles' && (
                <div className="field-group">
                  <label className="field-label" htmlFor="quick-b2">
                    {t.leftBox}
                  </label>
                  <select
                    id="quick-b2"
                    className="select"
                    value={teamB2}
                    onChange={(e) => setTeamB2(e.target.value)}
                  >
                    {players.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({p.skill_rating.toFixed(2)})
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          </div>

          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 16,
              alignItems: 'center',
              justifyContent: 'space-between',
              paddingTop: 10,
              borderTop: '1px solid var(--border-subtle)',
            }}
          >
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'center' }}>
              <div className="field-group">
                <span className="field-label">{t.scoringFormat}</span>
                <div className="segmented">
                  <button
                    type="button"
                    className={`segmented-btn ${scoringMode === 'side_out' ? 'active' : ''}`}
                    onClick={() => setScoringMode('side_out')}
                  >
                    {t.sideOut}
                  </button>
                  <button
                    type="button"
                    className={`segmented-btn ${scoringMode === 'rally' ? 'active' : ''}`}
                    onClick={() => setScoringMode('rally')}
                  >
                    {t.rally}
                  </button>
                </div>
              </div>

              <div className="field-group">
                <span className="field-label">{t.playTo}</span>
                <div className="segmented">
                  {([11, 15, 21] as TargetScore[]).map((pts) => (
                    <button
                      key={pts}
                      type="button"
                      className={`segmented-btn ${targetScore === pts ? 'active' : ''}`}
                      onClick={() => setTargetScore(pts)}
                    >
                      {pts}
                    </button>
                  ))}
                </div>
              </div>

              <label
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 7,
                  fontSize: '0.84rem',
                  fontWeight: 700,
                  marginTop: 16,
                  cursor: 'pointer',
                }}
              >
                <input
                  type="checkbox"
                  checked={winByTwo}
                  onChange={(e) => setWinByTwo(e.target.checked)}
                />
                {t.winByTwo}
              </label>

              <label
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 7,
                  fontSize: '0.84rem',
                  fontWeight: 700,
                  marginTop: 16,
                  cursor: 'pointer',
                }}
              >
                <input
                  type="checkbox"
                  checked={autoSwitchEnds}
                  onChange={(e) => setAutoSwitchEnds(e.target.checked)}
                />
                {t.autoSwitchEnds} ({Math.ceil(targetScore / 2)})
              </label>
            </div>

            <button
              type="button"
              id="btn-start-quick-match"
              className="btn btn-lime"
              onClick={handleStartQuickMatch}
              disabled={creating || players.length < (gameType === 'doubles' ? 4 : 2)}
            >
              <Play size={16} /> {t.startMatch}
            </button>
          </div>
          </div>
        </section>
      </div>
    );
  }

  // Live Scorekeeper Surface
  const callout = formatScoreCallout(liveState);
  const serverSide = getActiveServerSide(liveState);
  const serverPlayerId = getActiveServerPlayerId(liveState);
  const gamePointTeam = isGamePoint(liveState);
  const momentum = computeMomentum(liveState.rallies);

  return (
    <div className="scorekeeper-shell">
      <div className="scorekeeper-header-bar">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => {
              if (activeMatch.session_id && onBackToSession) {
                onBackToSession(activeMatch.session_id);
              } else {
                onSelectMatch(null);
              }
            }}
          >
            {activeMatch.session_id ? t.backSession : t.backSetup}
          </button>
          {activeMatch.court_number && (
            <span className="tag tag-live">
              R{activeMatch.round_number} · Court {activeMatch.court_number}
            </span>
          )}
          <span className="tag">
            {liveState.scoringMode === 'side_out' ? 'Side-Out' : 'Rally'} · {liveState.targetScore}
            {liveState.winByTwo ? ' (Win by 2)' : ''}
          </span>
          <span className="tag" style={{ fontFamily: 'var(--font-mono)' }}>
            {formatDuration(elapsedSeconds)}
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div className="segmented">
            <button
              type="button"
              className={`segmented-btn ${viewMode === 'court' ? 'active' : ''}`}
              onClick={() => setViewMode('court')}
            >
              <LayoutGrid size={13} style={{ verticalAlign: '-2px', marginRight: 4 }} />
              {t.court}
            </button>
            <button
              type="button"
              className={`segmented-btn ${viewMode === 'scoreboard' ? 'active' : ''}`}
              onClick={() => setViewMode('scoreboard')}
            >
              <Monitor size={13} style={{ verticalAlign: '-2px', marginRight: 4 }} />
              {t.board}
            </button>
          </div>
          <button
            type="button"
            className={`btn btn-icon ${soundEnabled ? 'btn-lime' : 'btn-secondary'}`}
            onClick={() => {
              const nextSound = !soundEnabled;
              setSoundEnabled(nextSound);
              onNotify(
                lang === 'ja'
                  ? nextSound
                    ? '効果音をオンにしました'
                    : '効果音をミュートしました'
                  : nextSound
                    ? 'Sound effects enabled'
                    : 'Sound effects muted'
              );
            }}
            aria-label="Toggle sound effects"
            title={soundEnabled ? 'Mute sound effects' : 'Enable sound effects'}
          >
            {soundEnabled ? <Volume2 size={16} /> : <VolumeX size={16} />}
          </button>
        </div>
      </div>

      {liveState.winnerTeam && (
        <div className="winner-banner">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Award size={26} />
            <div>
              <div style={{ fontWeight: 800, fontSize: '1.08rem' }}>
                {liveState.winnerTeam === 'A' ? activeMatch.team_a_name : activeMatch.team_b_name}{' '}
                {lang === 'ja' ? '勝利' : 'Wins'} {Math.max(liveState.teamAScore, liveState.teamBScore)} –{' '}
                {Math.min(liveState.teamAScore, liveState.teamBScore)}
              </div>
              <div style={{ fontSize: '0.82rem', opacity: 0.9 }}>
                {liveState.rallies.length} {t.ralliesLogged} · {formatDuration(elapsedSeconds)}
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-lime btn-sm" onClick={handleRematch}>
              <RefreshCw size={14} /> {t.rematch}
            </button>
            {activeMatch.session_id && onBackToSession && (
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => onBackToSession(activeMatch.session_id!)}
              >
                {t.sessionHub}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Main Scoring Surface */}
      {viewMode === 'court' ? (
        <SideoutMatchStage
          activeMatch={activeMatch}
          liveState={liveState}
          callout={callout}
          serverSide={serverSide}
          serverDisplayName={playerDisplay(
            serverPlayerId,
            liveState.servingTeam === 'A' ? activeMatch.team_a_name : activeMatch.team_b_name
          )}
          gamePointTeam={gamePointTeam}
          teamALabels={{
            right: playerDisplay(
              liveState.positions.teamA.right,
              liveState.gameType === 'singles' ? activeMatch.team_a_name || 'Player 1' : 'A1'
            ),
            left: playerDisplay(liveState.positions.teamA.left, 'A2'),
          }}
          teamBLabels={{
            right: playerDisplay(
              liveState.positions.teamB.right,
              liveState.gameType === 'singles' ? activeMatch.team_b_name || 'Player 2' : 'B1'
            ),
            left: playerDisplay(liveState.positions.teamB.left, 'B2'),
          }}
          autoSwitchEnds={autoSwitchEnds}
          onToggleAutoSwitchEnds={() => setAutoSwitchEnds((v) => !v)}
          saving={saving}
          onRally={handleRally}
          onUndo={handleUndo}
          onRedo={handleRedo}
          onSwapServer={handleSwapServer}
          onSwapBoxes={handleSwapBoxes}
          onFinishEarly={handleFinishEarly}
          onRematch={handleRematch}
          onBack={() => {
            if (activeMatch.session_id && onBackToSession) {
              onBackToSession(activeMatch.session_id);
            } else {
              onSelectMatch(null);
            }
          }}
        />
      ) : (
        <>
          <div className="callout-banner">
            <div className="callout-meta">
              <span className="callout-label">
                {liveState.winnerTeam ? t.finalScore : t.officialCallout}
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <span className="callout-digits" id="live-callout-display">
                  {callout}
                </span>
                {gamePointTeam && (
                  <span className="tag tag-lime">
                    GAME POINT · {gamePointTeam === 'A' ? activeMatch.team_a_name : activeMatch.team_b_name}
                  </span>
                )}
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div className="callout-server-note">
                {t.serving}:{' '}
                <strong>
                  {playerDisplay(
                    serverPlayerId,
                    liveState.servingTeam === 'A' ? activeMatch.team_a_name : activeMatch.team_b_name
                  )}
                </strong>{' '}
                ({serverSide === 'right' ? t.rightEven : t.leftOdd})
              </div>
            </div>
          </div>

          <div className="scoreboard-grid">
            <button
              type="button"
              id="btn-rally-team-a"
              className={`scoreboard-tile ${liveState.servingTeam === 'A' ? 'serving-a' : ''}`}
              onClick={() => handleRally('A')}
              disabled={Boolean(liveState.winnerTeam)}
            >
              <span className="tag tag-team-a">TEAM A</span>
              <div style={{ fontWeight: 800, fontSize: '1.15rem' }}>{activeMatch.team_a_name}</div>
              <div className="scoreboard-big-num" style={{ color: 'var(--team-a)' }}>
                {liveState.teamAScore}
              </div>
              {liveState.servingTeam === 'A' && !liveState.winnerTeam ? (
                <span className="tag tag-lime">
                  {t.serving} · {playerDisplay(serverPlayerId, 'Server')}
                  {liveState.gameType === 'doubles' && liveState.scoringMode === 'side_out'
                    ? ` (#${liveState.serverNumber})`
                    : ''}
                </span>
              ) : (
                <span style={{ fontSize: '0.8rem', color: 'var(--ink-muted)' }}>{t.tapHere}</span>
              )}
            </button>

            <button
              type="button"
              id="btn-rally-team-b"
              className={`scoreboard-tile ${liveState.servingTeam === 'B' ? 'serving-b' : ''}`}
              onClick={() => handleRally('B')}
              disabled={Boolean(liveState.winnerTeam)}
            >
              <span className="tag tag-team-b">TEAM B</span>
              <div style={{ fontWeight: 800, fontSize: '1.15rem' }}>{activeMatch.team_b_name}</div>
              <div className="scoreboard-big-num" style={{ color: 'var(--team-b)' }}>
                {liveState.teamBScore}
              </div>
              {liveState.servingTeam === 'B' && !liveState.winnerTeam ? (
                <span className="tag tag-lime">
                  {t.serving} · {playerDisplay(serverPlayerId, 'Server')}
                  {liveState.gameType === 'doubles' && liveState.scoringMode === 'side_out'
                    ? ` (#${liveState.serverNumber})`
                    : ''}
                </span>
              ) : (
                <span style={{ fontSize: '0.8rem', color: 'var(--ink-muted)' }}>{t.tapHere}</span>
              )}
            </button>
          </div>

          <div className="card controls-strip">
            <div className="controls-group">
              <button
                type="button"
                id="btn-undo-rally"
                className="btn btn-secondary btn-sm"
                onClick={handleUndo}
                disabled={liveState.rallies.length === 0}
              >
                <Undo2 size={15} /> {t.undo}
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={handleRedo}
                disabled={liveState.redoStack.length === 0}
              >
                <Redo2 size={15} /> {t.redo}
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={handleSwapServer}
                disabled={Boolean(liveState.winnerTeam)}
              >
                <RotateCcw size={15} /> {t.fixServer}
              </button>
              {liveState.gameType === 'doubles' && (
                <>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => handleSwapBoxes('A')}
                    disabled={Boolean(liveState.winnerTeam)}
                  >
                    <ArrowLeftRight size={14} /> {t.swapA}
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => handleSwapBoxes('B')}
                    disabled={Boolean(liveState.winnerTeam)}
                  >
                    <ArrowLeftRight size={14} /> {t.swapB}
                  </button>
                </>
              )}
            </div>

            {!liveState.winnerTeam && (
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={handleFinishEarly}
                disabled={saving}
              >
                <CheckCircle2 size={15} /> {t.endSave}
              </button>
            )}
          </div>
        </>
      )}

      {/* Momentum Gauge */}
      <div className="card momentum-card">
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 8,
          }}
        >
          <span className="section-heading" style={{ margin: 0 }}>
            {t.momentum}
          </span>
          <div className="rally-dots">
            {momentum.lastFive.length === 0 ? (
              <span style={{ fontSize: '0.8rem', color: 'var(--ink-muted)' }}>
                {t.waitingRally}
              </span>
            ) : (
              momentum.lastFive.map((team, i) => (
                <span key={i} className={`rally-dot ${team === 'A' ? 'a' : 'b'}`}>
                  {team}
                </span>
              ))
            )}
            {momentum.streakTeam && momentum.streakCount >= 2 && (
              <span className="tag" style={{ marginLeft: 4 }}>
                {momentum.streakTeam === 'A' ? activeMatch.team_a_name : activeMatch.team_b_name}{' '}
                +{momentum.streakCount}
              </span>
            )}
          </div>
        </div>
        <div className="momentum-track">
          <div className="momentum-fill-a" style={{ width: `${momentum.teamAPercent}%` }} />
        </div>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            fontSize: '0.78rem',
            fontWeight: 700,
            color: 'var(--ink-secondary)',
          }}
        >
          <span>
            {activeMatch.team_a_name} ({momentum.teamAPercent}%)
          </span>
          <span>
            {activeMatch.team_b_name} ({momentum.teamBPercent}%)
          </span>
        </div>
      </div>
    </div>
  );
}
