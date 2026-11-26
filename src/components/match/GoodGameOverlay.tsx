import { ArrowRight, Home, Trophy, Undo2 } from 'lucide-react';
import { motion } from 'motion/react';
import type { TeamId } from '../../../shared/types';
import type { Lang } from '../../lib/i18n';
import { PickleballMascot } from './PickleballMascot';

interface GoodGameOverlayProps {
  lang: Lang;
  winnerTeam?: TeamId | null;
  teamAName: string;
  teamBName: string;
  teamAScore: number;
  teamBScore: number;
  winnerScore: number;
  canUndo: boolean;
  onUndo: () => void;
  onPlayAgain: () => void;
  onHome: () => void;
}

function getWinnerInitials(label: string): string {
  const clean = label.trim();
  if (!clean) return '?';
  const parts = clean.split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return clean.slice(0, 2).toUpperCase();
}

export function GoodGameOverlay({
  lang,
  winnerTeam,
  teamAName,
  teamBName,
  teamAScore,
  teamBScore,
  winnerScore,
  canUndo,
  onUndo,
  onPlayAgain,
  onHome,
}: GoodGameOverlayProps) {
  const effectiveWinner: TeamId = winnerTeam ?? (teamAScore >= teamBScore ? 'A' : 'B');
  const winnerName = effectiveWinner === 'A' ? teamAName : teamBName;
  const winnerInitials = getWinnerInitials(winnerName);

  return (
    <motion.div
      className="good-game-overlay"
      initial={{ clipPath: 'circle(0% at 50% 42%)', opacity: 0.7 }}
      animate={{ clipPath: 'circle(135% at 50% 42%)', opacity: 1 }}
      exit={{ clipPath: 'circle(0% at 50% 42%)', opacity: 0 }}
      transition={{ duration: 0.48, ease: [0.22, 1, 0.36, 1] }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
        <motion.h2
          className="good-game-title"
          initial={{ y: -16, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.14, type: 'spring', stiffness: 300, damping: 24 }}
        >
          {lang === 'ja' ? 'ナイスゲーム！' : 'Good game!'}
        </motion.h2>
        <motion.div
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ delay: 0.2, duration: 0.25 }}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '4px 12px',
            borderRadius: 999,
            background: 'rgba(190, 242, 100, 0.16)',
            border: '1px solid rgba(190, 242, 100, 0.48)',
            color: '#bef264',
            fontSize: '0.82rem',
            fontWeight: 800,
            letterSpacing: '0.03em',
          }}
        >
          <Trophy size={13} />
          <span>{lang === 'ja' ? `${winnerName} の勝利` : `${winnerName} Wins!`}</span>
        </motion.div>
      </div>

      {/* Circular spotlight with skyline + court + celebrating mascot */}
      <motion.div
        className="good-game-spotlight"
        initial={{ scale: 0.75, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ delay: 0.1, type: 'spring', stiffness: 260, damping: 22 }}
      >
        <svg
          viewBox="0 0 220 220"
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
          aria-hidden="true"
        >
          <rect width="220" height="125" fill="#9d5846" />
          {/* Okayama Castle (Ujo) silhouette */}
          <path
            d="M0 115 H18 Q26 98 36 106 Q46 96 54 115
               H66 L72 95 H92 L95 84 H87 L94 74 H98 L91 65 H99
               L103 55 H96 L104 45 H106 L102 36 L110 26 L118 36 L114 45 H116 L124 55 H117
               L121 65 H129 L122 74 H126 L133 84 H125 L128 95 H148 L156 115
               H166 Q176 95 186 104 Q196 96 204 115 H220 V115 H0 Z"
            fill="#4a1d1f"
          />
          {/* Subtle golden shachihoko accents on keep roof */}
          <circle cx="103" cy="27" r="1.4" fill="#fbbf24" />
          <circle cx="117" cy="27" r="1.4" fill="#fbbf24" />
          {/* Winner circle badge at the peak of the castle */}
          <g>
            <circle cx="110" cy="28" r="18.5" fill="rgba(251, 191, 36, 0.2)" />
            <circle
              cx="110"
              cy="28"
              r="14.5"
              fill={effectiveWinner === 'A' ? '#86efac' : '#fdba74'}
              stroke="#fffbeb"
              strokeWidth="2"
            />
            <text
              x="110"
              y="29.5"
              textAnchor="middle"
              dominantBaseline="central"
              fill="#0f172a"
              fontSize="11.5"
              fontWeight="900"
              letterSpacing="0.02em"
            >
              {winnerInitials}
            </text>
          </g>
          {/* Court floor */}
          <rect y="115" width="220" height="105" fill="#234873" />
          <g stroke="rgba(255,255,255,0.45)" strokeWidth="2">
            <line x1="0" y1="115" x2="220" y2="115" />
            <line x1="65" y1="115" x2="20" y2="220" />
            <line x1="155" y1="115" x2="200" y2="220" />
            <line x1="110" y1="115" x2="110" y2="220" />
            <line x1="30" y1="168" x2="190" y2="168" />
          </g>
        </svg>

        <div style={{ position: 'relative', zIndex: 2, marginTop: 18 }}>
          <PickleballMascot score={winnerScore} mood="celebrating" size={112} />
        </div>
      </motion.div>

      {/* Score summary */}
      <div className="good-game-scores">
        <div
          className="good-game-score-row"
          style={{ opacity: effectiveWinner === 'A' ? 1 : 0.62 }}
        >
          <div className="good-game-team">
            <span className="good-game-dot" style={{ background: '#86efac' }} />
            <span>{teamAName}</span>
            {effectiveWinner === 'A' && (
              <span
                style={{
                  fontSize: '0.66rem',
                  fontWeight: 900,
                  padding: '2px 7px',
                  borderRadius: 999,
                  background: 'rgba(190, 242, 100, 0.18)',
                  border: '1px solid rgba(190, 242, 100, 0.5)',
                  color: '#bef264',
                  letterSpacing: '0.06em',
                }}
              >
                {lang === 'ja' ? '勝利' : 'WIN'}
              </span>
            )}
          </div>
          <span
            className="good-game-num"
            style={{ color: effectiveWinner === 'A' ? '#bef264' : undefined }}
          >
            {teamAScore}
          </span>
        </div>
        <div className="good-game-divider" />
        <div
          className="good-game-score-row"
          style={{ opacity: effectiveWinner === 'B' ? 1 : 0.62 }}
        >
          <div className="good-game-team">
            <span className="good-game-dot" style={{ background: '#fdba74' }} />
            <span>{teamBName}</span>
            {effectiveWinner === 'B' && (
              <span
                style={{
                  fontSize: '0.66rem',
                  fontWeight: 900,
                  padding: '2px 7px',
                  borderRadius: 999,
                  background: 'rgba(190, 242, 100, 0.18)',
                  border: '1px solid rgba(190, 242, 100, 0.5)',
                  color: '#bef264',
                  letterSpacing: '0.06em',
                }}
              >
                {lang === 'ja' ? '勝利' : 'WIN'}
              </span>
            )}
          </div>
          <span
            className="good-game-num"
            style={{ color: effectiveWinner === 'B' ? '#bef264' : undefined }}
          >
            {teamBScore}
          </span>
        </div>
      </div>

      {/* Bottom Actions */}
      <div className="good-game-actions">
        <button
          type="button"
          className="sideout-circle-btn"
          onClick={onHome}
          aria-label="Back to setup"
          title="Back to setup"
        >
          <Home size={18} />
        </button>
        <button
          type="button"
          className="sideout-pill-btn"
          onClick={onUndo}
          disabled={!canUndo}
        >
          <Undo2 size={15} /> {lang === 'ja' ? '戻す' : 'Undo'}
        </button>
        <button type="button" className="sideout-play-again-btn" onClick={onPlayAgain}>
          {lang === 'ja' ? 'もう一度プレイ' : 'Play again'} <ArrowRight size={16} />
        </button>
      </div>
    </motion.div>
  );
}
