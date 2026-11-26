import { describe, expect, it } from 'vitest';
import {
  computeDuprRatings,
  formatRating,
  MIN_MATCHES_FOR_RATING,
} from './ratingEngine';
import type { Match, Player } from './types';

const makePlayer = (id: string, name: string): Player => ({
  id,
  name,
  skill_rating: null,
  avatar_color: '#1D4ED8',
  created_at: '2026-11-26T00:00:00Z',
});

const makeMatch = (id: string, seq: number, scoreA: number, scoreB: number): Match => ({
  id,
  session_id: null,
  round_number: null,
  court_number: null,
  game_type: 'doubles',
  scoring_mode: 'side_out',
  target_score: 11,
  win_by_two: true,
  status: 'completed',
  team_a_name: 'Team A',
  team_b_name: 'Team B',
  team_a_score: scoreA,
  team_b_score: scoreB,
  winner_team: scoreA > scoreB ? 'A' : 'B',
  started_at: `2026-11-26T0${seq}:00:00Z`,
  completed_at: `2026-11-26T0${seq}:15:00Z`,
  duration_seconds: 900,
  participants: [
    { match_id: id, player_id: 'a1', team: 'A', starting_side: 'right' },
    { match_id: id, player_id: 'a2', team: 'A', starting_side: 'left' },
    { match_id: id, player_id: 'b1', team: 'B', starting_side: 'right' },
    { match_id: id, player_id: 'b2', team: 'B', starting_side: 'left' },
  ],
  rallies: [],
  live_state: null,
});

describe('ratingEngine', () => {
  it('keeps players with no completed matches unrated (NR)', () => {
    const players = [makePlayer('p1', 'Alice'), makePlayer('p2', 'Bob')];
    const result = computeDuprRatings(players, []);
    expect(result.ratings.get('p1')?.rating).toBeNull();
    expect(result.ratings.get('p2')?.rating).toBeNull();
    expect(formatRating(result.ratings.get('p1')?.rating)).toBe('NR');
  });

  it('keeps a player unrated (NR) after 3 games, before reaching the 5-match threshold', () => {
    const players = [
      makePlayer('a1', 'A1'),
      makePlayer('a2', 'A2'),
      makePlayer('b1', 'B1'),
      makePlayer('b2', 'B2'),
    ];
    const threeMatches = [
      makeMatch('m1', 1, 11, 5),
      makeMatch('m2', 2, 11, 7),
      makeMatch('m3', 3, 9, 11),
    ];

    const result = computeDuprRatings(players, threeMatches);
    expect(MIN_MATCHES_FOR_RATING).toBe(5);
    expect(result.ratings.get('a1')?.gamesPlayed).toBe(3);
    expect(result.ratings.get('a1')?.rating).toBeNull();
    expect(formatRating(result.ratings.get('a1')?.rating)).toBe('NR');
  });

  it('unlocks rating with margin sensitivity once 5 matches are completed', () => {
    const players = [
      makePlayer('a1', 'A1'),
      makePlayer('a2', 'A2'),
      makePlayer('b1', 'B1'),
      makePlayer('b2', 'B2'),
    ];
    const fiveMatches = [
      makeMatch('m1', 1, 11, 3),
      makeMatch('m2', 2, 11, 4),
      makeMatch('m3', 3, 11, 5),
      makeMatch('m4', 4, 11, 4),
      makeMatch('m5', 5, 11, 2),
    ];

    const result = computeDuprRatings(players, fiveMatches);
    const a1 = result.ratings.get('a1')!;
    const b1 = result.ratings.get('b1')!;
    expect(a1.gamesPlayed).toBe(5);
    expect(a1.rating).toBeGreaterThan(3.0);
    expect(b1.rating).toBeLessThan(3.0);
    expect(a1.lastDelta).toBeGreaterThan(0);
    expect(b1.lastDelta).toBeLessThan(0);
  });
});
