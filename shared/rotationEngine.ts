import type { Match, SessionFormat, SessionPlayer } from './types';

export interface ProposedCourtMatch {
  court_number: number;
  teamA: [string, string];
  teamB: [string, string];
}

export interface RoundProposal {
  round_number: number;
  matches: ProposedCourtMatch[];
  sitting_out: string[];
}

function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/**
 * Computes balanced matchups for the next round of a session across the configured courts.
 * - `rotating_partners`: minimizes repeat partners, repeat opponents, and unequal sit-outs
 * - `set_partners`: keeps team_slot pairs intact and rotates opposing pairs
 * - `king_of_court`: winners move up a court, losers move down, partners split on each court
 * - `open_play`: prioritizes players who sat out or have the fewest games played
 */
export function generateNextRound(params: {
  format: SessionFormat;
  courtsCount: number;
  sessionPlayers: SessionPlayer[];
  previousMatches: Match[];
  nextRoundNumber: number;
}): RoundProposal {
  const activePlayers = params.sessionPlayers.filter((p) => p.active);
  const playerIds = activePlayers.map((p) => p.player_id);

  if (playerIds.length < 4) {
    return {
      round_number: params.nextRoundNumber,
      matches: [],
      sitting_out: playerIds,
    };
  }

  const maxCourtsByPlayers = Math.floor(playerIds.length / 4);
  const numCourts = Math.max(1, Math.min(params.courtsCount, maxCourtsByPlayers));

  // Track historical counts
  const gamesPlayed = new Map<string, number>();
  const lastRoundPlayed = new Map<string, number>();
  const partnerCounts = new Map<string, number>();
  const opponentCounts = new Map<string, number>();

  for (const pid of playerIds) {
    gamesPlayed.set(pid, 0);
    lastRoundPlayed.set(pid, 0);
  }

  for (const m of params.previousMatches) {
    const teamA = m.participants.filter((p) => p.team === 'A').map((p) => p.player_id);
    const teamB = m.participants.filter((p) => p.team === 'B').map((p) => p.player_id);
    const roundNum = m.round_number ?? 1;

    for (const pid of [...teamA, ...teamB]) {
      gamesPlayed.set(pid, (gamesPlayed.get(pid) ?? 0) + 1);
      lastRoundPlayed.set(pid, Math.max(lastRoundPlayed.get(pid) ?? 0, roundNum));
    }
    if (teamA.length === 2) {
      const k = pairKey(teamA[0], teamA[1]);
      partnerCounts.set(k, (partnerCounts.get(k) ?? 0) + 1);
    }
    if (teamB.length === 2) {
      const k = pairKey(teamB[0], teamB[1]);
      partnerCounts.set(k, (partnerCounts.get(k) ?? 0) + 1);
    }
    for (const a of teamA) {
      for (const b of teamB) {
        const k = pairKey(a, b);
        opponentCounts.set(k, (opponentCounts.get(k) ?? 0) + 1);
      }
    }
  }

  // King of the Court logic (when previous round exists)
  if (params.format === 'king_of_court' && params.previousMatches.length > 0) {
    const prevRoundNum = Math.max(...params.previousMatches.map((m) => m.round_number ?? 0));
    const prevRoundMatches = params.previousMatches
      .filter((m) => m.round_number === prevRoundNum)
      .sort((a, b) => (a.court_number ?? 99) - (b.court_number ?? 99));

    if (prevRoundMatches.length > 0) {
      return generateKingOfCourtRound(
        prevRoundMatches,
        playerIds,
        numCourts,
        params.nextRoundNumber,
        gamesPlayed
      );
    }
  }

  // Set Partners logic
  if (params.format === 'set_partners') {
    return generateSetPartnersRound(
      activePlayers,
      numCourts,
      params.nextRoundNumber,
      gamesPlayed,
      opponentCounts
    );
  }

  // Rotating Partners / Open Play logic
  // 1. Select the (numCourts * 4) players who have played fewest games / sat out most recently
  const sortedForPlay = [...playerIds].sort((a, b) => {
    const gDiff = (gamesPlayed.get(a) ?? 0) - (gamesPlayed.get(b) ?? 0);
    if (gDiff !== 0) return gDiff;
    const rDiff = (lastRoundPlayed.get(a) ?? 0) - (lastRoundPlayed.get(b) ?? 0);
    if (rDiff !== 0) return rDiff;
    // deterministic rotation offset by round number so order shifts naturally
    const idxA = (playerIds.indexOf(a) + params.nextRoundNumber * 3) % playerIds.length;
    const idxB = (playerIds.indexOf(b) + params.nextRoundNumber * 3) % playerIds.length;
    return idxA - idxB;
  });

  const playing = sortedForPlay.slice(0, numCourts * 4);
  const sittingOut = sortedForPlay.slice(numCourts * 4);

  // 2. Greedy + local-search grouping to minimize repeat partners (high weight) & repeat opponents
  const matches = optimizeDoublesMatchups(
    playing,
    numCourts,
    partnerCounts,
    opponentCounts,
    params.nextRoundNumber
  );

  return {
    round_number: params.nextRoundNumber,
    matches,
    sitting_out: sittingOut,
  };
}

function generateKingOfCourtRound(
  prevRoundMatches: Match[],
  allPlayerIds: string[],
  numCourts: number,
  nextRoundNumber: number,
  gamesPlayed: Map<string, number>
): RoundProposal {
  const activeSet = new Set(allPlayerIds);
  const prevPlayingSet = new Set<string>();
  const courtBuckets: string[][] = Array.from({ length: numCourts }, () => []);

  // Place winners one court up (min court 0), losers one court down
  const overflowLosers: string[] = [];

  for (let i = 0; i < prevRoundMatches.length; i++) {
    const m = prevRoundMatches[i];
    const courtIdx = Math.min(numCourts - 1, Math.max(0, (m.court_number ?? i + 1) - 1));
    const teamA = m.participants
      .filter((p) => p.team === 'A' && activeSet.has(p.player_id))
      .map((p) => p.player_id);
    const teamB = m.participants
      .filter((p) => p.team === 'B' && activeSet.has(p.player_id))
      .map((p) => p.player_id);

    for (const p of [...teamA, ...teamB]) prevPlayingSet.add(p);

    const aWon =
      m.winner_team === 'A' ||
      (m.winner_team === null && m.team_a_score >= m.team_b_score);
    const winners = aWon ? teamA : teamB;
    const losers = aWon ? teamB : teamA;

    const winnerTarget = Math.max(0, courtIdx - 1);
    const loserTarget = courtIdx + 1;

    courtBuckets[winnerTarget].push(...winners);
    if (loserTarget < numCourts) {
      courtBuckets[loserTarget].push(...losers);
    } else {
      overflowLosers.push(...losers);
    }
  }

  // Add players who sat out last round into the lowest courts first
  const satOutLastRound = allPlayerIds
    .filter((id) => !prevPlayingSet.has(id))
    .sort((a, b) => (gamesPlayed.get(a) ?? 0) - (gamesPlayed.get(b) ?? 0));

  const pool = [...satOutLastRound, ...overflowLosers];
  // Fill any court that has < 4 players from pool, top to bottom
  for (let c = 0; c < numCourts; c++) {
    while (courtBuckets[c].length < 4 && pool.length > 0) {
      courtBuckets[c].push(pool.shift()!);
    }
  }

  const matches: ProposedCourtMatch[] = [];
  for (let c = 0; c < numCourts; c++) {
    const players = courtBuckets[c].slice(0, 4);
    if (players.length === 4) {
      // Split partners on King of the Court so winners face each other with new partners!
      matches.push({
        court_number: c + 1,
        teamA: [players[0], players[2]],
        teamB: [players[1], players[3]],
      });
    }
  }

  const assigned = new Set(matches.flatMap((m) => [...m.teamA, ...m.teamB]));
  const sittingOut = allPlayerIds.filter((id) => !assigned.has(id));

  return {
    round_number: nextRoundNumber,
    matches,
    sitting_out: sittingOut,
  };
}

function generateSetPartnersRound(
  activePlayers: SessionPlayer[],
  numCourts: number,
  nextRoundNumber: number,
  gamesPlayed: Map<string, number>,
  opponentCounts: Map<string, number>
): RoundProposal {
  // Group players into fixed pairs using team_slot or sequential check-in order
  const bySlot = new Map<number, string[]>();
  const unassigned: string[] = [];

  for (const sp of [...activePlayers].sort((a, b) => a.check_in_order - b.check_in_order)) {
    if (sp.team_slot !== null && sp.team_slot !== undefined) {
      const list = bySlot.get(sp.team_slot) ?? [];
      list.push(sp.player_id);
      bySlot.set(sp.team_slot, list);
    } else {
      unassigned.push(sp.player_id);
    }
  }

  const pairs: Array<[string, string]> = [];
  for (const [, list] of bySlot) {
    if (list.length >= 2) {
      pairs.push([list[0], list[1]]);
    } else if (list.length === 1) {
      unassigned.push(list[0]);
    }
  }
  for (let i = 0; i + 1 < unassigned.length; i += 2) {
    pairs.push([unassigned[i], unassigned[i + 1]]);
  }

  // Sort pairs by fewest games played
  const sortedPairs = [...pairs].sort((a, b) => {
    const gA = (gamesPlayed.get(a[0]) ?? 0) + (gamesPlayed.get(a[1]) ?? 0);
    const gB = (gamesPlayed.get(b[0]) ?? 0) + (gamesPlayed.get(b[1]) ?? 0);
    return gA - gB;
  });

  const activePairs = sortedPairs.slice(0, numCourts * 2);
  const matches: ProposedCourtMatch[] = [];
  const used = new Set<number>();

  for (let i = 0; i < activePairs.length; i++) {
    if (used.has(i)) continue;
    let bestJ = -1;
    let bestScore = Infinity;
    for (let j = i + 1; j < activePairs.length; j++) {
      if (used.has(j)) continue;
      let oppCost = 0;
      for (const a of activePairs[i]) {
        for (const b of activePairs[j]) {
          oppCost += opponentCounts.get(pairKey(a, b)) ?? 0;
        }
      }
      if (oppCost < bestScore) {
        bestScore = oppCost;
        bestJ = j;
      }
    }
    if (bestJ !== -1) {
      used.add(i);
      used.add(bestJ);
      matches.push({
        court_number: matches.length + 1,
        teamA: activePairs[i],
        teamB: activePairs[bestJ],
      });
    }
  }

  const assignedIds = new Set(matches.flatMap((m) => [...m.teamA, ...m.teamB]));
  const sittingOut = activePlayers
    .map((p) => p.player_id)
    .filter((id) => !assignedIds.has(id));

  return {
    round_number: nextRoundNumber,
    matches,
    sitting_out: sittingOut,
  };
}

function optimizeDoublesMatchups(
  playing: string[],
  numCourts: number,
  partnerCounts: Map<string, number>,
  opponentCounts: Map<string, number>,
  roundSeed: number
): ProposedCourtMatch[] {
  // Deterministic Fisher-Yates seeded permutations + pick lowest-cost assignment
  const trials = Math.min(250, Math.max(40, playing.length * 15));
  let bestLayout: string[] = [...playing];
  let bestCost = Infinity;

  let seed = roundSeed * 2654435761 + playing.length * 97;
  const nextRand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0xffffffff;
  };

  const evaluate = (arr: string[]): number => {
    let cost = 0;
    for (let c = 0; c < numCourts; c++) {
      const a1 = arr[c * 4];
      const a2 = arr[c * 4 + 1];
      const b1 = arr[c * 4 + 2];
      const b2 = arr[c * 4 + 3];
      // Heavily penalize repeat partners
      const pA = partnerCounts.get(pairKey(a1, a2)) ?? 0;
      const pB = partnerCounts.get(pairKey(b1, b2)) ?? 0;
      cost += (pA * pA + pB * pB) * 20 + (pA + pB) * 10;

      // Moderately penalize repeat opponents
      for (const a of [a1, a2]) {
        for (const b of [b1, b2]) {
          const opp = opponentCounts.get(pairKey(a, b)) ?? 0;
          cost += opp * opp * 2 + opp;
        }
      }
    }
    return cost;
  };

  for (let t = 0; t < trials; t++) {
    const candidate = [...playing];
    if (t > 0) {
      for (let i = candidate.length - 1; i > 0; i--) {
        const j = Math.floor(nextRand() * (i + 1));
        [candidate[i], candidate[j]] = [candidate[j], candidate[i]];
      }
    }
    const cost = evaluate(candidate);
    if (cost < bestCost) {
      bestCost = cost;
      bestLayout = candidate;
      if (bestCost === 0) break;
    }
  }

  const matches: ProposedCourtMatch[] = [];
  for (let c = 0; c < numCourts; c++) {
    matches.push({
      court_number: c + 1,
      teamA: [bestLayout[c * 4], bestLayout[c * 4 + 1]],
      teamB: [bestLayout[c * 4 + 2], bestLayout[c * 4 + 3]],
    });
  }
  return matches;
}
