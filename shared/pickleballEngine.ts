import { computeDuprRatings, MIN_MATCHES_FOR_RATING } from './ratingEngine';
import type {
  CourtPositions,
  CourtSide,
  GameType,
  LiveGameState,
  Match,
  Player,
  RallyEvent,
  RallyEventType,
  RallyOutcomeTag,
  ScoringMode,
  Session,
  TargetScore,
  TeamId,
} from './types';
import { VENUES } from './venues';

export interface CreateLiveStateOptions {
  gameType: GameType;
  scoringMode: ScoringMode;
  targetScore: TargetScore;
  winByTwo: boolean;
  initialServingTeam?: TeamId;
  teamAPlayers: [string | null, string | null]; // [right, left]
  teamBPlayers: [string | null, string | null]; // [right, left]
}

/** Creates the initial `LiveGameState` for a doubles or singles match (doubles side-out starts at 0-0-2). */
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
    version: 0,
  };
}

/** Formats the official pickleball callout (`A-B-Server` in doubles side-out, or `A-B` otherwise). */
export function formatScoreCallout(state: LiveGameState): string {
  const servingScore = state.servingTeam === 'A' ? state.teamAScore : state.teamBScore;
  const receivingScore = state.servingTeam === 'A' ? state.teamBScore : state.teamAScore;

  if (state.gameType === 'doubles' && state.scoringMode === 'side_out') {
    return `${servingScore} - ${receivingScore} - ${state.serverNumber}`;
  }
  return `${servingScore} - ${receivingScore}`;
}

/** Returns the active server's court side (`right` on even score, `left` on odd score, or by server number in doubles). */
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

/** Returns the `player_id` currently positioned to serve, or `null` if unassigned. */
export function getActiveServerPlayerId(state: LiveGameState): string | null {
  const side = getActiveServerSide(state);
  const teamPos = state.servingTeam === 'A' ? state.positions.teamA : state.positions.teamB;
  if (state.gameType === 'singles') {
    return teamPos.right ?? teamPos.left;
  }
  return teamPos[side];
}

/** Checks whether either team has reached `targetScore` (respecting `winByTwo`) and returns the winning `TeamId`. */
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

/** Returns the `TeamId` currently at game point, or `null` if neither team is one point away from winning. */
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

/**
 * Records a rally outcome, updating score, server/side-out state, court box swaps,
 * player attribution, and appending a `RallyEvent` to the match timeline.
 */
export function recordRally(
  state: LiveGameState,
  rallyWinner: TeamId,
  matchId: string
): LiveGameState {
  if (state.winnerTeam) {
    return state;
  }

  const preServingSide = getActiveServerSide(state);
  const preServingPlayerId = getActiveServerPlayerId(state);
  const recvPositions = state.servingTeam === 'A' ? state.positions.teamB : state.positions.teamA;
  const preReceivingPlayerId =
    state.gameType === 'singles'
      ? recvPositions.right ?? recvPositions.left
      : preServingSide === 'right'
        ? recvPositions.right
        : recvPositions.left;

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
    serving_player_id: preServingPlayerId,
    receiving_player_id: preReceivingPlayerId,
    serving_side: preServingSide,
    outcome_tag: null,
    outcome_player_id: null,
  };

  return {
    ...nextStateBase,
    rallies: [...state.rallies, rallyEvent],
    version: (state.version ?? state.rallies.length) + 1,
  };
}

/** Deterministically undoes the last rally and restores the prior court positions, server, and score. */
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

  rebuilt.version = (state.version ?? state.rallies.length) + 1;
  return rebuilt;
}

/** Re-applies the most recently undone rally from `redoStack`. */
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
    version: (state.version ?? state.rallies.length) + 1,
  };
}

/** Manually toggles the active server (Server 1 <-> Server 2, or serving team in singles/rally mode). */
export function swapServerManually(state: LiveGameState): LiveGameState {
  if (state.winnerTeam) return state;
  if (state.gameType === 'doubles' && state.scoringMode === 'side_out') {
    if (state.serverNumber === 1) {
      return { ...state, serverNumber: 2, version: (state.version ?? state.rallies.length) + 1 };
    }
    return {
      ...state,
      servingTeam: state.servingTeam === 'A' ? 'B' : 'A',
      serverNumber: 1,
      version: (state.version ?? state.rallies.length) + 1,
    };
  }
  return {
    ...state,
    servingTeam: state.servingTeam === 'A' ? 'B' : 'A',
    serverNumber: 1,
    version: (state.version ?? state.rallies.length) + 1,
  };
}

/** Manually swaps the right and left court box positions for a doubles team. */
export function swapTeamBoxesManually(state: LiveGameState, team: TeamId): LiveGameState {
  if (state.gameType !== 'doubles') return state;
  return {
    ...state,
    positions: {
      teamA: team === 'A' ? swapTeamPositions(state.positions.teamA) : state.positions.teamA,
      teamB: team === 'B' ? swapTeamPositions(state.positions.teamB) : state.positions.teamB,
    },
    version: (state.version ?? state.rallies.length) + 1,
  };
}

export interface MomentumSummary {
  teamAPercent: number; // 0..100
  teamBPercent: number; // 0..100
  streakTeam: TeamId | null;
  streakCount: number;
  lastFive: TeamId[];
}

/** Computes last-5 rally momentum percentages and the active consecutive rally streak. */
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

export interface TeamMatchAnalytics {
  ralliesWon: number;
  rallyWinPct: number;
  servesTotal: number;
  serveWins: number;
  serveWinPct: number | null;
  server1Serves: number;
  server1Wins: number;
  server2Serves: number;
  server2Wins: number;
  receiveRallies: number;
  receiveWins: number;
  receiveWinPct: number | null;
  sideOuts: number;
  oneAndDoneSideOuts: number;
  possessions: number;
  ptsPerPossession: number | null;
  longestPointRun: number;
  longestRallyStreak: number;
  maxLead: number;
  gamePointsFaced: number;
  gamePointsSaved: number;
}

export interface MatchSplitAnalytics {
  rallies: number;
  pointsA: number;
  pointsB: number;
  rallyWinPctA: number;
  rallyWinPctB: number;
}

export interface MatchAnalytics {
  totalRallies: number;
  teamA: TeamMatchAnalytics;
  teamB: TeamMatchAnalytics;
  leadChanges: number;
  ties: number;
  biggestComeback: { team: TeamId; deficit: number } | null;
  clutchRallies: number;
  clutchWinsA: number;
  clutchWinsB: number;
  avgRallySeconds: number | null;
  switchTarget: number;
  preSwitch: MatchSplitAnalytics | null;
  postSwitch: MatchSplitAnalytics | null;
}

function emptyTeamAnalytics(): TeamMatchAnalytics {
  return {
    ralliesWon: 0,
    rallyWinPct: 0,
    servesTotal: 0,
    serveWins: 0,
    serveWinPct: null,
    server1Serves: 0,
    server1Wins: 0,
    server2Serves: 0,
    server2Wins: 0,
    receiveRallies: 0,
    receiveWins: 0,
    receiveWinPct: null,
    sideOuts: 0,
    oneAndDoneSideOuts: 0,
    possessions: 0,
    ptsPerPossession: null,
    longestPointRun: 0,
    longestRallyStreak: 0,
    maxLead: 0,
    gamePointsFaced: 0,
    gamePointsSaved: 0,
  };
}

/** Computes comprehensive match-level analytics (serve/side-out rates, runs, clutch, pace, and end-switch splits). */
export function computeMatchAnalytics(
  match: Pick<
    Match,
    'rallies' | 'scoring_mode' | 'target_score' | 'win_by_two' | 'winner_team' | 'duration_seconds'
  >
): MatchAnalytics {
  const rallies = match.rallies ?? [];
  const totalRallies = rallies.length;
  const teamA = emptyTeamAnalytics();
  const teamB = emptyTeamAnalytics();
  const switchTarget = Math.ceil(match.target_score / 2);

  if (totalRallies === 0) {
    return {
      totalRallies: 0,
      teamA,
      teamB,
      leadChanges: 0,
      ties: 0,
      biggestComeback: null,
      clutchRallies: 0,
      clutchWinsA: 0,
      clutchWinsB: 0,
      avgRallySeconds: null,
      switchTarget,
      preSwitch: null,
      postSwitch: null,
    };
  }

  let prevA = 0;
  let prevB = 0;
  let prevLeader: TeamId | null = null;
  let leadChanges = 0;
  let ties = 0;

  let curPointRunTeam: TeamId | null = null;
  let curPointRun = 0;
  let curRallyStreakTeam: TeamId | null = null;
  let curRallyStreak = 0;

  let curServingPossessionTeam: TeamId | null = null;
  let curPossessionRallyIndex = 0;

  let maxDeficitA = 0;
  let maxDeficitB = 0;

  const clutchThreshold = Math.max(1, match.target_score - 3);
  let clutchRallies = 0;
  let clutchWinsA = 0;
  let clutchWinsB = 0;

  let switchIdx = -1;
  const rallyDurations: number[] = [];
  let prevServerNum: 1 | 2 =
    rallies[0].event_type === 'side_out'
      ? match.scoring_mode === 'side_out'
        ? 2
        : 1
      : rallies[0].event_type === 'server_change'
        ? 1
        : rallies[0].server_number;

  for (let i = 0; i < rallies.length; i++) {
    const r = rallies[i];
    const winner = r.rally_winner;
    const server: TeamId =
      r.event_type === 'side_out' ? (r.serving_team === 'A' ? 'B' : 'A') : r.serving_team;
    const serverNum: 1 | 2 =
      r.event_type === 'server_change'
        ? 1
        : r.event_type === 'side_out'
          ? prevServerNum
          : r.server_number;
    const wStats = winner === 'A' ? teamA : teamB;
    const sStats = server === 'A' ? teamA : teamB;
    const recvStats = server === 'A' ? teamB : teamA;

    // Possession tracking
    if (server !== curServingPossessionTeam) {
      curServingPossessionTeam = server;
      curPossessionRallyIndex = 0;
      sStats.possessions++;
    }
    curPossessionRallyIndex++;

    // Rallies won & consecutive rally streak
    wStats.ralliesWon++;
    if (curRallyStreakTeam === winner) {
      curRallyStreak++;
    } else {
      curRallyStreakTeam = winner;
      curRallyStreak = 1;
    }
    if (curRallyStreak > wStats.longestRallyStreak) {
      wStats.longestRallyStreak = curRallyStreak;
    }

    // Serve vs Receive stats
    sStats.servesTotal++;
    recvStats.receiveRallies++;
    if (serverNum === 1) {
      sStats.server1Serves++;
      if (winner === server) sStats.server1Wins++;
    } else {
      sStats.server2Serves++;
      if (winner === server) sStats.server2Wins++;
    }

    if (winner === server) {
      sStats.serveWins++;
    } else {
      recvStats.receiveWins++;
      if (r.event_type === 'side_out') {
        recvStats.sideOuts++;
        if (curPossessionRallyIndex === 1) {
          recvStats.oneAndDoneSideOuts++;
        }
      }
    }

    // Game point faced / saved (using pre-rally score)
    const aAtGamePoint =
      prevA >= match.target_score - 1 &&
      (!match.win_by_two || prevA - prevB >= 1) &&
      (match.scoring_mode === 'rally' || server === 'A');
    const bAtGamePoint =
      prevB >= match.target_score - 1 &&
      (!match.win_by_two || prevB - prevA >= 1) &&
      (match.scoring_mode === 'rally' || server === 'B');

    if (aAtGamePoint) {
      teamB.gamePointsFaced++;
      if (winner === 'B') teamB.gamePointsSaved++;
    }
    if (bAtGamePoint) {
      teamA.gamePointsFaced++;
      if (winner === 'A') teamA.gamePointsSaved++;
    }

    // Clutch rallies (both teams near target)
    if (prevA >= clutchThreshold && prevB >= clutchThreshold) {
      clutchRallies++;
      if (winner === 'A') clutchWinsA++;
      else clutchWinsB++;
    }

    // Point run tracking
    const deltaA = r.team_a_score - prevA;
    const deltaB = r.team_b_score - prevB;
    if (deltaA > 0) {
      curPointRun = curPointRunTeam === 'A' ? curPointRun + deltaA : deltaA;
      curPointRunTeam = 'A';
      if (curPointRun > teamA.longestPointRun) teamA.longestPointRun = curPointRun;
    } else if (deltaB > 0) {
      curPointRun = curPointRunTeam === 'B' ? curPointRun + deltaB : deltaB;
      curPointRunTeam = 'B';
      if (curPointRun > teamB.longestPointRun) teamB.longestPointRun = curPointRun;
    }

    // Lead, ties, deficits
    const diff = r.team_a_score - r.team_b_score;
    if (diff > teamA.maxLead) teamA.maxLead = diff;
    if (-diff > teamB.maxLead) teamB.maxLead = -diff;
    if (-diff > maxDeficitA) maxDeficitA = -diff;
    if (diff > maxDeficitB) maxDeficitB = diff;

    if (diff === 0 && (r.team_a_score > 0 || r.team_b_score > 0) && (deltaA > 0 || deltaB > 0)) {
      ties++;
    }
    const leader: TeamId | null = diff > 0 ? 'A' : diff < 0 ? 'B' : prevLeader;
    if (diff !== 0 && prevLeader && leader !== prevLeader) {
      leadChanges++;
    }
    if (diff !== 0) {
      prevLeader = leader;
    }

    // Switch-ends split index
    if (switchIdx === -1 && Math.max(r.team_a_score, r.team_b_score) >= switchTarget) {
      switchIdx = i;
    }

    // Pace between rallies
    if (i > 0) {
      const prevMs = Date.parse(rallies[i - 1].created_at);
      const curMs = Date.parse(r.created_at);
      if (Number.isFinite(prevMs) && Number.isFinite(curMs)) {
        const sec = (curMs - prevMs) / 1000;
        if (sec >= 0.5 && sec <= 300) {
          rallyDurations.push(sec);
        }
      }
    }

    prevA = r.team_a_score;
    prevB = r.team_b_score;
    prevServerNum = r.server_number;
  }

  // Finalize percentages
  for (const t of [teamA, teamB]) {
    t.rallyWinPct = Math.round((t.ralliesWon / totalRallies) * 100);
    t.serveWinPct = t.servesTotal > 0 ? Math.round((t.serveWins / t.servesTotal) * 100) : null;
    t.receiveWinPct =
      t.receiveRallies > 0 ? Math.round((t.receiveWins / t.receiveRallies) * 100) : null;
    t.ptsPerPossession =
      t.possessions > 0 ? Number((t.serveWins / t.possessions).toFixed(2)) : null;
  }

  let biggestComeback: { team: TeamId; deficit: number } | null = null;
  if (match.winner_team === 'A' && maxDeficitA > 0) {
    biggestComeback = { team: 'A', deficit: maxDeficitA };
  } else if (match.winner_team === 'B' && maxDeficitB > 0) {
    biggestComeback = { team: 'B', deficit: maxDeficitB };
  }

  let avgRallySeconds: number | null = null;
  if (rallyDurations.length > 0) {
    const sum = rallyDurations.reduce((a, b) => a + b, 0);
    avgRallySeconds = Number((sum / rallyDurations.length).toFixed(1));
  } else if (match.duration_seconds > 0) {
    avgRallySeconds = Number((match.duration_seconds / totalRallies).toFixed(1));
  }

  let preSwitch: MatchSplitAnalytics | null = null;
  let postSwitch: MatchSplitAnalytics | null = null;
  if (switchIdx !== -1 && switchIdx < rallies.length - 1) {
    const preRallies = rallies.slice(0, switchIdx + 1);
    const postRallies = rallies.slice(switchIdx + 1);
    const preLast = preRallies[preRallies.length - 1];
    const postLast = postRallies[postRallies.length - 1];
    const preWinsA = preRallies.filter((r) => r.rally_winner === 'A').length;
    const postWinsA = postRallies.filter((r) => r.rally_winner === 'A').length;
    const prePctA = Math.round((preWinsA / preRallies.length) * 100);
    const postPctA = Math.round((postWinsA / postRallies.length) * 100);
    preSwitch = {
      rallies: preRallies.length,
      pointsA: preLast.team_a_score,
      pointsB: preLast.team_b_score,
      rallyWinPctA: prePctA,
      rallyWinPctB: 100 - prePctA,
    };
    postSwitch = {
      rallies: postRallies.length,
      pointsA: postLast.team_a_score - preLast.team_a_score,
      pointsB: postLast.team_b_score - preLast.team_b_score,
      rallyWinPctA: postPctA,
      rallyWinPctB: 100 - postPctA,
    };
  }

  return {
    totalRallies,
    teamA,
    teamB,
    leadChanges,
    ties,
    biggestComeback,
    clutchRallies,
    clutchWinsA,
    clutchWinsB,
    avgRallySeconds,
    switchTarget,
    preSwitch,
    postSwitch,
  };
}

/** Ordered rally outcome tag definitions with bilingual EN/JA labels. */
export const RALLY_OUTCOME_TAGS: {
  id: RallyOutcomeTag;
  en: string;
  ja: string;
}[] = [
  { id: 'ace', en: 'Ace', ja: 'エース' },
  { id: 'service_fault', en: 'Service Fault', ja: 'サーブミス' },
  { id: 'winner', en: 'Winner', ja: 'ウィナー' },
  { id: 'net', en: 'Net', ja: 'ネット' },
  { id: 'out', en: 'Out', ja: 'アウト' },
];

/** Returns the localized display label for a `RallyOutcomeTag`. */
export function getOutcomeTagLabel(tag: RallyOutcomeTag, lang: 'en' | 'ja'): string {
  const found = RALLY_OUTCOME_TAGS.find((t) => t.id === tag);
  if (!found) return tag;
  return lang === 'ja' ? found.ja : found.en;
}

/** Attaches or clears an objective `RallyOutcomeTag` (and optional last-touch player) on a rally in `LiveGameState`. */
export function tagRallyOutcome(
  state: LiveGameState,
  seq: number,
  tag: RallyOutcomeTag | null,
  playerId: string | null = null
): LiveGameState {
  return {
    ...state,
    rallies: state.rallies.map((r) =>
      r.seq === seq
        ? { ...r, outcome_tag: tag, outcome_player_id: tag ? (playerId ?? null) : null }
        : r
    ),
    version: (state.version ?? state.rallies.length) + 1,
  };
}

/** Merges `outcome_tag` and player attribution from `live_state.rallies` onto persisted `match.rallies`. */
export function getMatchRalliesWithTags(match: Pick<Match, 'rallies' | 'live_state'>): RallyEvent[] {
  const rallies = match.rallies ?? [];
  const liveRallies = match.live_state?.rallies;
  if (!liveRallies || liveRallies.length === 0) return rallies;
  const liveMap = new Map<number, RallyEvent>();
  for (const lr of liveRallies) {
    liveMap.set(lr.seq, lr);
  }
  return rallies.map((r) => {
    const lr = liveMap.get(r.seq);
    if (!lr) return r;
    return {
      ...r,
      outcome_tag: r.outcome_tag ?? lr.outcome_tag ?? null,
      outcome_player_id: r.outcome_player_id ?? lr.outcome_player_id ?? null,
      serving_player_id: r.serving_player_id ?? lr.serving_player_id ?? null,
      receiving_player_id: r.receiving_player_id ?? lr.receiving_player_id ?? null,
      serving_side: r.serving_side ?? lr.serving_side ?? null,
    };
  });
}

export interface PlayerSkillProfile {
  playerId: string;
  ralliesPlayed: number;
  ralliesWon: number;
  rallyWinPct: number | null;
  servesTotal: number;
  serveWins: number;
  serveWinPct: number | null;
  serviceTurns: number;
  ptsPerServiceTurn: number | null;
  receiveRallies: number;
  receiveWins: number;
  receiveWinPct: number | null;
  rightSideRallies: number;
  rightSideWins: number;
  rightSideWinPct: number | null;
  leftSideRallies: number;
  leftSideWins: number;
  leftSideWinPct: number | null;
  clutchRallies: number;
  clutchWins: number;
  clutchWinPct: number | null;
  tagCounts: Partial<Record<RallyOutcomeTag, number>>;
}

/** Computes per-player department skill profiles (service, receiving, box sides, clutch, and shot tags). */
export function computePlayerSkillProfiles(
  players: Pick<Player, 'id'>[],
  matches: Match[]
): Map<string, PlayerSkillProfile> {
  const profiles = new Map<string, PlayerSkillProfile>();
  for (const p of players) {
    profiles.set(p.id, {
      playerId: p.id,
      ralliesPlayed: 0,
      ralliesWon: 0,
      rallyWinPct: null,
      servesTotal: 0,
      serveWins: 0,
      serveWinPct: null,
      serviceTurns: 0,
      ptsPerServiceTurn: null,
      receiveRallies: 0,
      receiveWins: 0,
      receiveWinPct: null,
      rightSideRallies: 0,
      rightSideWins: 0,
      rightSideWinPct: null,
      leftSideRallies: 0,
      leftSideWins: 0,
      leftSideWinPct: null,
      clutchRallies: 0,
      clutchWins: 0,
      clutchWinPct: null,
      tagCounts: {},
    });
  }

  for (const match of matches) {
    const rallies = getMatchRalliesWithTags(match);
    if (rallies.length === 0) continue;

    const teamAParts = match.participants.filter((p) => p.team === 'A');
    const teamBParts = match.participants.filter((p) => p.team === 'B');
    const teamAIds = teamAParts.map((p) => p.player_id);
    const teamBIds = teamBParts.map((p) => p.player_id);
    const aRight =
      teamAParts.find((p) => p.starting_side === 'right')?.player_id ?? teamAIds[0] ?? null;
    const aLeft =
      teamAParts.find((p) => p.starting_side === 'left')?.player_id ?? teamAIds[1] ?? null;
    const bRight =
      teamBParts.find((p) => p.starting_side === 'right')?.player_id ?? teamBIds[0] ?? null;
    const bLeft =
      teamBParts.find((p) => p.starting_side === 'left')?.player_id ?? teamBIds[1] ?? null;

    let positions: CourtPositions = {
      teamA: { right: aRight, left: aLeft },
      teamB: { right: bRight, left: bLeft },
    };

    const clutchThreshold = Math.max(1, match.target_score - 3);
    let prevA = 0;
    let prevB = 0;
    let lastServingPlayerId: string | null = null;

    for (let i = 0; i < rallies.length; i++) {
      const r = rallies[i];
      const serverTeam: TeamId =
        r.event_type === 'side_out' ? (r.serving_team === 'A' ? 'B' : 'A') : r.serving_team;
      const serverScore = serverTeam === 'A' ? prevA : prevB;
      const servingSide: CourtSide = r.serving_side ?? (serverScore % 2 === 0 ? 'right' : 'left');

      const serverTeamPos = serverTeam === 'A' ? positions.teamA : positions.teamB;
      const recvTeamPos = serverTeam === 'A' ? positions.teamB : positions.teamA;

      const servingPlayerId =
        r.serving_player_id ??
        (match.game_type === 'singles'
          ? serverTeamPos.right ?? serverTeamPos.left
          : servingSide === 'right'
            ? serverTeamPos.right
            : serverTeamPos.left);
      const receivingPlayerId =
        r.receiving_player_id ??
        (match.game_type === 'singles'
          ? recvTeamPos.right ?? recvTeamPos.left
          : servingSide === 'right'
            ? recvTeamPos.right
            : recvTeamPos.left);

      const winners = r.rally_winner === 'A' ? teamAIds : teamBIds;
      const losers = r.rally_winner === 'A' ? teamBIds : teamAIds;
      const isClutch = prevA >= clutchThreshold && prevB >= clutchThreshold;

      // Team-wide rally & clutch stats for all participants
      for (const pid of [...teamAIds, ...teamBIds]) {
        const prof = profiles.get(pid);
        if (!prof) continue;
        const won = winners.includes(pid);
        prof.ralliesPlayed++;
        if (won) prof.ralliesWon++;
        if (isClutch) {
          prof.clutchRallies++;
          if (won) prof.clutchWins++;
        }
      }

      // Serving player attribution
      if (servingPlayerId) {
        const sProf = profiles.get(servingPlayerId);
        if (sProf) {
          if (servingPlayerId !== lastServingPlayerId) {
            sProf.serviceTurns++;
          }
          sProf.servesTotal++;
          const won = r.rally_winner === serverTeam;
          if (won) sProf.serveWins++;
          if (servingSide === 'right') {
            sProf.rightSideRallies++;
            if (won) sProf.rightSideWins++;
          } else {
            sProf.leftSideRallies++;
            if (won) sProf.leftSideWins++;
          }
        }
      }
      lastServingPlayerId = servingPlayerId ?? null;

      // Receiving player attribution
      if (receivingPlayerId) {
        const rProf = profiles.get(receivingPlayerId);
        if (rProf) {
          rProf.receiveRallies++;
          const won = r.rally_winner !== serverTeam;
          if (won) rProf.receiveWins++;
          if (servingSide === 'right') {
            rProf.rightSideRallies++;
            if (won) rProf.rightSideWins++;
          } else {
            rProf.leftSideRallies++;
            if (won) rProf.leftSideWins++;
          }
        }
      }

      // Outcome tag attribution (prefer explicit last-touch player_id when recorded)
      if (r.outcome_tag) {
        if (r.outcome_player_id && profiles.has(r.outcome_player_id)) {
          const tProf = profiles.get(r.outcome_player_id)!;
          tProf.tagCounts[r.outcome_tag] = (tProf.tagCounts[r.outcome_tag] ?? 0) + 1;
        } else if (r.outcome_tag === 'service_fault') {
          if (servingPlayerId) {
            const sProf = profiles.get(servingPlayerId);
            if (sProf) {
              sProf.tagCounts.service_fault = (sProf.tagCounts.service_fault ?? 0) + 1;
            }
          }
        } else if (r.outcome_tag === 'net' || r.outcome_tag === 'out') {
          for (const pid of losers) {
            const lProf = profiles.get(pid);
            if (lProf) {
              lProf.tagCounts[r.outcome_tag] = (lProf.tagCounts[r.outcome_tag] ?? 0) + 1;
            }
          }
        } else {
          for (const pid of winners) {
            const wProf = profiles.get(pid);
            if (wProf) {
              wProf.tagCounts[r.outcome_tag] = (wProf.tagCounts[r.outcome_tag] ?? 0) + 1;
            }
          }
        }
      }

      // Advance positions if point scored on serve (mirrors recordRally)
      if (match.game_type === 'doubles' && r.event_type === 'point') {
        if (r.rally_winner === 'A') {
          positions = { ...positions, teamA: swapTeamPositions(positions.teamA) };
        } else {
          positions = { ...positions, teamB: swapTeamPositions(positions.teamB) };
        }
      }

      prevA = r.team_a_score;
      prevB = r.team_b_score;
    }
  }

  for (const prof of profiles.values()) {
    prof.rallyWinPct =
      prof.ralliesPlayed > 0 ? Math.round((prof.ralliesWon / prof.ralliesPlayed) * 100) : null;
    prof.serveWinPct =
      prof.servesTotal > 0 ? Math.round((prof.serveWins / prof.servesTotal) * 100) : null;
    prof.ptsPerServiceTurn =
      prof.serviceTurns > 0 ? Number((prof.serveWins / prof.serviceTurns).toFixed(2)) : null;
    prof.receiveWinPct =
      prof.receiveRallies > 0 ? Math.round((prof.receiveWins / prof.receiveRallies) * 100) : null;
    prof.rightSideWinPct =
      prof.rightSideRallies > 0
        ? Math.round((prof.rightSideWins / prof.rightSideRallies) * 100)
        : null;
    prof.leftSideWinPct =
      prof.leftSideRallies > 0
        ? Math.round((prof.leftSideWins / prof.leftSideRallies) * 100)
        : null;
    prof.clutchWinPct =
      prof.clutchRallies > 0 ? Math.round((prof.clutchWins / prof.clutchRallies) * 100) : null;
  }

  return profiles;
}

export const MIN_RALLIES_FOR_ATTRIBUTES = 100;

export interface PlayerPlaystyleBadge {
  id:
    | 'serve_specialist'
    | 'return_wall'
    | 'clutch'
    | 'right_anchor'
    | 'left_anchor'
    | 'finisher'
    | 'steady';
  en: string;
  ja: string;
}

export interface PlayerAttributes {
  unlocked: boolean;
  ralliesNeeded: number;
  matchesNeeded: number;
  axes: {
    serve: number | null;
    receive: number | null;
    clutch: number | null;
    consistency: number | null;
  };
  badges: PlayerPlaystyleBadge[];
  missTendency: 'net' | 'out' | 'balanced' | null;
}

/** Infers threshold-gated 4-axis skill scores, playstyle badges, and miss tendencies for a player. */
export function computePlayerAttributes(
  profile: PlayerSkillProfile,
  gamesPlayed?: number
): PlayerAttributes {
  const ralliesNeeded = Math.max(0, MIN_RALLIES_FOR_ATTRIBUTES - profile.ralliesPlayed);
  const matchesNeeded =
    gamesPlayed !== undefined ? Math.max(0, MIN_MATCHES_FOR_RATING - gamesPlayed) : 0;
  const unlocked =
    profile.ralliesPlayed >= MIN_RALLIES_FOR_ATTRIBUTES && matchesNeeded === 0;

  const aces = profile.tagCounts.ace ?? 0;
  const winners = profile.tagCounts.winner ?? 0;
  const nets = profile.tagCounts.net ?? 0;
  const outs = profile.tagCounts.out ?? 0;
  const svcFaults = profile.tagCounts.service_fault ?? 0;
  const totalTagged = aces + winners + nets + outs + svcFaults;
  const totalErrors = nets + outs + svcFaults;

  const serve = profile.servesTotal >= 25 ? profile.serveWinPct : null;
  const receive = profile.receiveRallies >= 25 ? profile.receiveWinPct : null;
  const clutch = profile.clutchRallies >= 15 ? profile.clutchWinPct : null;
  const consistency =
    totalTagged >= 25
      ? Math.max(0, Math.min(100, Math.round((1 - totalErrors / totalTagged) * 100)))
      : null;

  const badges: PlayerPlaystyleBadge[] = [];
  if (unlocked) {
    if (profile.servesTotal >= 30 && (profile.serveWinPct ?? 0) >= 60) {
      badges.push({ id: 'serve_specialist', en: 'Serve Specialist', ja: 'サーブ巧者' });
    }
    if (profile.receiveRallies >= 30 && (profile.receiveWinPct ?? 0) >= 55) {
      badges.push({ id: 'return_wall', en: 'Return Wall', ja: 'レシーブの壁' });
    }
    if (profile.clutchRallies >= 15 && (profile.clutchWinPct ?? 0) >= 60) {
      badges.push({ id: 'clutch', en: 'Clutch', ja: 'クラッチ' });
    }
    if (
      profile.rightSideRallies >= 20 &&
      profile.leftSideRallies >= 20 &&
      profile.rightSideWinPct !== null &&
      profile.leftSideWinPct !== null
    ) {
      if (profile.rightSideWinPct - profile.leftSideWinPct >= 12) {
        badges.push({ id: 'right_anchor', en: 'Right-Side Anchor', ja: '右サイド得意' });
      } else if (profile.leftSideWinPct - profile.rightSideWinPct >= 12) {
        badges.push({ id: 'left_anchor', en: 'Left-Side Anchor', ja: '左サイド得意' });
      }
    }
    if (totalTagged >= 25 && (aces + winners) / totalTagged >= 0.45) {
      badges.push({ id: 'finisher', en: 'Clean Finisher', ja: '決定力' });
    }
    if (totalTagged >= 25 && totalErrors / totalTagged <= 0.3) {
      badges.push({ id: 'steady', en: 'Steady', ja: '安定感' });
    }
  }

  let missTendency: 'net' | 'out' | 'balanced' | null = null;
  if (unlocked && nets + outs >= 15) {
    if (nets >= outs * 1.5) missTendency = 'net';
    else if (outs >= nets * 1.5) missTendency = 'out';
    else missTendency = 'balanced';
  }

  return {
    unlocked,
    ralliesNeeded,
    matchesNeeded,
    axes: { serve, receive, clutch, consistency },
    badges,
    missTendency,
  };
}

export interface SplitRecord {
  wins: number;
  losses: number;
  winPct: number | null;
}

export interface PlayerSituationalSplits {
  indoor: SplitRecord;
  outdoor: SplitRecord;
  earlyRounds: SplitRecord;
  lateRounds: SplitRecord;
  sideOut: SplitRecord;
  rallyMode: SplitRecord;
  underdog: SplitRecord;
  isGiantKiller: boolean;
  partnerSynergy: Map<string, number>;
}

function getSessionVenueCourtType(location: string | null | undefined): 'indoor' | 'outdoor' | null {
  const loc = location?.trim();
  if (!loc) return null;
  const found = VENUES.find((v) => loc.includes(v.shortName) || loc.includes(v.fullName));
  if (found) return found.courtType;
  if (loc.includes('屋外') || loc.toLowerCase().includes('outdoor')) return 'outdoor';
  if (loc.includes('屋内') || loc.toLowerCase().includes('indoor')) return 'indoor';
  return null;
}

function makeEmptySplit(): SplitRecord {
  return { wins: 0, losses: 0, winPct: null };
}

function finalizeSplit(s: SplitRecord): void {
  const total = s.wins + s.losses;
  s.winPct = total > 0 ? Math.round((s.wins / total) * 100) : null;
}

/** Returns true when a completed match was won by a team rated at least 0.15 points lower than the loser. */
export function isUpsetMatch(
  match: Match,
  ratingMap: Map<string, { rating: number | null }>
): boolean {
  if (match.status !== 'completed' || !match.winner_team) return false;
  const teamAIds = match.participants.filter((p) => p.team === 'A').map((p) => p.player_id);
  const teamBIds = match.participants.filter((p) => p.team === 'B').map((p) => p.player_id);
  const avg = (ids: string[]): number | null => {
    const vals = ids
      .map((id) => ratingMap.get(id)?.rating)
      .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
    if (vals.length === 0) return null;
    return vals.reduce((a, b) => a + b, 0) / vals.length;
  };
  const avgA = avg(teamAIds);
  const avgB = avg(teamBIds);
  if (avgA === null || avgB === null) return false;
  if (match.winner_team === 'A') return avgB - avgA >= 0.15;
  return avgA - avgB >= 0.15;
}

/** Computes cross-match situational splits (indoor/outdoor, stamina, scoring format, underdog, and partner synergy). */
export function computePlayerSituationalSplits(
  players: Player[],
  matches: Match[],
  sessions: Session[]
): Map<string, PlayerSituationalSplits> {
  const { ratings } = computeDuprRatings(players, matches);
  const playerSkillMap = new Map(players.map((p) => [p.id, p.skill_rating]));
  const sessionMap = new Map(sessions.map((s) => [s.id, s]));

  const playerRecord = new Map<string, { wins: number; losses: number }>();
  const pairRecord = new Map<string, Map<string, { wins: number; losses: number }>>();
  const splits = new Map<string, PlayerSituationalSplits>();

  for (const p of players) {
    playerRecord.set(p.id, { wins: 0, losses: 0 });
    pairRecord.set(p.id, new Map());
    splits.set(p.id, {
      indoor: makeEmptySplit(),
      outdoor: makeEmptySplit(),
      earlyRounds: makeEmptySplit(),
      lateRounds: makeEmptySplit(),
      sideOut: makeEmptySplit(),
      rallyMode: makeEmptySplit(),
      underdog: makeEmptySplit(),
      isGiantKiller: false,
      partnerSynergy: new Map(),
    });
  }

  for (const m of matches) {
    if (m.status !== 'completed' || !m.winner_team) continue;
    const teamAIds = m.participants.filter((p) => p.team === 'A').map((p) => p.player_id);
    const teamBIds = m.participants.filter((p) => p.team === 'B').map((p) => p.player_id);

    const avgRating = (ids: string[]): number | null => {
      const vals = ids
        .map((id) => playerSkillMap.get(id) ?? ratings.get(id)?.rating ?? null)
        .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
      if (vals.length === 0) return null;
      return vals.reduce((a, b) => a + b, 0) / vals.length;
    };
    const avgA = avgRating(teamAIds);
    const avgB = avgRating(teamBIds);

    const session = m.session_id ? sessionMap.get(m.session_id) : undefined;
    const courtType = getSessionVenueCourtType(session?.location);

    const recordTeam = (ids: string[], team: TeamId) => {
      const won = m.winner_team === team;
      const myAvg = team === 'A' ? avgA : avgB;
      const oppAvg = team === 'A' ? avgB : avgA;
      const isUnderdog = myAvg !== null && oppAvg !== null && oppAvg - myAvg >= 0.15;

      for (const pid of ids) {
        const sp = splits.get(pid);
        const rec = playerRecord.get(pid);
        if (!sp || !rec) continue;
        if (won) rec.wins++;
        else rec.losses++;

        if (courtType === 'indoor') {
          if (won) sp.indoor.wins++;
          else sp.indoor.losses++;
        } else if (courtType === 'outdoor') {
          if (won) sp.outdoor.wins++;
          else sp.outdoor.losses++;
        }

        if (m.round_number !== null && m.round_number !== undefined) {
          if (m.round_number <= 2) {
            if (won) sp.earlyRounds.wins++;
            else sp.earlyRounds.losses++;
          } else if (m.round_number >= 4) {
            if (won) sp.lateRounds.wins++;
            else sp.lateRounds.losses++;
          }
        }

        if (m.scoring_mode === 'side_out') {
          if (won) sp.sideOut.wins++;
          else sp.sideOut.losses++;
        } else {
          if (won) sp.rallyMode.wins++;
          else sp.rallyMode.losses++;
        }

        if (isUnderdog) {
          if (won) sp.underdog.wins++;
          else sp.underdog.losses++;
        }

        if (ids.length === 2) {
          const partnerId = ids.find((id) => id !== pid);
          if (partnerId) {
            const pMap = pairRecord.get(pid);
            if (pMap) {
              const cur = pMap.get(partnerId) ?? { wins: 0, losses: 0 };
              if (won) cur.wins++;
              else cur.losses++;
              pMap.set(partnerId, cur);
            }
          }
        }
      }
    };

    recordTeam(teamAIds, 'A');
    recordTeam(teamBIds, 'B');
  }

  for (const [pid, sp] of splits.entries()) {
    finalizeSplit(sp.indoor);
    finalizeSplit(sp.outdoor);
    finalizeSplit(sp.earlyRounds);
    finalizeSplit(sp.lateRounds);
    finalizeSplit(sp.sideOut);
    finalizeSplit(sp.rallyMode);
    finalizeSplit(sp.underdog);

    const underdogTotal = sp.underdog.wins + sp.underdog.losses;
    sp.isGiantKiller = underdogTotal >= 4 && (sp.underdog.winPct ?? 0) >= 50;

    const myRec = playerRecord.get(pid);
    const myWinPct =
      myRec && myRec.wins + myRec.losses > 0
        ? (myRec.wins / (myRec.wins + myRec.losses)) * 100
        : null;
    const pMap = pairRecord.get(pid);
    if (myWinPct !== null && pMap) {
      for (const [partnerId, rec] of pMap.entries()) {
        const pairTotal = rec.wins + rec.losses;
        if (pairTotal < 2) continue;
        const partnerRec = playerRecord.get(partnerId);
        if (!partnerRec || partnerRec.wins + partnerRec.losses === 0) continue;
        const partnerWinPct = (partnerRec.wins / (partnerRec.wins + partnerRec.losses)) * 100;
        const pairWinPct = (rec.wins / pairTotal) * 100;
        const expected = (myWinPct + partnerWinPct) / 2;
        sp.partnerSynergy.set(partnerId, Math.round(pairWinPct - expected));
      }
    }
  }

  return splits;
}

export interface SessionHighlights {
  isOutdoor: boolean;
  outdoorErrorSharePct: number | null;
  bestPair: { names: string; wins: number; losses: number; winPct: number } | null;
  closestMatch: {
    matchId: string;
    teamAName: string;
    teamBName: string;
    scoreA: number;
    scoreB: number;
    leadChanges: number;
  } | null;
}

/** Computes session-level highlights (best pair, closest match, and outdoor out/fault error rate). */
export function computeSessionHighlights(
  session: Session,
  sessionMatches: Match[],
  players: Player[]
): SessionHighlights {
  const isOutdoor = getSessionVenueCourtType(session.location) === 'outdoor';
  const playerMap = new Map(players.map((p) => [p.id, p.name]));

  // Outdoor tagged error share
  let taggedTotal = 0;
  let outdoorErrors = 0;
  for (const m of sessionMatches) {
    for (const r of getMatchRalliesWithTags(m)) {
      if (!r.outcome_tag) continue;
      taggedTotal++;
      if (r.outcome_tag === 'out' || r.outcome_tag === 'service_fault') {
        outdoorErrors++;
      }
    }
  }
  const outdoorErrorSharePct =
    isOutdoor && taggedTotal >= 5 ? Math.round((outdoorErrors / taggedTotal) * 100) : null;

  // Best pair in session (min 2 completed games)
  const pairStats = new Map<string, { names: string; wins: number; losses: number; diff: number }>();
  for (const m of sessionMatches) {
    if (m.status !== 'completed' || !m.winner_team) continue;
    for (const team of ['A', 'B'] as TeamId[]) {
      const ids = m.participants
        .filter((p) => p.team === team)
        .map((p) => p.player_id)
        .sort();
      if (ids.length !== 2) continue;
      const key = ids.join('|');
      const names = ids.map((id) => playerMap.get(id) ?? 'Player').join(' & ');
      const cur = pairStats.get(key) ?? { names, wins: 0, losses: 0, diff: 0 };
      const won = m.winner_team === team;
      if (won) cur.wins++;
      else cur.losses++;
      cur.diff += team === 'A' ? m.team_a_score - m.team_b_score : m.team_b_score - m.team_a_score;
      pairStats.set(key, cur);
    }
  }

  let bestPair: SessionHighlights['bestPair'] = null;
  for (const ps of pairStats.values()) {
    const total = ps.wins + ps.losses;
    if (total < 2) continue;
    const winPct = Math.round((ps.wins / total) * 100);
    if (
      !bestPair ||
      winPct > bestPair.winPct ||
      (winPct === bestPair.winPct && ps.wins > bestPair.wins)
    ) {
      bestPair = { names: ps.names, wins: ps.wins, losses: ps.losses, winPct };
    }
  }

  // Closest / thriller match
  let closestMatch: SessionHighlights['closestMatch'] = null;
  let bestScore = -Infinity;
  for (const m of sessionMatches) {
    if (m.status !== 'completed') continue;
    const rallies = getMatchRalliesWithTags(m);
    const a = computeMatchAnalytics({ ...m, rallies });
    const margin = Math.abs(m.team_a_score - m.team_b_score);
    const thrillerScore = a.leadChanges * 10 + a.ties * 4 - margin;
    if (thrillerScore > bestScore) {
      bestScore = thrillerScore;
      closestMatch = {
        matchId: m.id,
        teamAName: m.team_a_name,
        teamBName: m.team_b_name,
        scoreA: m.team_a_score,
        scoreB: m.team_b_score,
        leadChanges: a.leadChanges,
      };
    }
  }

  return { isOutdoor, outdoorErrorSharePct, bestPair, closestMatch };
}
