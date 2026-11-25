import { describe, expect, it } from 'vitest';
import { generateNextRound } from './rotationEngine';
import type { Match, SessionPlayer } from './types';

function makePlayers(count: number): SessionPlayer[] {
  return Array.from({ length: count }, (_, i) => ({
    session_id: 's1',
    player_id: `p${i + 1}`,
    team_slot: Math.floor(i / 2),
    check_in_order: i,
    active: true,
  }));
}

describe('rotationEngine', () => {
  it('assigns 2 courts and rotates sit-outs fairly with 10 players', () => {
    const players = makePlayers(10);
    const r1 = generateNextRound({
      format: 'rotating_partners',
      courtsCount: 2,
      sessionPlayers: players,
      previousMatches: [],
      nextRoundNumber: 1,
    });

    expect(r1.matches).toHaveLength(2);
    expect(r1.sitting_out).toHaveLength(2);

    const prevMatches: Match[] = r1.matches.map((pm, idx) => ({
      id: `m${idx}`,
      session_id: 's1',
      round_number: 1,
      court_number: pm.court_number,
      game_type: 'doubles',
      scoring_mode: 'side_out',
      target_score: 11,
      win_by_two: true,
      status: 'completed',
      team_a_name: 'A',
      team_b_name: 'B',
      team_a_score: 11,
      team_b_score: 7,
      winner_team: 'A',
      started_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
      duration_seconds: 600,
      participants: [
        { match_id: `m${idx}`, player_id: pm.teamA[0], team: 'A', starting_side: 'right' },
        { match_id: `m${idx}`, player_id: pm.teamA[1], team: 'A', starting_side: 'left' },
        { match_id: `m${idx}`, player_id: pm.teamB[0], team: 'B', starting_side: 'right' },
        { match_id: `m${idx}`, player_id: pm.teamB[1], team: 'B', starting_side: 'left' },
      ],
      rallies: [],
      live_state: null,
    }));

    const r2 = generateNextRound({
      format: 'rotating_partners',
      courtsCount: 2,
      sessionPlayers: players,
      previousMatches: prevMatches,
      nextRoundNumber: 2,
    });

    // Players who sat out in round 1 MUST play in round 2
    const r2Playing = new Set(r2.matches.flatMap((m) => [...m.teamA, ...m.teamB]));
    for (const satOut of r1.sitting_out) {
      expect(r2Playing.has(satOut)).toBe(true);
    }
  });

  it('promotes Court 2 winners to Court 1 in King of the Court', () => {
    const players = makePlayers(8);
    const prevMatches: Match[] = [
      {
        id: 'c1',
        session_id: 's1',
        round_number: 1,
        court_number: 1,
        game_type: 'doubles',
        scoring_mode: 'side_out',
        target_score: 11,
        win_by_two: true,
        status: 'completed',
        team_a_name: 'A',
        team_b_name: 'B',
        team_a_score: 11,
        team_b_score: 5,
        winner_team: 'A',
        started_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
        duration_seconds: 500,
        participants: [
          { match_id: 'c1', player_id: 'p1', team: 'A', starting_side: 'right' },
          { match_id: 'c1', player_id: 'p2', team: 'A', starting_side: 'left' },
          { match_id: 'c1', player_id: 'p3', team: 'B', starting_side: 'right' },
          { match_id: 'c1', player_id: 'p4', team: 'B', starting_side: 'left' },
        ],
        rallies: [],
        live_state: null,
      },
      {
        id: 'c2',
        session_id: 's1',
        round_number: 1,
        court_number: 2,
        game_type: 'doubles',
        scoring_mode: 'side_out',
        target_score: 11,
        win_by_two: true,
        status: 'completed',
        team_a_name: 'A',
        team_b_name: 'B',
        team_a_score: 8,
        team_b_score: 11,
        winner_team: 'B',
        started_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
        duration_seconds: 500,
        participants: [
          { match_id: 'c2', player_id: 'p5', team: 'A', starting_side: 'right' },
          { match_id: 'c2', player_id: 'p6', team: 'A', starting_side: 'left' },
          { match_id: 'c2', player_id: 'p7', team: 'B', starting_side: 'right' },
          { match_id: 'c2', player_id: 'p8', team: 'B', starting_side: 'left' },
        ],
        rallies: [],
        live_state: null,
      },
    ];

    const r2 = generateNextRound({
      format: 'king_of_court',
      courtsCount: 2,
      sessionPlayers: players,
      previousMatches: prevMatches,
      nextRoundNumber: 2,
    });

    const court1Players = new Set([...r2.matches[0].teamA, ...r2.matches[0].teamB]);
    // Court 1 winners (p1, p2) + Court 2 winners (p7, p8) should now play on Court 1
    expect(court1Players).toEqual(new Set(['p1', 'p2', 'p7', 'p8']));
  });
});
