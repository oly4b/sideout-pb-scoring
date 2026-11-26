import type {
  DatabaseStatus,
  GameType,
  LiveGameState,
  Match,
  MatchParticipant,
  MatchStatus,
  Player,
  PlayerDetailStats,
  PlayerStanding,
  RallyEvent,
  SchedulerUpcomingPayload,
  ScoringMode,
  Session,
  SessionFormat,
  TargetScore,
  TeamId,
} from '../../shared/types';

const API_BASE = (import.meta.env.VITE_API_URL as string | undefined) || '/api';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
    ...init,
  });
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch {
      // ignore json parse error
    }
    throw new Error(message);
  }
  return res.json() as Promise<T>;
}

export const api = {
  getDbStatus: () => request<DatabaseStatus>('/db/status'),
  getDbSchema: () => request<{ sql: string }>('/db/schema'),
  exportAll: () =>
    request<{
      exported_at: string;
      players: Player[];
      sessions: Session[];
      matches: Match[];
    }>('/export'),

  // Players
  listPlayers: () => request<Player[]>('/players'),
  createPlayer: (input: {
    name: string;
    nickname?: string;
    skill_rating?: number;
    avatar_color?: string;
  }) =>
    request<Player>('/players', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  updatePlayer: (
    id: string,
    input: Partial<Pick<Player, 'name' | 'nickname' | 'skill_rating' | 'avatar_color'>>
  ) =>
    request<Player>(`/players/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  deletePlayer: (id: string) =>
    request<{ deleted: boolean }>(`/players/${id}`, { method: 'DELETE' }),
  getStandings: () => request<PlayerStanding[]>('/standings'),
  getPlayerStats: (id: string) => request<PlayerDetailStats>(`/players/${id}/stats`),

  // Sessions
  listSessions: () => request<Session[]>('/sessions'),
  getSession: (id: string) => request<Session>(`/sessions/${id}`),
  createSession: (input: {
    title: string;
    format: SessionFormat;
    courts_count: number;
    scoring_mode: ScoringMode;
    target_score: TargetScore;
    win_by_two: boolean;
    location?: string;
    player_ids: string[];
    team_slots?: Record<string, number>;
  }) =>
    request<Session>('/sessions', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  generateNextRound: (sessionId: string) =>
    request<{ session: Session; new_matches: Match[]; sitting_out: string[] }>(
      `/sessions/${sessionId}/next-round`,
      { method: 'POST' }
    ),
  getSessionStandings: (sessionId: string) =>
    request<PlayerStanding[]>(`/sessions/${sessionId}/standings`),
  endSession: (sessionId: string) =>
    request<Session>(`/sessions/${sessionId}/end`, { method: 'POST' }),
  deleteSession: (sessionId: string) =>
    request<{ deleted: boolean }>(`/sessions/${sessionId}`, { method: 'DELETE' }),

  // Matches
  listMatches: (params?: { sessionId?: string; playerId?: string; status?: MatchStatus }) => {
    const qs = new URLSearchParams();
    if (params?.sessionId) qs.set('sessionId', params.sessionId);
    if (params?.playerId) qs.set('playerId', params.playerId);
    if (params?.status) qs.set('status', params.status);
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return request<Match[]>(`/matches${suffix}`);
  },
  getMatch: (id: string) => request<Match>(`/matches/${id}`),
  createMatch: (input: {
    session_id?: string | null;
    round_number?: number | null;
    court_number?: number | null;
    game_type: GameType;
    scoring_mode: ScoringMode;
    target_score: TargetScore;
    win_by_two: boolean;
    team_a_name: string;
    team_b_name: string;
    initial_serving_team?: TeamId;
    participants: Array<Omit<MatchParticipant, 'match_id'>>;
  }) =>
    request<Match>('/matches', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  updateMatch: (
    id: string,
    patch: {
      status?: MatchStatus;
      team_a_score?: number;
      team_b_score?: number;
      winner_team?: TeamId | null;
      completed_at?: string | null;
      duration_seconds?: number;
      live_state?: LiveGameState | null;
      rallies?: RallyEvent[];
    }
  ) =>
    request<Match>(`/matches/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
  quickScoreMatch: (id: string, team_a_score: number, team_b_score: number) =>
    request<Match>(`/matches/${id}/quick-score`, {
      method: 'POST',
      body: JSON.stringify({ team_a_score, team_b_score }),
    }),
  deleteMatch: (id: string) =>
    request<{ deleted: boolean }>(`/matches/${id}`, { method: 'DELETE' }),

  // Shared session-scheduler sync
  getSchedulerUpcoming: (minDate?: string) => {
    const suffix = minDate ? `?minDate=${encodeURIComponent(minDate)}` : '';
    return request<SchedulerUpcomingPayload>(`/scheduler/upcoming${suffix}`);
  },
};
