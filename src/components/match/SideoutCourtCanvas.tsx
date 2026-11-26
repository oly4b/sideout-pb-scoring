import { AnimatePresence, motion } from 'motion/react';
import type { CourtSide, LiveGameState, TeamId } from '../../../shared/types';
import type { Lang } from '../../lib/i18n';
import { FlameBadge } from './FlameBadge';
import { PickleballMascot, type MascotMood } from './PickleballMascot';

export type CourtTransitionCue = 'switch_ends' | 'side_out' | 'server_change' | null;

interface SideoutCourtCanvasProps {
  lang: Lang;
  liveState: LiveGameState;
  serverSide: CourtSide;
  endsSwitched: boolean;
  mascotMood: MascotMood;
  transitionCue: CourtTransitionCue;
  teamALabels: { right: string; left: string };
  teamBLabels: { right: string; left: string };
  teamAName: string;
  teamBName: string;
  onRally: (winner: TeamId) => void;
}

interface CourtCoords {
  xPct: number;
  yPct: number;
}

function getBoxCoords(half: 'top' | 'bottom', side: CourtSide): CourtCoords {
  if (half === 'bottom') {
    return side === 'left' ? { xPct: 33, yPct: 79 } : { xPct: 67, yPct: 79 };
  }
  return side === 'right' ? { xPct: 35, yPct: 19 } : { xPct: 65, yPct: 19 };
}

function getBoxPolygonPoints(half: 'top' | 'bottom', side: CourtSide): string {
  if (half === 'bottom') {
    // Bottom half: NVZ (59.4..440.6 at y=346), baseline (42..458 at y=518)
    return side === 'left'
      ? '59.4,346 250,346 250,518 42,518'
      : '250,346 440.6,346 458,518 250,518';
  }
  // Top half: baseline (92..408 at y=24), NVZ (75.6..424.4 at y=186)
  // Top half facing down: player's right = viewer's left, player's left = viewer's right
  return side === 'right'
    ? '92,24 250,24 250,186 75.6,186'
    : '250,24 408,24 424.4,186 250,186';
}

function getInitials(label: string): string {
  const clean = label.trim();
  if (!clean) return '?';
  const parts = clean.split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return clean.slice(0, 2).toUpperCase();
}

interface TokenRenderItem {
  key: string;
  team: TeamId;
  half: 'top' | 'bottom';
  side: CourtSide;
  label: string;
  initials: string;
  isServer: boolean;
  isActiveReceiver: boolean;
}

export function SideoutCourtCanvas({
  lang,
  liveState,
  serverSide,
  endsSwitched,
  mascotMood,
  transitionCue,
  teamALabels,
  teamBLabels,
  teamAName,
  teamBName,
  onRally,
}: SideoutCourtCanvasProps) {
  const teamAHalf: 'top' | 'bottom' = endsSwitched ? 'top' : 'bottom';
  const teamBHalf: 'top' | 'bottom' = endsSwitched ? 'bottom' : 'top';
  const topTeam: TeamId = teamAHalf === 'top' ? 'A' : 'B';
  const bottomTeam: TeamId = teamAHalf === 'bottom' ? 'A' : 'B';
  const topTeamName = topTeam === 'A' ? teamAName : teamBName;
  const bottomTeamName = bottomTeam === 'A' ? teamAName : teamBName;
  const receivingTeam: TeamId = liveState.servingTeam === 'A' ? 'B' : 'A';
  const receiverSide: CourtSide = serverSide;

  const tokens: TokenRenderItem[] = [];

  if (liveState.gameType === 'singles') {
    const aSide: CourtSide =
      liveState.servingTeam === 'A' ? serverSide : receiverSide;
    const bSide: CourtSide =
      liveState.servingTeam === 'B' ? serverSide : receiverSide;

    tokens.push({
      key: 'singles-A',
      team: 'A',
      half: teamAHalf,
      side: aSide,
      label: teamALabels.right,
      initials: getInitials(teamALabels.right),
      isServer: liveState.servingTeam === 'A',
      isActiveReceiver: receivingTeam === 'A',
    });
    tokens.push({
      key: 'singles-B',
      team: 'B',
      half: teamBHalf,
      side: bSide,
      label: teamBLabels.right,
      initials: getInitials(teamBLabels.right),
      isServer: liveState.servingTeam === 'B',
      isActiveReceiver: receivingTeam === 'B',
    });
  } else {
    const slotA1 = liveState.positions.teamA.right;
    const slotA2 = liveState.positions.teamA.left;
    const slotB1 = liveState.positions.teamB.right;
    const slotB2 = liveState.positions.teamB.left;

    tokens.push(
      {
        key: `A-${slotA1 ?? 'right'}`,
        team: 'A',
        half: teamAHalf,
        side: 'right',
        label: teamALabels.right,
        initials: getInitials(teamALabels.right),
        isServer: liveState.servingTeam === 'A' && serverSide === 'right',
        isActiveReceiver: receivingTeam === 'A' && receiverSide === 'right',
      },
      {
        key: `A-${slotA2 ?? 'left'}`,
        team: 'A',
        half: teamAHalf,
        side: 'left',
        label: teamALabels.left,
        initials: getInitials(teamALabels.left),
        isServer: liveState.servingTeam === 'A' && serverSide === 'left',
        isActiveReceiver: receivingTeam === 'A' && receiverSide === 'left',
      },
      {
        key: `B-${slotB1 ?? 'right'}`,
        team: 'B',
        half: teamBHalf,
        side: 'right',
        label: teamBLabels.right,
        initials: getInitials(teamBLabels.right),
        isServer: liveState.servingTeam === 'B' && serverSide === 'right',
        isActiveReceiver: receivingTeam === 'B' && receiverSide === 'right',
      },
      {
        key: `B-${slotB2 ?? 'left'}`,
        team: 'B',
        half: teamBHalf,
        side: 'left',
        label: teamBLabels.left,
        initials: getInitials(teamBLabels.left),
        isServer: liveState.servingTeam === 'B' && serverSide === 'left',
        isActiveReceiver: receivingTeam === 'B' && receiverSide === 'left',
      }
    );
  }

  const serverHalf = liveState.servingTeam === 'A' ? teamAHalf : teamBHalf;
  const receiverHalf = serverHalf === 'bottom' ? 'top' : 'bottom';
  const startCoords = getBoxCoords(serverHalf, serverSide);
  const endCoords = getBoxCoords(receiverHalf, receiverSide);
  const serverBoxPoints = getBoxPolygonPoints(serverHalf, serverSide);

  const sxFull = (startCoords.xPct / 100) * 500;
  const syFull = (startCoords.yPct / 100) * 540;
  const exFull = (endCoords.xPct / 100) * 500;
  const eyFull = (endCoords.yPct / 100) * 540;

  const yTop = 158; // ~5% shorter from top endpoint (146 -> 158)
  const yBot = 377; // ~5% shorter from bottom endpoint (389 -> 377)
  const sy = serverHalf === 'top' ? yTop : yBot;
  const ey = receiverHalf === 'top' ? yTop : yBot;
  const dyFull = eyFull - syFull || 1;
  const sx = sxFull + (exFull - sxFull) * ((sy - syFull) / dyFull);
  const ex = sxFull + (exFull - sxFull) * ((ey - syFull) / dyFull);
  const cx = (sx + ex) / 2;
  const cy = (sy + ey) / 2 - 58;

  const teamAOnFire = liveState.teamAScore >= Math.max(1, liveState.targetScore - 2);
  const teamBOnFire = liveState.teamBScore >= Math.max(1, liveState.targetScore - 2);

  const topOnFire = teamAHalf === 'top' ? teamAOnFire : teamBOnFire;
  const bottomOnFire = teamAHalf === 'bottom' ? teamAOnFire : teamBOnFire;

  const servingScore =
    liveState.servingTeam === 'A' ? liveState.teamAScore : liveState.teamBScore;

  return (
    <motion.div
      className="sideout-court-stage"
      animate={
        transitionCue === 'switch_ends'
          ? { scale: [1, 0.96, 1.02, 1], rotateY: [0, 12, -8, 0] }
          : { scale: 1, rotateY: 0 }
      }
      transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
    >
      {/* Scroll-centering anchor: midpoint between net (y=264) and bottom NVZ line (y=346) */}
      <div
        data-court-center-anchor="true"
        aria-hidden="true"
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: '56.5%',
          height: 1,
          pointerEvents: 'none',
        }}
      />

      {/* Perspective Court SVG */}
      <svg
        viewBox="0 0 500 540"
        className="sideout-court-svg"
        preserveAspectRatio="xMidYMid meet"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id="court-blue-grad" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#1b3a61" />
            <stop offset="50%" stopColor="#1e3d63" />
            <stop offset="100%" stopColor="#264d7a" />
          </linearGradient>
          <linearGradient id="court-kitchen-grad" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#9d4638" />
            <stop offset="50%" stopColor="#8e3d30" />
            <stop offset="100%" stopColor="#7f372c" />
          </linearGradient>
          <clipPath id="court-clip">
            <polygon points="92,24 408,24 458,518 42,518" />
          </clipPath>
        </defs>

        <polygon points="88,28 412,28 464,524 36,524" fill="rgba(2, 6, 23, 0.45)" />
        {/* Blue main court surface */}
        <polygon points="92,24 408,24 458,518 42,518" fill="url(#court-blue-grad)" />
        {/* Red kitchen (NVZ) */}
        <polygon
          points="75.6,186 424.4,186 440.6,346 59.4,346"
          fill="url(#court-kitchen-grad)"
          clipPath="url(#court-clip)"
        />

        {/* Active serving box highlight */}
        <motion.polygon
          key={serverBoxPoints}
          points={serverBoxPoints}
          clipPath="url(#court-clip)"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.25 }}
          fill="rgba(255, 255, 255, 0.11)"
        />

        {/* Subtle sun-horizon watermark behind the net */}
        <g clipPath="url(#court-clip)" opacity="0.14">
          <circle cx="250" cy="264" r="78" fill="#ffffff" />
          <rect x="160" y="272" width="180" height="6" fill="#0f172a" />
          <rect x="160" y="286" width="180" height="7" fill="#0f172a" />
          <rect x="160" y="302" width="180" height="8" fill="#0f172a" />
        </g>

        {/* Court Lines */}
        <g stroke="rgba(255, 255, 255, 0.85)" strokeWidth="2.5" fill="none">
          <g clipPath="url(#court-clip)">
            <line x1="75.6" y1="186" x2="424.4" y2="186" />
            <line x1="59.4" y1="346" x2="440.6" y2="346" />
            <line x1="250" y1="24" x2="250" y2="186" />
            <line x1="250" y1="346" x2="250" y2="518" />
          </g>
          <polygon points="92,24 408,24 458,518 42,518" />
        </g>

        {/* 3D Net (~5 deg steeper bird's-eye angle) */}
        <g>
          <line x1="60" y1="268" x2="440" y2="268" stroke="rgba(2, 6, 23, 0.4)" strokeWidth="5" />
          <rect
            x="58"
            y="255"
            width="384"
            height="10"
            fill="rgba(15, 23, 42, 0.55)"
            stroke="rgba(255,255,255,0.22)"
            strokeWidth="1"
          />
          <line
            x1="56"
            y1="255"
            x2="444"
            y2="255"
            stroke="#f8fafc"
            strokeWidth="3.2"
            strokeLinecap="round"
          />
          <rect x="53" y="251" width="6" height="17" rx="2" fill="#cbd5e1" />
          <rect x="441" y="251" width="6" height="17" rx="2" fill="#cbd5e1" />
        </g>

        {/* Serve Trajectory Dashed Arc (25% past NVZ, arcing above the net) */}
        <motion.path
          key={`${sx.toFixed(1)}-${sy}-${ex.toFixed(1)}-${ey}`}
          d={`M ${sx} ${sy} Q ${cx} ${cy} ${ex} ${ey}`}
          fill="none"
          stroke="#bef264"
          strokeWidth="2.6"
          strokeLinecap="butt"
          strokeDasharray="8 6"
          style={{ filter: 'drop-shadow(0 1px 2px rgba(2, 6, 23, 0.8))' }}
          initial={{ opacity: 0.2 }}
          animate={{ opacity: 0.96 }}
          transition={{ duration: 0.3, ease: 'easeOut' }}
        />
      </svg>

      {/* Interactive Top & Bottom Court Half Tap Targets */}
      <motion.button
        type="button"
        whileTap={{ backgroundColor: 'rgba(255, 255, 255, 0.08)' }}
        onClick={() => onRally(topTeam)}
        disabled={Boolean(liveState.winnerTeam)}
        aria-label={`Score rally for ${topTeamName} (top side)`}
        style={{
          position: 'absolute',
          left: '7%',
          right: '7%',
          top: '4%',
          height: '44%',
          background: 'transparent',
          border: 'none',
          cursor: liveState.winnerTeam ? 'default' : 'pointer',
          zIndex: 3,
          borderRadius: '14px 14px 4px 4px',
          WebkitTapHighlightColor: 'transparent',
        }}
      />
      <motion.button
        type="button"
        whileTap={{ backgroundColor: 'rgba(255, 255, 255, 0.08)' }}
        onClick={() => onRally(bottomTeam)}
        disabled={Boolean(liveState.winnerTeam)}
        aria-label={`Score rally for ${bottomTeamName} (bottom side)`}
        style={{
          position: 'absolute',
          left: '4%',
          right: '4%',
          bottom: '3%',
          height: '45%',
          background: 'transparent',
          border: 'none',
          cursor: liveState.winnerTeam ? 'default' : 'pointer',
          zIndex: 3,
          borderRadius: '4px 4px 16px 16px',
          WebkitTapHighlightColor: 'transparent',
        }}
      />

      {/* Court-level Switch Ends / Service Change Banner */}
      <AnimatePresence>
        {transitionCue && (
          <motion.div
            key={`${transitionCue}-${liveState.servingTeam}-${liveState.serverNumber}-${endsSwitched}`}
            initial={{ scale: 0.8, opacity: 0, y: 8 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.9, opacity: 0, y: -8 }}
            transition={{ type: 'spring', stiffness: 360, damping: 24 }}
            style={{
              position: 'absolute',
              left: '50%',
              top: '48.5%',
              transform: 'translate(-50%, -50%)',
              zIndex: 14,
              padding: '6px 14px',
              borderRadius: 999,
              background:
                transitionCue === 'switch_ends'
                  ? 'rgba(163, 230, 53, 0.95)'
                  : 'rgba(15, 23, 42, 0.92)',
              color: transitionCue === 'switch_ends' ? '#0f172a' : '#f8fafc',
              border: '1.5px solid rgba(255, 255, 255, 0.3)',
              fontSize: '0.72rem',
              fontWeight: 900,
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              boxShadow: '0 8px 22px rgba(2, 6, 23, 0.55)',
              pointerEvents: 'none',
              whiteSpace: 'nowrap',
            }}
          >
            {transitionCue === 'switch_ends'
              ? lang === 'ja'
                ? '⇄ エンド交代'
                : '⇄ Switch Ends'
              : transitionCue === 'side_out'
                ? lang === 'ja'
                  ? 'サイドアウト！'
                  : 'Side Out!'
                : lang === 'ja'
                  ? '2ndサーバー'
                  : '2nd Server'}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Flame indicators at 9+ points (2 to win) */}
      <AnimatePresence>
        {topOnFire && (
          <div
            key="flame-top"
            style={{
              position: 'absolute',
              left: '50%',
              top: '16%',
              transform: 'translate(-50%, -50%)',
              zIndex: 4,
            }}
          >
            <FlameBadge size={28} />
          </div>
        )}
        {bottomOnFire && (
          <div
            key="flame-bottom"
            style={{
              position: 'absolute',
              left: '50%',
              top: '83%',
              transform: 'translate(-50%, -50%)',
              zIndex: 4,
            }}
          >
            <FlameBadge size={28} />
          </div>
        )}
      </AnimatePresence>

      {/* Players & Mascot Tokens */}
      {tokens.map((tok) => {
        const coords = getBoxCoords(tok.half, tok.side);
        const isTeamA = tok.team === 'A';
        const pillBg = isTeamA ? '#bbf7d0' : '#ffc4bd';
        const pillBorder = isTeamA ? '#4ade80' : '#ff8a80';

        return (
          <motion.div
            key={tok.key}
            animate={{
              left: `${coords.xPct}%`,
              top: `${coords.yPct}%`,
            }}
            transition={{
              type: 'spring',
              stiffness: 240,
              damping: 22,
            }}
            style={{
              position: 'absolute',
              transform: 'translate(-50%, -50%)',
              zIndex: tok.isServer ? 8 : 5,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              pointerEvents: 'none',
            }}
          >
            {tok.isServer ? (
              <motion.div
                key="server-mascot"
                initial={{ scale: 0.88, y: -4, opacity: 0.85 }}
                animate={{ scale: 1, y: 0, opacity: 1 }}
                transition={{ duration: 0.22, ease: 'easeOut' }}
                style={{
                  position: 'relative',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                }}
              >
                {/* Service change ripple */}
                {(transitionCue === 'side_out' || transitionCue === 'server_change') && (
                  <motion.div
                    key={`ripple-${liveState.rallies.length}`}
                    initial={{ scale: 0.5, opacity: 0.85 }}
                    animate={{ scale: 1.9, opacity: 0 }}
                    transition={{ duration: 0.6, ease: 'easeOut' }}
                    style={{
                      position: 'absolute',
                      bottom: 10,
                      width: 68,
                      height: 26,
                      borderRadius: '999px',
                      border: '2px solid #bef264',
                      pointerEvents: 'none',
                    }}
                  />
                )}

                <div style={{ position: 'relative', zIndex: 2 }}>
                  <PickleballMascot
                    score={servingScore}
                    mood={mascotMood}
                    facing={tok.side === 'left' ? 'right' : 'left'}
                    size={tok.half === 'top' ? 79 : 91}
                    showShadow={false}
                  />
                </div>

                {/* Hovering perspective circle loading ring around server's feet */}
                <div
                  style={{
                    position: 'relative',
                    width: tok.half === 'top' ? 76 : 88,
                    height: tok.half === 'top' ? 26 : 30,
                    marginTop: tok.half === 'top' ? -24 : -28,
                    zIndex: 1,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <svg
                    viewBox="0 0 96 36"
                    width="100%"
                    height="100%"
                    style={{ overflow: 'visible' }}
                    aria-hidden="true"
                  >
                    {/* Subtle dashed base ring */}
                    <ellipse
                      cx="48"
                      cy="18"
                      rx="40"
                      ry="12"
                      fill="rgba(2, 6, 23, 0.28)"
                      stroke="rgba(255, 255, 255, 0.35)"
                      strokeWidth="1.5"
                      strokeDasharray="3 4"
                    />
                    {/* Orbiting loading arc */}
                    <motion.ellipse
                      cx="48"
                      cy="18"
                      rx="40"
                      ry="12"
                      fill="none"
                      stroke="#f8fafc"
                      strokeWidth="2.6"
                      strokeLinecap="round"
                      strokeDasharray="48 130"
                      animate={{ strokeDashoffset: [0, -178] }}
                      transition={{ duration: 5.5, repeat: Infinity, ease: 'linear' }}
                    />
                  </svg>
                </div>

                <span
                  style={{
                    marginTop: -6,
                    padding: '1px 7px',
                    borderRadius: 999,
                    background: pillBg,
                    color: '#0f172a',
                    fontSize: '0.68rem',
                    fontWeight: 800,
                    border: `1.5px solid ${pillBorder}`,
                    boxShadow: '0 2px 6px rgba(0,0,0,0.35)',
                    maxWidth: 88,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    zIndex: 2,
                  }}
                >
                  {tok.label}
                </span>
              </motion.div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
                <div
                  style={{
                    position: 'relative',
                    width: 34,
                    height: 34,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {tok.isActiveReceiver && (
                    <svg
                      viewBox="0 0 40 40"
                      style={{
                        position: 'absolute',
                        inset: -4,
                        width: 'calc(100% + 8px)',
                        height: 'calc(100% + 8px)',
                        pointerEvents: 'none',
                      }}
                      aria-hidden="true"
                    >
                      <circle
                        cx="20"
                        cy="20"
                        r="18"
                        fill="none"
                        stroke="rgba(255, 255, 255, 0.24)"
                        strokeWidth="1.5"
                        strokeDasharray="3 4"
                      />
                      <motion.circle
                        cx="20"
                        cy="20"
                        r="18"
                        fill="none"
                        stroke="#f8fafc"
                        strokeWidth="2.4"
                        strokeLinecap="round"
                        strokeDasharray="32 81"
                        animate={{ strokeDashoffset: [0, -113] }}
                        transition={{ duration: 5.5, repeat: Infinity, ease: 'linear' }}
                      />
                    </svg>
                  )}
                  <div
                    style={{
                      position: 'relative',
                      zIndex: 2,
                      width: 30,
                      height: 30,
                      borderRadius: '999px',
                      background: pillBg,
                      border: `2px solid ${pillBorder}`,
                      color: '#0f172a',
                      fontWeight: 900,
                      fontSize: '0.72rem',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      boxShadow: '0 3px 8px rgba(2, 6, 23, 0.45)',
                    }}
                  >
                    {tok.initials}
                  </div>
                </div>
                <span
                  style={{
                    padding: '1px 6px',
                    borderRadius: 999,
                    background: 'rgba(15, 23, 42, 0.72)',
                    color: '#f8fafc',
                    fontSize: '0.64rem',
                    fontWeight: 700,
                    border: '1px solid rgba(255,255,255,0.16)',
                    maxWidth: 82,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {tok.label}
                </span>
              </div>
            )}
          </motion.div>
        );
      })}
    </motion.div>
  );
}
