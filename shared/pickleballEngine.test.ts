import { describe, expect, it } from 'vitest';
import {
  computeMatchAnalytics,
  computeMomentum,
  computePlayerAttributes,
  computePlayerSituationalSplits,
  computePlayerSkillProfiles,
  computeSessionHighlights,
  createInitialLiveState,
  formatScoreCallout,
  getActiveServerPlayerId,
  getActiveServerSide,
  isGamePoint,
  isUpsetMatch,
  recordRally,
  redoLastRally,
  tagRallyOutcome,
  undoLastRally,
} from './pickleballEngine';
import type { Match, Player, Session } from './types';

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

  it('computes match analytics (side-outs, streaks, comebacks, game points, splits)', () => {
    let s = createInitialLiveState({
      gameType: 'doubles',
      scoringMode: 'side_out',
      targetScore: 11,
      winByTwo: true,
      initialServingTeam: 'A',
      teamAPlayers: ['A1', 'A2'],
      teamBPlayers: ['B1', 'B2'],
    });

    // B breaks A on opening serve (0-0-2 -> side-out)
    s = recordRally(s, 'B', 'm4');
    // B scores 2 points on Server 1
    s = recordRally(s, 'B', 'm4');
    s = recordRally(s, 'B', 'm4');
    // A wins 2 rallies to side out B (Server 1 -> Server 2 -> Side-out)
    s = recordRally(s, 'A', 'm4');
    s = recordRally(s, 'A', 'm4');
    // A goes on an 11-point run to win 11-2
    for (let i = 0; i < 11; i++) {
      s = recordRally(s, 'A', 'm4');
    }

    const analytics = computeMatchAnalytics({
      rallies: s.rallies,
      scoring_mode: 'side_out',
      target_score: 11,
      win_by_two: true,
      winner_team: 'A',
      duration_seconds: 320,
    });

    expect(analytics.totalRallies).toBe(16);
    expect(analytics.teamA.ralliesWon).toBe(13);
    expect(analytics.teamB.ralliesWon).toBe(3);
    expect(analytics.teamA.longestPointRun).toBe(11);
    expect(analytics.teamB.longestPointRun).toBe(2);
    expect(analytics.teamA.sideOuts).toBe(1);
    expect(analytics.teamB.oneAndDoneSideOuts).toBe(1);
    expect(analytics.biggestComeback).toEqual({ team: 'A', deficit: 2 });
    expect(analytics.preSwitch).not.toBeNull();
    expect(analytics.postSwitch).not.toBeNull();
    expect(analytics.avgRallySeconds).toBe(20);
  });

  it('computes player skill profiles and supports rally outcome tagging', () => {
    let s = createInitialLiveState({
      gameType: 'doubles',
      scoringMode: 'side_out',
      targetScore: 11,
      winByTwo: true,
      initialServingTeam: 'A',
      teamAPlayers: ['A1', 'A2'],
      teamBPlayers: ['B1', 'B2'],
    });

    // A1 serves from right to B1, A wins -> tagged as ace
    s = recordRally(s, 'A', 'm5');
    s = tagRallyOutcome(s, 1, 'ace');
    // A1 serves from left to B2, B wins -> side-out, tagged as net
    s = recordRally(s, 'B', 'm5');
    s = tagRallyOutcome(s, 2, 'net');

    const profiles = computePlayerSkillProfiles(
      [{ id: 'A1' }, { id: 'A2' }, { id: 'B1' }, { id: 'B2' }],
      [
        {
          id: 'm5',
          session_id: null,
          round_number: null,
          court_number: null,
          game_type: 'doubles',
          scoring_mode: 'side_out',
          target_score: 11,
          win_by_two: true,
          status: 'in_progress',
          team_a_name: 'A',
          team_b_name: 'B',
          team_a_score: s.teamAScore,
          team_b_score: s.teamBScore,
          winner_team: null,
          started_at: new Date().toISOString(),
          completed_at: null,
          duration_seconds: 30,
          live_state: s,
          participants: [
            { match_id: 'm5', player_id: 'A1', team: 'A', starting_side: 'right' },
            { match_id: 'm5', player_id: 'A2', team: 'A', starting_side: 'left' },
            { match_id: 'm5', player_id: 'B1', team: 'B', starting_side: 'right' },
            { match_id: 'm5', player_id: 'B2', team: 'B', starting_side: 'left' },
          ],
          rallies: s.rallies,
        },
      ]
    );

    const a1 = profiles.get('A1')!;
    const b1 = profiles.get('B1')!;
    const b2 = profiles.get('B2')!;

    expect(a1.servesTotal).toBe(2);
    expect(a1.serveWins).toBe(1);
    expect(a1.serveWinPct).toBe(50);
    expect(a1.tagCounts.ace).toBe(1);
    expect(a1.tagCounts.net).toBe(1);
    expect(b1.receiveRallies).toBe(1);
    expect(b1.receiveWins).toBe(0);
    expect(b2.receiveRallies).toBe(1);
    expect(b2.receiveWins).toBe(1);

    // Below 100-rally & 5-match threshold -> attributes stay locked
    const lockedAttrs = computePlayerAttributes(a1, 2);
    expect(lockedAttrs.unlocked).toBe(false);
    expect(lockedAttrs.ralliesNeeded).toBe(98);
    expect(lockedAttrs.matchesNeeded).toBe(3);
    expect(lockedAttrs.badges).toEqual([]);

    // 100+ rallies but < 5 matches (rating still NR) -> still locked
    const ratingLockedAttrs = computePlayerAttributes(
      { ...a1, ralliesPlayed: 110, servesTotal: 55, serveWins: 38, serveWinPct: 69 },
      4
    );
    expect(ratingLockedAttrs.unlocked).toBe(false);
    expect(ratingLockedAttrs.matchesNeeded).toBe(1);

    // Above 100-rally and 5-match threshold -> unlocks badges
    const unlockedAttrs = computePlayerAttributes(
      {
        ...a1,
        ralliesPlayed: 110,
        servesTotal: 55,
        serveWins: 38,
        serveWinPct: 69,
        receiveRallies: 55,
        receiveWins: 35,
        receiveWinPct: 64,
        clutchRallies: 20,
        clutchWins: 14,
        clutchWinPct: 70,
      },
      5
    );
    expect(unlockedAttrs.unlocked).toBe(true);
    expect(unlockedAttrs.badges.map((b) => b.id)).toEqual([
      'serve_specialist',
      'return_wall',
      'clutch',
    ]);
  });

  it('tracks deuce, game points saved, lead changes, ties, and clutch rallies in rally scoring', () => {
    let s = createInitialLiveState({
      gameType: 'singles',
      scoringMode: 'rally',
      targetScore: 11,
      winByTwo: true,
      initialServingTeam: 'A',
      teamAPlayers: ['A1', null],
      teamBPlayers: ['B1', null],
    });

    // Alternate to 10-10 (ties at 1-1 .. 10-10 = 10 ties; A leads then ties each time)
    for (let i = 0; i < 10; i++) {
      s = recordRally(s, 'A', 'm_deuce');
      s = recordRally(s, 'B', 'm_deuce');
    }
    // B takes first lead 11-10 (game point for B) -> leadChange 1 (A -> B)
    s = recordRally(s, 'B', 'm_deuce');
    // A saves game point -> 11-11 (tie #11)
    s = recordRally(s, 'A', 'm_deuce');
    // B takes 12-11 (game point #2 for B)
    s = recordRally(s, 'B', 'm_deuce');
    // A saves game point #2 -> 12-12 (tie #12)
    s = recordRally(s, 'A', 'm_deuce');
    // A scores 13-12 (leadChange 2: B -> A) and 14-12 (win)
    s = recordRally(s, 'A', 'm_deuce');
    s = recordRally(s, 'A', 'm_deuce');

    expect(s.winnerTeam).toBe('A');
    const analytics = computeMatchAnalytics({
      rallies: s.rallies,
      scoring_mode: 'rally',
      target_score: 11,
      win_by_two: true,
      winner_team: 'A',
      duration_seconds: 260,
    });

    expect(analytics.totalRallies).toBe(26);
    expect(analytics.ties).toBe(12);
    expect(analytics.leadChanges).toBe(2);
    expect(analytics.teamA.gamePointsFaced).toBe(2);
    expect(analytics.teamA.gamePointsSaved).toBe(2);
    expect(analytics.teamB.gamePointsFaced).toBe(2);
    expect(analytics.teamB.gamePointsSaved).toBe(1);
    expect(analytics.clutchRallies).toBe(10); // from 8-8 onwards: 8-8, 9-8, 9-9, 10-9, 10-10, 11-10, 11-11, 12-11, 12-12, 13-12
    expect(analytics.clutchWinsA).toBe(6);
    expect(analytics.clutchWinsB).toBe(4);
    expect(analytics.biggestComeback).toEqual({ team: 'A', deficit: 1 });
  });

  it('computes server 1 vs 2, outcome tag attribution, side preference, and miss tendency', () => {
    let s = createInitialLiveState({
      gameType: 'doubles',
      scoringMode: 'side_out',
      targetScore: 11,
      winByTwo: true,
      initialServingTeam: 'A',
      teamAPlayers: ['A1', 'A2'],
      teamBPlayers: ['B1', 'B2'],
    });

    // A1 serves 0-0-2 -> ace (1-0-2), then faults (service_fault -> side-out to B 0-1-1)
    s = recordRally(s, 'A', 'm_tags');
    s = tagRallyOutcome(s, 1, 'ace');
    s = recordRally(s, 'B', 'm_tags');
    s = tagRallyOutcome(s, 2, 'service_fault');

    // B1 (Server 1) scores 2 points (winner, winner), then loses on Server 1 -> server_change (net)
    s = recordRally(s, 'B', 'm_tags');
    s = tagRallyOutcome(s, 3, 'winner');
    s = recordRally(s, 'B', 'm_tags');
    s = tagRallyOutcome(s, 4, 'winner');
    s = recordRally(s, 'A', 'm_tags');
    s = tagRallyOutcome(s, 5, 'net');

    // B2 (Server 2) scores 1 point (winner), then loses -> side-out to A (out)
    s = recordRally(s, 'B', 'm_tags');
    s = tagRallyOutcome(s, 6, 'winner');
    s = recordRally(s, 'A', 'm_tags');
    s = tagRallyOutcome(s, 7, 'out');

    const analytics = computeMatchAnalytics({
      rallies: s.rallies,
      scoring_mode: 'side_out',
      target_score: 11,
      win_by_two: true,
      winner_team: null,
      duration_seconds: 140,
    });

    expect(analytics.teamB.server1Serves).toBe(3);
    expect(analytics.teamB.server1Wins).toBe(2);
    expect(analytics.teamB.server2Serves).toBe(2);
    expect(analytics.teamB.server2Wins).toBe(1);

    const profiles = computePlayerSkillProfiles(
      [{ id: 'A1' }, { id: 'A2' }, { id: 'B1' }, { id: 'B2' }],
      [
        {
          id: 'm_tags',
          session_id: null,
          round_number: null,
          court_number: null,
          game_type: 'doubles',
          scoring_mode: 'side_out',
          target_score: 11,
          win_by_two: true,
          status: 'in_progress',
          team_a_name: 'A',
          team_b_name: 'B',
          team_a_score: s.teamAScore,
          team_b_score: s.teamBScore,
          winner_team: null,
          started_at: new Date().toISOString(),
          completed_at: null,
          duration_seconds: 140,
          live_state: s,
          participants: [
            { match_id: 'm_tags', player_id: 'A1', team: 'A', starting_side: 'right' },
            { match_id: 'm_tags', player_id: 'A2', team: 'A', starting_side: 'left' },
            { match_id: 'm_tags', player_id: 'B1', team: 'B', starting_side: 'right' },
            { match_id: 'm_tags', player_id: 'B2', team: 'B', starting_side: 'left' },
          ],
          rallies: s.rallies,
        },
      ]
    );

    // Service fault credited only to A1, not A2
    expect(profiles.get('A1')!.tagCounts.service_fault).toBe(1);
    expect(profiles.get('A2')!.tagCounts.service_fault).toBeUndefined();
    // Net & Out credited to losing team B
    expect(profiles.get('B1')!.tagCounts.net).toBe(1);
    expect(profiles.get('B1')!.tagCounts.out).toBe(1);

    // Attribute side preference + finisher + steady + missTendency (at 100+ rallies & 5+ games)
    const sideAttr = computePlayerAttributes(
      {
        playerId: 'A1',
        ralliesPlayed: 105,
        ralliesWon: 65,
        rallyWinPct: 62,
        servesTotal: 50,
        serveWins: 28,
        serveWinPct: 56,
        serviceTurns: 12,
        ptsPerServiceTurn: 2.33,
        receiveRallies: 55,
        receiveWins: 28,
        receiveWinPct: 51,
        rightSideRallies: 30,
        rightSideWins: 24,
        rightSideWinPct: 80,
        leftSideRallies: 30,
        leftSideWins: 14,
        leftSideWinPct: 47,
        clutchRallies: 18,
        clutchWins: 9,
        clutchWinPct: 50,
        tagCounts: { ace: 6, winner: 14, net: 15, out: 4, service_fault: 2 },
      },
      5
    );
    expect(sideAttr.unlocked).toBe(true);
    expect(sideAttr.badges.map((b) => b.id)).toContain('right_anchor');
    expect(sideAttr.badges.map((b) => b.id)).toContain('finisher');
    expect(sideAttr.missTendency).toBe('net');
  });

  it('computes situational splits, partner synergy, upsets, and session highlights', () => {
    const mkPlayer = (id: string, name: string, rating: number): Player => ({
      id,
      name,
      nickname: null,
      skill_rating: rating,
      avatar_color: '#1D4ED8',
      created_at: '2026-11-26T00:00:00Z',
    });
    const players: Player[] = [
      mkPlayer('p1', 'Underdog1', 2.8),
      mkPlayer('p2', 'Underdog2', 2.9),
      mkPlayer('p3', 'Fav1', 4.2),
      mkPlayer('p4', 'Fav2', 4.3),
    ];

    const sessions: Session[] = [
      {
        id: 's_in',
        title: 'Indoor Night',
        location: '真備総合公園 (屋内)',
        format: 'rotating_partners',
        courts_count: 1,
        scoring_mode: 'side_out',
        target_score: 11,
        win_by_two: true,
        status: 'completed',
        current_round: 4,
        started_at: '2026-11-26T18:00:00Z',
        ended_at: '2026-11-26T20:00:00Z',
        players: [],
      },
      {
        id: 's_out',
        title: 'Outdoor Morning',
        location: '二日市公園テニス (屋外)',
        format: 'rotating_partners',
        courts_count: 1,
        scoring_mode: 'rally',
        target_score: 11,
        win_by_two: true,
        status: 'completed',
        current_round: 2,
        started_at: '2026-11-27T09:00:00Z',
        ended_at: '2026-11-27T11:00:00Z',
        players: [],
      },
    ];

    const mkMatch = (
      id: string,
      sessionId: string,
      round: number,
      mode: 'side_out' | 'rally',
      winner: 'A' | 'B',
      scoreA: number,
      scoreB: number,
      rallies: Match['rallies'] = []
    ): Match => ({
      id,
      session_id: sessionId,
      round_number: round,
      court_number: 1,
      game_type: 'doubles',
      scoring_mode: mode,
      target_score: 11,
      win_by_two: true,
      status: 'completed',
      team_a_name: 'Underdog1 & Underdog2',
      team_b_name: 'Fav1 & Fav2',
      team_a_score: scoreA,
      team_b_score: scoreB,
      winner_team: winner,
      started_at: '2026-11-26T18:00:00Z',
      completed_at: '2026-11-26T18:15:00Z',
      duration_seconds: 900,
      live_state: null,
      participants: [
        { match_id: id, player_id: 'p1', team: 'A', starting_side: 'right' },
        { match_id: id, player_id: 'p2', team: 'A', starting_side: 'left' },
        { match_id: id, player_id: 'p3', team: 'B', starting_side: 'right' },
        { match_id: id, player_id: 'p4', team: 'B', starting_side: 'left' },
      ],
      rallies,
    });

    // Build 5 outdoor tagged rallies (3 out/service_fault = 60% outdoor error share)
    let outdoorState = createInitialLiveState({
      gameType: 'doubles',
      scoringMode: 'rally',
      targetScore: 11,
      winByTwo: true,
      initialServingTeam: 'A',
      teamAPlayers: ['p1', 'p2'],
      teamBPlayers: ['p3', 'p4'],
    });
    for (let i = 1; i <= 5; i++) {
      outdoorState = recordRally(outdoorState, 'A', 'm_o1');
      outdoorState = tagRallyOutcome(outdoorState, i, i <= 3 ? 'out' : 'winner');
    }

    const matches: Match[] = [
      mkMatch('m_i1', 's_in', 1, 'side_out', 'A', 11, 9),
      mkMatch('m_i2', 's_in', 2, 'side_out', 'A', 11, 7),
      mkMatch('m_i3', 's_in', 4, 'side_out', 'B', 8, 11),
      mkMatch('m_o1', 's_out', 1, 'rally', 'A', 11, 9, outdoorState.rallies),
      mkMatch('m_o2', 's_out', 2, 'rally', 'B', 6, 11),
    ];

    const splits = computePlayerSituationalSplits(players, matches, sessions);
    const p1 = splits.get('p1')!;
    expect(p1.indoor).toEqual({ wins: 2, losses: 1, winPct: 67 });
    expect(p1.outdoor).toEqual({ wins: 1, losses: 1, winPct: 50 });
    expect(p1.earlyRounds).toEqual({ wins: 3, losses: 1, winPct: 75 });
    expect(p1.lateRounds).toEqual({ wins: 0, losses: 1, winPct: 0 });
    expect(p1.sideOut).toEqual({ wins: 2, losses: 1, winPct: 67 });
    expect(p1.rallyMode).toEqual({ wins: 1, losses: 1, winPct: 50 });
    expect(p1.underdog).toEqual({ wins: 3, losses: 2, winPct: 60 });
    expect(p1.isGiantKiller).toBe(true);

    const ratingMap = new Map<string, { rating: number | null }>([
      ['p1', { rating: 2.8 }],
      ['p2', { rating: 2.9 }],
      ['p3', { rating: 4.2 }],
      ['p4', { rating: 4.3 }],
    ]);
    expect(isUpsetMatch(matches[0], ratingMap)).toBe(true);
    expect(isUpsetMatch(matches[2], ratingMap)).toBe(false);

    const highlights = computeSessionHighlights(
      sessions[1],
      matches.filter((m) => m.session_id === 's_out'),
      players
    );
    expect(highlights.isOutdoor).toBe(true);
    expect(highlights.outdoorErrorSharePct).toBe(60);
    expect(highlights.bestPair).not.toBeNull();
    expect(highlights.closestMatch?.matchId).toBe('m_o1');
  });

  it('computes positive and negative partner synergy and preserves tags across undo/redo', () => {
    let s = createInitialLiveState({
      gameType: 'doubles',
      scoringMode: 'side_out',
      targetScore: 11,
      winByTwo: true,
      initialServingTeam: 'A',
      teamAPlayers: ['A1', 'A2'],
      teamBPlayers: ['B1', 'B2'],
    });
    s = recordRally(s, 'A', 'm_undo');
    s = tagRallyOutcome(s, 1, 'ace');
    expect(s.rallies[0].outcome_tag).toBe('ace');

    s = undoLastRally(s, 'A', ['A1', 'A2'], ['B1', 'B2']);
    expect(s.rallies).toHaveLength(0);
    s = redoLastRally(s);
    expect(s.rallies).toHaveLength(1);
    expect(s.rallies[0].outcome_tag).toBe('ace');

    const mkP = (id: string): Player => ({
      id,
      name: id,
      nickname: null,
      skill_rating: 3.0,
      avatar_color: '#1D4ED8',
      created_at: '2026-11-26T00:00:00Z',
    });
    const players = [mkP('p1'), mkP('p2'), mkP('p3'), mkP('p4')];
    const mkM = (id: string, a1: string, a2: string, b1: string, b2: string, winner: 'A' | 'B'): Match => ({
      id,
      session_id: null,
      round_number: null,
      court_number: null,
      game_type: 'doubles',
      scoring_mode: 'side_out',
      target_score: 11,
      win_by_two: true,
      status: 'completed',
      team_a_name: 'A',
      team_b_name: 'B',
      team_a_score: winner === 'A' ? 11 : 5,
      team_b_score: winner === 'B' ? 11 : 5,
      winner_team: winner,
      started_at: '2026-11-26T18:00:00Z',
      completed_at: '2026-11-26T18:15:00Z',
      duration_seconds: 600,
      live_state: null,
      participants: [
        { match_id: id, player_id: a1, team: 'A', starting_side: 'right' },
        { match_id: id, player_id: a2, team: 'A', starting_side: 'left' },
        { match_id: id, player_id: b1, team: 'B', starting_side: 'right' },
        { match_id: id, player_id: b2, team: 'B', starting_side: 'left' },
      ],
      rallies: [],
    });

    // p1+p2 win 2-0 together (100%), while p1+p3 lose 0-2 together (0%)
    const matches: Match[] = [
      mkM('1', 'p1', 'p2', 'p3', 'p4', 'A'),
      mkM('2', 'p1', 'p2', 'p3', 'p4', 'A'),
      mkM('3', 'p1', 'p3', 'p2', 'p4', 'B'),
      mkM('4', 'p1', 'p3', 'p2', 'p4', 'B'),
    ];
    const splits = computePlayerSituationalSplits(players, matches, []);
    // p1=50%, p2=100% -> expected=75%, actual with p2=100% -> +25% synergy
    expect(splits.get('p1')!.partnerSynergy.get('p2')).toBe(25);
    // p1=50%, p3=0% -> expected=25%, actual with p3=0% -> -25% synergy
    expect(splits.get('p1')!.partnerSynergy.get('p3')).toBe(-25);
  });
});
