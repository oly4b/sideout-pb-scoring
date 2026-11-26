import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createInitialLiveState, recordRally } from '../../../shared/pickleballEngine';
import type {
  DatabaseStatus,
  Match,
  Player,
  Session,
  TeamId,
} from '../../../shared/types';
import type {
  CreateMatchInput,
  CreatePlayerInput,
  CreateSessionInput,
  DataRepository,
  MatchFilter,
  UpdateMatchPatch,
  UpdatePlayerInput,
  UpdateSessionPatch,
} from './repository';

interface LocalStoreData {
  players: Player[];
  sessions: Session[];
  matches: Match[];
}

function simulateSampleMatch(params: {
  id: string;
  session_id: string | null;
  round_number: number | null;
  court_number: number | null;
  teamAIds: [string, string];
  teamBIds: [string, string];
  teamAName: string;
  teamBName: string;
  rallyWinners: TeamId[];
  startedAt: string;
  durationSeconds: number;
}): Match {
  let state = createInitialLiveState({
    gameType: 'doubles',
    scoringMode: 'side_out',
    targetScore: 11,
    winByTwo: true,
    initialServingTeam: 'A',
    teamAPlayers: params.teamAIds,
    teamBPlayers: params.teamBIds,
  });

  const baseTime = new Date(params.startedAt).getTime();
  for (let i = 0; i < params.rallyWinners.length; i++) {
    state = recordRally(state, params.rallyWinners[i], params.id);
    if (state.rallies.length > 0) {
      state.rallies[state.rallies.length - 1].created_at = new Date(
        baseTime + (i + 1) * 19_000
      ).toISOString();
    }
    if (state.winnerTeam) break;
  }

  const completedAt = state.winnerTeam
    ? new Date(baseTime + params.durationSeconds * 1000).toISOString()
    : null;

  return {
    id: params.id,
    session_id: params.session_id,
    round_number: params.round_number,
    court_number: params.court_number,
    game_type: 'doubles',
    scoring_mode: 'side_out',
    target_score: 11,
    win_by_two: true,
    status: state.winnerTeam ? 'completed' : 'in_progress',
    team_a_name: params.teamAName,
    team_b_name: params.teamBName,
    team_a_score: state.teamAScore,
    team_b_score: state.teamBScore,
    winner_team: state.winnerTeam,
    started_at: params.startedAt,
    completed_at: completedAt,
    duration_seconds: params.durationSeconds,
    participants: [
      { match_id: params.id, player_id: params.teamAIds[0], team: 'A', starting_side: 'right' },
      { match_id: params.id, player_id: params.teamAIds[1], team: 'A', starting_side: 'left' },
      { match_id: params.id, player_id: params.teamBIds[0], team: 'B', starting_side: 'right' },
      { match_id: params.id, player_id: params.teamBIds[1], team: 'B', starting_side: 'left' },
    ],
    rallies: state.rallies,
    live_state: state,
  };
}

function buildSeedData(): LocalStoreData {
  const now = Date.now();
  const h = (hoursAgo: number) => new Date(now - hoursAgo * 3600_000).toISOString();

  const players: Player[] = [
    { id: '11111111-1111-4111-8111-111111111101', name: 'Kenji Sato', nickname: 'Kenji', skill_rating: 4.25, avatar_color: '#1D4ED8', created_at: h(72) },
    { id: '11111111-1111-4111-8111-111111111102', name: 'Maya Chen', nickname: 'Maya', skill_rating: 4.10, avatar_color: '#0F7B55', created_at: h(72) },
    { id: '11111111-1111-4111-8111-111111111103', name: 'Devon Brooks', nickname: 'Dev', skill_rating: 3.95, avatar_color: '#D94F2B', created_at: h(70) },
    { id: '11111111-1111-4111-8111-111111111104', name: 'Hannah Park', nickname: 'Han', skill_rating: 4.05, avatar_color: '#B45309', created_at: h(70) },
    { id: '11111111-1111-4111-8111-111111111105', name: 'Lucas Rivera', nickname: 'Luke', skill_rating: 3.75, avatar_color: '#0E7490', created_at: h(65) },
    { id: '11111111-1111-4111-8111-111111111106', name: 'Chloe Miller', nickname: 'Chloe', skill_rating: 3.85, avatar_color: '#BE185D', created_at: h(65) },
    { id: '11111111-1111-4111-8111-111111111107', name: 'Taro Watanabe', nickname: 'Taro', skill_rating: 4.15, avatar_color: '#3F6212', created_at: h(60) },
    { id: '11111111-1111-4111-8111-111111111108', name: 'Elena Novak', nickname: 'Elena', skill_rating: 3.90, avatar_color: '#374151', created_at: h(60) },
  ];

  const sessionId = '22222222-2222-4222-8222-222222222201';
  const sessions: Session[] = [
    {
      id: sessionId,
      title: 'Wednesday Night Open Play',
      format: 'rotating_partners',
      courts_count: 2,
      scoring_mode: 'side_out',
      target_score: 11,
      win_by_two: true,
      location: 'Yoyogi Outdoor Courts',
      status: 'active',
      current_round: 2,
      started_at: h(1.5),
      ended_at: null,
      players: players.map((p, idx) => ({
        session_id: sessionId,
        player_id: p.id,
        team_slot: null,
        check_in_order: idx,
        active: true,
      })),
    },
  ];

  // Round 1 completed matches + Round 2 live/scheduled matches + 1 historical standalone match
  const r1Court1 = simulateSampleMatch({
    id: '33333333-3333-4333-8333-333333333301',
    session_id: sessionId,
    round_number: 1,
    court_number: 1,
    teamAIds: [players[0].id, players[1].id],
    teamBIds: [players[2].id, players[3].id],
    teamAName: 'Kenji & Maya',
    teamBName: 'Devon & Hannah',
    rallyWinners: [
      'A', 'A', 'B',
      'B', 'B', 'A', 'B', 'A',
      'A', 'A', 'A', 'B', 'A', 'A', 'B',
      'B', 'B', 'B', 'A', 'B', 'A',
      'A', 'A', 'B', 'A', 'A', 'A', 'B',
      'B', 'B', 'A', 'A', 'A', 'A',
    ],
    startedAt: h(1.4),
    durationSeconds: 780,
  });

  const r1Court2 = simulateSampleMatch({
    id: '33333333-3333-4333-8333-333333333302',
    session_id: sessionId,
    round_number: 1,
    court_number: 2,
    teamAIds: [players[4].id, players[5].id],
    teamBIds: [players[6].id, players[7].id],
    teamAName: 'Lucas & Chloe',
    teamBName: 'Taro & Elena',
    rallyWinners: [
      'B',
      'B', 'B', 'B', 'A', 'B', 'B', 'A',
      'A', 'A', 'B', 'A', 'A', 'B',
      'B', 'B', 'A', 'B', 'B', 'B', 'B', 'B', 'B', 'B',
    ],
    startedAt: h(1.4),
    durationSeconds: 690,
  });

  const r2Court1 = simulateSampleMatch({
    id: '33333333-3333-4333-8333-333333333303',
    session_id: sessionId,
    round_number: 2,
    court_number: 1,
    teamAIds: [players[0].id, players[3].id],
    teamBIds: [players[6].id, players[1].id],
    teamAName: 'Kenji & Hannah',
    teamBName: 'Taro & Maya',
    rallyWinners: ['A', 'A', 'A', 'B', 'B', 'B', 'A', 'B', 'A', 'A', 'A'],
    startedAt: h(0.25),
    durationSeconds: 320,
  });

  const r2Court2State = createInitialLiveState({
    gameType: 'doubles',
    scoringMode: 'side_out',
    targetScore: 11,
    winByTwo: true,
    initialServingTeam: 'A',
    teamAPlayers: [players[2].id, players[4].id],
    teamBPlayers: [players[5].id, players[7].id],
  });
  const r2Court2: Match = {
    id: '33333333-3333-4333-8333-333333333304',
    session_id: sessionId,
    round_number: 2,
    court_number: 2,
    game_type: 'doubles',
    scoring_mode: 'side_out',
    target_score: 11,
    win_by_two: true,
    status: 'scheduled',
    team_a_name: 'Devon & Lucas',
    team_b_name: 'Chloe & Elena',
    team_a_score: 0,
    team_b_score: 0,
    winner_team: null,
    started_at: h(0.2),
    completed_at: null,
    duration_seconds: 0,
    participants: [
      { match_id: '33333333-3333-4333-8333-333333333304', player_id: players[2].id, team: 'A', starting_side: 'right' },
      { match_id: '33333333-3333-4333-8333-333333333304', player_id: players[4].id, team: 'A', starting_side: 'left' },
      { match_id: '33333333-3333-4333-8333-333333333304', player_id: players[5].id, team: 'B', starting_side: 'right' },
      { match_id: '33333333-3333-4333-8333-333333333304', player_id: players[7].id, team: 'B', starting_side: 'left' },
    ],
    rallies: [],
    live_state: r2Court2State,
  };

  const soloHistMatch = simulateSampleMatch({
    id: '33333333-3333-4333-8333-333333333305',
    session_id: null,
    round_number: null,
    court_number: null,
    teamAIds: [players[0].id, players[6].id],
    teamBIds: [players[1].id, players[3].id],
    teamAName: 'Kenji & Taro',
    teamBName: 'Maya & Hannah',
    rallyWinners: [
      'A', 'B',
      'B', 'B', 'B', 'A', 'B', 'B', 'A',
      'A', 'A', 'A', 'B', 'A', 'A', 'B',
      'B', 'B', 'A', 'B', 'B', 'B', 'A',
      'A', 'A', 'A', 'B', 'A', 'A', 'A', 'B',
      'B', 'B', 'A', 'B', 'B', 'B',
    ],
    startedAt: h(26),
    durationSeconds: 940,
  });

  return {
    players,
    sessions,
    matches: [r2Court1, r2Court2, r1Court1, r1Court2, soloHistMatch],
  };
}

export class LocalJsonAdapter implements DataRepository {
  private filePath: string;
  private data: LocalStoreData;

  constructor(filePath: string) {
    this.filePath = filePath;
    this.data = this.load();
  }

  private load(): LocalStoreData {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf-8');
        return JSON.parse(raw) as LocalStoreData;
      }
    } catch {
      // fall through to seed
    }
    const seed = buildSeedData();
    this.save(seed);
    return seed;
  }

  private save(data: LocalStoreData = this.data) {
    const dir = path.dirname(this.filePath);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2), 'utf-8');
  }

  async getStatus(): Promise<DatabaseStatus> {
    const rallies = this.data.matches.reduce((acc, m) => acc + m.rallies.length, 0);
    return {
      driver: 'local_json',
      connected: true,
      label: 'Local Dev Store (Ready for Supabase)',
      details: 'Persisting to server/data/db.json — add SUPABASE_URL or DATABASE_URL in .env to switch to Postgres/Supabase',
      counts: {
        players: this.data.players.length,
        sessions: this.data.sessions.length,
        matches: this.data.matches.length,
        rallies,
      },
    };
  }

  async listPlayers(): Promise<Player[]> {
    return [...this.data.players].sort((a, b) => a.name.localeCompare(b.name));
  }

  async getPlayer(id: string): Promise<Player | null> {
    return this.data.players.find((p) => p.id === id) ?? null;
  }

  async createPlayer(input: CreatePlayerInput): Promise<Player> {
    const player: Player = {
      id: crypto.randomUUID(),
      name: input.name.trim(),
      nickname: input.nickname ?? null,
      skill_rating: input.skill_rating ?? null,
      avatar_color: input.avatar_color ?? '#1D4ED8',
      created_at: new Date().toISOString(),
    };
    this.data.players.push(player);
    this.save();
    return player;
  }

  async updatePlayer(id: string, input: UpdatePlayerInput): Promise<Player | null> {
    const idx = this.data.players.findIndex((p) => p.id === id);
    if (idx === -1) return null;
    this.data.players[idx] = { ...this.data.players[idx], ...input };
    this.save();
    return this.data.players[idx];
  }

  async deletePlayer(id: string): Promise<boolean> {
    const before = this.data.players.length;
    this.data.players = this.data.players.filter((p) => p.id !== id);
    this.save();
    return this.data.players.length < before;
  }

  async listSessions(): Promise<Session[]> {
    return [...this.data.sessions]
      .sort((a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime())
      .map((s) => ({
        ...s,
        matches: this.data.matches.filter((m) => m.session_id === s.id),
      }));
  }

  async getSession(id: string): Promise<Session | null> {
    const s = this.data.sessions.find((item) => item.id === id);
    if (!s) return null;
    return {
      ...s,
      matches: this.data.matches.filter((m) => m.session_id === id),
    };
  }

  async createSession(input: CreateSessionInput): Promise<Session> {
    const id = crypto.randomUUID();
    const session: Session = {
      id,
      title: input.title.trim(),
      format: input.format,
      courts_count: input.courts_count,
      scoring_mode: input.scoring_mode,
      target_score: input.target_score,
      win_by_two: input.win_by_two,
      location: input.location ?? null,
      status: 'active',
      current_round: 1,
      started_at: new Date().toISOString(),
      ended_at: null,
      players: input.player_ids.map((pid, idx) => ({
        session_id: id,
        player_id: pid,
        team_slot: input.team_slots?.[pid] ?? null,
        check_in_order: idx,
        active: true,
      })),
    };
    this.data.sessions.unshift(session);
    this.save();
    return { ...session, matches: [] };
  }

  async updateSession(id: string, patch: UpdateSessionPatch): Promise<Session | null> {
    const idx = this.data.sessions.findIndex((s) => s.id === id);
    if (idx === -1) return null;
    this.data.sessions[idx] = { ...this.data.sessions[idx], ...patch };
    this.save();
    return this.getSession(id);
  }

  async deleteSession(id: string): Promise<boolean> {
    const before = this.data.sessions.length;
    this.data.sessions = this.data.sessions.filter((s) => s.id !== id);
    this.data.matches = this.data.matches.filter((m) => m.session_id !== id);
    this.save();
    return this.data.sessions.length < before;
  }

  async listMatches(filter?: MatchFilter): Promise<Match[]> {
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

  async getMatch(id: string): Promise<Match | null> {
    return this.data.matches.find((m) => m.id === id) ?? null;
  }

  async createMatch(input: CreateMatchInput): Promise<Match> {
    const id = crypto.randomUUID();
    const match: Match = {
      id,
      session_id: input.session_id ?? null,
      round_number: input.round_number ?? null,
      court_number: input.court_number ?? null,
      game_type: input.game_type,
      scoring_mode: input.scoring_mode,
      target_score: input.target_score,
      win_by_two: input.win_by_two,
      status: input.status ?? 'in_progress',
      team_a_name: input.team_a_name,
      team_b_name: input.team_b_name,
      team_a_score: 0,
      team_b_score: 0,
      winner_team: null,
      started_at: new Date().toISOString(),
      completed_at: null,
      duration_seconds: 0,
      participants: input.participants.map((p) => ({ match_id: id, ...p })),
      rallies: [],
      live_state: input.live_state ?? null,
    };
    this.data.matches.unshift(match);
    this.save();
    return match;
  }

  async updateMatch(id: string, patch: UpdateMatchPatch): Promise<Match | null> {
    const idx = this.data.matches.findIndex((m) => m.id === id);
    if (idx === -1) return null;
    this.data.matches[idx] = { ...this.data.matches[idx], ...patch };
    this.save();
    return this.data.matches[idx];
  }

  async deleteMatch(id: string): Promise<boolean> {
    const before = this.data.matches.length;
    this.data.matches = this.data.matches.filter((m) => m.id !== id);
    this.save();
    return this.data.matches.length < before;
  }

  async exportAll() {
    return {
      exported_at: new Date().toISOString(),
      players: this.data.players,
      sessions: this.data.sessions,
      matches: this.data.matches,
    };
  }
}
