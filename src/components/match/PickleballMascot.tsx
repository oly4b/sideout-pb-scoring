import { motion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';

export type MascotMood = 'idle' | 'serving' | 'scoring' | 'walking' | 'celebrating';

interface PickleballMascotProps {
  score?: number;
  mood?: MascotMood;
  facing?: 'left' | 'right';
  size?: number;
  showShadow?: boolean;
}

export function PickleballMascot({
  score,
  mood = 'serving',
  facing = 'right',
  size = 64,
  showShadow = true,
}: PickleballMascotProps) {
  const isCelebrating = mood === 'celebrating';
  const isScoring = mood === 'scoring';
  const isWalking = mood === 'walking';

  const prevScoreRef = useRef<number | undefined>(score);
  const [tickKey, setTickKey] = useState<number | null>(null);

  useEffect(() => {
    if (
      typeof score === 'number' &&
      typeof prevScoreRef.current === 'number' &&
      score > prevScoreRef.current
    ) {
      setTickKey((k) => (k ?? 0) + 1);
      const timer = window.setTimeout(() => setTickKey(null), 950);
      prevScoreRef.current = score;
      return () => window.clearTimeout(timer);
    }
    prevScoreRef.current = score;
  }, [score]);

  const bodyBounce = isCelebrating
    ? { y: [0, -14, 0], rotate: 0 }
    : isWalking
      ? { y: [0, -2, 0], rotate: [-1, 1, -1] }
      : isScoring
        ? { y: [0, -6, 0], rotate: 0 }
        : { y: [0, -2, 0], rotate: 0 };

  const bodyTransition = isCelebrating
    ? { duration: 1.15, repeat: Infinity, ease: 'easeInOut' as const }
    : isWalking
      ? { duration: 0.52, repeat: Infinity, ease: 'easeInOut' as const }
      : isScoring
        ? { duration: 0.4, ease: 'easeOut' as const }
        : { duration: 3.2, repeat: Infinity, ease: 'easeInOut' as const };

  const leafAnimate = isCelebrating
    ? { rotate: [8, 16, -6, -16, 8] }
    : isWalking
      ? { rotate: [4, -6, 4] }
      : isScoring
        ? { rotate: [0, 14, -8, 0] }
        : { rotate: [-3, 4, -3] };

  const leafTransition = isCelebrating
    ? { duration: 1.15, times: [0, 0.25, 0.5, 0.75, 1], repeat: Infinity, ease: 'easeInOut' as const }
    : isWalking
      ? { duration: 0.52, repeat: Infinity, ease: 'easeInOut' as const }
      : isScoring
        ? { duration: 0.45, ease: 'easeOut' as const }
        : { duration: 3.2, delay: 0.2, repeat: Infinity, ease: 'easeInOut' as const };

  return (
    <div
      style={{
        position: 'relative',
        width: size,
        height: size * 1.18,
        display: 'inline-flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'flex-end',
        pointerEvents: 'none',
        userSelect: 'none',
      }}
    >
      {/* Transient +1 score tick when player scores */}
      {tickKey !== null && (
        <motion.div
          key={tickKey}
          initial={{ scale: 0.72, y: 4, opacity: 0 }}
          animate={{
            scale: [0.72, 1.12, 1, 0.94],
            y: [4, -10, -18, -24],
            opacity: [0, 1, 1, 0],
          }}
          transition={{ duration: 0.92, times: [0, 0.22, 0.68, 1], ease: 'easeOut' }}
          style={{
            position: 'absolute',
            top: -size * 0.22,
            fontFamily: 'var(--font-display)',
            fontWeight: 900,
            fontSize: Math.max(15, size * 0.34),
            lineHeight: 1,
            color: '#bef264',
            textShadow: '0 2px 6px rgba(2, 6, 23, 0.9), 0 0 2px rgba(2, 6, 23, 0.95)',
            zIndex: 4,
            whiteSpace: 'nowrap',
          }}
        >
          +1
        </motion.div>
      )}

      {/* Ground shadow */}
      {showShadow && (
        <motion.div
          animate={
            isCelebrating
              ? { scaleX: [1.05, 0.65, 1.05], opacity: [0.44, 0.2, 0.44] }
              : { scaleX: [1, 0.94, 1], opacity: [0.36, 0.3, 0.36] }
          }
          transition={bodyTransition}
          style={{
            position: 'absolute',
            bottom: 0,
            width: size * 0.68,
            height: size * 0.14,
            borderRadius: '999px',
            background: 'rgba(2, 6, 23, 0.55)',
            filter: 'blur(2px)',
          }}
        />
      )}

      {/* Outer flip wrapper so Motion transform never conflicts with scaleX(-1) */}
      <div
        style={{
          display: 'inline-flex',
          transform: facing === 'left' ? 'scaleX(-1)' : undefined,
        }}
      >
        {/* Peach Character SVG */}
        <motion.svg
          viewBox="0 0 120 132"
          width={size}
          height={size * 1.1}
          animate={bodyBounce}
          transition={bodyTransition}
          style={{
            transformOrigin: '50% 90%',
            overflow: 'visible',
          }}
        >
        <defs>
          <radialGradient id="peach-body-grad" cx="38%" cy="30%" r="70%">
            <stop offset="0%" stopColor="#ffe4e6" />
            <stop offset="35%" stopColor="#ff9ebb" />
            <stop offset="75%" stopColor="#fb7185" />
            <stop offset="100%" stopColor="#e11d48" />
          </radialGradient>
          <linearGradient id="peach-leaf-grad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#a3e635" />
            <stop offset="100%" stopColor="#16a34a" />
          </linearGradient>
          <linearGradient id="peach-headband-grad" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#1b365d" />
            <stop offset="50%" stopColor="#264673" />
            <stop offset="100%" stopColor="#112440" />
          </linearGradient>
          <radialGradient id="peach-pickleball-grad" cx="35%" cy="32%" r="68%">
            <stop offset="0%" stopColor="#ecfccb" />
            <stop offset="32%" stopColor="#bef264" />
            <stop offset="72%" stopColor="#84cc16" />
            <stop offset="100%" stopColor="#4d7c0f" />
          </radialGradient>
        </defs>

        {/* Left leg & sneaker */}
        <motion.g
          animate={
            isCelebrating
              ? { y: [0, -3, 0], rotate: [4, 24, 4] }
              : isWalking
                ? { y: [0, -1.5, 0, 0, 0], rotate: [0, -7, 0, 7, 0] }
                : { y: 0, rotate: 0 }
          }
          transition={
            isCelebrating
              ? { duration: 1.15, repeat: Infinity, ease: 'easeInOut' }
              : isWalking
                ? { duration: 0.52, repeat: Infinity, ease: 'easeInOut' }
                : { duration: 0.2, ease: 'easeOut' }
          }
          style={{ transformOrigin: '44px 98px', transformBox: 'view-box' }}
        >
          <path d="M44 98 L42 113" stroke="#1e293b" strokeWidth="5.5" strokeLinecap="round" />
          <ellipse cx="39" cy="116" rx="10" ry="5.5" fill="#0f172a" />
          <path d="M31 117 Q39 121 47 117" stroke="#f8fafc" strokeWidth="2.5" strokeLinecap="round" fill="none" />
        </motion.g>

        {/* Right leg & sneaker */}
        <motion.g
          animate={
            isCelebrating
              ? { y: [0, -3, 0], rotate: [-4, -24, -4] }
              : isWalking
                ? { y: [0, 0, 0, -1.5, 0], rotate: [0, 7, 0, -7, 0] }
                : { y: 0, rotate: 0 }
          }
          transition={
            isCelebrating
              ? { duration: 1.15, repeat: Infinity, ease: 'easeInOut' }
              : isWalking
                ? { duration: 0.52, repeat: Infinity, ease: 'easeInOut' }
                : { duration: 0.2, ease: 'easeOut' }
          }
          style={{ transformOrigin: '72px 98px', transformBox: 'view-box' }}
        >
          <path d="M72 98 L74 113" stroke="#1e293b" strokeWidth="5.5" strokeLinecap="round" />
          <ellipse cx="77" cy="116" rx="10" ry="5.5" fill="#0f172a" />
          <path d="M69 117 Q77 121 85 117" stroke="#f8fafc" strokeWidth="2.5" strokeLinecap="round" fill="none" />
        </motion.g>

        {/* Peach stem & leaf at top cleft (leaf anchored at stem 59,19) */}
        <g transform="translate(59, 19) rotate(-12)">
          <motion.path
            d="M0 0 C8 -9, 21 -8, 25 0 C21 8, 8 9, 0 0 Z"
            fill="url(#peach-leaf-grad)"
            stroke="#15803d"
            strokeWidth="1.4"
            animate={leafAnimate}
            transition={leafTransition}
            style={{ originX: 0, originY: 0.5 }}
          />
        </g>
        <path
          d="M58 26 Q58 14 63 9"
          stroke="#78350f"
          strokeWidth="3.5"
          strokeLinecap="round"
          fill="none"
        />

        {/* Left arm (behind body so shoulder anchors cleanly at 20,68) */}
        <g transform="translate(20, 68)">
          <motion.g
            animate={
              isCelebrating
                ? { rotate: [28, 48, 28] }
                : isScoring
                  ? { rotate: [-25, -45, -20, -25] }
                  : { rotate: [-32, -25, -32] }
            }
            transition={{
              duration: isCelebrating ? 1.15 : isScoring ? 0.35 : 3.2,
              repeat: isScoring ? 0 : Infinity,
              ease: 'easeInOut',
            }}
            style={{ originX: 1, originY: 0.5 }}
          >
            <path d="M2 0 Q-7 1 -18 0" stroke="#1e293b" strokeWidth="4.6" strokeLinecap="round" fill="none" />
            <circle cx="-18" cy="0" r="2.8" fill="#1e293b" />
          </motion.g>
        </g>

        {/* Peach body with signature top cleft and soft tapered bottom */}
        <path
          d="M58 26
             C45 18, 20 26, 18 54
             C16 80, 38 100, 58 102
             C78 100, 100 80, 98 54
             C96 26, 71 18, 58 26 Z"
          fill="url(#peach-body-grad)"
          stroke="#be123c"
          strokeWidth="2"
        />

        {/* Subtle peach cleft crease */}
        <path
          d="M58 26 Q54 34 57 41"
          stroke="rgba(190, 18, 60, 0.32)"
          strokeWidth="2"
          strokeLinecap="round"
          fill="none"
        />

        {/* Soft specular highlight */}
        <ellipse
          cx="40"
          cy="38"
          rx="11"
          ry="6"
          transform="rotate(-28 40 38)"
          fill="rgba(255, 255, 255, 0.42)"
        />

        {/* Navy headband across brow */}
        <path
          d="M19 48 Q58 37 97 48 L95 38 Q58 27 21 38 Z"
          fill="url(#peach-headband-grad)"
          stroke="#0f172a"
          strokeWidth="1.5"
        />
        {/* Optic lime stripe accent on headband */}
        <path
          d="M21 43 Q58 32 95 43"
          stroke="#a3e635"
          strokeWidth="1.8"
          fill="none"
          opacity="0.9"
        />

        {/* Rosy cheeks */}
        <ellipse cx="36" cy="67" rx="5.5" ry="3.2" fill="#fb7185" opacity="0.55" />
        <ellipse cx="80" cy="67" rx="5.5" ry="3.2" fill="#fb7185" opacity="0.55" />

        {/* Facial expression */}
        {isCelebrating ? (
          <g>
            {/* Happy ^ ^ eyes */}
            <path
              d="M42 60 Q46 53 50 60"
              stroke="#0f172a"
              strokeWidth="3.2"
              strokeLinecap="round"
              fill="none"
            />
            <path
              d="M66 60 Q70 53 74 60"
              stroke="#0f172a"
              strokeWidth="3.2"
              strokeLinecap="round"
              fill="none"
            />
            {/* Big joyful open mouth */}
            <path
              d="M48 69 Q58 82 68 69 Z"
              fill="#0f172a"
              stroke="#0f172a"
              strokeWidth="2"
              strokeLinejoin="round"
            />
            <path d="M52 74 Q58 78 64 74" stroke="#fda4af" strokeWidth="2.5" strokeLinecap="round" fill="none" />
          </g>
        ) : (
          <g>
            {/* Cute eyes with shine */}
            <circle cx="47" cy="59" r="4.3" fill="#0f172a" />
            <circle cx="45.8" cy="57.5" r="1.4" fill="#ffffff" />
            <circle cx="69" cy="59" r="4.3" fill="#0f172a" />
            <circle cx="67.8" cy="57.5" r="1.4" fill="#ffffff" />
            {/* Confident smile */}
            <path
              d="M50 70 Q58 77 66 70"
              stroke="#0f172a"
              strokeWidth="2.9"
              strokeLinecap="round"
              fill="none"
            />
          </g>
        )}

        {/* Right arm holding pickleball sphere in front, anchored at 96,68 */}
        <g transform="translate(96, 68)">
          <motion.g
            animate={
              isCelebrating
                ? { rotate: [-28, -48, -28] }
                : isScoring
                  ? { rotate: [-36, -58, -28, -36] }
                  : { rotate: [-42, -34, -42] }
            }
            transition={{
              duration: isCelebrating ? 1.15 : isScoring ? 0.35 : 3.2,
              repeat: isScoring ? 0 : Infinity,
              ease: 'easeInOut',
            }}
            style={{ originX: 0, originY: 0.5 }}
          >
            <path d="M-2 0 Q7 -1 15 0" stroke="#1e293b" strokeWidth="4.6" strokeLinecap="round" fill="none" />
            {/* Hand gripping ball (drawn behind the ball so it doesn't poke through) */}
            <circle cx="15" cy="0" r="2.8" fill="#1e293b" />
            {/* Pickleball sphere (centered at y=0 so originY=0.5 aligns exactly with shoulder 0,0) */}
            <circle
              cx="23.5"
              cy="0"
              r="10.5"
              fill="url(#peach-pickleball-grad)"
              stroke="#1e293b"
              strokeWidth="1.8"
            />
            {/* Subtle sphere highlight */}
            <ellipse
              cx="20"
              cy="-5"
              rx="3.4"
              ry="2"
              transform="rotate(-25 20 -5)"
              fill="rgba(255, 255, 255, 0.36)"
            />
            {/* Shadowed pickleball holes */}
            <g>
              <circle cx="23" cy="0.5" r="2.1" fill="#1a2e05" opacity="0.72" />
              <circle cx="23.4" cy="0.9" r="1.4" fill="#0f172a" opacity="0.45" />

              <ellipse cx="18" cy="-2.5" rx="1.6" ry="1.9" fill="#1a2e05" opacity="0.68" />
              <ellipse cx="18.4" cy="-2.1" rx="1.0" ry="1.2" fill="#0f172a" opacity="0.4" />

              <ellipse cx="28.3" cy="-3.5" rx="1.5" ry="1.8" fill="#1a2e05" opacity="0.74" />
              <ellipse cx="28.6" cy="-3.1" rx="0.95" ry="1.1" fill="#0f172a" opacity="0.45" />

              <ellipse cx="18.7" cy="5.2" rx="1.8" ry="1.5" fill="#1a2e05" opacity="0.72" />
              <ellipse cx="19" cy="5.5" rx="1.1" ry="0.95" fill="#0f172a" opacity="0.45" />

              <ellipse cx="28.1" cy="4.8" rx="1.6" ry="1.5" fill="#1a2e05" opacity="0.76" />
              <ellipse cx="28.4" cy="5.1" rx="1.0" ry="0.95" fill="#0f172a" opacity="0.48" />
            </g>
          </motion.g>
        </g>
        </motion.svg>
      </div>
    </div>
  );
}
