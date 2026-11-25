import { describe, expect, it } from 'vitest';
import {
  computeMomentum,
  createInitialLiveState,
  formatScoreCallout,
  getActiveServerPlayerId,
  getActiveServerSide,
  isGamePoint,
  recordRally,
  redoLastRally,
  undoLastRally,
} from './pickleballEngine';

describe('pickleballEngine', () => {
  it('starts doubles side-out at 0-0-2 with right-side player serving', () => {
    const state = createInitialLiveState({
      gameType: 'doubles',
      scoringMode: 'side_out',
      targetScore: 11,
      winByTwo: true,
      initialServingTeam: 'A',
      teamAPlayers: ['A1', 'A2'],
      teamBPlayers: ['B1', 'B2'],
    });

    expect(formatScoreCallout(state)).toBe('0 - 0 - 2');
    expect(getActiveServerSide(state)).toBe('right');
    expect(getActiveServerPlayerId(state)).toBe('A1');
  });

  it('scores a point, swaps boxes, and transitions from 0-0-2 directly to side-out on fault', () => {
    let s = createInitialLiveState({
      gameType: 'doubles',
      scoringMode: 'side_out',
      targetScore: 11,
      winByTwo: true,
      initialServingTeam: 'A',
      teamAPlayers: ['A1', 'A2'],
      teamBPlayers: ['B1', 'B2'],
    });

    // Team A scores -> 1-0-2, A1 & A2 swap boxes, A1 now serves from left
    s = recordRally(s, 'A', 'm1');
    expect(formatScoreCallout(s)).toBe('1 - 0 - 2');
    expect(s.positions.teamA).toEqual({ right: 'A2', left: 'A1' });
    expect(getActiveServerSide(s)).toBe('left');
    expect(getActiveServerPlayerId(s)).toBe('A1');

    // Team B wins rally -> side-out (because opening server was server 2) -> 0-1-1, B1 serves from right
    s = recordRally(s, 'B', 'm1');
    expect(s.servingTeam).toBe('B');
    expect(s.serverNumber).toBe(1);
    expect(formatScoreCallout(s)).toBe('0 - 1 - 1');
    expect(getActiveServerSide(s)).toBe('right');
    expect(getActiveServerPlayerId(s)).toBe('B1');

    // Team B loses rally on Server 1 -> Server 2 (B2 serves from left)
    s = recordRally(s, 'A', 'm1');
    expect(s.servingTeam).toBe('B');
    expect(s.serverNumber).toBe(2);
    expect(formatScoreCallout(s)).toBe('0 - 1 - 2');
    expect(getActiveServerSide(s)).toBe('left');
    expect(getActiveServerPlayerId(s)).toBe('B2');
  });

  it('enforces win-by-2 at deuce (10-10 -> 11-10 not over -> 12-10 over)', () => {
    let s = createInitialLiveState({
      gameType: 'singles',
      scoringMode: 'rally',
      targetScore: 11,
      winByTwo: true,
      initialServingTeam: 'A',
      teamAPlayers: ['A1', null],
      teamBPlayers: ['B1', null],
    });

    for (let i = 0; i < 10; i++) {
      s = recordRally(s, 'A', 'm2');
      s = recordRally(s, 'B', 'm2');
    }
    expect(s.teamAScore).toBe(10);
    expect(s.teamBScore).toBe(10);
    expect(s.winnerTeam).toBeNull();

    s = recordRally(s, 'A', 'm2');
    expect(s.teamAScore).toBe(11);
    expect(s.winnerTeam).toBeNull();
    expect(isGamePoint(s)).toBe('A');

    s = recordRally(s, 'A', 'm2');
    expect(s.teamAScore).toBe(12);
    expect(s.winnerTeam).toBe('A');
  });

  it('supports deterministic undo and redo with momentum calculation', () => {
    let s = createInitialLiveState({
      gameType: 'doubles',
      scoringMode: 'side_out',
      targetScore: 11,
      winByTwo: true,
      initialServingTeam: 'A',
      teamAPlayers: ['A1', 'A2'],
      teamBPlayers: ['B1', 'B2'],
    });

    s = recordRally(s, 'A', 'm3');
    s = recordRally(s, 'A', 'm3');
    expect(s.teamAScore).toBe(2);
    expect(computeMomentum(s.rallies).streakCount).toBe(2);

    s = undoLastRally(s, 'A', ['A1', 'A2'], ['B1', 'B2']);
    expect(s.teamAScore).toBe(1);
    expect(s.positions.teamA).toEqual({ right: 'A2', left: 'A1' });

    s = redoLastRally(s);
    expect(s.teamAScore).toBe(2);
    expect(s.positions.teamA).toEqual({ right: 'A1', left: 'A2' });
  });
});
