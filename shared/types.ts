export type GameType = 'doubles' | 'singles';
export type ScoringMode = 'side_out' | 'rally';
export type TargetScore = 7 | 11 | 15 | 21;
export type TeamId = 'A' | 'B';
export type CourtSide = 'right' | 'left';
export type MatchStatus = 'scheduled' | 'in_progress' | 'completed';
export type SessionFormat =
  | 'open_play'
  | 'rotating_partners'
  | 'set_partners'
  | 'king_of_court';
export type SessionStatus = 'active' | 'completed';
export type RallyEventType = 'point' | 'server_change' | 'side_out';

export type RallyOutcomeTag =
  | 'ace'
  | 'service_fault'
  | 'winner'
  | 'net'
  | 'out';

export interface Player {
  id: string;
  name: string;
  nickname?: string | null;
  skill_rating: number | null;
  avatar_color: string;
  created_at: string;
}

export interface MatchParticipant {
  match_id: string;
  player_id: string;
  team: TeamId;
  starting_side: CourtSide;
}

export interface RallyEvent {
  id: string;
  match_id: string;
  seq: number;
  rally_winner: TeamId;
  event_type: RallyEventType;
  serving_team: TeamId;
  server_number: 1 | 2;
  team_a_score: number;
  team_b_score: number;
  callout: string;
  created_at: string;
  serving_player_id?: string | null;
  receiving_player_id?: string | null;
  serving_side?: CourtSide | null;
  outcome_tag?: RallyOutcomeTag | null;
}

export interface CourtPositions {
  teamA: {
    right: string | null; // player_id or label
    left: string | null;
  };
  teamB: {
    right: string | null;
    left: string | null;
  };
}

export interface LiveGameState {
  gameType: GameType;
  scoringMode: ScoringMode;
  targetScore: TargetScore;
  winByTwo: boolean;
  teamAScore: number;
  teamBScore: number;
  servingTeam: TeamId;
  serverNumber: 1 | 2;
  positions: CourtPositions;
  winnerTeam: TeamId | null;
  isFirstServeOfGame: boolean;
  rallies: RallyEvent[];
  redoStack: Array<{
    teamAScore: number;
    teamBScore: number;
    servingTeam: TeamId;
    serverNumber: 1 | 2;
    positions: CourtPositions;
    winnerTeam: TeamId | null;
    isFirstServeOfGame: boolean;
    rallyEvent: RallyEvent;
  }>;
}

export interface Match {
  id: string;
  session_id: string | null;
  round_number: number | null;
  court_number: number | null;
  game_type: GameType;
  scoring_mode: ScoringMode;
  target_score: TargetScore;
  win_by_two: boolean;
  status: MatchStatus;
  team_a_name: string;
  team_b_name: string;
  team_a_score: number;
  team_b_score: number;
  winner_team: TeamId | null;
  started_at: string;
  completed_at: string | null;
  duration_seconds: number;
  participants: MatchParticipant[];
  rallies: RallyEvent[];
  live_state: LiveGameState | null;
}

export interface SessionPlayer {
  session_id: string;
  player_id: string;
  team_slot: number | null;
  check_in_order: number;
  active: boolean;
}

export interface Session {
  id: string;
  title: string;
  format: SessionFormat;
  courts_count: number;
  scoring_mode: ScoringMode;
  target_score: TargetScore;
  win_by_two: boolean;
  location: string | null;
  status: SessionStatus;
  current_round: number;
  started_at: string;
  ended_at: string | null;
  players: SessionPlayer[];
  matches?: Match[];
}

export interface PlayerStanding {
  player_id: string;
  name: string;
  avatar_color: string;
  skill_rating: number | null;
  rating_delta?: number | null;
  games_played: number;
  wins: number;
  losses: number;
  win_pct: number;
  points_for: number;
  points_against: number;
  point_diff: number;
  streak: number; // positive = win streak, negative = loss streak
}

export interface PairRecord {
  other_player_id: string;
  other_name: string;
  other_color: string;
  games: number;
  wins: number;
  losses: number;
  win_pct: number;
  point_diff: number;
}

export interface PlayerDetailStats extends PlayerStanding {
  teammates: PairRecord[];
  opponents: PairRecord[];
  recent_matches: Match[];
}

export interface DatabaseStatus {
  driver: 'supabase' | 'postgres' | 'local_json';
  connected: boolean;
  label: string;
  details: string;
  counts: {
    players: number;
    sessions: number;
    matches: number;
    rallies: number;
  };
}

export interface SchedulerAttendee {
  attendee_name: string;
  status: 'yes' | 'maybe';
}

export interface SchedulerBookedSession {
  date_key: string;
  start_hour: number;
  end_hour: number;
  venue_id: string;
  venue_short_name: string;
  venue_full_name: string;
  map_url: string;
  court_type: 'indoor' | 'outdoor';
  attendees: SchedulerAttendee[];
}

export interface SchedulerPollPlayer {
  name: string;
  note: string;
}

export interface SchedulerUpcomingPayload {
  connected: boolean;
  min_date: string;
  sessions: SchedulerBookedSession[];
  players: SchedulerPollPlayer[];
  error?: string;
}
