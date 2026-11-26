import type { Match, Player } from './types';

export interface PlayerRatingState {
  rating: number | null;
  lastDelta: number | null;
  gamesPlayed: number;
}

export interface MatchRatingDelta {
  teamADelta: number;
  teamBDelta: number;
  playerDeltas: Record<string, number>;
}

export interface DuprRatingResult {
  ratings: Map<string, PlayerRatingState>;
  matchDeltas: Map<string, MatchRatingDelta>;
}

const BASELINE_RATING = 3.0;
const SCALE_FACTOR = 0.85;
const MIN_RATING = 2.0;
const MAX_RATING = 8.0;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function clampRating(n: number): number {
  return round2(Math.min(MAX_RATING, Math.max(MIN_RATING, n)));
}

function getKFactor(gamesPlayed: number): number {
  if (gamesPlayed < 5) return 0.35;
  if (gamesPlayed < 15) return 0.22;
  return 0.12;
}

export function formatRating(rating: number | null | undefined): string {
  return typeof rating === 'number' && Number.isFinite(rating) ? rating.toFixed(2) : 'NR';
}

export function computeDuprRatings(
  players: Player[],
  matches: Match[]
): DuprRatingResult {
  const ratings = new Map<string, PlayerRatingState>();
  for (const p of players) {
    ratings.set(p.id, {
      rating: null,
      lastDelta: null,
      gamesPlayed: 0,
    });
  }

  const completed = matches
    .filter((m) => m.status === 'completed' && m.winner_team !== null)
    .sort((a, b) => {
      const tA = new Date(a.completed_at ?? a.started_at).getTime();
      const tB = new Date(b.completed_at ?? b.started_at).getTime();
      return tA - tB;
    });

  const matchDeltas = new Map<string, MatchRatingDelta>();

  for (const m of completed) {
    const teamAIds = m.participants.filter((p) => p.team === 'A').map((p) => p.player_id);
    const teamBIds = m.participants.filter((p) => p.team === 'B').map((p) => p.player_id);
    if (teamAIds.length === 0 || teamBIds.length === 0) continue;

    // For unrated players in their first match, seed internal calculation at the court's rated avg or 3.50
    const allRatedOnCourt = [...teamAIds, ...teamBIds]
      .map((id) => ratings.get(id)?.rating)
      .filter((r): r is number => typeof r === 'number');
    const courtFallback =
      allRatedOnCourt.length > 0
        ? allRatedOnCourt.reduce((acc, r) => acc + r, 0) / allRatedOnCourt.length
        : BASELINE_RATING;

    const getEffective = (id: string) => ratings.get(id)?.rating ?? courtFallback;

    const teamARating =
      teamAIds.reduce((sum, id) => sum + getEffective(id), 0) / teamAIds.length;
    const teamBRating =
      teamBIds.reduce((sum, id) => sum + getEffective(id), 0) / teamBIds.length;

    const expectedA = 1 / (1 + Math.pow(10, -(teamARating - teamBRating) / SCALE_FACTOR));
    const expectedB = 1 - expectedA;

    const totalPoints = Math.max(1, m.team_a_score + m.team_b_score);
    const winA = m.winner_team === 'A' ? 1 : 0;
    const winB = m.winner_team === 'B' ? 1 : 0;

    // DUPR-style blend: 55% match outcome + 45% point-share performance
    const actualA = 0.55 * winA + 0.45 * (m.team_a_score / totalPoints);
    const actualB = 0.55 * winB + 0.45 * (m.team_b_score / totalPoints);

    const playerDeltas: Record<string, number> = {};
    let sumDeltaA = 0;
    let sumDeltaB = 0;

    for (const id of teamAIds) {
      const state = ratings.get(id) ?? { rating: null, lastDelta: null, gamesPlayed: 0 };
      const k = getKFactor(state.gamesPlayed);
      const prev = state.rating ?? courtFallback;
      const delta = round2(k * (actualA - expectedA));
      const nextRating = clampRating(prev + delta);
      const actualDelta = round2(nextRating - prev);
      ratings.set(id, {
        rating: nextRating,
        lastDelta: actualDelta,
        gamesPlayed: state.gamesPlayed + 1,
      });
      playerDeltas[id] = actualDelta;
      sumDeltaA += actualDelta;
    }

    for (const id of teamBIds) {
      const state = ratings.get(id) ?? { rating: null, lastDelta: null, gamesPlayed: 0 };
      const k = getKFactor(state.gamesPlayed);
      const prev = state.rating ?? courtFallback;
      const delta = round2(k * (actualB - expectedB));
      const nextRating = clampRating(prev + delta);
      const actualDelta = round2(nextRating - prev);
      ratings.set(id, {
        rating: nextRating,
        lastDelta: actualDelta,
        gamesPlayed: state.gamesPlayed + 1,
      });
      playerDeltas[id] = actualDelta;
      sumDeltaB += actualDelta;
    }

    matchDeltas.set(m.id, {
      teamADelta: round2(sumDeltaA / teamAIds.length),
      teamBDelta: round2(sumDeltaB / teamBIds.length),
      playerDeltas,
    });
  }

  return { ratings, matchDeltas };
}
