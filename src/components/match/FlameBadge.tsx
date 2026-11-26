import { motion } from 'motion/react';

interface FlameBadgeProps {
  size?: number;
}

export function FlameBadge({ size = 28 }: FlameBadgeProps) {
  return (
    <motion.div
      initial={{ scale: 0, opacity: 0 }}
      animate={{ scale: [1, 1.08, 1], opacity: 1 }}
      exit={{ scale: 0, opacity: 0 }}
      transition={{
        scale: { duration: 0.9, repeat: Infinity, ease: 'easeInOut' },
        opacity: { duration: 0.2 },
      }}
      style={{
        width: size,
        height: size,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        filter: 'drop-shadow(0 0 8px rgba(251, 146, 60, 0.75))',
        pointerEvents: 'none',
      }}
      aria-hidden="true"
    >
      <svg viewBox="0 0 36 36" width={size} height={size}>
        <defs>
          <linearGradient id="flame-outer" x1="0%" y1="100%" x2="0%" y2="0%">
            <stop offset="0%" stopColor="#ea580c" />
            <stop offset="55%" stopColor="#f97316" />
            <stop offset="100%" stopColor="#facc15" />
          </linearGradient>
          <linearGradient id="flame-inner" x1="0%" y1="100%" x2="0%" y2="0%">
            <stop offset="0%" stopColor="#f97316" />
            <stop offset="100%" stopColor="#fef08a" />
          </linearGradient>
        </defs>
        <path
          d="M18 3 C20 9, 27 12, 27 21 C27 27.5, 22.8 32, 18 32 C13.2 32, 9 27.5, 9 21 C9 15, 13.5 11.5, 15 8 C15.8 10.5, 17 11.5, 17.5 11.5 C16.5 8, 17 5, 18 3 Z"
          fill="url(#flame-outer)"
        />
        <path
          d="M18.2 14 C19.5 17.5, 23 19.5, 23 24 C23 27.5, 20.8 30, 18 30 C15.2 30, 13 27.5, 13 24 C13 20.5, 15.8 18.5, 16.8 16.5 C17.3 18, 18 18.5, 18.2 14 Z"
          fill="url(#flame-inner)"
        />
      </svg>
    </motion.div>
  );
}
