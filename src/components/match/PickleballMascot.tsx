import { motion } from 'motion/react';

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

  const bodyBounce = isCelebrating
    ? { y: [0, -11, 0], scaleY: [1, 1.06, 1], scaleX: [1, 0.95, 1], rotate: 0 }
    : isWalking
      ? {
          y: [0, -4, 0, -4, 0],
          rotate: [0, -3.5, 0, 3.5, 0],
          scaleY: [1, 0.97, 1, 0.97, 1],
          scaleX: [1, 1.02, 1, 1.02, 1],
        }
      : isScoring
        ? { y: [0, -8, 0], scaleY: [1, 1.05, 1], scaleX: [1, 0.97, 1], rotate: 0 }
        : { y: [0, -2.5, 0], scaleY: [1, 0.98, 1], scaleX: [1, 1.015, 1], rotate: 0 };

  const bodyTransition = isCelebrating
    ? { duration: 0.72, repeat: Infinity, ease: 'easeInOut' as const }
    : isWalking
      ? { duration: 0.36, repeat: Infinity, ease: 'easeInOut' as const }
      : isScoring
        ? { duration: 0.36, ease: 'easeOut' as const }
        : { duration: 1.8, repeat: Infinity, ease: 'easeInOut' as const };

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
      {/* Floating score number above head */}
      {typeof score === 'number' && (
        <motion.div
          key={score}
          initial={{ scale: 0.75, y: 4, opacity: 0.6 }}
          animate={{ scale: 1, y: 0, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 420, damping: 22 }}
          style={{
            position: 'absolute',
            top: -size * 0.24,
            fontFamily: 'var(--font-display)',
            fontWeight: 900,
            fontSize: Math.max(15, size * 0.34),
            lineHeight: 1,
            color: '#ffffff',
            textShadow: '0 2px 4px rgba(2, 6, 23, 0.85), 0 0 2px rgba(2, 6, 23, 0.95)',
            zIndex: 3,
          }}
        >
          {score}
        </motion.div>
      )}

      {/* Ground shadow */}
      {showShadow && (
        <motion.div
          animate={
            isCelebrating
              ? { scaleX: [1.05, 0.72, 1.05], opacity: [0.45, 0.22, 0.45] }
              : { scaleX: [1, 0.92, 1], opacity: [0.38, 0.3, 0.38] }
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
          transform: facing === 'left' ? 'scaleX(-1)' : undefined,
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
          <linearGradient id="peach-paddle-grad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#bef264" />
            <stop offset="100%" stopColor="#65a30d" />
          </linearGradient>
        </defs>

        {/* Left leg & sneaker */}
        <motion.g
          animate={
            isWalking
              ? { y: [0, -5, 0, 1.5, 0], rotate: [0, -16, 0, 16, 0] }
              : { y: 0, rotate: 0 }
          }
          transition={
            isWalking
              ? { duration: 0.36, repeat: Infinity, ease: 'easeInOut' }
              : { duration: 0.2, ease: 'easeOut' }
          }
          style={{ transformOrigin: '44px 98px' }}
        >
          <path d="M44 98 L42 113" stroke="#1e293b" strokeWidth="5.5" strokeLinecap="round" />
          <ellipse cx="39" cy="116" rx="10" ry="5.5" fill="#0f172a" />
          <path d="M31 117 Q39 121 47 117" stroke="#f8fafc" strokeWidth="2.5" strokeLinecap="round" fill="none" />
        </motion.g>

        {/* Right leg & sneaker */}
        <motion.g
          animate={
            isWalking
              ? { y: [0, 1.5, 0, -5, 0], rotate: [0, 16, 0, -16, 0] }
              : { y: 0, rotate: 0 }
          }
          transition={
            isWalking
              ? { duration: 0.36, repeat: Infinity, ease: 'easeInOut' }
              : { duration: 0.2, ease: 'easeOut' }
          }
          style={{ transformOrigin: '72px 98px' }}
        >
          <path d="M72 98 L74 113" stroke="#1e293b" strokeWidth="5.5" strokeLinecap="round" />
          <ellipse cx="77" cy="116" rx="10" ry="5.5" fill="#0f172a" />
          <path d="M69 117 Q77 121 85 117" stroke="#f8fafc" strokeWidth="2.5" strokeLinecap="round" fill="none" />
        </motion.g>

        {/* Fluttering headband tails (behind head on left) */}
        <motion.g
          animate={{ rotate: [-5, 7, -5] }}
          transition={{ duration: isCelebrating ? 0.45 : 1.4, repeat: Infinity, ease: 'easeInOut' }}
          style={{ transformOrigin: '24px 43px' }}
        >
          <path
            d="M25 41 C12 37, 5 44, 1 50 C9 49, 18 46, 25 45 Z"
            fill="#112440"
          />
          <path
            d="M25 45 C14 47, 7 54, 5 60 C13 57, 20 52, 26 48 Z"
            fill="#264673"
          />
        </motion.g>

        {/* Peach stem & leaf at top cleft */}
        <path
          d="M58 26 Q58 14 63 9"
          stroke="#78350f"
          strokeWidth="3.5"
          strokeLinecap="round"
          fill="none"
        />
        <motion.path
          d="M59 20 C67 8, 82 10, 84 20 C76 26, 65 25, 59 20 Z"
          fill="url(#peach-leaf-grad)"
          stroke="#15803d"
          strokeWidth="1.4"
          animate={{ rotate: [-3, 4, -3] }}
          transition={{ duration: 2.2, repeat: Infinity, ease: 'easeInOut' }}
          style={{ transformOrigin: '59px 20px' }}
        />

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

        {/* Paddle arm & optic-lime pickleball paddle */}
        <motion.g
          animate={
            isCelebrating
              ? { rotate: [-14, 18, -14] }
              : isScoring
                ? { rotate: [0, -28, 6, 0] }
                : { rotate: [-3, 5, -3] }
          }
          transition={{
            duration: isCelebrating ? 0.55 : isScoring ? 0.35 : 2.1,
            repeat: isScoring ? 0 : Infinity,
            ease: 'easeInOut',
          }}
          style={{ transformOrigin: '88px 72px' }}
        >
          <path d="M88 70 L99 65" stroke="#1e293b" strokeWidth="4.5" strokeLinecap="round" />
          <rect
            x="96"
            y="59"
            width="5"
            height="12"
            rx="2.5"
            transform="rotate(20 98 65)"
            fill="#1e293b"
          />
          <ellipse
            cx="104"
            cy="51"
            rx="10.5"
            ry="13"
            transform="rotate(20 104 51)"
            fill="url(#peach-paddle-grad)"
            stroke="#1e293b"
            strokeWidth="2.2"
          />
          <circle cx="104" cy="51" r="2.2" fill="#1e293b" opacity="0.35" />
        </motion.g>
      </motion.svg>
    </div>
  );
}
