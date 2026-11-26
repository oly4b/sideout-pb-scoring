import { computeDuprRatings } from './ratingEngine';
import type { Match, PairRecord, Player, PlayerDetailStats, PlayerStanding } from './types';

/** Computes overall leaderboard standings (W-L, win %, PF, PA, point diff, streak, and rating) across completed matches. */
export function computeStandings(players: Player[], matches: Match[]): PlayerStanding[] {
  const { ratings } = computeDuprRatings(players, matches);
  const completed = matches
    .filter((m) => m.status === 'completed' && m.winner_team !== null)
    .sort((a, b) => {
      const tA = new Date(a.completed_at ?? a.started_at).getTime();
      const tB = new Date(b.completed_at ?? b.started_at).getTime();
      return tA - tB;
    });

  const statsMap = new Map<string, PlayerStanding>();
  for (const p of players) {
    const r = ratings.get(p.id);
    statsMap.set(p.id, {
      player_id: p.id,
      name: p.name,
      avatar_color: p.avatar_color,
      skill_rating: r ? r.rating : null,
      rating_delta: r ? r.lastDelta : null,
      games_played: 0,
      wins: 0,
      losses: 0,
      win_pct: 0,
      points_for: 0,
      points_against: 0,
      point_diff: 0,
      streak: 0,
    });
  }

  for (const m of completed) {
    for (const part of m.participants) {
      const s = statsMap.get(part.player_id);
      if (!s) continue;

      const won = m.winner_team === part.team;
      const pf = part.team === 'A' ? m.team_a_score : m.team_b_score;
      const pa = part.team === 'A' ? m.team_b_score : m.team_a_score;

      s.games_played += 1;
      if (won) {
        s.wins += 1;
        s.streak = s.streak >= 0 ? s.streak + 1 : 1;
      } else {
        s.losses += 1;
        s.streak = s.streak <= 0 ? s.streak - 1 : -1;
      }
      s.points_for += pf;
      s.points_against += pa;
      s.point_diff = s.points_for - s.points_against;
      s.win_pct = s.games_played > 0 ? Math.round((s.wins / s.games_played) * 1000) / 10 : 0;
    }
  }

  return Array.from(statsMap.values()).sort((a, b) => {
    if (b.wins !== a.wins) return b.wins - a.wins;
    if (b.win_pct !== a.win_pct) return b.win_pct - a.win_pct;
    if (b.point_diff !== a.point_diff) return b.point_diff - a.point_diff;
    return b.points_for - a.points_for;
  });
}

/** Computes detailed head-to-head opponent records, doubles partner records, and recent matches for a player. */
export function computePlayerDetailStats(
  playerId: string,
  players: Player[],
  matches: Match[]
): PlayerDetailStats | null {
  const playerMap = new Map(players.map((p) => [p.id, p]));
  const standings = computeStandings(players, matches);
  const base = standings.find((s) => s.player_id === playerId);
  if (!base) return null;

  const teammateMap = new Map<string, PairRecord>();
  const opponentMap = new Map<string, PairRecord>();

  const playerMatches = matches
    .filter((m) => m.participants.some((p) => p.player_id === playerId))
    .sort((a, b) => {
      const tA = new Date(a.completed_at ?? a.started_at).getTime();
      const tB = new Date(b.completed_at ?? b.started_at).getTime();
      return tB - tA;
    });

  for (const m of playerMatches) {
    if (m.status !== 'completed' || !m.winner_team) continue;
    const myPart = m.participants.find((p) => p.player_id === playerId);
    if (!myPart) continue;

    const won = m.winner_team === myPart.team;
    const pf = myPart.team === 'A' ? m.team_a_score : m.team_b_score;
    const pa = myPart.team === 'A' ? m.team_b_score : m.team_a_score;
    const diff = pf - pa;

    for (const other of m.participants) {
      if (other.player_id === playerId) continue;
      const otherPlayer = playerMap.get(other.player_id);
      if (!otherPlayer) continue;

      const targetMap = other.team === myPart.team ? teammateMap : opponentMap;
      const rec = targetMap.get(other.player_id) ?? {
        other_player_id: other.player_id,
        other_name: otherPlayer.name,
        other_color: otherPlayer.avatar_color,
        games: 0,
        wins: 0,
        losses: 0,
        win_pct: 0,
        point_diff: 0,
      };
      rec.games += 1;
      if (won) rec.wins += 1;
      else rec.losses += 1;
      rec.point_diff += diff;
      rec.win_pct = Math.round((rec.wins / rec.games) * 1000) / 10;
      targetMap.set(other.player_id, rec);
    }
  }

  const sortPairs = (a: PairRecord, b: PairRecord) =>
    b.games !== a.games ? b.games - a.games : b.win_pct - a.win_pct;

  return {
    ...base,
    teammates: Array.from(teammateMap.values()).sort(sortPairs),
    opponents: Array.from(opponentMap.values()).sort(sortPairs),
    recent_matches: playerMatches.slice(0, 15),
  };
}
