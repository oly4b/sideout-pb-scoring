import { describe, expect, it } from 'vitest';
import { computeDuprRatings, formatRating } from './ratingEngine';
import type { Match, Player } from './types';

const makePlayer = (id: string, name: string): Player => ({
  id,
  name,
  skill_rating: null,
  avatar_color: '#1D4ED8',
  created_at: '2026-11-26T00:00:00Z',
});

describe('ratingEngine', () => {
  it('keeps players with no completed matches unrated (NR)', () => {
    const players = [makePlayer('p1', 'Alice'), makePlayer('p2', 'Bob')];
    const result = computeDuprRatings(players, []);
    expect(result.ratings.get('p1')?.rating).toBeNull();
    expect(result.ratings.get('p2')?.rating).toBeNull();
    expect(formatRating(result.ratings.get('p1')?.rating)).toBe('NR');
  });

  it('updates ratings with margin sensitivity after a completed match', () => {
    const players = [
      makePlayer('a1', 'A1'),
      makePlayer('a2', 'A2'),
      makePlayer('b1', 'B1'),
      makePlayer('b2', 'B2'),
    ];
    const match: Match = {
      id: 'm1',
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
      team_a_score: 11,
      team_b_score: 3,
      winner_team: 'A',
      started_at: '2026-11-26T01:00:00Z',
      completed_at: '2026-11-26T01:15:00Z',
      duration_seconds: 900,
      participants: [
        { match_id: 'm1', player_id: 'a1', team: 'A', starting_side: 'right' },
        { match_id: 'm1', player_id: 'a2', team: 'A', starting_side: 'left' },
        { match_id: 'm1', player_id: 'b1', team: 'B', starting_side: 'right' },
        { match_id: 'm1', player_id: 'b2', team: 'B', starting_side: 'left' },
      ],
      rallies: [],
      live_state: null,
    };

    const result = computeDuprRatings(players, [match]);
    const a1 = result.ratings.get('a1')!;
    const b1 = result.ratings.get('b1')!;
    expect(a1.rating).toBeGreaterThan(3.0);
    expect(b1.rating).toBeLessThan(3.0);
    expect(a1.lastDelta).toBeGreaterThan(0);
    expect(b1.lastDelta).toBeLessThan(0);
    expect(result.matchDeltas.get('m1')?.teamADelta).toBeGreaterThan(0);
  });
});
