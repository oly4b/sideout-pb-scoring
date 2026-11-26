import {
  ArrowLeftRight,
  CheckCircle2,
  Home,
  Redo2,
  RotateCcw,
  Users,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import type { CourtSide, LiveGameState, Match, TeamId } from '../../../shared/types';
import type { Lang } from '../../lib/i18n';
import { GoodGameOverlay } from './GoodGameOverlay';
import type { MascotMood } from './PickleballMascot';
import { RollingNumber } from './RollingDigit';
import { SideoutCourtCanvas, type CourtTransitionCue } from './SideoutCourtCanvas';

interface SideoutMatchStageProps {
  lang: Lang;
  activeMatch: Match;
  liveState: LiveGameState;
  callout: string;
  serverSide: CourtSide;
  serverDisplayName: string;
  gamePointTeam: TeamId | null;
  teamALabels: { right: string; left: string };
  teamBLabels: { right: string; left: string };
  autoSwitchEnds: boolean;
  onToggleAutoSwitchEnds: () => void;
  saving: boolean;
  onRally: (winner: TeamId) => void;
  onUndo: () => void;
  onRedo: () => void;
  onSwapServer: () => void;
  onSwapBoxes: (team: TeamId) => void;
  onFinishEarly: () => void;
  onRematch: () => void;
  onBack: () => void;
}

function getCardBadge(
  team: TeamId,
  score: number,
  otherScore: number,
  liveState: LiveGameState,
  gamePointTeam: TeamId | null,
  lang: Lang
): { text: string; tone: 'win' | 'close' } | null {
  if (liveState.winnerTeam) return null;
  const isJa = lang === 'ja';
  if (gamePointTeam === team) {
    return { text: isJa ? 'ゲームポイント' : 'Game point', tone: 'win' };
  }
  const minMargin = liveState.winByTwo ? 2 : 1;
  const needed = Math.max(liveState.targetScore - score, otherScore + minMargin - score);
  if (needed === 1) {
    return { text: isJa ? 'あと1点' : '1 to win', tone: 'close' };
  }
  if (needed === 2 && score >= liveState.targetScore - 2) {
    return { text: isJa ? 'あと2点' : '2 to win', tone: 'close' };
  }
  return null;
}

export function SideoutMatchStage({
  lang,
  activeMatch,
  liveState,
  callout,
  serverSide,
  serverDisplayName,
  gamePointTeam,
  teamALabels,
  teamBLabels,
  autoSwitchEnds,
  onToggleAutoSwitchEnds,
  saving,
  onRally,
  onUndo,
  onRedo,
  onSwapServer,
  onSwapBoxes,
  onFinishEarly,
  onRematch,
  onBack,
}: SideoutMatchStageProps) {
  const [mascotMood, setMascotMood] = useState<MascotMood>('serving');
  const [manualFlip, setManualFlip] = useState(false);
  const [transitionCue, setTransitionCue] = useState<CourtTransitionCue>(null);

  const switchThreshold = Math.ceil(liveState.targetScore / 2);
  const autoSwitched =
    autoSwitchEnds &&
    Math.max(liveState.teamAScore, liveState.teamBScore) >= switchThreshold;
  const endsSwitched = manualFlip ? !autoSwitched : autoSwitched;

  const prevEndsRef = useRef(endsSwitched);
  const prevServingRef = useRef(`${liveState.servingTeam}-${liveState.serverNumber}`);
  const prevServerSideRef = useRef(serverSide);

  const lastRally = liveState.rallies[liveState.rallies.length - 1];

  // Trigger walking animation whenever service changes or server switches sides/ends
  useEffect(() => {
    const currServing = `${liveState.servingTeam}-${liveState.serverNumber}`;
    const serviceChanged = prevServingRef.current !== currServing;
    const sideChanged = prevServerSideRef.current !== serverSide;
    const endsChanged = prevEndsRef.current !== endsSwitched;

    prevServerSideRef.current = serverSide;

    if (serviceChanged || sideChanged || endsChanged) {
      setMascotMood('walking');
      const timer = window.setTimeout(() => setMascotMood('serving'), 720);
      return () => window.clearTimeout(timer);
    }
    setMascotMood('serving');
  }, [liveState.servingTeam, liveState.serverNumber, serverSide, endsSwitched]);

  // Trigger switch-ends or service-change visual cue
  useEffect(() => {
    const currServing = `${liveState.servingTeam}-${liveState.serverNumber}`;
    let nextCue: CourtTransitionCue = null;

    if (prevEndsRef.current !== endsSwitched) {
      nextCue = 'switch_ends';
    } else if (prevServingRef.current !== currServing) {
      nextCue = lastRally?.event_type === 'server_change' ? 'server_change' : 'side_out';
    }

    prevEndsRef.current = endsSwitched;
    prevServingRef.current = currServing;

    if (!nextCue) return;
    setTransitionCue(nextCue);
    const timer = window.setTimeout(() => setTransitionCue(null), 1100);
    return () => window.clearTimeout(timer);
  }, [endsSwitched, liveState.servingTeam, liveState.serverNumber, lastRally?.event_type]);

  const isJa = lang === 'ja';

  // Determine top status label
  let statusPrefix =
    liveState.scoringMode === 'side_out'
      ? isJa
        ? 'サイドアウト制'
        : 'SIDE-OUT'
      : isJa
        ? 'ラリー制'
        : 'RALLY';
  if (lastRally) {
    const prevMax = Math.max(
      lastRally.team_a_score - (lastRally.rally_winner === 'A' && lastRally.event_type === 'point' ? 1 : 0),
      lastRally.team_b_score - (lastRally.rally_winner === 'B' && lastRally.event_type === 'point' ? 1 : 0)
    );
    const currMax = Math.max(liveState.teamAScore, liveState.teamBScore);
    if (autoSwitchEnds && prevMax < switchThreshold && currMax >= switchThreshold) {
      statusPrefix = isJa ? 'エンド交代' : 'SWITCH ENDS';
    } else if (lastRally.event_type === 'side_out') {
      statusPrefix = isJa ? 'サイドアウト' : 'SIDE OUT';
    } else if (lastRally.event_type === 'server_change') {
      statusPrefix = isJa ? '2ndサーバー' : 'SECOND SERVER';
    } else if (liveState.gameType === 'doubles' && liveState.scoringMode === 'side_out') {
      statusPrefix =
        liveState.serverNumber === 1
          ? isJa
            ? '1stサーバー'
            : 'FIRST SERVER'
          : isJa
            ? '2ndサーバー'
            : 'SECOND SERVER';
    }
  }

  const badgeA = getCardBadge(
    'A',
    liveState.teamAScore,
    liveState.teamBScore,
    liveState,
    gamePointTeam,
    lang
  );
  const badgeB = getCardBadge(
    'B',
    liveState.teamBScore,
    liveState.teamAScore,
    liveState,
    gamePointTeam,
    lang
  );

  const sideText =
    serverSide === 'right' ? (isJa ? '右' : 'Right') : isJa ? '左' : 'Left';
  const compactCallout = callout.replace(/\s+/g, '');

  return (
    <div className="sideout-stage-shell">
      {/* Okayama Castle (烏城) Silhouette & Horizon */}
      <div className="sideout-skyline-bg" aria-hidden="true">
        <svg viewBox="0 0 420 110" preserveAspectRatio="none" className="sideout-skyline-svg">
          {/* Distant hills */}
          <path
            d="M0 110 V88 Q70 70 150 86 T300 84 T420 90 V110 Z"
            fill="rgba(11, 18, 34, 0.55)"
          />
          {/* Okayama Castle (Ujo) keep + ishigaki stone wall + flanking yagura & pine trees */}
          <path
            d="M0 110 V94
               H18 Q28 76 40 88 Q50 74 62 94
               H82 L88 80 H112 L116 94
               H146 L154 78 H172
               L176 68 H166 L175 58 H180 L171 49 H182
               L186 39 H177 L187 29 H191 L186 19 L210 6 L234 19 L229 29 H233 L243 39 H234
               L238 49 H249 L240 58 H245 L254 68 H244 L248 78 H266 L276 94
               H308 L314 82 H334 L340 94
               H358 Q370 76 382 88 Q392 75 404 94 H420 V110 Z"
            fill="#0b1222"
          />
          {/* Subtle golden shachihoko roof ornaments */}
          <circle cx="195" cy="12" r="1.6" fill="#fbbf24" opacity="0.85" />
          <circle cx="225" cy="12" r="1.6" fill="#fbbf24" opacity="0.85" />
        </svg>
      </div>

      {/* Top HUD */}
      <header className="sideout-hud">
        <AnimatePresence mode="wait">
          <motion.div
            key={statusPrefix}
            initial={{ y: -4, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 4, opacity: 0 }}
            transition={{ duration: 0.16 }}
            className="sideout-hud-pill"
          >
            {statusPrefix} &nbsp;·&nbsp;{' '}
            {isJa ? `${liveState.targetScore}点先取` : `TO ${liveState.targetScore}`}
          </motion.div>
        </AnimatePresence>

        <div id="live-callout-display" className="sideout-hud-callout" aria-label={callout}>
          {compactCallout}
        </div>

        <div className="sideout-hud-sub">
          {isJa
            ? `${serverDisplayName} サーブ · ${sideText}`
            : `${serverDisplayName} serves · ${sideText}`}
        </div>
      </header>

      {/* Center 2.5D Court Canvas */}
      <SideoutCourtCanvas
        lang={lang}
        liveState={liveState}
        serverSide={serverSide}
        endsSwitched={endsSwitched}
        mascotMood={mascotMood}
        transitionCue={transitionCue}
        teamALabels={teamALabels}
        teamBLabels={teamBLabels}
        teamAName={activeMatch.team_a_name}
        teamBName={activeMatch.team_b_name}
        onRally={onRally}
      />

      {/* Bottom Scoreboard Cards + Center Controls */}
      <div className="sideout-bottom-deck">
        <motion.button
          type="button"
          id="btn-rally-team-a"
          className="sideout-score-card is-team-a"
          whileTap={{ scale: 0.96 }}
          onClick={() => onRally('A')}
          disabled={Boolean(liveState.winnerTeam)}
        >
          <span className="sideout-card-name">{activeMatch.team_a_name}</span>
          <RollingNumber value={liveState.teamAScore} className="sideout-card-score" />
          <span className="sideout-card-badge-slot">
            {badgeA && (
              <span className={`sideout-card-badge ${badgeA.tone === 'win' ? 'is-win' : ''}`}>
                {badgeA.text}
              </span>
            )}
          </span>
        </motion.button>

        <div className="sideout-center-controls">
          <button
            type="button"
            id="btn-undo-rally"
            className="sideout-circle-text-btn"
            onClick={onUndo}
            disabled={liveState.rallies.length === 0}
            title={isJa ? '1つ戻す' : 'Undo last rally'}
          >
            {isJa ? '戻す' : 'Undo'}
          </button>
          <button
            type="button"
            className="sideout-circle-btn"
            onClick={onBack}
            aria-label={isJa ? '設定へ戻る' : 'Back to setup'}
            title={isJa ? '設定へ戻る' : 'Back to setup'}
          >
            <Home size={16} />
          </button>
        </div>

        <motion.button
          type="button"
          id="btn-rally-team-b"
          className="sideout-score-card is-team-b"
          whileTap={{ scale: 0.96 }}
          onClick={() => onRally('B')}
          disabled={Boolean(liveState.winnerTeam)}
        >
          <span className="sideout-card-name">{activeMatch.team_b_name}</span>
          <RollingNumber value={liveState.teamBScore} className="sideout-card-score" />
          <span className="sideout-card-badge-slot">
            {badgeB && (
              <span className={`sideout-card-badge ${badgeB.tone === 'win' ? 'is-win' : ''}`}>
                {badgeB.text}
              </span>
            )}
          </span>
        </motion.button>
      </div>

      {/* Compact Secondary Utilities */}
      <div className="sideout-utility-bar">
        <button
          type="button"
          className="sideout-util-btn"
          onClick={onRedo}
          disabled={liveState.redoStack.length === 0}
        >
          <Redo2 size={13} /> {isJa ? 'やり直す' : 'Redo'}
        </button>
        <button
          type="button"
          className="sideout-util-btn"
          onClick={onSwapServer}
          disabled={Boolean(liveState.winnerTeam)}
        >
          <RotateCcw size={13} /> {isJa ? 'サーバー修正' : 'Fix Server'}
        </button>
        <button
          type="button"
          className="sideout-util-btn"
          onClick={() => setManualFlip((f) => !f)}
        >
          <Users size={13} /> {isJa ? 'エンド反転' : 'Flip Ends'}
        </button>
        <button
          type="button"
          className={`sideout-util-btn ${autoSwitchEnds ? 'is-accent' : ''}`}
          onClick={onToggleAutoSwitchEnds}
          title={
            isJa
              ? `${switchThreshold}点で自動エンド交代`
              : `Automatically switch ends at ${switchThreshold}`
          }
        >
          {isJa
            ? `${switchThreshold}点交代: ${autoSwitchEnds ? 'ON' : 'OFF'}`
            : `Switch @${switchThreshold}: ${autoSwitchEnds ? 'On' : 'Off'}`}
        </button>
        {liveState.gameType === 'doubles' && (
          <>
            <button
              type="button"
              className="sideout-util-btn"
              onClick={() => onSwapBoxes('A')}
              disabled={Boolean(liveState.winnerTeam)}
            >
              <ArrowLeftRight size={13} /> {isJa ? 'A入替' : 'Swap A'}
            </button>
            <button
              type="button"
              className="sideout-util-btn"
              onClick={() => onSwapBoxes('B')}
              disabled={Boolean(liveState.winnerTeam)}
            >
              <ArrowLeftRight size={13} /> {isJa ? 'B入替' : 'Swap B'}
            </button>
          </>
        )}
        {!liveState.winnerTeam && (
          <button
            type="button"
            className="sideout-util-btn is-accent"
            onClick={onFinishEarly}
            disabled={saving}
          >
            <CheckCircle2 size={13} /> {isJa ? '終了して保存' : 'End & Save'}
          </button>
        )}
      </div>

      {/* Good Game Iris-Wipe Victory Screen */}
      <AnimatePresence>
        {liveState.winnerTeam && (
          <GoodGameOverlay
            lang={lang}
            teamAName={activeMatch.team_a_name}
            teamBName={activeMatch.team_b_name}
            teamAScore={liveState.teamAScore}
            teamBScore={liveState.teamBScore}
            winnerScore={Math.max(liveState.teamAScore, liveState.teamBScore)}
            canUndo={liveState.rallies.length > 0}
            onUndo={onUndo}
            onPlayAgain={onRematch}
            onHome={onBack}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
