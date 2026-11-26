import type {
  CourtPositions,
  GameType,
  LiveGameState,
  RallyEvent,
  RallyEventType,
  ScoringMode,
  TargetScore,
  TeamId,
} from './types';

export interface CreateLiveStateOptions {
  gameType: GameType;
  scoringMode: ScoringMode;
  targetScore: TargetScore;
  winByTwo: boolean;
  initialServingTeam?: TeamId;
  teamAPlayers: [string | null, string | null]; // [right, left]
  teamBPlayers: [string | null, string | null]; // [right, left]
}

export function createInitialLiveState(opts: CreateLiveStateOptions): LiveGameState {
  const servingTeam: TeamId = opts.initialServingTeam ?? 'A';
  // Official pickleball doubles side-out rule: game starts 0-0-2 (only 1 server on opening possession)
  const serverNumber: 1 | 2 =
    opts.gameType === 'doubles' && opts.scoringMode === 'side_out' ? 2 : 1;

  return {
    gameType: opts.gameType,
    scoringMode: opts.scoringMode,
    targetScore: opts.targetScore,
    winByTwo: opts.winByTwo,
    teamAScore: 0,
    teamBScore: 0,
    servingTeam,
    serverNumber,
    positions: {
      teamA: {
        right: opts.teamAPlayers[0] ?? null,
        left: opts.gameType === 'doubles' ? (opts.teamAPlayers[1] ?? null) : null,
      },
      teamB: {
        right: opts.teamBPlayers[0] ?? null,
        left: opts.gameType === 'doubles' ? (opts.teamBPlayers[1] ?? null) : null,
      },
    },
    winnerTeam: null,
    isFirstServeOfGame: true,
    rallies: [],
    redoStack: [],
  };
}

export function formatScoreCallout(state: LiveGameState): string {
  const servingScore = state.servingTeam === 'A' ? state.teamAScore : state.teamBScore;
  const receivingScore = state.servingTeam === 'A' ? state.teamBScore : state.teamAScore;

  if (state.gameType === 'doubles' && state.scoringMode === 'side_out') {
    return `${servingScore} - ${receivingScore} - ${state.serverNumber}`;
  }
  return `${servingScore} - ${receivingScore}`;
}

export function getActiveServerSide(state: LiveGameState): 'right' | 'left' {
  const servingScore = state.servingTeam === 'A' ? state.teamAScore : state.teamBScore;
  // In pickleball, server 1 (and singles server) serves from right on even score, left on odd score.
  // For doubles, the player currently in the right box serves on even score; after each point the serving team swaps boxes,
  // so the server's side is always right when serving team has even score (if server 1 started right) or tracked directly via box swaps.
  // Specifically:
  // - On side-out (new serving team starts as Server 1): right-side player ALWAYS serves first!
  // - If Server 1 scores, serving team swaps boxes -> Server 1 is now on left and serves from left.
  // - If Server 1 faults -> Server 2 serves from the opposite box (whichever box Server 2 is currently in).
  // Let's derive exact active server side from box swaps + server number!
  if (state.gameType === 'singles') {
    return servingScore % 2 === 0 ? 'right' : 'left';
  }
  // In doubles, right box is the "even" court for the starting server.
  // Notice: whenever a side-out happens (or game starts at 0-0-2), the player currently in the RIGHT box serves!
  // Wait: if Server 1 started in RIGHT and scored k points before faulting:
  //   - k even -> Server 1 is in RIGHT, so Server 2 is in LEFT!
  //   - k odd -> Server 1 is in LEFT, so Server 2 is in RIGHT!
  // Even simpler: track parity of points won during this possession, OR check score parity?
  // Careful: in side-out doubles, at 0-0-2 (start of game), Team A has score 0 (even) and server 2 serves from RIGHT!
  // Wait — after Team A loses serve at 0-0-2, Team B has score 0 (even), server 1 serves from RIGHT.
  // Whenever a team's score is EVEN, the player who started on RIGHT is on RIGHT; when ODD, that player is on LEFT.
  // Wait: if Team A won 1 point on opening 0-0-2, score is 1 (odd), they swapped, so that same server is now on LEFT.
  // Let's compute active server side cleanly by inspecting the current possession in rallies!
  return deriveDoublesServerSide(state);
}

function deriveDoublesServerSide(state: LiveGameState): 'right' | 'left' {
  // Walk backwards to find the start of the current serving team's possession
  let pointsThisPossession = 0;
  let server1Points = 0;
  let sawServerChange = false;

  for (let i = state.rallies.length - 1; i >= 0; i--) {
    const ev = state.rallies[i];
    if (ev.event_type === 'side_out') {
      break;
    }
    if (ev.event_type === 'server_change') {
      sawServerChange = true;
    } else if (ev.event_type === 'point') {
      pointsThisPossession++;
      if (sawServerChange) {
        server1Points++;
      }
    }
  }

  if (!sawServerChange) {
    // Still on the opening server of this possession (Server 1, or opening 0-0-2 Server 2).
    // Possession always starts serving from the RIGHT box, swapping on every point scored.
    return pointsThisPossession % 2 === 0 ? 'right' : 'left';
  }

  // Server 2 took over after Server 1 scored `server1Points`.
  // When Server 1 faulted, Server 1 was on (server1Points % 2 === 0 ? 'right' : 'left'),
  // so Server 2 started on the OPPOSITE side: (server1Points % 2 === 0 ? 'left' : 'right').
  const server2Points = pointsThisPossession - server1Points;
  const server2StartSide: 'right' | 'left' = server1Points % 2 === 0 ? 'left' : 'right';
  if (server2Points % 2 === 0) {
    return server2StartSide;
  }
  return server2StartSide === 'right' ? 'left' : 'right';
}

export function getActiveServerPlayerId(state: LiveGameState): string | null {
  const side = getActiveServerSide(state);
  const teamPos = state.servingTeam === 'A' ? state.positions.teamA : state.positions.teamB;
  if (state.gameType === 'singles') {
    return teamPos.right ?? teamPos.left;
  }
  return teamPos[side];
}

export function checkWinner(
  teamAScore: number,
  teamBScore: number,
  targetScore: number,
  winByTwo: boolean
): TeamId | null {
  const minMargin = winByTwo ? 2 : 1;
  if (teamAScore >= targetScore && teamAScore - teamBScore >= minMargin) {
    return 'A';
  }
  if (teamBScore >= targetScore && teamBScore - teamAScore >= minMargin) {
    return 'B';
  }
  return null;
}

export function isGamePoint(state: LiveGameState): TeamId | null {
  if (state.winnerTeam) return null;
  const minMargin = state.winByTwo ? 2 : 1;
  const aCanWin =
    (state.scoringMode === 'rally' || state.servingTeam === 'A') &&
    state.teamAScore + 1 >= state.targetScore &&
    state.teamAScore + 1 - state.teamBScore >= minMargin;
  const bCanWin =
    (state.scoringMode === 'rally' || state.servingTeam === 'B') &&
    state.teamBScore + 1 >= state.targetScore &&
    state.teamBScore + 1 - state.teamAScore >= minMargin;

  if (aCanWin) return 'A';
  if (bCanWin) return 'B';
  return null;
}

function swapTeamPositions(pos: { right: string | null; left: string | null }) {
  return { right: pos.left, left: pos.right };
}

export function recordRally(
  state: LiveGameState,
  rallyWinner: TeamId,
  matchId: string
): LiveGameState {
  if (state.winnerTeam) {
    return state;
  }

  let teamAScore = state.teamAScore;
  let teamBScore = state.teamBScore;
  let servingTeam = state.servingTeam;
  let serverNumber = state.serverNumber;
  let positions: CourtPositions = {
    teamA: { ...state.positions.teamA },
    teamB: { ...state.positions.teamB },
  };
  let eventType: RallyEventType = 'point';

  if (state.scoringMode === 'side_out') {
    if (rallyWinner === state.servingTeam) {
      // Serving team scores a point and swaps left/right boxes in doubles
      if (rallyWinner === 'A') {
        teamAScore += 1;
        if (state.gameType === 'doubles') {
          positions.teamA = swapTeamPositions(positions.teamA);
        }
      } else {
        teamBScore += 1;
        if (state.gameType === 'doubles') {
          positions.teamB = swapTeamPositions(positions.teamB);
        }
      }
      eventType = 'point';
    } else {
      // Receiving team won the rally -> server change or side-out
      if (state.gameType === 'doubles' && state.serverNumber === 1) {
        serverNumber = 2;
        eventType = 'server_change';
      } else {
        servingTeam = state.servingTeam === 'A' ? 'B' : 'A';
        serverNumber = 1;
        eventType = 'side_out';
      }
    }
  } else {
    // Rally scoring: every rally awards a point
    if (rallyWinner === 'A') {
      teamAScore += 1;
    } else {
      teamBScore += 1;
    }
    if (rallyWinner === state.servingTeam) {
      if (state.gameType === 'doubles') {
        if (rallyWinner === 'A') {
          positions.teamA = swapTeamPositions(positions.teamA);
        } else {
          positions.teamB = swapTeamPositions(positions.teamB);
        }
      }
      eventType = 'point';
    } else {
      servingTeam = rallyWinner;
      serverNumber = 1;
      eventType = 'side_out';
    }
  }

  const winnerTeam = checkWinner(teamAScore, teamBScore, state.targetScore, state.winByTwo);

  const nextStateBase: LiveGameState = {
    ...state,
    teamAScore,
    teamBScore,
    servingTeam,
    serverNumber,
    positions,
    winnerTeam,
    isFirstServeOfGame: false,
    rallies: state.rallies,
    redoStack: [],
  };

  const callout = formatScoreCallout(nextStateBase);
  const rallyEvent: RallyEvent = {
    id: crypto.randomUUID ? crypto.randomUUID() : `rally_${Date.now()}_${state.rallies.length + 1}`,
    match_id: matchId,
    seq: state.rallies.length + 1,
    rally_winner: rallyWinner,
    event_type: eventType,
    serving_team: servingTeam,
    server_number: serverNumber,
    team_a_score: teamAScore,
    team_b_score: teamBScore,
    callout,
    created_at: new Date().toISOString(),
  };

  return {
    ...nextStateBase,
    rallies: [...state.rallies, rallyEvent],
  };
}

export function undoLastRally(
  state: LiveGameState,
  initialServingTeam: TeamId,
  initialTeamAPlayers: [string | null, string | null],
  initialTeamBPlayers: [string | null, string | null]
): LiveGameState {
  if (state.rallies.length === 0) return state;

  const popped = state.rallies[state.rallies.length - 1];
  const remainingRallies = state.rallies.slice(0, -1);

  // Replay from initial state cleanly so court positions and server numbers stay 100% deterministic
  let rebuilt = createInitialLiveState({
    gameType: state.gameType,
    scoringMode: state.scoringMode,
    targetScore: state.targetScore,
    winByTwo: state.winByTwo,
    initialServingTeam,
    teamAPlayers: initialTeamAPlayers,
    teamBPlayers: initialTeamBPlayers,
  });

  for (const r of remainingRallies) {
    rebuilt = recordRally(rebuilt, r.rally_winner, r.match_id);
  }
  // Preserve original timestamps/ids for remaining rallies
  rebuilt.rallies = remainingRallies;
  rebuilt.redoStack = [
    {
      teamAScore: state.teamAScore,
      teamBScore: state.teamBScore,
      servingTeam: state.servingTeam,
      serverNumber: state.serverNumber,
      positions: state.positions,
      winnerTeam: state.winnerTeam,
      isFirstServeOfGame: state.isFirstServeOfGame,
      rallyEvent: popped,
    },
    ...state.redoStack,
  ];

  return rebuilt;
}

export function redoLastRally(state: LiveGameState): LiveGameState {
  if (state.redoStack.length === 0) return state;
  const [next, ...rest] = state.redoStack;
  return {
    ...state,
    teamAScore: next.teamAScore,
    teamBScore: next.teamBScore,
    servingTeam: next.servingTeam,
    serverNumber: next.serverNumber,
    positions: next.positions,
    winnerTeam: next.winnerTeam,
    isFirstServeOfGame: next.isFirstServeOfGame,
    rallies: [...state.rallies, next.rallyEvent],
    redoStack: rest,
  };
}

export function swapServerManually(state: LiveGameState): LiveGameState {
  if (state.winnerTeam) return state;
  if (state.gameType === 'doubles' && state.scoringMode === 'side_out') {
    if (state.serverNumber === 1) {
      return { ...state, serverNumber: 2 };
    }
    return {
      ...state,
      servingTeam: state.servingTeam === 'A' ? 'B' : 'A',
      serverNumber: 1,
    };
  }
  return {
    ...state,
    servingTeam: state.servingTeam === 'A' ? 'B' : 'A',
    serverNumber: 1,
  };
}

export function swapTeamBoxesManually(state: LiveGameState, team: TeamId): LiveGameState {
  if (state.gameType !== 'doubles') return state;
  return {
    ...state,
    positions: {
      teamA: team === 'A' ? swapTeamPositions(state.positions.teamA) : state.positions.teamA,
      teamB: team === 'B' ? swapTeamPositions(state.positions.teamB) : state.positions.teamB,
    },
  };
}

export interface MomentumSummary {
  teamAPercent: number; // 0..100
  teamBPercent: number; // 0..100
  streakTeam: TeamId | null;
  streakCount: number;
  lastFive: TeamId[];
}

export function computeMomentum(rallies: RallyEvent[]): MomentumSummary {
  if (rallies.length === 0) {
    return { teamAPercent: 50, teamBPercent: 50, streakTeam: null, streakCount: 0, lastFive: [] };
  }

  const lastFive = rallies.slice(-5).map((r) => r.rally_winner);
  const aRecent = lastFive.filter((t) => t === 'A').length;
  const teamAPercent = Math.round((aRecent / lastFive.length) * 100);
  const teamBPercent = 100 - teamAPercent;

  const streakTeam = rallies[rallies.length - 1].rally_winner;
  let streakCount = 0;
  for (let i = rallies.length - 1; i >= 0; i--) {
    if (rallies[i].rally_winner === streakTeam) {
      streakCount++;
    } else {
      break;
    }
  }

  return { teamAPercent, teamBPercent, streakTeam, streakCount, lastFive };
}
