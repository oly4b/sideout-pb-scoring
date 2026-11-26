import { AnimatePresence, motion } from 'motion/react';

interface RollingNumberProps {
  value: number;
  className?: string;
  style?: React.CSSProperties;
}

export function RollingNumber({ value, className, style }: RollingNumberProps) {
  return (
    <span
      className={className}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        position: 'relative',
        lineHeight: 1,
        ...style,
      }}
    >
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={value}
          initial={{ y: '65%', opacity: 0 }}
          animate={{ y: '0%', opacity: 1 }}
          exit={{ y: '-65%', opacity: 0 }}
          transition={{ type: 'spring', stiffness: 420, damping: 30 }}
          style={{ display: 'inline-block' }}
        >
          {value}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}
