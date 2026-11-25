import type {
  DatabaseStatus,
  GameType,
  LiveGameState,
  Match,
  MatchParticipant,
  MatchStatus,
  Player,
  RallyEvent,
  ScoringMode,
  Session,
  SessionFormat,
  SessionPlayer,
  SessionStatus,
  TargetScore,
  TeamId,
} from '../../../shared/types';

export interface CreatePlayerInput {
  name: string;
  nickname?: string | null;
  skill_rating?: number;
  avatar_color?: string;
}

export interface UpdatePlayerInput {
  name?: string;
  nickname?: string | null;
  skill_rating?: number;
  avatar_color?: string;
}

export interface CreateSessionInput {
  title: string;
  format: SessionFormat;
  courts_count: number;
  scoring_mode: ScoringMode;
  target_score: TargetScore;
  win_by_two: boolean;
  location?: string | null;
  player_ids: string[];
  team_slots?: Record<string, number>;
}

export interface UpdateSessionPatch {
  title?: string;
  status?: SessionStatus;
  current_round?: number;
  ended_at?: string | null;
  players?: SessionPlayer[];
}

export interface CreateMatchInput {
  session_id?: string | null;
  round_number?: number | null;
  court_number?: number | null;
  game_type: GameType;
  scoring_mode: ScoringMode;
  target_score: TargetScore;
  win_by_two: boolean;
  status?: MatchStatus;
  team_a_name: string;
  team_b_name: string;
  participants: Array<Omit<MatchParticipant, 'match_id'>>;
  live_state?: LiveGameState | null;
}

export interface UpdateMatchPatch {
  status?: MatchStatus;
  team_a_name?: string;
  team_b_name?: string;
  team_a_score?: number;
  team_b_score?: number;
  winner_team?: TeamId | null;
  completed_at?: string | null;
  duration_seconds?: number;
  live_state?: LiveGameState | null;
  rallies?: RallyEvent[];
}

export interface MatchFilter {
  sessionId?: string;
  status?: MatchStatus;
  playerId?: string;
}

export interface DataRepository {
  getStatus(): Promise<DatabaseStatus>;
  listPlayers(): Promise<Player[]>;
  getPlayer(id: string): Promise<Player | null>;
  createPlayer(input: CreatePlayerInput): Promise<Player>;
  updatePlayer(id: string, input: UpdatePlayerInput): Promise<Player | null>;
  deletePlayer(id: string): Promise<boolean>;

  listSessions(): Promise<Session[]>;
  getSession(id: string): Promise<Session | null>;
  createSession(input: CreateSessionInput): Promise<Session>;
  updateSession(id: string, patch: UpdateSessionPatch): Promise<Session | null>;
  deleteSession(id: string): Promise<boolean>;

  listMatches(filter?: MatchFilter): Promise<Match[]>;
  getMatch(id: string): Promise<Match | null>;
  createMatch(input: CreateMatchInput): Promise<Match>;
  updateMatch(id: string, patch: UpdateMatchPatch): Promise<Match | null>;
  deleteMatch(id: string): Promise<boolean>;

  exportAll(): Promise<{
    exported_at: string;
    players: Player[];
    sessions: Session[];
    matches: Match[];
  }>;
}
