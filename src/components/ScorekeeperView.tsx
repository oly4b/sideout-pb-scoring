import {
  ArrowLeftRight,
  Award,
  CheckCircle2,
  Eye,
  LayoutGrid,
  Monitor,
  Play,
  Redo2,
  RefreshCw,
  RotateCcw,
  Undo2,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  computeMomentum,
  createInitialLiveState,
  formatScoreCallout,
  getActiveServerPlayerId,
  getActiveServerSide,
  isGamePoint,
  RALLY_OUTCOME_TAGS,
  recordRally,
  redoLastRally,
  swapServerManually,
  swapTeamBoxesManually,
  tagRallyOutcome,
  undoLastRally,
} from '../../shared/pickleballEngine';
import { computeDuprRatings, formatRating } from '../../shared/ratingEngine';
import type {
  GameType,
  LiveGameState,
  Match,
  Player,
  RallyOutcomeTag,
  ScoringMode,
  TargetScore,
  TeamId,
} from '../../shared/types';
import { api, ConflictError } from '../lib/api';
import { copy, type Lang } from '../lib/i18n';
import { supabaseClient } from '../lib/supabase';
import { MatchAnalyticsPanel } from './MatchAnalyticsPanel';
import { playRallySound, playUndoSound } from '../lib/soundEffects';
import { SideoutMatchStage } from './match/SideoutMatchStage';

interface ScorekeeperViewProps {
  lang: Lang;
  players: Player[];
  matches: Match[];
  activeMatch: Match | null;
  inProgressMatches: Match[];
  defaultAutoSwitchEnds?: boolean;
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

const SCOREKEEPER_MATCHES_KEY = 'momodinks_scorekeeper_matches';

function readScorekeeperMatches(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = window.localStorage.getItem(SCOREKEEPER_MATCHES_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? new Set(parsed.filter((id) => typeof id === 'string')) : new Set();
  } catch {
    return new Set();
  }
}

function isScorekeeperForMatch(matchId: string): boolean {
  return readScorekeeperMatches().has(matchId);
}

function markScorekeeperForMatch(matchId: string, isScorekeeper: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    const set = readScorekeeperMatches();
    if (isScorekeeper) {
      set.add(matchId);
    } else {
      set.delete(matchId);
    }
    // Keep only the most recent 50 match IDs
    const trimmed = Array.from(set).slice(-50);
    window.localStorage.setItem(SCOREKEEPER_MATCHES_KEY, JSON.stringify(trimmed));
  } catch {
    // ignore storage errors
  }
}

/** Live court/scoreboard scoring interface with quick-match setup, serialized persistence, and rally tagging. */
export function ScorekeeperView({
  lang,
  players,
  matches,
  activeMatch,
  inProgressMatches,
  defaultAutoSwitchEnds = false,
  onSelectMatch,
  onMatchUpdated,
  onBackToSession,
  onNotify,
}: ScorekeeperViewProps) {
  const t = copy[lang].scorekeeper;
  const playerMap = useMemo(() => new Map(players.map((p) => [p.id, p])), [players]);
  const liveRatings = useMemo(
    () => computeDuprRatings(players, matches).ratings,
    [players, matches]
  );
  const displayPlayerRating = (p: Player) =>
    formatRating(liveRatings.get(p.id)?.rating ?? p.skill_rating);

  const [gameType, setGameType] = useState<GameType>('doubles');
  const [scoringMode, setScoringMode] = useState<ScoringMode>('side_out');
  const [targetScore, setTargetScore] = useState<TargetScore>(11);
  const [winByTwo, setWinByTwo] = useState(true);
  const [autoSwitchEnds, setAutoSwitchEnds] = useState(false);
  const [teamA1, setTeamA1] = useState<string>(players[0]?.id ?? '');
  const [teamA2, setTeamA2] = useState<string>(players[1]?.id ?? '');
  const [teamB1, setTeamB1] = useState<string>(players[2]?.id ?? '');
  const [teamB2, setTeamB2] = useState<string>(players[3]?.id ?? '');
  const [creating, setCreating] = useState(false);

  const [viewMode, setViewMode] = useState<'court' | 'scoreboard'>('court');
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [detailedStats, setDetailedStats] = useState(true);
  const [spectatorMode, setSpectatorMode] = useState(false);
  const [pendingTagSeq, setPendingTagSeq] = useState<number | null>(null);
  const [liveState, setLiveState] = useState<LiveGameState | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [saving, setSaving] = useState(false);
  const saveTimerRef = useRef<number | null>(null);
  const baseVersionRef = useRef<number>(0);
  const inFlightSaveRef = useRef<Promise<void> | null>(null);
  const pendingSaveRef = useRef<{
    match: Match;
    next: LiveGameState;
    durationSeconds: number;
  } | null>(null);
  const setupShellRef = useRef<HTMLDivElement | null>(null);
  const scoringSurfaceRef = useRef<HTMLDivElement | null>(null);

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
    baseVersionRef.current = hydrated.version ?? hydrated.rallies.length;
    const joinAsSpectator =
      !isScorekeeperForMatch(activeMatch.id) &&
      activeMatch.status === 'in_progress' &&
      hydrated.rallies.length > 0;
    setSpectatorMode(joinAsSpectator);
    if (activeMatch.session_id) {
      setAutoSwitchEnds(defaultAutoSwitchEnds);
    }

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

  const isLiveReady = Boolean(activeMatch && liveState);
  const isMatchEnded = Boolean(liveState?.winnerTeam);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const courtAnchor = scoringSurfaceRef.current?.querySelector('[data-court-center-anchor="true"]');
      const target = isLiveReady ? (courtAnchor ?? scoringSurfaceRef.current) : setupShellRef.current;
      target?.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
        inline: 'nearest',
      });
    }, isMatchEnded ? 100 : 60);
    return () => window.clearTimeout(timer);
  }, [activeMatch?.id, isLiveReady, isMatchEnded, viewMode]);

  useEffect(() => {
    if (!activeMatch || activeMatch.status === 'completed') return;
    let cancelled = false;

    const syncFromRemote = async () => {
      if (cancelled || inFlightSaveRef.current || pendingSaveRef.current) return;
      try {
        const fresh = await api.getMatch(activeMatch.id);
        if (cancelled || inFlightSaveRef.current || pendingSaveRef.current) return;
        const remoteVersion = fresh.live_state?.version ?? fresh.rallies.length;
        if (
          remoteVersion > baseVersionRef.current ||
          (fresh.status === 'completed' && activeMatch.status !== 'completed')
        ) {
          baseVersionRef.current = remoteVersion;
          if (fresh.live_state) {
            setLiveState(fresh.live_state);
          }
          onMatchUpdated(fresh);
        }
      } catch {
        // ignore transient polling errors
      }
    };

    const channel = supabaseClient
      ? supabaseClient
          .channel(`match-live-${activeMatch.id}`)
          .on(
            'postgres_changes',
            {
              event: 'UPDATE',
              schema: 'public',
              table: 'matches',
              filter: `id=eq.${activeMatch.id}`,
            },
            (payload) => {
              if (cancelled || inFlightSaveRef.current || pendingSaveRef.current) return;
              const row = payload.new as Partial<Match> | undefined;
              const remoteLive = row?.live_state as LiveGameState | null | undefined;
              if (remoteLive) {
                const remoteVersion = remoteLive.version ?? remoteLive.rallies?.length ?? 0;
                if (
                  remoteVersion > baseVersionRef.current ||
                  (row?.status === 'completed' && activeMatch.status !== 'completed')
                ) {
                  baseVersionRef.current = remoteVersion;
                  setLiveState(remoteLive);
                  onMatchUpdated({
                    ...activeMatch,
                    status: row?.status ?? activeMatch.status,
                    team_a_score: row?.team_a_score ?? remoteLive.teamAScore,
                    team_b_score: row?.team_b_score ?? remoteLive.teamBScore,
                    winner_team:
                      row?.winner_team !== undefined ? row.winner_team : remoteLive.winnerTeam,
                    completed_at:
                      row?.completed_at !== undefined ? row.completed_at : activeMatch.completed_at,
                    duration_seconds: row?.duration_seconds ?? activeMatch.duration_seconds,
                    live_state: remoteLive,
                    rallies: remoteLive.rallies ?? activeMatch.rallies,
                  });
                }
                return;
              }
              void syncFromRemote();
            }
          )
          .subscribe()
      : null;

    const pollMs = supabaseClient ? 8000 : 3500;
    const pollId = window.setInterval(() => {
      void syncFromRemote();
    }, pollMs);

    return () => {
      cancelled = true;
      window.clearInterval(pollId);
      if (channel && supabaseClient) {
        void supabaseClient.removeChannel(channel);
      }
    };
  }, [activeMatch?.id, activeMatch?.status, onMatchUpdated]);

  const flushPendingSave = () => {
    if (inFlightSaveRef.current || !pendingSaveRef.current) {
      return inFlightSaveRef.current ?? Promise.resolve();
    }

    const run = async () => {
      try {
        setSaving(true);
        while (pendingSaveRef.current) {
          const payload = pendingSaveRef.current;
          pendingSaveRef.current = null;
          const isDone = payload.next.winnerTeam !== null;
          const updated = await api.updateMatch(payload.match.id, {
            status: isDone ? 'completed' : 'in_progress',
            team_a_score: payload.next.teamAScore,
            team_b_score: payload.next.teamBScore,
            winner_team: payload.next.winnerTeam,
            completed_at: isDone ? new Date().toISOString() : null,
            duration_seconds: payload.durationSeconds,
            live_state: payload.next,
            rallies: payload.next.rallies,
            expected_version: baseVersionRef.current,
          });
          baseVersionRef.current = updated.live_state?.version ?? updated.rallies.length;
          onMatchUpdated(updated);
        }
      } catch (err) {
        if (err instanceof ConflictError && err.latestMatch) {
          const latest = err.latestMatch;
          pendingSaveRef.current = null;
          baseVersionRef.current = latest.live_state?.version ?? latest.rallies.length;
          if (latest.live_state) {
            setLiveState(latest.live_state);
          }
          onMatchUpdated(latest);
          onNotify(
            lang === 'ja'
              ? '他の端末の最新スコアと同期しました'
              : 'Synced latest score from another device'
          );
        } else {
          onNotify(err instanceof Error ? err.message : 'Failed to save rally');
        }
      } finally {
        inFlightSaveRef.current = null;
        setSaving(false);
        if (pendingSaveRef.current) {
          void flushPendingSave();
        }
      }
    };

    const promise = run();
    inFlightSaveRef.current = promise;
    return promise;
  };

  const persistMatchState = (match: Match, next: LiveGameState, immediate = false) => {
    pendingSaveRef.current = { match, next, durationSeconds: elapsedSeconds };
    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    if (immediate) {
      void flushPendingSave();
    } else {
      saveTimerRef.current = window.setTimeout(() => {
        saveTimerRef.current = null;
        void flushPendingSave();
      }, 80);
    }
  };

  const handleRally = (winner: TeamId) => {
    if (!activeMatch || !liveState || liveState.winnerTeam || spectatorMode) return;
    markScorekeeperForMatch(activeMatch.id, true);
    const next = recordRally(liveState, winner, activeMatch.id);
    setLiveState(next);
    if (soundEnabled) {
      void playRallySound(next);
    }
    if (detailedStats) {
      const lastSeq = next.rallies[next.rallies.length - 1]?.seq ?? null;
      setPendingTagSeq(lastSeq);
    } else if (pendingTagSeq !== null) {
      setPendingTagSeq(null);
    }
    persistMatchState(activeMatch, next, next.winnerTeam !== null);
  };

  const handleTagRally = (tag: RallyOutcomeTag) => {
    if (!activeMatch || !liveState || pendingTagSeq === null) return;
    const next = tagRallyOutcome(liveState, pendingTagSeq, tag);
    setLiveState(next);
    setPendingTagSeq(null);
    persistMatchState(activeMatch, next, next.winnerTeam !== null);
  };

  const handleUndo = () => {
    if (!activeMatch || !liveState || liveState.rallies.length === 0 || spectatorMode) return;
    setPendingTagSeq(null);
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
    if (!activeMatch || !liveState || liveState.redoStack.length === 0 || spectatorMode) return;
    const next = redoLastRally(liveState);
    setLiveState(next);
    persistMatchState(activeMatch, next);
  };

  const handleSwapServer = () => {
    if (!activeMatch || !liveState || liveState.winnerTeam || spectatorMode) return;
    const next = swapServerManually(liveState);
    setLiveState(next);
    persistMatchState(activeMatch, next);
  };

  const handleSwapBoxes = (team: TeamId) => {
    if (!activeMatch || !liveState || liveState.gameType !== 'doubles' || spectatorMode) return;
    const next = swapTeamBoxesManually(liveState, team);
    setLiveState(next);
    persistMatchState(activeMatch, next);
  };

  const handleFinishEarly = async () => {
    if (!activeMatch || !liveState || spectatorMode) return;
    const winner: TeamId | null =
      liveState.teamAScore > liveState.teamBScore
        ? 'A'
        : liveState.teamBScore > liveState.teamAScore
          ? 'B'
          : null;
    try {
      if (saveTimerRef.current) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      pendingSaveRef.current = null;
      if (inFlightSaveRef.current) {
        await inFlightSaveRef.current.catch(() => undefined);
      }
      setSaving(true);
      const finishedState: LiveGameState = {
        ...liveState,
        winnerTeam: winner,
        version: (liveState.version ?? liveState.rallies.length) + 1,
      };
      const updated = await api.updateMatch(activeMatch.id, {
        status: 'completed',
        team_a_score: liveState.teamAScore,
        team_b_score: liveState.teamBScore,
        winner_team: winner,
        completed_at: new Date().toISOString(),
        duration_seconds: elapsedSeconds,
        live_state: finishedState,
        rallies: liveState.rallies,
        expected_version: baseVersionRef.current,
      });
      baseVersionRef.current = updated.live_state?.version ?? updated.rallies.length;
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
      markScorekeeperForMatch(created.id, true);
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

  const activeSlotIds =
    gameType === 'doubles' ? [teamA1, teamA2, teamB1, teamB2] : [teamA1, teamB1];
  const hasDuplicatePlayers =
    activeSlotIds.some((id) => Boolean(id)) &&
    new Set(activeSlotIds.filter(Boolean)).size !== activeSlotIds.filter(Boolean).length;

  const isTakenInOtherSlot = (slot: 'A1' | 'A2' | 'B1' | 'B2', playerId: string) => {
    if (slot !== 'A1' && teamA1 === playerId) return true;
    if (gameType === 'doubles' && slot !== 'A2' && teamA2 === playerId) return true;
    if (slot !== 'B1' && teamB1 === playerId) return true;
    if (gameType === 'doubles' && slot !== 'B2' && teamB2 === playerId) return true;
    return false;
  };

  const handleSelectSlot = (slot: 'A1' | 'A2' | 'B1' | 'B2', nextId: string) => {
    const currentVal =
      slot === 'A1' ? teamA1 : slot === 'A2' ? teamA2 : slot === 'B1' ? teamB1 : teamB2;

    if (slot !== 'A1' && teamA1 === nextId) setTeamA1(currentVal);
    else if (gameType === 'doubles' && slot !== 'A2' && teamA2 === nextId) setTeamA2(currentVal);
    else if (slot !== 'B1' && teamB1 === nextId) setTeamB1(currentVal);
    else if (gameType === 'doubles' && slot !== 'B2' && teamB2 === nextId) setTeamB2(currentVal);

    if (slot === 'A1') setTeamA1(nextId);
    else if (slot === 'A2') setTeamA2(nextId);
    else if (slot === 'B1') setTeamB1(nextId);
    else setTeamB2(nextId);
  };

  // Match Setup View (compact session-scheduler aligned layout)
  if (!activeMatch || !liveState) {
    return (
      <div ref={setupShellRef} className="scorekeeper-shell">

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
                  onChange={(e) => handleSelectSlot('A1', e.target.value)}
                >
                  {players.map((p) => {
                    const taken = isTakenInOtherSlot('A1', p.id);
                    return (
                      <option key={p.id} value={p.id} disabled={taken}>
                        {p.name} ({displayPlayerRating(p)})
                        {taken ? (lang === 'ja' ? ' · 選択済み' : ' · Selected') : ''}
                      </option>
                    );
                  })}
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
                    onChange={(e) => handleSelectSlot('A2', e.target.value)}
                  >
                    {players.map((p) => {
                      const taken = isTakenInOtherSlot('A2', p.id);
                      return (
                        <option key={p.id} value={p.id} disabled={taken}>
                          {p.name} ({displayPlayerRating(p)})
                          {taken ? (lang === 'ja' ? ' · 選択済み' : ' · Selected') : ''}
                        </option>
                      );
                    })}
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
                  onChange={(e) => handleSelectSlot('B1', e.target.value)}
                >
                  {players.map((p) => {
                    const taken = isTakenInOtherSlot('B1', p.id);
                    return (
                      <option key={p.id} value={p.id} disabled={taken}>
                        {p.name} ({displayPlayerRating(p)})
                        {taken ? (lang === 'ja' ? ' · 選択済み' : ' · Selected') : ''}
                      </option>
                    );
                  })}
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
                    onChange={(e) => handleSelectSlot('B2', e.target.value)}
                  >
                    {players.map((p) => {
                      const taken = isTakenInOtherSlot('B2', p.id);
                      return (
                        <option key={p.id} value={p.id} disabled={taken}>
                          {p.name} ({displayPlayerRating(p)})
                          {taken ? (lang === 'ja' ? ' · 選択済み' : ' · Selected') : ''}
                        </option>
                      );
                    })}
                  </select>
                </div>
              )}
            </div>
          </div>

          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 14,
              alignItems: 'flex-end',
              justifyContent: 'space-between',
              paddingTop: 12,
              borderTop: '1px solid var(--border-subtle)',
            }}
          >
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'flex-end' }}>
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

              <div className="field-group">
                <span className="field-label">{lang === 'ja' ? 'オプション' : 'Options'}</span>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={winByTwo}
                    className={`btn btn-sm ${winByTwo ? 'btn-lime' : 'btn-secondary'}`}
                    style={{ borderRadius: 999, minHeight: 36 }}
                    onClick={() => setWinByTwo((v) => !v)}
                  >
                    <span
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: '999px',
                        background: winByTwo ? '#0f172a' : 'var(--ink-muted)',
                        opacity: winByTwo ? 0.85 : 0.45,
                      }}
                    />
                    {t.winByTwo}
                  </button>

                  <button
                    type="button"
                    role="switch"
                    aria-checked={autoSwitchEnds}
                    className={`btn btn-sm ${autoSwitchEnds ? 'btn-lime' : 'btn-secondary'}`}
                    style={{ borderRadius: 999, minHeight: 36 }}
                    onClick={() => setAutoSwitchEnds((v) => !v)}
                  >
                    <span
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: '999px',
                        background: autoSwitchEnds ? '#0f172a' : 'var(--ink-muted)',
                        opacity: autoSwitchEnds ? 0.85 : 0.45,
                      }}
                    />
                    {t.autoSwitchEnds} ({Math.ceil(targetScore / 2)})
                  </button>

                  <button
                    type="button"
                    role="switch"
                    aria-checked={detailedStats}
                    className={`btn btn-sm ${detailedStats ? 'btn-lime' : 'btn-secondary'}`}
                    style={{ borderRadius: 999, minHeight: 36 }}
                    onClick={() => setDetailedStats((v) => !v)}
                  >
                    <span
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: '999px',
                        background: detailedStats ? '#0f172a' : 'var(--ink-muted)',
                        opacity: detailedStats ? 0.85 : 0.45,
                      }}
                    />
                    {lang === 'ja' ? '詳細統計' : 'Detailed Stats'}
                  </button>
                </div>
              </div>
            </div>

            <button
              type="button"
              id="btn-start-quick-match"
              className="btn btn-lime"
              style={{ minHeight: 38 }}
              onClick={handleStartQuickMatch}
              disabled={
                creating ||
                hasDuplicatePlayers ||
                players.length < (gameType === 'doubles' ? 4 : 2)
              }
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
          <button
            type="button"
            className={`btn btn-sm ${detailedStats ? 'btn-lime' : 'btn-secondary'}`}
            aria-pressed={detailedStats}
            onClick={() => {
              const nextVal = !detailedStats;
              setDetailedStats(nextVal);
              if (!nextVal) {
                setPendingTagSeq(null);
              }
              onNotify(
                lang === 'ja'
                  ? nextVal
                    ? '詳細統計タグをオンにしました'
                    : '詳細統計タグをオフにしました'
                  : nextVal
                    ? 'Detailed rally tagging enabled'
                    : 'Detailed rally tagging disabled'
              );
            }}
          >
            {lang === 'ja' ? '詳細統計' : 'Stats'}: {detailedStats ? 'ON' : 'OFF'}
          </button>
          <button
            type="button"
            className={`btn btn-sm ${spectatorMode ? 'btn-lime' : 'btn-secondary'}`}
            aria-pressed={spectatorMode}
            onClick={() => {
              const nextSpec = !spectatorMode;
              setSpectatorMode(nextSpec);
              markScorekeeperForMatch(activeMatch.id, !nextSpec);
              if (nextSpec) setPendingTagSeq(null);
              onNotify(
                lang === 'ja'
                  ? nextSpec
                    ? '観戦モード（読み取り専用・自動同期）'
                    : 'スコア入力モードに戻りました'
                  : nextSpec
                    ? 'Spectator mode (read-only live sync)'
                    : 'Scorekeeper input enabled'
              );
            }}
          >
            <Eye size={13} />
            {lang === 'ja' ? '観戦' : 'Spectator'}
          </button>
        </div>
      </div>

      {liveState.winnerTeam && viewMode === 'scoreboard' && (
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
      <div ref={scoringSurfaceRef} style={{ width: '100%' }}>
      {viewMode === 'court' ? (
        <SideoutMatchStage
          lang={lang}
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
              ) : liveState.winnerTeam ? (
                <span className={`tag ${liveState.winnerTeam === 'A' ? 'tag-lime' : ''}`}>
                  {liveState.winnerTeam === 'A'
                    ? lang === 'ja'
                      ? '勝利'
                      : 'WINNER'
                    : lang === 'ja'
                      ? '試合終了'
                      : 'FINAL'}
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
              ) : liveState.winnerTeam ? (
                <span className={`tag ${liveState.winnerTeam === 'B' ? 'tag-lime' : ''}`}>
                  {liveState.winnerTeam === 'B'
                    ? lang === 'ja'
                      ? '勝利'
                      : 'WINNER'
                    : lang === 'ja'
                      ? '試合終了'
                      : 'FINAL'}
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
      </div>

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
          <span
            style={{
              color: 'var(--team-a)',
              opacity: momentum.teamAPercent < momentum.teamBPercent ? 0.5 : 1,
            }}
          >
            {activeMatch.team_a_name} ({momentum.teamAPercent}%)
          </span>
          <span
            style={{
              color: 'var(--team-b)',
              opacity: momentum.teamBPercent < momentum.teamAPercent ? 0.5 : 1,
            }}
          >
            {activeMatch.team_b_name} ({momentum.teamBPercent}%)
          </span>
        </div>
      </div>

      {pendingTagSeq !== null && (() => {
        const taggedRally = liveState.rallies.find((r) => r.seq === pendingTagSeq);
        const rallyWinnerName = taggedRally
          ? taggedRally.rally_winner === 'A'
            ? activeMatch.team_a_name
            : activeMatch.team_b_name
          : '';
        const servingTeamWon = taggedRally ? taggedRally.event_type === 'point' : true;
        const visibleTags = RALLY_OUTCOME_TAGS.filter((tag) => {
          if (servingTeamWon && tag.id === 'service_fault') return false;
          if (!servingTeamWon && tag.id === 'ace') return false;
          return true;
        });

        return (
          <div className="modal-backdrop" onClick={() => setPendingTagSeq(null)}>
            <div
              className="modal-card"
              style={{ maxWidth: 440 }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="modal-header">
                <h2>
                  {lang === 'ja' ? `ラリー #${pendingTagSeq}` : `Rally #${pendingTagSeq}`}
                  {taggedRally ? ` · ${taggedRally.callout}` : ''}
                </h2>
                <button
                  type="button"
                  className="btn btn-ghost btn-icon"
                  aria-label={lang === 'ja' ? 'スキップ' : 'Skip'}
                  onClick={() => setPendingTagSeq(null)}
                >
                  <X size={18} />
                </button>
              </div>

              <div className="modal-body">
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span className="tag" style={{ alignSelf: 'flex-start' }}>
                    {servingTeamWon
                      ? lang === 'ja'
                        ? 'サーブ側得点'
                        : 'Serving team scored'
                      : lang === 'ja'
                        ? 'レシーブ側ブレイク'
                        : 'Receiving team won rally'}
                  </span>
                  <div style={{ fontSize: '1.02rem', fontWeight: 800, color: 'var(--ink-primary)' }}>
                    {lang === 'ja'
                      ? `${rallyWinnerName} の決着方法は？`
                      : `How did ${rallyWinnerName} win this rally?`}
                  </div>
                </div>

                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                    gap: 8,
                  }}
                >
                  {visibleTags.map((tag, idx) => {
                    const isOddLast = visibleTags.length % 2 === 1 && idx === visibleTags.length - 1;
                    return (
                      <button
                        key={tag.id}
                        type="button"
                        className="btn btn-secondary"
                        style={{
                          minHeight: 48,
                          fontWeight: 700,
                          justifyContent: 'center',
                          fontSize: '0.88rem',
                          gridColumn: isOddLast ? '1 / -1' : undefined,
                        }}
                        onClick={() => handleTagRally(tag.id)}
                      >
                        {lang === 'ja' ? tag.ja : tag.en}
                      </button>
                    );
                  })}
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => setPendingTagSeq(null)}
                  >
                    {lang === 'ja' ? 'スキップ' : 'Skip'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {liveState.rallies.length > 0 && (
        <div className="card">
          <MatchAnalyticsPanel
            match={{
              ...activeMatch,
              team_a_score: liveState.teamAScore,
              team_b_score: liveState.teamBScore,
              winner_team: liveState.winnerTeam,
              duration_seconds: elapsedSeconds,
              rallies: liveState.rallies,
            }}
            lang={lang}
            compact
          />
        </div>
      )}
    </div>
  );
}
