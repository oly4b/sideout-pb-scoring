import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type {
  DatabaseStatus,
  Match,
  MatchParticipant,
  Player,
  RallyEvent,
  Session,
  SessionPlayer,
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

export class SupabaseAdapter implements DataRepository {
  private client: SupabaseClient;
  private url: string;
  private matchUpdateLocks = new Map<string, Promise<unknown>>();

  constructor(url: string, key: string) {
    this.url = url;
    this.client = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }

  async getStatus(): Promise<DatabaseStatus> {
    try {
      const [pRes, sRes, mRes, rRes] = await Promise.all([
        this.client.from('players').select('*', { count: 'exact', head: true }),
        this.client.from('sessions').select('*', { count: 'exact', head: true }),
        this.client.from('matches').select('*', { count: 'exact', head: true }),
        this.client.from('rally_events').select('*', { count: 'exact', head: true }),
      ]);
      const err = pRes.error || sRes.error || mRes.error || rRes.error;
      if (err) {
        return {
          driver: 'supabase',
          connected: false,
          label: 'Supabase (Schema / Auth Error)',
          details: err.message,
          counts: { players: 0, sessions: 0, matches: 0, rallies: 0 },
        };
      }
      return {
        driver: 'supabase',
        connected: true,
        label: 'Supabase Connected',
        details: new URL(this.url).host,
        counts: {
          players: pRes.count ?? 0,
          sessions: sRes.count ?? 0,
          matches: mRes.count ?? 0,
          rallies: rRes.count ?? 0,
        },
      };
    } catch (error) {
      return {
        driver: 'supabase',
        connected: false,
        label: 'Supabase Disconnected',
        details: error instanceof Error ? error.message : 'Unknown error',
        counts: { players: 0, sessions: 0, matches: 0, rallies: 0 },
      };
    }
  }

  async listPlayers(): Promise<Player[]> {
    const { data, error } = await this.client
      .from('players')
      .select('*')
      .order('name', { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []).map((row) => ({
      ...row,
      skill_rating:
        row.skill_rating !== null && row.skill_rating !== undefined
          ? Number(row.skill_rating)
          : null,
    }));
  }

  async getPlayer(id: string): Promise<Player | null> {
    const { data, error } = await this.client.from('players').select('*').eq('id', id).maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return null;
    return {
      ...data,
      skill_rating:
        data.skill_rating !== null && data.skill_rating !== undefined
          ? Number(data.skill_rating)
          : null,
    };
  }

  async createPlayer(input: CreatePlayerInput): Promise<Player> {
    const { data, error } = await this.client
      .from('players')
      .insert({
        name: input.name.trim(),
        nickname: input.nickname ?? null,
        skill_rating: input.skill_rating ?? null,
        avatar_color: input.avatar_color ?? '#1D4ED8',
      })
      .select('*')
      .single();
    if (error) throw new Error(error.message);
    return {
      ...data,
      skill_rating:
        data.skill_rating !== null && data.skill_rating !== undefined
          ? Number(data.skill_rating)
          : null,
    };
  }

  async updatePlayer(id: string, input: UpdatePlayerInput): Promise<Player | null> {
    const { data, error } = await this.client
      .from('players')
      .update(input)
      .eq('id', id)
      .select('*')
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data
      ? {
          ...data,
          skill_rating:
            data.skill_rating !== null && data.skill_rating !== undefined
              ? Number(data.skill_rating)
              : null,
        }
      : null;
  }

  async deletePlayer(id: string): Promise<boolean> {
    const { error } = await this.client.from('players').delete().eq('id', id);
    if (error) throw new Error(error.message);
    return true;
  }

  async listSessions(): Promise<Session[]> {
    const { data: sessions, error } = await this.client
      .from('sessions')
      .select('*')
      .order('started_at', { ascending: false });
    if (error) throw new Error(error.message);
    if (!sessions || sessions.length === 0) return [];

    const { data: spRows, error: spErr } = await this.client.from('session_players').select('*');
    if (spErr) throw new Error(spErr.message);

    const bySession = new Map<string, SessionPlayer[]>();
    for (const row of spRows ?? []) {
      const list = bySession.get(row.session_id) ?? [];
      list.push(row);
      bySession.set(row.session_id, list);
    }

    return sessions.map((s) => ({
      ...s,
      players: (bySession.get(s.id) ?? []).sort((a, b) => a.check_in_order - b.check_in_order),
    }));
  }

  async getSession(id: string): Promise<Session | null> {
    const { data, error } = await this.client
      .from('sessions')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return null;

    const { data: spRows, error: spErr } = await this.client
      .from('session_players')
      .select('*')
      .eq('session_id', id)
      .order('check_in_order', { ascending: true });
    if (spErr) throw new Error(spErr.message);

    const matches = await this.listMatches({ sessionId: id });
    return {
      ...data,
      players: spRows ?? [],
      matches,
    };
  }

  async createSession(input: CreateSessionInput): Promise<Session> {
    const { data: session, error } = await this.client
      .from('sessions')
      .insert({
        title: input.title.trim(),
        format: input.format,
        courts_count: input.courts_count,
        scoring_mode: input.scoring_mode,
        target_score: input.target_score,
        win_by_two: input.win_by_two,
        location: input.location ?? null,
        status: 'active',
        current_round: 1,
      })
      .select('*')
      .single();
    if (error) throw new Error(error.message);

    const spInserts = input.player_ids.map((playerId, idx) => ({
      session_id: session.id,
      player_id: playerId,
      team_slot: input.team_slots?.[playerId] ?? null,
      check_in_order: idx,
      active: true,
    }));

    if (spInserts.length > 0) {
      const { error: spErr } = await this.client.from('session_players').insert(spInserts);
      if (spErr) throw new Error(spErr.message);
    }

    return {
      ...session,
      players: spInserts,
      matches: [],
    };
  }

  async updateSession(id: string, patch: UpdateSessionPatch): Promise<Session | null> {
    const { players, ...sessionFields } = patch;
    if (Object.keys(sessionFields).length > 0) {
      const { error } = await this.client
        .from('sessions')
        .update(sessionFields)
        .eq('id', id);
      if (error) throw new Error(error.message);
    }
    if (players) {
      await this.client.from('session_players').delete().eq('session_id', id);
      if (players.length > 0) {
        const { error: spErr } = await this.client.from('session_players').insert(
          players.map((p, idx) => ({
            session_id: id,
            player_id: p.player_id,
            team_slot: p.team_slot ?? null,
            check_in_order: p.check_in_order ?? idx,
            active: p.active,
          }))
        );
        if (spErr) throw new Error(spErr.message);
      }
    }
    return this.getSession(id);
  }

  async deleteSession(id: string): Promise<boolean> {
    const { error } = await this.client.from('sessions').delete().eq('id', id);
    if (error) throw new Error(error.message);
    return true;
  }

  async listMatches(filter?: MatchFilter): Promise<Match[]> {
    let query = this.client.from('matches').select('*').order('started_at', { ascending: false });
    if (filter?.sessionId) query = query.eq('session_id', filter.sessionId);
    if (filter?.status) query = query.eq('status', filter.status);

    const { data: matches, error } = await query;
    if (error) throw new Error(error.message);
    if (!matches || matches.length === 0) return [];

    const matchIds = matches.map((m) => m.id);
    const [partRes, rallyRes] = await Promise.all([
      this.client.from('match_participants').select('*').in('match_id', matchIds),
      this.client
        .from('rally_events')
        .select('*')
        .in('match_id', matchIds)
        .order('seq', { ascending: true }),
    ]);

    if (partRes.error) throw new Error(partRes.error.message);
    if (rallyRes.error) throw new Error(rallyRes.error.message);

    const partMap = new Map<string, MatchParticipant[]>();
    for (const p of partRes.data ?? []) {
      const list = partMap.get(p.match_id) ?? [];
      list.push(p);
      partMap.set(p.match_id, list);
    }

    const rallyMap = new Map<string, RallyEvent[]>();
    for (const r of rallyRes.data ?? []) {
      const list = rallyMap.get(r.match_id) ?? [];
      list.push(r);
      rallyMap.set(r.match_id, list);
    }

    let hydrated: Match[] = matches.map((m) => ({
      ...m,
      participants: partMap.get(m.id) ?? [],
      rallies: rallyMap.get(m.id) ?? [],
    }));

    if (filter?.playerId) {
      hydrated = hydrated.filter((m) =>
        m.participants.some((p) => p.player_id === filter.playerId)
      );
    }
    return hydrated;
  }

  async getMatch(id: string): Promise<Match | null> {
    const { data, error } = await this.client.from('matches').select('*').eq('id', id).maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return null;

    const [partRes, rallyRes] = await Promise.all([
      this.client.from('match_participants').select('*').eq('match_id', id),
      this.client
        .from('rally_events')
        .select('*')
        .eq('match_id', id)
        .order('seq', { ascending: true }),
    ]);
    if (partRes.error) throw new Error(partRes.error.message);
    if (rallyRes.error) throw new Error(rallyRes.error.message);

    return {
      ...data,
      participants: partRes.data ?? [],
      rallies: rallyRes.data ?? [],
    };
  }

  async createMatch(input: CreateMatchInput): Promise<Match> {
    const { data: match, error } = await this.client
      .from('matches')
      .insert({
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
        live_state: input.live_state ?? null,
      })
      .select('*')
      .single();
    if (error) throw new Error(error.message);

    const participantRows = input.participants.map((p) => ({
      match_id: match.id,
      player_id: p.player_id,
      team: p.team,
      starting_side: p.starting_side,
    }));

    if (participantRows.length > 0) {
      const { error: pErr } = await this.client.from('match_participants').insert(participantRows);
      if (pErr) throw new Error(pErr.message);
    }

    return {
      ...match,
      participants: participantRows,
      rallies: [],
    };
  }

  async updateMatch(id: string, patch: UpdateMatchPatch): Promise<Match | null> {
    const prev = this.matchUpdateLocks.get(id) ?? Promise.resolve();
    const next = prev.catch(() => undefined).then(() => this.performUpdateMatch(id, patch));
    this.matchUpdateLocks.set(id, next);
    try {
      return await next;
    } finally {
      if (this.matchUpdateLocks.get(id) === next) {
        this.matchUpdateLocks.delete(id);
      }
    }
  }

  private async performUpdateMatch(id: string, patch: UpdateMatchPatch): Promise<Match | null> {
    const { rallies, ...matchFields } = patch;
    if (Object.keys(matchFields).length > 0) {
      const { error } = await this.client.from('matches').update(matchFields).eq('id', id);
      if (error) throw new Error(error.message);
    }

    if (rallies) {
      if (rallies.length === 0) {
        const { error: delErr } = await this.client
          .from('rally_events')
          .delete()
          .eq('match_id', id);
        if (delErr) throw new Error(delErr.message);
      } else {
        const rows = rallies.map((r) => ({
          match_id: id,
          seq: r.seq,
          rally_winner: r.rally_winner,
          event_type: r.event_type,
          serving_team: r.serving_team,
          server_number: r.server_number,
          team_a_score: r.team_a_score,
          team_b_score: r.team_b_score,
          callout: r.callout,
          created_at: r.created_at,
        }));
        const { error: rErr } = await this.client
          .from('rally_events')
          .upsert(rows, { onConflict: 'match_id,seq' });
        if (rErr) throw new Error(rErr.message);

        const maxSeq = rallies.reduce((max, r) => Math.max(max, r.seq), 0);
        const { error: pruneErr } = await this.client
          .from('rally_events')
          .delete()
          .eq('match_id', id)
          .gt('seq', maxSeq);
        if (pruneErr) throw new Error(pruneErr.message);
      }
    }

    return this.getMatch(id);
  }

  async deleteMatch(id: string): Promise<boolean> {
    const { error } = await this.client.from('matches').delete().eq('id', id);
    if (error) throw new Error(error.message);
    return true;
  }

  async exportAll() {
    const [players, sessions, matches] = await Promise.all([
      this.listPlayers(),
      this.listSessions(),
      this.listMatches(),
    ]);
    return {
      exported_at: new Date().toISOString(),
      players,
      sessions,
      matches,
    };
  }
}
