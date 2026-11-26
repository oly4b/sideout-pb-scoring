// server/src/index.ts
import "dotenv/config";
import fs2 from "node:fs";
import path3 from "node:path";
import cors from "cors";
import express from "express";

// shared/pickleballEngine.ts
function createInitialLiveState(opts) {
  const servingTeam = opts.initialServingTeam ?? "A";
  const serverNumber = opts.gameType === "doubles" && opts.scoringMode === "side_out" ? 2 : 1;
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
        left: opts.gameType === "doubles" ? opts.teamAPlayers[1] ?? null : null
      },
      teamB: {
        right: opts.teamBPlayers[0] ?? null,
        left: opts.gameType === "doubles" ? opts.teamBPlayers[1] ?? null : null
      }
    },
    winnerTeam: null,
    isFirstServeOfGame: true,
    rallies: [],
    redoStack: []
  };
}
function formatScoreCallout(state) {
  const servingScore = state.servingTeam === "A" ? state.teamAScore : state.teamBScore;
  const receivingScore = state.servingTeam === "A" ? state.teamBScore : state.teamAScore;
  if (state.gameType === "doubles" && state.scoringMode === "side_out") {
    return `${servingScore} - ${receivingScore} - ${state.serverNumber}`;
  }
  return `${servingScore} - ${receivingScore}`;
}
function checkWinner(teamAScore, teamBScore, targetScore, winByTwo) {
  const minMargin = winByTwo ? 2 : 1;
  if (teamAScore >= targetScore && teamAScore - teamBScore >= minMargin) {
    return "A";
  }
  if (teamBScore >= targetScore && teamBScore - teamAScore >= minMargin) {
    return "B";
  }
  return null;
}
function swapTeamPositions(pos) {
  return { right: pos.left, left: pos.right };
}
function recordRally(state, rallyWinner, matchId) {
  if (state.winnerTeam) {
    return state;
  }
  let teamAScore = state.teamAScore;
  let teamBScore = state.teamBScore;
  let servingTeam = state.servingTeam;
  let serverNumber = state.serverNumber;
  let positions = {
    teamA: { ...state.positions.teamA },
    teamB: { ...state.positions.teamB }
  };
  let eventType = "point";
  if (state.scoringMode === "side_out") {
    if (rallyWinner === state.servingTeam) {
      if (rallyWinner === "A") {
        teamAScore += 1;
        if (state.gameType === "doubles") {
          positions.teamA = swapTeamPositions(positions.teamA);
        }
      } else {
        teamBScore += 1;
        if (state.gameType === "doubles") {
          positions.teamB = swapTeamPositions(positions.teamB);
        }
      }
      eventType = "point";
    } else {
      if (state.gameType === "doubles" && state.serverNumber === 1) {
        serverNumber = 2;
        eventType = "server_change";
      } else {
        servingTeam = state.servingTeam === "A" ? "B" : "A";
        serverNumber = 1;
        eventType = "side_out";
      }
    }
  } else {
    if (rallyWinner === "A") {
      teamAScore += 1;
    } else {
      teamBScore += 1;
    }
    if (rallyWinner === state.servingTeam) {
      if (state.gameType === "doubles") {
        if (rallyWinner === "A") {
          positions.teamA = swapTeamPositions(positions.teamA);
        } else {
          positions.teamB = swapTeamPositions(positions.teamB);
        }
      }
      eventType = "point";
    } else {
      servingTeam = rallyWinner;
      serverNumber = 1;
      eventType = "side_out";
    }
  }
  const winnerTeam = checkWinner(teamAScore, teamBScore, state.targetScore, state.winByTwo);
  const nextStateBase = {
    ...state,
    teamAScore,
    teamBScore,
    servingTeam,
    serverNumber,
    positions,
    winnerTeam,
    isFirstServeOfGame: false,
    rallies: state.rallies,
    redoStack: []
  };
  const callout = formatScoreCallout(nextStateBase);
  const rallyEvent = {
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
    created_at: (/* @__PURE__ */ new Date()).toISOString()
  };
  return {
    ...nextStateBase,
    rallies: [...state.rallies, rallyEvent]
  };
}

// shared/rotationEngine.ts
function pairKey(a, b) {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}
function generateNextRound(params) {
  const activePlayers = params.sessionPlayers.filter((p) => p.active);
  const playerIds = activePlayers.map((p) => p.player_id);
  if (playerIds.length < 4) {
    return {
      round_number: params.nextRoundNumber,
      matches: [],
      sitting_out: playerIds
    };
  }
  const maxCourtsByPlayers = Math.floor(playerIds.length / 4);
  const numCourts = Math.max(1, Math.min(params.courtsCount, maxCourtsByPlayers));
  const gamesPlayed = /* @__PURE__ */ new Map();
  const lastRoundPlayed = /* @__PURE__ */ new Map();
  const partnerCounts = /* @__PURE__ */ new Map();
  const opponentCounts = /* @__PURE__ */ new Map();
  for (const pid of playerIds) {
    gamesPlayed.set(pid, 0);
    lastRoundPlayed.set(pid, 0);
  }
  for (const m of params.previousMatches) {
    const teamA = m.participants.filter((p) => p.team === "A").map((p) => p.player_id);
    const teamB = m.participants.filter((p) => p.team === "B").map((p) => p.player_id);
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
  if (params.format === "king_of_court" && params.previousMatches.length > 0) {
    const prevRoundNum = Math.max(...params.previousMatches.map((m) => m.round_number ?? 0));
    const prevRoundMatches = params.previousMatches.filter((m) => m.round_number === prevRoundNum).sort((a, b) => (a.court_number ?? 99) - (b.court_number ?? 99));
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
  if (params.format === "set_partners") {
    return generateSetPartnersRound(
      activePlayers,
      numCourts,
      params.nextRoundNumber,
      gamesPlayed,
      opponentCounts
    );
  }
  const sortedForPlay = [...playerIds].sort((a, b) => {
    const gDiff = (gamesPlayed.get(a) ?? 0) - (gamesPlayed.get(b) ?? 0);
    if (gDiff !== 0) return gDiff;
    const rDiff = (lastRoundPlayed.get(a) ?? 0) - (lastRoundPlayed.get(b) ?? 0);
    if (rDiff !== 0) return rDiff;
    const idxA = (playerIds.indexOf(a) + params.nextRoundNumber * 3) % playerIds.length;
    const idxB = (playerIds.indexOf(b) + params.nextRoundNumber * 3) % playerIds.length;
    return idxA - idxB;
  });
  const playing = sortedForPlay.slice(0, numCourts * 4);
  const sittingOut = sortedForPlay.slice(numCourts * 4);
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
    sitting_out: sittingOut
  };
}
function generateKingOfCourtRound(prevRoundMatches, allPlayerIds, numCourts, nextRoundNumber, gamesPlayed) {
  const activeSet = new Set(allPlayerIds);
  const prevPlayingSet = /* @__PURE__ */ new Set();
  const courtBuckets = Array.from({ length: numCourts }, () => []);
  const overflowLosers = [];
  for (let i = 0; i < prevRoundMatches.length; i++) {
    const m = prevRoundMatches[i];
    const courtIdx = Math.min(numCourts - 1, Math.max(0, (m.court_number ?? i + 1) - 1));
    const teamA = m.participants.filter((p) => p.team === "A" && activeSet.has(p.player_id)).map((p) => p.player_id);
    const teamB = m.participants.filter((p) => p.team === "B" && activeSet.has(p.player_id)).map((p) => p.player_id);
    for (const p of [...teamA, ...teamB]) prevPlayingSet.add(p);
    const aWon = m.winner_team === "A" || m.winner_team === null && m.team_a_score >= m.team_b_score;
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
  const satOutLastRound = allPlayerIds.filter((id) => !prevPlayingSet.has(id)).sort((a, b) => (gamesPlayed.get(a) ?? 0) - (gamesPlayed.get(b) ?? 0));
  const pool = [...satOutLastRound, ...overflowLosers];
  for (let c = 0; c < numCourts; c++) {
    while (courtBuckets[c].length < 4 && pool.length > 0) {
      courtBuckets[c].push(pool.shift());
    }
  }
  const matches = [];
  for (let c = 0; c < numCourts; c++) {
    const players = courtBuckets[c].slice(0, 4);
    if (players.length === 4) {
      matches.push({
        court_number: c + 1,
        teamA: [players[0], players[2]],
        teamB: [players[1], players[3]]
      });
    }
  }
  const assigned = new Set(matches.flatMap((m) => [...m.teamA, ...m.teamB]));
  const sittingOut = allPlayerIds.filter((id) => !assigned.has(id));
  return {
    round_number: nextRoundNumber,
    matches,
    sitting_out: sittingOut
  };
}
function generateSetPartnersRound(activePlayers, numCourts, nextRoundNumber, gamesPlayed, opponentCounts) {
  const bySlot = /* @__PURE__ */ new Map();
  const unassigned = [];
  for (const sp of [...activePlayers].sort((a, b) => a.check_in_order - b.check_in_order)) {
    if (sp.team_slot !== null && sp.team_slot !== void 0) {
      const list = bySlot.get(sp.team_slot) ?? [];
      list.push(sp.player_id);
      bySlot.set(sp.team_slot, list);
    } else {
      unassigned.push(sp.player_id);
    }
  }
  const pairs = [];
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
  const sortedPairs = [...pairs].sort((a, b) => {
    const gA = (gamesPlayed.get(a[0]) ?? 0) + (gamesPlayed.get(a[1]) ?? 0);
    const gB = (gamesPlayed.get(b[0]) ?? 0) + (gamesPlayed.get(b[1]) ?? 0);
    return gA - gB;
  });
  const activePairs = sortedPairs.slice(0, numCourts * 2);
  const matches = [];
  const used = /* @__PURE__ */ new Set();
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
        teamB: activePairs[bestJ]
      });
    }
  }
  const assignedIds = new Set(matches.flatMap((m) => [...m.teamA, ...m.teamB]));
  const sittingOut = activePlayers.map((p) => p.player_id).filter((id) => !assignedIds.has(id));
  return {
    round_number: nextRoundNumber,
    matches,
    sitting_out: sittingOut
  };
}
function optimizeDoublesMatchups(playing, numCourts, partnerCounts, opponentCounts, roundSeed) {
  const trials = Math.min(250, Math.max(40, playing.length * 15));
  let bestLayout = [...playing];
  let bestCost = Infinity;
  let seed = roundSeed * 2654435761 + playing.length * 97;
  const nextRand = () => {
    seed = seed * 1664525 + 1013904223 >>> 0;
    return seed / 4294967295;
  };
  const evaluate = (arr) => {
    let cost = 0;
    for (let c = 0; c < numCourts; c++) {
      const a1 = arr[c * 4];
      const a2 = arr[c * 4 + 1];
      const b1 = arr[c * 4 + 2];
      const b2 = arr[c * 4 + 3];
      const pA = partnerCounts.get(pairKey(a1, a2)) ?? 0;
      const pB = partnerCounts.get(pairKey(b1, b2)) ?? 0;
      cost += (pA * pA + pB * pB) * 20 + (pA + pB) * 10;
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
  const matches = [];
  for (let c = 0; c < numCourts; c++) {
    matches.push({
      court_number: c + 1,
      teamA: [bestLayout[c * 4], bestLayout[c * 4 + 1]],
      teamB: [bestLayout[c * 4 + 2], bestLayout[c * 4 + 3]]
    });
  }
  return matches;
}

// shared/statsEngine.ts
function computeStandings(players, matches) {
  const completed = matches.filter((m) => m.status === "completed" && m.winner_team !== null).sort((a, b) => {
    const tA = new Date(a.completed_at ?? a.started_at).getTime();
    const tB = new Date(b.completed_at ?? b.started_at).getTime();
    return tA - tB;
  });
  const statsMap = /* @__PURE__ */ new Map();
  for (const p of players) {
    statsMap.set(p.id, {
      player_id: p.id,
      name: p.name,
      avatar_color: p.avatar_color,
      skill_rating: p.skill_rating,
      games_played: 0,
      wins: 0,
      losses: 0,
      win_pct: 0,
      points_for: 0,
      points_against: 0,
      point_diff: 0,
      streak: 0
    });
  }
  for (const m of completed) {
    for (const part of m.participants) {
      const s = statsMap.get(part.player_id);
      if (!s) continue;
      const won = m.winner_team === part.team;
      const pf = part.team === "A" ? m.team_a_score : m.team_b_score;
      const pa = part.team === "A" ? m.team_b_score : m.team_a_score;
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
      s.win_pct = s.games_played > 0 ? Math.round(s.wins / s.games_played * 1e3) / 10 : 0;
    }
  }
  return Array.from(statsMap.values()).sort((a, b) => {
    if (b.wins !== a.wins) return b.wins - a.wins;
    if (b.win_pct !== a.win_pct) return b.win_pct - a.win_pct;
    if (b.point_diff !== a.point_diff) return b.point_diff - a.point_diff;
    return b.points_for - a.points_for;
  });
}
function computePlayerDetailStats(playerId, players, matches) {
  const playerMap = new Map(players.map((p) => [p.id, p]));
  const standings = computeStandings(players, matches);
  const base = standings.find((s) => s.player_id === playerId);
  if (!base) return null;
  const teammateMap = /* @__PURE__ */ new Map();
  const opponentMap = /* @__PURE__ */ new Map();
  const playerMatches = matches.filter((m) => m.participants.some((p) => p.player_id === playerId)).sort((a, b) => {
    const tA = new Date(a.completed_at ?? a.started_at).getTime();
    const tB = new Date(b.completed_at ?? b.started_at).getTime();
    return tB - tA;
  });
  for (const m of playerMatches) {
    if (m.status !== "completed" || !m.winner_team) continue;
    const myPart = m.participants.find((p) => p.player_id === playerId);
    if (!myPart) continue;
    const won = m.winner_team === myPart.team;
    const pf = myPart.team === "A" ? m.team_a_score : m.team_b_score;
    const pa = myPart.team === "A" ? m.team_b_score : m.team_a_score;
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
        point_diff: 0
      };
      rec.games += 1;
      if (won) rec.wins += 1;
      else rec.losses += 1;
      rec.point_diff += diff;
      rec.win_pct = Math.round(rec.wins / rec.games * 1e3) / 10;
      targetMap.set(other.player_id, rec);
    }
  }
  const sortPairs = (a, b) => b.games !== a.games ? b.games - a.games : b.win_pct - a.win_pct;
  return {
    ...base,
    teammates: Array.from(teammateMap.values()).sort(sortPairs),
    opponents: Array.from(opponentMap.values()).sort(sortPairs),
    recent_matches: playerMatches.slice(0, 15)
  };
}

// server/src/db/index.ts
import path2 from "node:path";

// server/src/db/localJsonAdapter.ts
import crypto2 from "node:crypto";
import fs from "node:fs";
import path from "node:path";
function simulateSampleMatch(params) {
  let state = createInitialLiveState({
    gameType: "doubles",
    scoringMode: "side_out",
    targetScore: 11,
    winByTwo: true,
    initialServingTeam: "A",
    teamAPlayers: params.teamAIds,
    teamBPlayers: params.teamBIds
  });
  const baseTime = new Date(params.startedAt).getTime();
  for (let i = 0; i < params.rallyWinners.length; i++) {
    state = recordRally(state, params.rallyWinners[i], params.id);
    if (state.rallies.length > 0) {
      state.rallies[state.rallies.length - 1].created_at = new Date(
        baseTime + (i + 1) * 19e3
      ).toISOString();
    }
    if (state.winnerTeam) break;
  }
  const completedAt = state.winnerTeam ? new Date(baseTime + params.durationSeconds * 1e3).toISOString() : null;
  return {
    id: params.id,
    session_id: params.session_id,
    round_number: params.round_number,
    court_number: params.court_number,
    game_type: "doubles",
    scoring_mode: "side_out",
    target_score: 11,
    win_by_two: true,
    status: state.winnerTeam ? "completed" : "in_progress",
    team_a_name: params.teamAName,
    team_b_name: params.teamBName,
    team_a_score: state.teamAScore,
    team_b_score: state.teamBScore,
    winner_team: state.winnerTeam,
    started_at: params.startedAt,
    completed_at: completedAt,
    duration_seconds: params.durationSeconds,
    participants: [
      { match_id: params.id, player_id: params.teamAIds[0], team: "A", starting_side: "right" },
      { match_id: params.id, player_id: params.teamAIds[1], team: "A", starting_side: "left" },
      { match_id: params.id, player_id: params.teamBIds[0], team: "B", starting_side: "right" },
      { match_id: params.id, player_id: params.teamBIds[1], team: "B", starting_side: "left" }
    ],
    rallies: state.rallies,
    live_state: state
  };
}
function buildSeedData() {
  const now = Date.now();
  const h = (hoursAgo) => new Date(now - hoursAgo * 36e5).toISOString();
  const players = [
    { id: "11111111-1111-4111-8111-111111111101", name: "Kenji Sato", nickname: "Kenji", skill_rating: 4.25, avatar_color: "#1D4ED8", created_at: h(72) },
    { id: "11111111-1111-4111-8111-111111111102", name: "Maya Chen", nickname: "Maya", skill_rating: 4.1, avatar_color: "#0F7B55", created_at: h(72) },
    { id: "11111111-1111-4111-8111-111111111103", name: "Devon Brooks", nickname: "Dev", skill_rating: 3.95, avatar_color: "#D94F2B", created_at: h(70) },
    { id: "11111111-1111-4111-8111-111111111104", name: "Hannah Park", nickname: "Han", skill_rating: 4.05, avatar_color: "#B45309", created_at: h(70) },
    { id: "11111111-1111-4111-8111-111111111105", name: "Lucas Rivera", nickname: "Luke", skill_rating: 3.75, avatar_color: "#0E7490", created_at: h(65) },
    { id: "11111111-1111-4111-8111-111111111106", name: "Chloe Miller", nickname: "Chloe", skill_rating: 3.85, avatar_color: "#BE185D", created_at: h(65) },
    { id: "11111111-1111-4111-8111-111111111107", name: "Taro Watanabe", nickname: "Taro", skill_rating: 4.15, avatar_color: "#3F6212", created_at: h(60) },
    { id: "11111111-1111-4111-8111-111111111108", name: "Elena Novak", nickname: "Elena", skill_rating: 3.9, avatar_color: "#374151", created_at: h(60) }
  ];
  const sessionId = "22222222-2222-4222-8222-222222222201";
  const sessions = [
    {
      id: sessionId,
      title: "Wednesday Night Open Play",
      format: "rotating_partners",
      courts_count: 2,
      scoring_mode: "side_out",
      target_score: 11,
      win_by_two: true,
      location: "Yoyogi Outdoor Courts",
      status: "active",
      current_round: 2,
      started_at: h(1.5),
      ended_at: null,
      players: players.map((p, idx) => ({
        session_id: sessionId,
        player_id: p.id,
        team_slot: null,
        check_in_order: idx,
        active: true
      }))
    }
  ];
  const r1Court1 = simulateSampleMatch({
    id: "33333333-3333-4333-8333-333333333301",
    session_id: sessionId,
    round_number: 1,
    court_number: 1,
    teamAIds: [players[0].id, players[1].id],
    teamBIds: [players[2].id, players[3].id],
    teamAName: "Kenji & Maya",
    teamBName: "Devon & Hannah",
    rallyWinners: [
      "A",
      "A",
      "B",
      "B",
      "B",
      "A",
      "B",
      "A",
      "A",
      "A",
      "A",
      "B",
      "A",
      "A",
      "B",
      "B",
      "B",
      "B",
      "A",
      "B",
      "A",
      "A",
      "A",
      "B",
      "A",
      "A",
      "A",
      "B",
      "B",
      "B",
      "A",
      "A",
      "A",
      "A"
    ],
    startedAt: h(1.4),
    durationSeconds: 780
  });
  const r1Court2 = simulateSampleMatch({
    id: "33333333-3333-4333-8333-333333333302",
    session_id: sessionId,
    round_number: 1,
    court_number: 2,
    teamAIds: [players[4].id, players[5].id],
    teamBIds: [players[6].id, players[7].id],
    teamAName: "Lucas & Chloe",
    teamBName: "Taro & Elena",
    rallyWinners: [
      "B",
      "B",
      "B",
      "B",
      "A",
      "B",
      "B",
      "A",
      "A",
      "A",
      "B",
      "A",
      "A",
      "B",
      "B",
      "B",
      "A",
      "B",
      "B",
      "B",
      "B",
      "B",
      "B",
      "B"
    ],
    startedAt: h(1.4),
    durationSeconds: 690
  });
  const r2Court1 = simulateSampleMatch({
    id: "33333333-3333-4333-8333-333333333303",
    session_id: sessionId,
    round_number: 2,
    court_number: 1,
    teamAIds: [players[0].id, players[3].id],
    teamBIds: [players[6].id, players[1].id],
    teamAName: "Kenji & Hannah",
    teamBName: "Taro & Maya",
    rallyWinners: ["A", "A", "A", "B", "B", "B", "A", "B", "A", "A", "A"],
    startedAt: h(0.25),
    durationSeconds: 320
  });
  const r2Court2State = createInitialLiveState({
    gameType: "doubles",
    scoringMode: "side_out",
    targetScore: 11,
    winByTwo: true,
    initialServingTeam: "A",
    teamAPlayers: [players[2].id, players[4].id],
    teamBPlayers: [players[5].id, players[7].id]
  });
  const r2Court2 = {
    id: "33333333-3333-4333-8333-333333333304",
    session_id: sessionId,
    round_number: 2,
    court_number: 2,
    game_type: "doubles",
    scoring_mode: "side_out",
    target_score: 11,
    win_by_two: true,
    status: "scheduled",
    team_a_name: "Devon & Lucas",
    team_b_name: "Chloe & Elena",
    team_a_score: 0,
    team_b_score: 0,
    winner_team: null,
    started_at: h(0.2),
    completed_at: null,
    duration_seconds: 0,
    participants: [
      { match_id: "33333333-3333-4333-8333-333333333304", player_id: players[2].id, team: "A", starting_side: "right" },
      { match_id: "33333333-3333-4333-8333-333333333304", player_id: players[4].id, team: "A", starting_side: "left" },
      { match_id: "33333333-3333-4333-8333-333333333304", player_id: players[5].id, team: "B", starting_side: "right" },
      { match_id: "33333333-3333-4333-8333-333333333304", player_id: players[7].id, team: "B", starting_side: "left" }
    ],
    rallies: [],
    live_state: r2Court2State
  };
  const soloHistMatch = simulateSampleMatch({
    id: "33333333-3333-4333-8333-333333333305",
    session_id: null,
    round_number: null,
    court_number: null,
    teamAIds: [players[0].id, players[6].id],
    teamBIds: [players[1].id, players[3].id],
    teamAName: "Kenji & Taro",
    teamBName: "Maya & Hannah",
    rallyWinners: [
      "A",
      "B",
      "B",
      "B",
      "B",
      "A",
      "B",
      "B",
      "A",
      "A",
      "A",
      "A",
      "B",
      "A",
      "A",
      "B",
      "B",
      "B",
      "A",
      "B",
      "B",
      "B",
      "A",
      "A",
      "A",
      "A",
      "B",
      "A",
      "A",
      "A",
      "B",
      "B",
      "B",
      "A",
      "B",
      "B",
      "B"
    ],
    startedAt: h(26),
    durationSeconds: 940
  });
  return {
    players,
    sessions,
    matches: [r2Court1, r2Court2, r1Court1, r1Court2, soloHistMatch]
  };
}
var LocalJsonAdapter = class {
  filePath;
  data;
  constructor(filePath) {
    this.filePath = filePath;
    this.data = this.load();
  }
  load() {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, "utf-8");
        return JSON.parse(raw);
      }
    } catch {
    }
    const seed = buildSeedData();
    this.save(seed);
    return seed;
  }
  save(data = this.data) {
    const dir = path.dirname(this.filePath);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2), "utf-8");
  }
  async getStatus() {
    const rallies = this.data.matches.reduce((acc, m) => acc + m.rallies.length, 0);
    return {
      driver: "local_json",
      connected: true,
      label: "Local Dev Store (Ready for Supabase)",
      details: "Persisting to server/data/db.json \u2014 add SUPABASE_URL or DATABASE_URL in .env to switch to Postgres/Supabase",
      counts: {
        players: this.data.players.length,
        sessions: this.data.sessions.length,
        matches: this.data.matches.length,
        rallies
      }
    };
  }
  async listPlayers() {
    return [...this.data.players].sort((a, b) => a.name.localeCompare(b.name));
  }
  async getPlayer(id) {
    return this.data.players.find((p) => p.id === id) ?? null;
  }
  async createPlayer(input) {
    const player = {
      id: crypto2.randomUUID(),
      name: input.name.trim(),
      nickname: input.nickname ?? null,
      skill_rating: input.skill_rating ?? 3.5,
      avatar_color: input.avatar_color ?? "#1D4ED8",
      created_at: (/* @__PURE__ */ new Date()).toISOString()
    };
    this.data.players.push(player);
    this.save();
    return player;
  }
  async updatePlayer(id, input) {
    const idx = this.data.players.findIndex((p) => p.id === id);
    if (idx === -1) return null;
    this.data.players[idx] = { ...this.data.players[idx], ...input };
    this.save();
    return this.data.players[idx];
  }
  async deletePlayer(id) {
    const before = this.data.players.length;
    this.data.players = this.data.players.filter((p) => p.id !== id);
    this.save();
    return this.data.players.length < before;
  }
  async listSessions() {
    return [...this.data.sessions].sort((a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime()).map((s) => ({
      ...s,
      matches: this.data.matches.filter((m) => m.session_id === s.id)
    }));
  }
  async getSession(id) {
    const s = this.data.sessions.find((item) => item.id === id);
    if (!s) return null;
    return {
      ...s,
      matches: this.data.matches.filter((m) => m.session_id === id)
    };
  }
  async createSession(input) {
    const id = crypto2.randomUUID();
    const session = {
      id,
      title: input.title.trim(),
      format: input.format,
      courts_count: input.courts_count,
      scoring_mode: input.scoring_mode,
      target_score: input.target_score,
      win_by_two: input.win_by_two,
      location: input.location ?? null,
      status: "active",
      current_round: 1,
      started_at: (/* @__PURE__ */ new Date()).toISOString(),
      ended_at: null,
      players: input.player_ids.map((pid, idx) => ({
        session_id: id,
        player_id: pid,
        team_slot: input.team_slots?.[pid] ?? null,
        check_in_order: idx,
        active: true
      }))
    };
    this.data.sessions.unshift(session);
    this.save();
    return { ...session, matches: [] };
  }
  async updateSession(id, patch) {
    const idx = this.data.sessions.findIndex((s) => s.id === id);
    if (idx === -1) return null;
    this.data.sessions[idx] = { ...this.data.sessions[idx], ...patch };
    this.save();
    return this.getSession(id);
  }
  async deleteSession(id) {
    const before = this.data.sessions.length;
    this.data.sessions = this.data.sessions.filter((s) => s.id !== id);
    this.data.matches = this.data.matches.map(
      (m) => m.session_id === id ? { ...m, session_id: null } : m
    );
    this.save();
    return this.data.sessions.length < before;
  }
  async listMatches(filter) {
    let list = [...this.data.matches];
    if (filter?.sessionId) list = list.filter((m) => m.session_id === filter.sessionId);
    if (filter?.status) list = list.filter((m) => m.status === filter.status);
    if (filter?.playerId) {
      list = list.filter((m) => m.participants.some((p) => p.player_id === filter.playerId));
    }
    return list.sort(
      (a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime()
    );
  }
  async getMatch(id) {
    return this.data.matches.find((m) => m.id === id) ?? null;
  }
  async createMatch(input) {
    const id = crypto2.randomUUID();
    const match = {
      id,
      session_id: input.session_id ?? null,
      round_number: input.round_number ?? null,
      court_number: input.court_number ?? null,
      game_type: input.game_type,
      scoring_mode: input.scoring_mode,
      target_score: input.target_score,
      win_by_two: input.win_by_two,
      status: input.status ?? "in_progress",
      team_a_name: input.team_a_name,
      team_b_name: input.team_b_name,
      team_a_score: 0,
      team_b_score: 0,
      winner_team: null,
      started_at: (/* @__PURE__ */ new Date()).toISOString(),
      completed_at: null,
      duration_seconds: 0,
      participants: input.participants.map((p) => ({ match_id: id, ...p })),
      rallies: [],
      live_state: input.live_state ?? null
    };
    this.data.matches.unshift(match);
    this.save();
    return match;
  }
  async updateMatch(id, patch) {
    const idx = this.data.matches.findIndex((m) => m.id === id);
    if (idx === -1) return null;
    this.data.matches[idx] = { ...this.data.matches[idx], ...patch };
    this.save();
    return this.data.matches[idx];
  }
  async deleteMatch(id) {
    const before = this.data.matches.length;
    this.data.matches = this.data.matches.filter((m) => m.id !== id);
    this.save();
    return this.data.matches.length < before;
  }
  async exportAll() {
    return {
      exported_at: (/* @__PURE__ */ new Date()).toISOString(),
      players: this.data.players,
      sessions: this.data.sessions,
      matches: this.data.matches
    };
  }
};

// server/src/db/postgresAdapter.ts
import { Pool } from "pg";
var PostgresAdapter = class {
  pool;
  hostLabel;
  constructor(connectionString) {
    const isLocal = connectionString.includes("localhost") || connectionString.includes("127.0.0.1");
    this.pool = new Pool({
      connectionString,
      ssl: isLocal ? false : { rejectUnauthorized: false }
    });
    try {
      const parsed = new URL(connectionString);
      this.hostLabel = `${parsed.hostname}${parsed.pathname}`;
    } catch {
      this.hostLabel = "PostgreSQL";
    }
  }
  async getStatus() {
    try {
      const res = await this.pool.query(`
        select
          (select count(*)::int from public.players) as players,
          (select count(*)::int from public.sessions) as sessions,
          (select count(*)::int from public.matches) as matches,
          (select count(*)::int from public.rally_events) as rallies
      `);
      const counts = res.rows[0];
      return {
        driver: "postgres",
        connected: true,
        label: "PostgreSQL Connected",
        details: this.hostLabel,
        counts
      };
    } catch (error) {
      return {
        driver: "postgres",
        connected: false,
        label: "PostgreSQL Connection Error",
        details: error instanceof Error ? error.message : "Unable to reach PostgreSQL",
        counts: { players: 0, sessions: 0, matches: 0, rallies: 0 }
      };
    }
  }
  async listPlayers() {
    const res = await this.pool.query("select * from public.players order by name asc");
    return res.rows.map((r) => ({ ...r, skill_rating: Number(r.skill_rating ?? 3.5) }));
  }
  async getPlayer(id) {
    const res = await this.pool.query("select * from public.players where id = $1", [id]);
    if (res.rowCount === 0) return null;
    const r = res.rows[0];
    return { ...r, skill_rating: Number(r.skill_rating ?? 3.5) };
  }
  async createPlayer(input) {
    const res = await this.pool.query(
      `insert into public.players (name, nickname, skill_rating, avatar_color)
       values ($1, $2, $3, $4)
       returning *`,
      [
        input.name.trim(),
        input.nickname ?? null,
        input.skill_rating ?? 3.5,
        input.avatar_color ?? "#1D4ED8"
      ]
    );
    const r = res.rows[0];
    return { ...r, skill_rating: Number(r.skill_rating ?? 3.5) };
  }
  async updatePlayer(id, input) {
    const existing = await this.getPlayer(id);
    if (!existing) return null;
    const res = await this.pool.query(
      `update public.players
       set name = $2, nickname = $3, skill_rating = $4, avatar_color = $5
       where id = $1
       returning *`,
      [
        id,
        input.name ?? existing.name,
        input.nickname !== void 0 ? input.nickname : existing.nickname,
        input.skill_rating ?? existing.skill_rating,
        input.avatar_color ?? existing.avatar_color
      ]
    );
    const r = res.rows[0];
    return { ...r, skill_rating: Number(r.skill_rating ?? 3.5) };
  }
  async deletePlayer(id) {
    const res = await this.pool.query("delete from public.players where id = $1", [id]);
    return (res.rowCount ?? 0) > 0;
  }
  async listSessions() {
    const [sRes, spRes] = await Promise.all([
      this.pool.query("select * from public.sessions order by started_at desc"),
      this.pool.query("select * from public.session_players order by check_in_order asc")
    ]);
    const bySession = /* @__PURE__ */ new Map();
    for (const sp of spRes.rows) {
      const list = bySession.get(sp.session_id) ?? [];
      list.push(sp);
      bySession.set(sp.session_id, list);
    }
    return sRes.rows.map((s) => ({
      ...s,
      players: bySession.get(s.id) ?? []
    }));
  }
  async getSession(id) {
    const res = await this.pool.query("select * from public.sessions where id = $1", [id]);
    if (res.rowCount === 0) return null;
    const spRes = await this.pool.query(
      "select * from public.session_players where session_id = $1 order by check_in_order asc",
      [id]
    );
    const matches = await this.listMatches({ sessionId: id });
    return {
      ...res.rows[0],
      players: spRes.rows,
      matches
    };
  }
  async createSession(input) {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const sRes = await client.query(
        `insert into public.sessions (title, format, courts_count, scoring_mode, target_score, win_by_two, location)
         values ($1, $2, $3, $4, $5, $6, $7)
         returning *`,
        [
          input.title.trim(),
          input.format,
          input.courts_count,
          input.scoring_mode,
          input.target_score,
          input.win_by_two,
          input.location ?? null
        ]
      );
      const session = sRes.rows[0];
      const players = [];
      for (let i = 0; i < input.player_ids.length; i++) {
        const pid = input.player_ids[i];
        const slot = input.team_slots?.[pid] ?? null;
        await client.query(
          `insert into public.session_players (session_id, player_id, team_slot, check_in_order, active)
           values ($1, $2, $3, $4, true)`,
          [session.id, pid, slot, i]
        );
        players.push({
          session_id: session.id,
          player_id: pid,
          team_slot: slot,
          check_in_order: i,
          active: true
        });
      }
      await client.query("commit");
      return { ...session, players, matches: [] };
    } catch (err) {
      await client.query("rollback");
      throw err;
    } finally {
      client.release();
    }
  }
  async updateSession(id, patch) {
    const existing = await this.getSession(id);
    if (!existing) return null;
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      await client.query(
        `update public.sessions
         set title = $2, status = $3, current_round = $4, ended_at = $5
         where id = $1`,
        [
          id,
          patch.title ?? existing.title,
          patch.status ?? existing.status,
          patch.current_round ?? existing.current_round,
          patch.ended_at !== void 0 ? patch.ended_at : existing.ended_at
        ]
      );
      if (patch.players) {
        await client.query("delete from public.session_players where session_id = $1", [id]);
        for (let i = 0; i < patch.players.length; i++) {
          const p = patch.players[i];
          await client.query(
            `insert into public.session_players (session_id, player_id, team_slot, check_in_order, active)
             values ($1, $2, $3, $4, $5)`,
            [id, p.player_id, p.team_slot ?? null, p.check_in_order ?? i, p.active]
          );
        }
      }
      await client.query("commit");
    } catch (err) {
      await client.query("rollback");
      throw err;
    } finally {
      client.release();
    }
    return this.getSession(id);
  }
  async deleteSession(id) {
    const res = await this.pool.query("delete from public.sessions where id = $1", [id]);
    return (res.rowCount ?? 0) > 0;
  }
  async listMatches(filter) {
    const clauses = [];
    const values = [];
    if (filter?.sessionId) {
      values.push(filter.sessionId);
      clauses.push(`session_id = $${values.length}`);
    }
    if (filter?.status) {
      values.push(filter.status);
      clauses.push(`status = $${values.length}`);
    }
    const where = clauses.length > 0 ? `where ${clauses.join(" and ")}` : "";
    const mRes = await this.pool.query(
      `select * from public.matches ${where} order by started_at desc`,
      values
    );
    if (mRes.rows.length === 0) return [];
    const ids = mRes.rows.map((m) => m.id);
    const [pRes, rRes] = await Promise.all([
      this.pool.query("select * from public.match_participants where match_id = any($1::uuid[])", [
        ids
      ]),
      this.pool.query(
        "select * from public.rally_events where match_id = any($1::uuid[]) order by seq asc",
        [ids]
      )
    ]);
    const partMap = /* @__PURE__ */ new Map();
    for (const p of pRes.rows) {
      const list = partMap.get(p.match_id) ?? [];
      list.push(p);
      partMap.set(p.match_id, list);
    }
    const rallyMap = /* @__PURE__ */ new Map();
    for (const r of rRes.rows) {
      const list = rallyMap.get(r.match_id) ?? [];
      list.push(r);
      rallyMap.set(r.match_id, list);
    }
    let hydrated = mRes.rows.map((m) => ({
      ...m,
      participants: partMap.get(m.id) ?? [],
      rallies: rallyMap.get(m.id) ?? []
    }));
    if (filter?.playerId) {
      hydrated = hydrated.filter(
        (m) => m.participants.some((p) => p.player_id === filter.playerId)
      );
    }
    return hydrated;
  }
  async getMatch(id) {
    const mRes = await this.pool.query("select * from public.matches where id = $1", [id]);
    if (mRes.rowCount === 0) return null;
    const [pRes, rRes] = await Promise.all([
      this.pool.query("select * from public.match_participants where match_id = $1", [id]),
      this.pool.query("select * from public.rally_events where match_id = $1 order by seq asc", [
        id
      ])
    ]);
    return {
      ...mRes.rows[0],
      participants: pRes.rows,
      rallies: rRes.rows
    };
  }
  async createMatch(input) {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const mRes = await client.query(
        `insert into public.matches (
          session_id, round_number, court_number, game_type, scoring_mode,
          target_score, win_by_two, status, team_a_name, team_b_name, live_state
        ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
        returning *`,
        [
          input.session_id ?? null,
          input.round_number ?? null,
          input.court_number ?? null,
          input.game_type,
          input.scoring_mode,
          input.target_score,
          input.win_by_two,
          input.status ?? "in_progress",
          input.team_a_name,
          input.team_b_name,
          input.live_state ? JSON.stringify(input.live_state) : null
        ]
      );
      const match = mRes.rows[0];
      const participants = [];
      for (const p of input.participants) {
        await client.query(
          `insert into public.match_participants (match_id, player_id, team, starting_side)
           values ($1, $2, $3, $4)`,
          [match.id, p.player_id, p.team, p.starting_side]
        );
        participants.push({ match_id: match.id, ...p });
      }
      await client.query("commit");
      return { ...match, participants, rallies: [] };
    } catch (err) {
      await client.query("rollback");
      throw err;
    } finally {
      client.release();
    }
  }
  async updateMatch(id, patch) {
    const existing = await this.getMatch(id);
    if (!existing) return null;
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      await client.query(
        `update public.matches
         set status = $2,
             team_a_name = $3,
             team_b_name = $4,
             team_a_score = $5,
             team_b_score = $6,
             winner_team = $7,
             completed_at = $8,
             duration_seconds = $9,
             live_state = $10
         where id = $1`,
        [
          id,
          patch.status ?? existing.status,
          patch.team_a_name ?? existing.team_a_name,
          patch.team_b_name ?? existing.team_b_name,
          patch.team_a_score ?? existing.team_a_score,
          patch.team_b_score ?? existing.team_b_score,
          patch.winner_team !== void 0 ? patch.winner_team : existing.winner_team,
          patch.completed_at !== void 0 ? patch.completed_at : existing.completed_at,
          patch.duration_seconds ?? existing.duration_seconds,
          patch.live_state !== void 0 ? patch.live_state ? JSON.stringify(patch.live_state) : null : existing.live_state ? JSON.stringify(existing.live_state) : null
        ]
      );
      if (patch.rallies) {
        await client.query("delete from public.rally_events where match_id = $1", [id]);
        for (const r of patch.rallies) {
          await client.query(
            `insert into public.rally_events (
              match_id, seq, rally_winner, event_type, serving_team,
              server_number, team_a_score, team_b_score, callout, created_at
            ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
            [
              id,
              r.seq,
              r.rally_winner,
              r.event_type,
              r.serving_team,
              r.server_number,
              r.team_a_score,
              r.team_b_score,
              r.callout,
              r.created_at
            ]
          );
        }
      }
      await client.query("commit");
    } catch (err) {
      await client.query("rollback");
      throw err;
    } finally {
      client.release();
    }
    return this.getMatch(id);
  }
  async deleteMatch(id) {
    const res = await this.pool.query("delete from public.matches where id = $1", [id]);
    return (res.rowCount ?? 0) > 0;
  }
  async exportAll() {
    const [players, sessions, matches] = await Promise.all([
      this.listPlayers(),
      this.listSessions(),
      this.listMatches()
    ]);
    return {
      exported_at: (/* @__PURE__ */ new Date()).toISOString(),
      players,
      sessions,
      matches
    };
  }
};

// server/src/db/supabaseAdapter.ts
import { createClient } from "@supabase/supabase-js";
var SupabaseAdapter = class {
  client;
  url;
  constructor(url, key) {
    this.url = url;
    this.client = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
  }
  async getStatus() {
    try {
      const [pRes, sRes, mRes, rRes] = await Promise.all([
        this.client.from("players").select("*", { count: "exact", head: true }),
        this.client.from("sessions").select("*", { count: "exact", head: true }),
        this.client.from("matches").select("*", { count: "exact", head: true }),
        this.client.from("rally_events").select("*", { count: "exact", head: true })
      ]);
      const err = pRes.error || sRes.error || mRes.error || rRes.error;
      if (err) {
        return {
          driver: "supabase",
          connected: false,
          label: "Supabase (Schema / Auth Error)",
          details: err.message,
          counts: { players: 0, sessions: 0, matches: 0, rallies: 0 }
        };
      }
      return {
        driver: "supabase",
        connected: true,
        label: "Supabase Connected",
        details: new URL(this.url).host,
        counts: {
          players: pRes.count ?? 0,
          sessions: sRes.count ?? 0,
          matches: mRes.count ?? 0,
          rallies: rRes.count ?? 0
        }
      };
    } catch (error) {
      return {
        driver: "supabase",
        connected: false,
        label: "Supabase Disconnected",
        details: error instanceof Error ? error.message : "Unknown error",
        counts: { players: 0, sessions: 0, matches: 0, rallies: 0 }
      };
    }
  }
  async listPlayers() {
    const { data, error } = await this.client.from("players").select("*").order("name", { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []).map((row) => ({
      ...row,
      skill_rating: Number(row.skill_rating ?? 3.5)
    }));
  }
  async getPlayer(id) {
    const { data, error } = await this.client.from("players").select("*").eq("id", id).maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return null;
    return { ...data, skill_rating: Number(data.skill_rating ?? 3.5) };
  }
  async createPlayer(input) {
    const { data, error } = await this.client.from("players").insert({
      name: input.name.trim(),
      nickname: input.nickname ?? null,
      skill_rating: input.skill_rating ?? 3.5,
      avatar_color: input.avatar_color ?? "#1D4ED8"
    }).select("*").single();
    if (error) throw new Error(error.message);
    return { ...data, skill_rating: Number(data.skill_rating ?? 3.5) };
  }
  async updatePlayer(id, input) {
    const { data, error } = await this.client.from("players").update(input).eq("id", id).select("*").maybeSingle();
    if (error) throw new Error(error.message);
    return data ? { ...data, skill_rating: Number(data.skill_rating ?? 3.5) } : null;
  }
  async deletePlayer(id) {
    const { error } = await this.client.from("players").delete().eq("id", id);
    if (error) throw new Error(error.message);
    return true;
  }
  async listSessions() {
    const { data: sessions, error } = await this.client.from("sessions").select("*").order("started_at", { ascending: false });
    if (error) throw new Error(error.message);
    if (!sessions || sessions.length === 0) return [];
    const { data: spRows, error: spErr } = await this.client.from("session_players").select("*");
    if (spErr) throw new Error(spErr.message);
    const bySession = /* @__PURE__ */ new Map();
    for (const row of spRows ?? []) {
      const list = bySession.get(row.session_id) ?? [];
      list.push(row);
      bySession.set(row.session_id, list);
    }
    return sessions.map((s) => ({
      ...s,
      players: (bySession.get(s.id) ?? []).sort((a, b) => a.check_in_order - b.check_in_order)
    }));
  }
  async getSession(id) {
    const { data, error } = await this.client.from("sessions").select("*").eq("id", id).maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return null;
    const { data: spRows, error: spErr } = await this.client.from("session_players").select("*").eq("session_id", id).order("check_in_order", { ascending: true });
    if (spErr) throw new Error(spErr.message);
    const matches = await this.listMatches({ sessionId: id });
    return {
      ...data,
      players: spRows ?? [],
      matches
    };
  }
  async createSession(input) {
    const { data: session, error } = await this.client.from("sessions").insert({
      title: input.title.trim(),
      format: input.format,
      courts_count: input.courts_count,
      scoring_mode: input.scoring_mode,
      target_score: input.target_score,
      win_by_two: input.win_by_two,
      location: input.location ?? null,
      status: "active",
      current_round: 1
    }).select("*").single();
    if (error) throw new Error(error.message);
    const spInserts = input.player_ids.map((playerId, idx) => ({
      session_id: session.id,
      player_id: playerId,
      team_slot: input.team_slots?.[playerId] ?? null,
      check_in_order: idx,
      active: true
    }));
    if (spInserts.length > 0) {
      const { error: spErr } = await this.client.from("session_players").insert(spInserts);
      if (spErr) throw new Error(spErr.message);
    }
    return {
      ...session,
      players: spInserts,
      matches: []
    };
  }
  async updateSession(id, patch) {
    const { players, ...sessionFields } = patch;
    if (Object.keys(sessionFields).length > 0) {
      const { error } = await this.client.from("sessions").update(sessionFields).eq("id", id);
      if (error) throw new Error(error.message);
    }
    if (players) {
      await this.client.from("session_players").delete().eq("session_id", id);
      if (players.length > 0) {
        const { error: spErr } = await this.client.from("session_players").insert(
          players.map((p, idx) => ({
            session_id: id,
            player_id: p.player_id,
            team_slot: p.team_slot ?? null,
            check_in_order: p.check_in_order ?? idx,
            active: p.active
          }))
        );
        if (spErr) throw new Error(spErr.message);
      }
    }
    return this.getSession(id);
  }
  async deleteSession(id) {
    const { error } = await this.client.from("sessions").delete().eq("id", id);
    if (error) throw new Error(error.message);
    return true;
  }
  async listMatches(filter) {
    let query = this.client.from("matches").select("*").order("started_at", { ascending: false });
    if (filter?.sessionId) query = query.eq("session_id", filter.sessionId);
    if (filter?.status) query = query.eq("status", filter.status);
    const { data: matches, error } = await query;
    if (error) throw new Error(error.message);
    if (!matches || matches.length === 0) return [];
    const matchIds = matches.map((m) => m.id);
    const [partRes, rallyRes] = await Promise.all([
      this.client.from("match_participants").select("*").in("match_id", matchIds),
      this.client.from("rally_events").select("*").in("match_id", matchIds).order("seq", { ascending: true })
    ]);
    if (partRes.error) throw new Error(partRes.error.message);
    if (rallyRes.error) throw new Error(rallyRes.error.message);
    const partMap = /* @__PURE__ */ new Map();
    for (const p of partRes.data ?? []) {
      const list = partMap.get(p.match_id) ?? [];
      list.push(p);
      partMap.set(p.match_id, list);
    }
    const rallyMap = /* @__PURE__ */ new Map();
    for (const r of rallyRes.data ?? []) {
      const list = rallyMap.get(r.match_id) ?? [];
      list.push(r);
      rallyMap.set(r.match_id, list);
    }
    let hydrated = matches.map((m) => ({
      ...m,
      participants: partMap.get(m.id) ?? [],
      rallies: rallyMap.get(m.id) ?? []
    }));
    if (filter?.playerId) {
      hydrated = hydrated.filter(
        (m) => m.participants.some((p) => p.player_id === filter.playerId)
      );
    }
    return hydrated;
  }
  async getMatch(id) {
    const { data, error } = await this.client.from("matches").select("*").eq("id", id).maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return null;
    const [partRes, rallyRes] = await Promise.all([
      this.client.from("match_participants").select("*").eq("match_id", id),
      this.client.from("rally_events").select("*").eq("match_id", id).order("seq", { ascending: true })
    ]);
    if (partRes.error) throw new Error(partRes.error.message);
    if (rallyRes.error) throw new Error(rallyRes.error.message);
    return {
      ...data,
      participants: partRes.data ?? [],
      rallies: rallyRes.data ?? []
    };
  }
  async createMatch(input) {
    const { data: match, error } = await this.client.from("matches").insert({
      session_id: input.session_id ?? null,
      round_number: input.round_number ?? null,
      court_number: input.court_number ?? null,
      game_type: input.game_type,
      scoring_mode: input.scoring_mode,
      target_score: input.target_score,
      win_by_two: input.win_by_two,
      status: input.status ?? "in_progress",
      team_a_name: input.team_a_name,
      team_b_name: input.team_b_name,
      team_a_score: 0,
      team_b_score: 0,
      winner_team: null,
      live_state: input.live_state ?? null
    }).select("*").single();
    if (error) throw new Error(error.message);
    const participantRows = input.participants.map((p) => ({
      match_id: match.id,
      player_id: p.player_id,
      team: p.team,
      starting_side: p.starting_side
    }));
    if (participantRows.length > 0) {
      const { error: pErr } = await this.client.from("match_participants").insert(participantRows);
      if (pErr) throw new Error(pErr.message);
    }
    return {
      ...match,
      participants: participantRows,
      rallies: []
    };
  }
  async updateMatch(id, patch) {
    const { rallies, ...matchFields } = patch;
    if (Object.keys(matchFields).length > 0) {
      const { error } = await this.client.from("matches").update(matchFields).eq("id", id);
      if (error) throw new Error(error.message);
    }
    if (rallies) {
      await this.client.from("rally_events").delete().eq("match_id", id);
      if (rallies.length > 0) {
        const { error: rErr } = await this.client.from("rally_events").insert(
          rallies.map((r) => ({
            match_id: id,
            seq: r.seq,
            rally_winner: r.rally_winner,
            event_type: r.event_type,
            serving_team: r.serving_team,
            server_number: r.server_number,
            team_a_score: r.team_a_score,
            team_b_score: r.team_b_score,
            callout: r.callout,
            created_at: r.created_at
          }))
        );
        if (rErr) throw new Error(rErr.message);
      }
    }
    return this.getMatch(id);
  }
  async deleteMatch(id) {
    const { error } = await this.client.from("matches").delete().eq("id", id);
    if (error) throw new Error(error.message);
    return true;
  }
  async exportAll() {
    const [players, sessions, matches] = await Promise.all([
      this.listPlayers(),
      this.listSessions(),
      this.listMatches()
    ]);
    return {
      exported_at: (/* @__PURE__ */ new Date()).toISOString(),
      players,
      sessions,
      matches
    };
  }
};

// server/src/db/index.ts
var singleton = null;
function getRepository() {
  if (singleton) return singleton;
  const supabaseUrl = process.env.SUPABASE_URL?.trim() || process.env.VITE_SUPABASE_URL?.trim() || process.env.SCHEDULER_SUPABASE_URL?.trim();
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || process.env.SUPABASE_ANON_KEY?.trim() || process.env.SUPABASE_PUBLISHABLE_KEY?.trim() || process.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() || process.env.VITE_SUPABASE_ANON_KEY?.trim() || process.env.SCHEDULER_SUPABASE_KEY?.trim();
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (supabaseUrl && supabaseKey) {
    let host = supabaseUrl;
    try {
      host = new URL(supabaseUrl).host;
    } catch {
    }
    console.log(`[DB] Using SupabaseAdapter (${host})`);
    singleton = new SupabaseAdapter(supabaseUrl, supabaseKey);
    return singleton;
  }
  if (databaseUrl) {
    console.log("[DB] Using PostgresAdapter (DATABASE_URL)");
    singleton = new PostgresAdapter(databaseUrl);
    return singleton;
  }
  const localPath = process.env.VERCEL ? "/tmp/momodinks-db.json" : path2.resolve(process.cwd(), "server/data/db.json");
  console.log(`[DB] Using LocalJsonAdapter (${localPath}) \u2014 set SUPABASE_URL or DATABASE_URL in .env to connect Postgres/Supabase`);
  singleton = new LocalJsonAdapter(localPath);
  return singleton;
}

// server/src/schedulerSync.ts
import { createClient as createClient2 } from "@supabase/supabase-js";

// shared/venues.ts
var VENUES = [
  {
    id: "fukuda",
    shortName: "\u798F\u7530\u516C\u5712",
    fullName: "\u30B7\u30DE\u30C0\u307F\u3089\u3044\u30A2\u30EA\u30FC\u30CA\u6C34\u5CF6\uFF08\u798F\u7530\u516C\u5712\uFF09",
    courtType: "indoor"
  },
  {
    id: "mizushima",
    shortName: "\u6C34\u5CF6\u4F53\u80B2\u9928",
    fullName: "\u6C34\u5CF6\u4F53\u80B2\u9928",
    courtType: "indoor"
  },
  {
    id: "kurashiki_gym",
    shortName: "\u5009\u6577\u4F53\u80B2\u9928",
    fullName: "\u5009\u6577\u4F53\u80B2\u9928",
    courtType: "indoor"
  },
  {
    id: "kurashiki_weightlifting",
    shortName: "\u5009\u6577\u904B\u52D5\u516C\u5712WL\u5834",
    fullName: "\u5009\u6577\u904B\u52D5\u516C\u5712 \u30A6\u30A8\u30A4\u30C8\u30EA\u30D5\u30C6\u30A3\u30F3\u30B0\u5834",
    courtType: "indoor"
  },
  {
    id: "mizushima_fureai",
    shortName: "\u6C34\u5CF6\u3075\u308C\u3042\u3044\u30BB\u30F3\u30BF\u30FC",
    fullName: "\u6C34\u5CF6\u3075\u308C\u3042\u3044\u30BB\u30F3\u30BF\u30FC \u4F53\u80B2\u9928",
    courtType: "indoor"
  },
  {
    id: "mabi",
    shortName: "\u771F\u5099\u7DCF\u5408\u516C\u5712",
    fullName: "\u771F\u5099\u7DCF\u5408\u516C\u5712 \u4F53\u80B2\u9928",
    courtType: "indoor"
  },
  {
    id: "tamashima",
    shortName: "\u7389\u5CF6\u306E\u68EE",
    fullName: "\u7389\u5CF6\u306E\u68EE \u4F53\u80B2\u9928",
    courtType: "indoor"
  },
  {
    id: "nakayama",
    shortName: "\u4E2D\u5C71\u516C\u5712",
    fullName: "\u4E2D\u5C71\u516C\u5712 \u4F53\u80B2\u9928",
    courtType: "indoor"
  },
  {
    id: "nadasaki",
    shortName: "\u7058\u5D0E\u4F53\u80B2\u30BB\u30F3\u30BF\u30FC",
    fullName: "\u7058\u5D0E\u4F53\u80B2\u30BB\u30F3\u30BF\u30FC",
    courtType: "indoor"
  },
  {
    id: "futsukaichi",
    shortName: "\u4E8C\u65E5\u5E02\u516C\u5712\u30C6\u30CB\u30B9",
    fullName: "\u4E8C\u65E5\u5E02\u516C\u5712\u30C6\u30CB\u30B9\u30B3\u30FC\u30C8\uFF08\u7167\u660E\u3042\u308A\uFF09",
    courtType: "outdoor"
  },
  {
    id: "yoshiigawa_1",
    shortName: "\u5409\u4E95\u5DDD\u7B2C1\u7DD1\u5730",
    fullName: "\u5409\u4E95\u5DDD\u7B2C1\u7DD1\u5730 \u30C6\u30CB\u30B9\u30B3\u30FC\u30C8\uFF08\u301C17:00\uFF09",
    courtType: "outdoor"
  },
  {
    id: "hyakkengawa_a",
    shortName: "\u767E\u9593\u5DDD\u7DD1\u5730(A\u30FB\u6771\u5DDD\u539F)",
    fullName: "\u767E\u9593\u5DDD\u7DD1\u5730 \u30C6\u30CB\u30B9\u30B3\u30FC\u30C8A\uFF08\u6771\u5DDD\u539F\u30FB\u30CF\u30FC\u30C9\u30B3\u30FC\u30C8\u30FB\u301C17:00\uFF09",
    courtType: "outdoor"
  },
  {
    id: "hyakkengawa_c",
    shortName: "\u767E\u9593\u5DDD\u7DD1\u5730(C\u30FB\u795E\u4E0B)",
    fullName: "\u767E\u9593\u5DDD\u7DD1\u5730 \u30C6\u30CB\u30B9\u30B3\u30FC\u30C8C\uFF08\u795E\u4E0B\u30FB\u30CF\u30FC\u30C9\u30B3\u30FC\u30C8\u30FB\u301C17:00\uFF09",
    courtType: "outdoor"
  }
];
var VENUE_MAP = new Map(VENUES.map((v) => [v.id, v]));
function resolveVenue(venueId, manualVenueName, fallbackCourtType = "indoor") {
  if (venueId && venueId !== "other") {
    const found = VENUE_MAP.get(venueId);
    if (found) return found;
  }
  const cleanName = manualVenueName?.trim() || venueId || "Custom Venue";
  return {
    id: venueId || "other",
    shortName: cleanName,
    fullName: cleanName,
    courtType: fallbackCourtType
  };
}

// server/src/schedulerSync.ts
var schedulerClient = null;
function getSchedulerClient() {
  if (schedulerClient) return schedulerClient;
  const url = process.env.SCHEDULER_SUPABASE_URL?.trim() || process.env.VITE_SUPABASE_URL?.trim() || process.env.SUPABASE_URL?.trim();
  const key = process.env.SCHEDULER_SUPABASE_KEY?.trim() || process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || process.env.SUPABASE_PUBLISHABLE_KEY?.trim() || process.env.SUPABASE_ANON_KEY?.trim() || process.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() || process.env.VITE_SUPABASE_ANON_KEY?.trim();
  if (!url || !key) return null;
  schedulerClient = createClient2(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false
    }
  });
  return schedulerClient;
}
function getTodayJstDateKey() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(/* @__PURE__ */ new Date());
}
async function fetchSchedulerUpcoming(minDateInput) {
  const minDate = minDateInput?.trim() || getTodayJstDateKey();
  const client = getSchedulerClient();
  if (!client) {
    return {
      connected: false,
      min_date: minDate,
      sessions: [],
      players: [],
      error: "Scheduler Supabase credentials not configured (SCHEDULER_SUPABASE_URL / KEY)."
    };
  }
  const [bookedRes, attendeesRes, votesRes] = await Promise.all([
    client.from("booked_sessions").select("date_key, start_hour, end_hour, venue_id, venue_name, map_url, court_type").gte("date_key", minDate).order("date_key", { ascending: true }),
    client.from("session_attendees").select("session_date, start_hour, end_hour, venue_id, venue_name, attendee_name, status").gte("session_date", minDate),
    client.from("calendar_votes").select("name, note").order("created_at", { ascending: true })
  ]);
  if (bookedRes.error) {
    return {
      connected: false,
      min_date: minDate,
      sessions: [],
      players: [],
      error: bookedRes.error.message
    };
  }
  const attendeesByDate = /* @__PURE__ */ new Map();
  const playerMap = /* @__PURE__ */ new Map();
  for (const row of attendeesRes.data ?? []) {
    const dateKey = String(row.session_date ?? "");
    const name = String(row.attendee_name ?? "").trim();
    if (!dateKey || !name) continue;
    const status = row.status === "maybe" ? "maybe" : "yes";
    const list = attendeesByDate.get(dateKey) ?? [];
    list.push({ attendee_name: name, status });
    attendeesByDate.set(dateKey, list);
    if (!playerMap.has(name.toLowerCase())) {
      playerMap.set(name.toLowerCase(), { name, note: "" });
    }
  }
  for (const row of votesRes.data ?? []) {
    const name = String(row.name ?? "").trim();
    if (!name) continue;
    const note = String(row.note ?? "").trim();
    if (!playerMap.has(name.toLowerCase())) {
      playerMap.set(name.toLowerCase(), { name, note });
    } else if (note) {
      const existing = playerMap.get(name.toLowerCase());
      if (!existing.note) existing.note = note;
    }
  }
  const sessions = (bookedRes.data ?? []).map((row) => {
    const courtType = row.court_type === "outdoor" ? "outdoor" : "indoor";
    const resolved = resolveVenue(
      String(row.venue_id ?? "other"),
      row.venue_name ? String(row.venue_name) : "",
      courtType
    );
    return {
      date_key: String(row.date_key),
      start_hour: Number(row.start_hour ?? 19),
      end_hour: Number(row.end_hour ?? 21),
      venue_id: resolved.id,
      venue_short_name: resolved.shortName,
      venue_full_name: resolved.fullName,
      map_url: String(row.map_url ?? ""),
      court_type: courtType,
      attendees: attendeesByDate.get(String(row.date_key)) ?? []
    };
  });
  return {
    connected: true,
    min_date: minDate,
    sessions,
    players: Array.from(playerMap.values())
  };
}

// server/src/index.ts
var app = express();
app.use(cors());
app.use(express.json({ limit: "5mb" }));
var repo = getRepository();
function firstName(player, fallback) {
  if (!player) return fallback;
  return player.nickname?.trim() || player.name.split(" ")[0];
}
app.get("/api/health", async (_req, res) => {
  const status = await repo.getStatus();
  res.json({ ok: true, db: status });
});
app.get("/api/db/status", async (_req, res) => {
  const status = await repo.getStatus();
  res.json(status);
});
app.get("/api/scheduler/upcoming", async (req, res) => {
  try {
    const minDate = typeof req.query.minDate === "string" ? req.query.minDate : void 0;
    const payload = await fetchSchedulerUpcoming(minDate);
    res.json(payload);
  } catch (err) {
    res.status(500).json({
      connected: false,
      min_date: "",
      sessions: [],
      players: [],
      error: err instanceof Error ? err.message : "Failed to fetch scheduler data"
    });
  }
});
app.get("/api/db/schema", (_req, res) => {
  const schemaPath = path3.resolve(process.cwd(), "supabase/migrations/001_initial_schema.sql");
  const sql = fs2.existsSync(schemaPath) ? fs2.readFileSync(schemaPath, "utf-8") : "";
  res.json({ sql });
});
app.get("/api/export", async (_req, res) => {
  try {
    const dump = await repo.exportAll();
    res.json(dump);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Export failed" });
  }
});
app.get("/api/export-project", (_req, res) => {
  const zipPath = path3.resolve(process.cwd(), "server/data/sideout-pb-scoring.zip");
  if (!fs2.existsSync(zipPath)) {
    res.status(404).json({ error: "Project archive not found" });
    return;
  }
  res.download(zipPath, "sideout-pb-scoring.zip");
});
var SEED_COLORS = ["#1D4ED8", "#15803D", "#E25747", "#B45309", "#0E7490", "#BE185D", "#3F6212"];
app.get("/api/players", async (_req, res) => {
  try {
    let players = await repo.listPlayers();
    if (players.length === 0) {
      const upcoming = await fetchSchedulerUpcoming().catch(() => null);
      if (upcoming?.connected && upcoming.players.length > 0) {
        for (let i = 0; i < upcoming.players.length; i++) {
          const sp = upcoming.players[i];
          if (!sp.name.trim()) continue;
          await repo.createPlayer({
            name: sp.name.trim(),
            skill_rating: 3.5,
            avatar_color: SEED_COLORS[i % SEED_COLORS.length]
          });
        }
        players = await repo.listPlayers();
      }
    }
    res.json(players);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to list players" });
  }
});
app.post("/api/players", async (req, res) => {
  try {
    const { name, nickname, skill_rating, avatar_color } = req.body ?? {};
    if (!name || typeof name !== "string" || !name.trim()) {
      res.status(400).json({ error: "Player name is required" });
      return;
    }
    const created = await repo.createPlayer({ name, nickname, skill_rating, avatar_color });
    res.status(201).json(created);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to create player" });
  }
});
app.patch("/api/players/:id", async (req, res) => {
  try {
    const updated = await repo.updatePlayer(req.params.id, req.body ?? {});
    if (!updated) {
      res.status(404).json({ error: "Player not found" });
      return;
    }
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to update player" });
  }
});
app.delete("/api/players/:id", async (req, res) => {
  try {
    const ok = await repo.deletePlayer(req.params.id);
    res.json({ deleted: ok });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to delete player" });
  }
});
app.get("/api/standings", async (_req, res) => {
  try {
    const [players, matches] = await Promise.all([repo.listPlayers(), repo.listMatches()]);
    res.json(computeStandings(players, matches));
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to compute standings" });
  }
});
app.get("/api/players/:id/stats", async (req, res) => {
  try {
    const [players, matches] = await Promise.all([repo.listPlayers(), repo.listMatches()]);
    const stats = computePlayerDetailStats(req.params.id, players, matches);
    if (!stats) {
      res.status(404).json({ error: "Player not found" });
      return;
    }
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to compute player stats" });
  }
});
app.get("/api/sessions", async (_req, res) => {
  try {
    const sessions = await repo.listSessions();
    res.json(sessions);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to list sessions" });
  }
});
app.get("/api/sessions/:id", async (req, res) => {
  try {
    const session = await repo.getSession(req.params.id);
    if (!session) {
      res.status(404).json({ error: "Session not found" });
      return;
    }
    res.json(session);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to load session" });
  }
});
app.post("/api/sessions", async (req, res) => {
  try {
    const body = req.body ?? {};
    if (!body.title || !Array.isArray(body.player_ids) || body.player_ids.length < 4) {
      res.status(400).json({ error: "Session title and at least 4 players are required" });
      return;
    }
    const session = await repo.createSession({
      title: body.title,
      format: body.format ?? "rotating_partners",
      courts_count: Number(body.courts_count ?? 2),
      scoring_mode: body.scoring_mode ?? "side_out",
      target_score: Number(body.target_score ?? 11),
      win_by_two: body.win_by_two !== false,
      location: body.location ?? null,
      player_ids: body.player_ids,
      team_slots: body.team_slots
    });
    const players = await repo.listPlayers();
    const playerMap = new Map(players.map((p) => [p.id, p]));
    const proposal = generateNextRound({
      format: session.format,
      courtsCount: session.courts_count,
      sessionPlayers: session.players,
      previousMatches: [],
      nextRoundNumber: 1
    });
    const createdMatches = [];
    for (const pm of proposal.matches) {
      const a1 = playerMap.get(pm.teamA[0]);
      const a2 = playerMap.get(pm.teamA[1]);
      const b1 = playerMap.get(pm.teamB[0]);
      const b2 = playerMap.get(pm.teamB[1]);
      const liveState = createInitialLiveState({
        gameType: "doubles",
        scoringMode: session.scoring_mode,
        targetScore: session.target_score,
        winByTwo: session.win_by_two,
        initialServingTeam: "A",
        teamAPlayers: pm.teamA,
        teamBPlayers: pm.teamB
      });
      const match = await repo.createMatch({
        session_id: session.id,
        round_number: 1,
        court_number: pm.court_number,
        game_type: "doubles",
        scoring_mode: session.scoring_mode,
        target_score: session.target_score,
        win_by_two: session.win_by_two,
        status: "scheduled",
        team_a_name: `${firstName(a1, "P1")} & ${firstName(a2, "P2")}`,
        team_b_name: `${firstName(b1, "P3")} & ${firstName(b2, "P4")}`,
        participants: [
          { player_id: pm.teamA[0], team: "A", starting_side: "right" },
          { player_id: pm.teamA[1], team: "A", starting_side: "left" },
          { player_id: pm.teamB[0], team: "B", starting_side: "right" },
          { player_id: pm.teamB[1], team: "B", starting_side: "left" }
        ],
        live_state: liveState
      });
      createdMatches.push(match);
    }
    res.status(201).json({ ...session, matches: createdMatches });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to create session" });
  }
});
app.post("/api/sessions/:id/next-round", async (req, res) => {
  try {
    const session = await repo.getSession(req.params.id);
    if (!session) {
      res.status(404).json({ error: "Session not found" });
      return;
    }
    const players = await repo.listPlayers();
    const playerMap = new Map(players.map((p) => [p.id, p]));
    const nextRoundNumber = session.current_round + 1;
    const proposal = generateNextRound({
      format: session.format,
      courtsCount: session.courts_count,
      sessionPlayers: session.players,
      previousMatches: session.matches ?? [],
      nextRoundNumber
    });
    const createdMatches = [];
    for (const pm of proposal.matches) {
      const a1 = playerMap.get(pm.teamA[0]);
      const a2 = playerMap.get(pm.teamA[1]);
      const b1 = playerMap.get(pm.teamB[0]);
      const b2 = playerMap.get(pm.teamB[1]);
      const liveState = createInitialLiveState({
        gameType: "doubles",
        scoringMode: session.scoring_mode,
        targetScore: session.target_score,
        winByTwo: session.win_by_two,
        initialServingTeam: "A",
        teamAPlayers: pm.teamA,
        teamBPlayers: pm.teamB
      });
      const match = await repo.createMatch({
        session_id: session.id,
        round_number: nextRoundNumber,
        court_number: pm.court_number,
        game_type: "doubles",
        scoring_mode: session.scoring_mode,
        target_score: session.target_score,
        win_by_two: session.win_by_two,
        status: "scheduled",
        team_a_name: `${firstName(a1, "P1")} & ${firstName(a2, "P2")}`,
        team_b_name: `${firstName(b1, "P3")} & ${firstName(b2, "P4")}`,
        participants: [
          { player_id: pm.teamA[0], team: "A", starting_side: "right" },
          { player_id: pm.teamA[1], team: "A", starting_side: "left" },
          { player_id: pm.teamB[0], team: "B", starting_side: "right" },
          { player_id: pm.teamB[1], team: "B", starting_side: "left" }
        ],
        live_state: liveState
      });
      createdMatches.push(match);
    }
    const updated = await repo.updateSession(session.id, { current_round: nextRoundNumber });
    res.json({ session: updated, new_matches: createdMatches, sitting_out: proposal.sitting_out });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to generate round" });
  }
});
app.get("/api/sessions/:id/standings", async (req, res) => {
  try {
    const session = await repo.getSession(req.params.id);
    if (!session) {
      res.status(404).json({ error: "Session not found" });
      return;
    }
    const allPlayers = await repo.listPlayers();
    const sessionPlayerIds = new Set(session.players.map((p) => p.player_id));
    const sessionPlayers = allPlayers.filter((p) => sessionPlayerIds.has(p.id));
    res.json(computeStandings(sessionPlayers, session.matches ?? []));
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to compute session standings" });
  }
});
app.post("/api/sessions/:id/end", async (req, res) => {
  try {
    const updated = await repo.updateSession(req.params.id, {
      status: "completed",
      ended_at: (/* @__PURE__ */ new Date()).toISOString()
    });
    if (!updated) {
      res.status(404).json({ error: "Session not found" });
      return;
    }
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to end session" });
  }
});
app.delete("/api/sessions/:id", async (req, res) => {
  try {
    const ok = await repo.deleteSession(req.params.id);
    res.json({ deleted: ok });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to delete session" });
  }
});
app.get("/api/matches", async (req, res) => {
  try {
    const matches = await repo.listMatches({
      sessionId: typeof req.query.sessionId === "string" ? req.query.sessionId : void 0,
      playerId: typeof req.query.playerId === "string" ? req.query.playerId : void 0,
      status: req.query.status === "scheduled" || req.query.status === "in_progress" || req.query.status === "completed" ? req.query.status : void 0
    });
    res.json(matches);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to list matches" });
  }
});
app.get("/api/matches/:id", async (req, res) => {
  try {
    const match = await repo.getMatch(req.params.id);
    if (!match) {
      res.status(404).json({ error: "Match not found" });
      return;
    }
    res.json(match);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to fetch match" });
  }
});
app.post("/api/matches", async (req, res) => {
  try {
    const body = req.body ?? {};
    const gameType = body.game_type ?? "doubles";
    const scoringMode = body.scoring_mode ?? "side_out";
    const targetScore = Number(body.target_score ?? 11);
    const winByTwo = body.win_by_two !== false;
    const participants = Array.isArray(body.participants) ? body.participants : [];
    const teamA = participants.filter((p) => p.team === "A");
    const teamB = participants.filter((p) => p.team === "B");
    const liveState = body.live_state ?? createInitialLiveState({
      gameType,
      scoringMode,
      targetScore,
      winByTwo,
      initialServingTeam: body.initial_serving_team ?? "A",
      teamAPlayers: [teamA[0]?.player_id ?? null, teamA[1]?.player_id ?? null],
      teamBPlayers: [teamB[0]?.player_id ?? null, teamB[1]?.player_id ?? null]
    });
    const created = await repo.createMatch({
      session_id: body.session_id ?? null,
      round_number: body.round_number ?? null,
      court_number: body.court_number ?? null,
      game_type: gameType,
      scoring_mode: scoringMode,
      target_score: targetScore,
      win_by_two: winByTwo,
      status: body.status ?? "in_progress",
      team_a_name: body.team_a_name || "Team A",
      team_b_name: body.team_b_name || "Team B",
      participants,
      live_state: liveState
    });
    res.status(201).json(created);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to create match" });
  }
});
app.patch("/api/matches/:id", async (req, res) => {
  try {
    const updated = await repo.updateMatch(req.params.id, req.body ?? {});
    if (!updated) {
      res.status(404).json({ error: "Match not found" });
      return;
    }
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to update match" });
  }
});
app.post("/api/matches/:id/quick-score", async (req, res) => {
  try {
    const { team_a_score, team_b_score } = req.body ?? {};
    const a = Number(team_a_score);
    const b = Number(team_b_score);
    if (!Number.isFinite(a) || !Number.isFinite(b) || a < 0 || b < 0 || a === b) {
      res.status(400).json({ error: "Enter valid non-tied scores to record a quick result" });
      return;
    }
    const existing = await repo.getMatch(req.params.id);
    if (!existing) {
      res.status(404).json({ error: "Match not found" });
      return;
    }
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const duration = Math.max(
      60,
      Math.round((Date.now() - new Date(existing.started_at).getTime()) / 1e3)
    );
    const updated = await repo.updateMatch(req.params.id, {
      status: "completed",
      team_a_score: a,
      team_b_score: b,
      winner_team: a > b ? "A" : "B",
      completed_at: now,
      duration_seconds: existing.duration_seconds || duration
    });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to save quick score" });
  }
});
app.delete("/api/matches/:id", async (req, res) => {
  try {
    const ok = await repo.deleteMatch(req.params.id);
    res.json({ deleted: ok });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to delete match" });
  }
});
if (!process.env.VERCEL) {
  const distDir = path3.resolve(process.cwd(), "dist");
  if (fs2.existsSync(distDir)) {
    app.use(express.static(distDir));
    app.get("/{*splat}", (_req, res) => {
      res.sendFile(path3.join(distDir, "index.html"));
    });
  }
  const PORT = Number(process.env.PORT ?? 4e3);
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[API] Sideout Pickleball server listening on http://localhost:${PORT}`);
  });
}
var index_default = app;
export {
  index_default as default
};
