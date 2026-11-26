import type { LiveGameState } from '../../shared/types';

let audioCtx: AudioContext | null = null;

async function ensureReadyAudioContext(): Promise<AudioContext | null> {
  if (typeof window === 'undefined') return null;
  const Ctx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return null;
  if (!audioCtx) {
    audioCtx = new Ctx();
  }
  if (audioCtx.state === 'suspended') {
    try {
      await audioCtx.resume();
    } catch {
      return null;
    }
  }
  return audioCtx;
}

function scheduleTone(
  ctx: AudioContext,
  freq: number,
  startOffset: number,
  duration: number,
  type: OscillatorType,
  peakGain: number
): void {
  const now = ctx.currentTime + startOffset;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type = type;
  osc.frequency.setValueAtTime(freq, now);

  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(peakGain, now + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

  osc.connect(gain);
  gain.connect(ctx.destination);

  osc.start(now);
  osc.stop(now + duration + 0.02);
}

/** Plays synthesized Web Audio cues for rally outcomes (point, 2nd server, side-out, or victory fanfare). */
export async function playRallySound(nextState: LiveGameState): Promise<void> {
  const ctx = await ensureReadyAudioContext();
  if (!ctx) return;

  if (nextState.winnerTeam) {
    // Celebratory victory fanfare arpeggio (C5 -> E5 -> G5 -> C6)
    scheduleTone(ctx, 523.25, 0.01, 0.14, 'triangle', 0.24);
    scheduleTone(ctx, 659.25, 0.1, 0.14, 'triangle', 0.24);
    scheduleTone(ctx, 783.99, 0.19, 0.16, 'triangle', 0.26);
    scheduleTone(ctx, 1046.5, 0.29, 0.34, 'sine', 0.28);
    return;
  }

  const lastEvent = nextState.rallies[nextState.rallies.length - 1];
  if (!lastEvent) return;

  if (lastEvent.event_type === 'side_out') {
    // Distinct descending possession-change cue (G4 -> C4)
    scheduleTone(ctx, 392.0, 0.01, 0.12, 'triangle', 0.24);
    scheduleTone(ctx, 261.63, 0.09, 0.2, 'triangle', 0.26);
    return;
  }

  if (lastEvent.event_type === 'server_change') {
    // Distinct 2nd server double-tap cue (two crisp A4 pulses)
    scheduleTone(ctx, 440.0, 0.01, 0.08, 'sine', 0.22);
    scheduleTone(ctx, 440.0, 0.1, 0.1, 'sine', 0.22);
    return;
  }

  // Point scored: distinct chime per team
  if (lastEvent.rally_winner === 'A') {
    // Team 1 / A: bright ascending major third (C5 -> E5)
    scheduleTone(ctx, 523.25, 0.01, 0.11, 'sine', 0.24);
    scheduleTone(ctx, 659.25, 0.075, 0.17, 'sine', 0.26);
  } else {
    // Team 2 / B: distinct higher fourth chime (D5 -> G5)
    scheduleTone(ctx, 587.33, 0.01, 0.11, 'triangle', 0.22);
    scheduleTone(ctx, 783.99, 0.075, 0.17, 'triangle', 0.25);
  }
}

/** Plays a short descending Web Audio cue when a rally is undone. */
export async function playUndoSound(): Promise<void> {
  const ctx = await ensureReadyAudioContext();
  if (!ctx) return;
  scheduleTone(ctx, 349.23, 0.01, 0.08, 'sine', 0.16);
  scheduleTone(ctx, 293.66, 0.06, 0.1, 'sine', 0.14);
}
