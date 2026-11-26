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

  it('supports 1v1 singles rotation with minimum 3 players and fair sit-outs', () => {
    const players = makePlayers(3);
    const r1 = generateNextRound({
      format: 'singles',
      courtsCount: 2,
      sessionPlayers: players,
      previousMatches: [],
      nextRoundNumber: 1,
    });

    expect(r1.matches).toHaveLength(1);
    expect(r1.matches[0].teamA).toHaveLength(1);
    expect(r1.matches[0].teamB).toHaveLength(1);
    expect(r1.sitting_out).toHaveLength(1);

    const makeSinglesMatch = (
      id: string,
      roundNumber: number,
      pA: string,
      pB: string
    ): Match => ({
      id,
      session_id: 's1',
      round_number: roundNumber,
      court_number: 1,
      game_type: 'singles',
      scoring_mode: 'side_out',
      target_score: 11,
      win_by_two: true,
      status: 'completed',
      team_a_name: pA,
      team_b_name: pB,
      team_a_score: 11,
      team_b_score: 6,
      winner_team: 'A',
      started_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
      duration_seconds: 300,
      participants: [
        { match_id: id, player_id: pA, team: 'A', starting_side: 'right' },
        { match_id: id, player_id: pB, team: 'B', starting_side: 'right' },
      ],
      rallies: [],
      live_state: null,
    });

    const m1 = makeSinglesMatch('m1', 1, r1.matches[0].teamA[0], r1.matches[0].teamB[0]);
    const r2 = generateNextRound({
      format: 'singles',
      courtsCount: 2,
      sessionPlayers: players,
      previousMatches: [m1],
      nextRoundNumber: 2,
    });

    expect(r2.matches).toHaveLength(1);
    const r2Playing = new Set([...r2.matches[0].teamA, ...r2.matches[0].teamB]);
    expect(r2Playing.has(r1.sitting_out[0])).toBe(true);

    const m2 = makeSinglesMatch('m2', 2, r2.matches[0].teamA[0], r2.matches[0].teamB[0]);
    const r3 = generateNextRound({
      format: 'singles',
      courtsCount: 2,
      sessionPlayers: players,
      previousMatches: [m1, m2],
      nextRoundNumber: 3,
    });

    // After 3 rounds, all 3 players should have sat out once each
    const satOutSet = new Set([r1.sitting_out[0], r2.sitting_out[0], r3.sitting_out[0]]);
    expect(satOutSet.size).toBe(3);
  });

  it('assigns 2 courts in 1v1 singles with 5 players', () => {
    const players = makePlayers(5);
    const r1 = generateNextRound({
      format: 'singles',
      courtsCount: 2,
      sessionPlayers: players,
      previousMatches: [],
      nextRoundNumber: 1,
    });

    expect(r1.matches).toHaveLength(2);
    expect(r1.sitting_out).toHaveLength(1);
    for (const m of r1.matches) {
      expect(m.teamA).toHaveLength(1);
      expect(m.teamB).toHaveLength(1);
    }
  });

  it('allows 1 of 3 singles players to sit out for 1 game and matches remaining 2', () => {
    const players = makePlayers(3).map((p, idx) =>
      idx === 0 ? { ...p, active: false } : p
    );
    const r1 = generateNextRound({
      format: 'singles',
      courtsCount: 1,
      sessionPlayers: players,
      previousMatches: [],
      nextRoundNumber: 1,
    });

    expect(r1.matches).toHaveLength(1);
    expect(new Set([...r1.matches[0].teamA, ...r1.matches[0].teamB])).toEqual(
      new Set(['p2', 'p3'])
    );
  });
});
