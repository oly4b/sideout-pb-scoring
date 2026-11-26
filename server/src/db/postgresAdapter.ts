import { Pool } from 'pg';
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

export class PostgresAdapter implements DataRepository {
  private pool: Pool;
  private hostLabel: string;

  constructor(connectionString: string) {
    const isLocal =
      connectionString.includes('localhost') || connectionString.includes('127.0.0.1');
    this.pool = new Pool({
      connectionString,
      ssl: isLocal ? false : { rejectUnauthorized: false },
    });
    try {
      const parsed = new URL(connectionString);
      this.hostLabel = `${parsed.hostname}${parsed.pathname}`;
    } catch {
      this.hostLabel = 'PostgreSQL';
    }
  }

  async getStatus(): Promise<DatabaseStatus> {
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
        driver: 'postgres',
        connected: true,
        label: 'PostgreSQL Connected',
        details: this.hostLabel,
        counts,
      };
    } catch (error) {
      return {
        driver: 'postgres',
        connected: false,
        label: 'PostgreSQL Connection Error',
        details: error instanceof Error ? error.message : 'Unable to reach PostgreSQL',
        counts: { players: 0, sessions: 0, matches: 0, rallies: 0 },
      };
    }
  }

  async listPlayers(): Promise<Player[]> {
    const res = await this.pool.query('select * from public.players order by name asc');
    return res.rows.map((r) => ({
      ...r,
      skill_rating:
        r.skill_rating !== null && r.skill_rating !== undefined ? Number(r.skill_rating) : null,
    }));
  }

  async getPlayer(id: string): Promise<Player | null> {
    const res = await this.pool.query('select * from public.players where id = $1', [id]);
    if (res.rowCount === 0) return null;
    const r = res.rows[0];
    return {
      ...r,
      skill_rating:
        r.skill_rating !== null && r.skill_rating !== undefined ? Number(r.skill_rating) : null,
    };
  }

  async createPlayer(input: CreatePlayerInput): Promise<Player> {
    const res = await this.pool.query(
      `insert into public.players (name, nickname, skill_rating, avatar_color)
       values ($1, $2, $3, $4)
       returning *`,
      [
        input.name.trim(),
        input.nickname ?? null,
        input.skill_rating ?? null,
        input.avatar_color ?? '#1D4ED8',
      ]
    );
    const r = res.rows[0];
    return {
      ...r,
      skill_rating:
        r.skill_rating !== null && r.skill_rating !== undefined ? Number(r.skill_rating) : null,
    };
  }

  async updatePlayer(id: string, input: UpdatePlayerInput): Promise<Player | null> {
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
        input.nickname !== undefined ? input.nickname : existing.nickname,
        input.skill_rating !== undefined ? input.skill_rating : existing.skill_rating,
        input.avatar_color ?? existing.avatar_color,
      ]
    );
    const r = res.rows[0];
    return {
      ...r,
      skill_rating:
        r.skill_rating !== null && r.skill_rating !== undefined ? Number(r.skill_rating) : null,
    };
  }

  async deletePlayer(id: string): Promise<boolean> {
    const res = await this.pool.query('delete from public.players where id = $1', [id]);
    return (res.rowCount ?? 0) > 0;
  }

  async listSessions(): Promise<Session[]> {
    const [sRes, spRes] = await Promise.all([
      this.pool.query('select * from public.sessions order by started_at desc'),
      this.pool.query('select * from public.session_players order by check_in_order asc'),
    ]);
    const bySession = new Map<string, SessionPlayer[]>();
    for (const sp of spRes.rows) {
      const list = bySession.get(sp.session_id) ?? [];
      list.push(sp);
      bySession.set(sp.session_id, list);
    }
    return sRes.rows.map((s) => ({
      ...s,
      players: bySession.get(s.id) ?? [],
    }));
  }

  async getSession(id: string): Promise<Session | null> {
    const res = await this.pool.query('select * from public.sessions where id = $1', [id]);
    if (res.rowCount === 0) return null;
    const spRes = await this.pool.query(
      'select * from public.session_players where session_id = $1 order by check_in_order asc',
      [id]
    );
    const matches = await this.listMatches({ sessionId: id });
    return {
      ...res.rows[0],
      players: spRes.rows,
      matches,
    };
  }

  async createSession(input: CreateSessionInput): Promise<Session> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
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
          input.location ?? null,
        ]
      );
      const session = sRes.rows[0];
      const players: SessionPlayer[] = [];
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
          active: true,
        });
      }
      await client.query('commit');
      return { ...session, players, matches: [] };
    } catch (err) {
      await client.query('rollback');
      throw err;
    } finally {
      client.release();
    }
  }

  async updateSession(id: string, patch: UpdateSessionPatch): Promise<Session | null> {
    const existing = await this.getSession(id);
    if (!existing) return null;

    const client = await this.pool.connect();
    try {
      await client.query('begin');
      await client.query(
        `update public.sessions
         set title = $2, status = $3, current_round = $4, ended_at = $5
         where id = $1`,
        [
          id,
          patch.title ?? existing.title,
          patch.status ?? existing.status,
          patch.current_round ?? existing.current_round,
          patch.ended_at !== undefined ? patch.ended_at : existing.ended_at,
        ]
      );
      if (patch.players) {
        await client.query('delete from public.session_players where session_id = $1', [id]);
        for (let i = 0; i < patch.players.length; i++) {
          const p = patch.players[i];
          await client.query(
            `insert into public.session_players (session_id, player_id, team_slot, check_in_order, active)
             values ($1, $2, $3, $4, $5)`,
            [id, p.player_id, p.team_slot ?? null, p.check_in_order ?? i, p.active]
          );
        }
      }
      await client.query('commit');
    } catch (err) {
      await client.query('rollback');
      throw err;
    } finally {
      client.release();
    }

    return this.getSession(id);
  }

  async deleteSession(id: string): Promise<boolean> {
    const res = await this.pool.query('delete from public.sessions where id = $1', [id]);
    return (res.rowCount ?? 0) > 0;
  }

  async listMatches(filter?: MatchFilter): Promise<Match[]> {
    const clauses: string[] = [];
    const values: unknown[] = [];
    if (filter?.sessionId) {
      values.push(filter.sessionId);
      clauses.push(`session_id = $${values.length}`);
    }
    if (filter?.status) {
      values.push(filter.status);
      clauses.push(`status = $${values.length}`);
    }

    const where = clauses.length > 0 ? `where ${clauses.join(' and ')}` : '';
    const mRes = await this.pool.query(
      `select * from public.matches ${where} order by started_at desc`,
      values
    );
    if (mRes.rows.length === 0) return [];

    const ids = mRes.rows.map((m) => m.id);
    const [pRes, rRes] = await Promise.all([
      this.pool.query('select * from public.match_participants where match_id = any($1::uuid[])', [
        ids,
      ]),
      this.pool.query(
        'select * from public.rally_events where match_id = any($1::uuid[]) order by seq asc',
        [ids]
      ),
    ]);

    const partMap = new Map<string, MatchParticipant[]>();
    for (const p of pRes.rows) {
      const list = partMap.get(p.match_id) ?? [];
      list.push(p);
      partMap.set(p.match_id, list);
    }

    const rallyMap = new Map<string, RallyEvent[]>();
    for (const r of rRes.rows) {
      const list = rallyMap.get(r.match_id) ?? [];
      list.push(r);
      rallyMap.set(r.match_id, list);
    }

    let hydrated: Match[] = mRes.rows.map((m) => ({
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
    const mRes = await this.pool.query('select * from public.matches where id = $1', [id]);
    if (mRes.rowCount === 0) return null;
    const [pRes, rRes] = await Promise.all([
      this.pool.query('select * from public.match_participants where match_id = $1', [id]),
      this.pool.query('select * from public.rally_events where match_id = $1 order by seq asc', [
        id,
      ]),
    ]);
    return {
      ...mRes.rows[0],
      participants: pRes.rows,
      rallies: rRes.rows,
    };
  }

  async createMatch(input: CreateMatchInput): Promise<Match> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
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
          input.status ?? 'in_progress',
          input.team_a_name,
          input.team_b_name,
          input.live_state ? JSON.stringify(input.live_state) : null,
        ]
      );
      const match = mRes.rows[0];
      const participants: MatchParticipant[] = [];
      for (const p of input.participants) {
        await client.query(
          `insert into public.match_participants (match_id, player_id, team, starting_side)
           values ($1, $2, $3, $4)`,
          [match.id, p.player_id, p.team, p.starting_side]
        );
        participants.push({ match_id: match.id, ...p });
      }
      await client.query('commit');
      return { ...match, participants, rallies: [] };
    } catch (err) {
      await client.query('rollback');
      throw err;
    } finally {
      client.release();
    }
  }

  async updateMatch(id: string, patch: UpdateMatchPatch): Promise<Match | null> {
    const existing = await this.getMatch(id);
    if (!existing) return null;

    const client = await this.pool.connect();
    try {
      await client.query('begin');
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
          patch.winner_team !== undefined ? patch.winner_team : existing.winner_team,
          patch.completed_at !== undefined ? patch.completed_at : existing.completed_at,
          patch.duration_seconds ?? existing.duration_seconds,
          patch.live_state !== undefined
            ? patch.live_state
              ? JSON.stringify(patch.live_state)
              : null
            : existing.live_state
              ? JSON.stringify(existing.live_state)
              : null,
        ]
      );

      if (patch.rallies) {
        await client.query('delete from public.rally_events where match_id = $1', [id]);
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
              r.created_at,
            ]
          );
        }
      }
      await client.query('commit');
    } catch (err) {
      await client.query('rollback');
      throw err;
    } finally {
      client.release();
    }
    return this.getMatch(id);
  }

  async deleteMatch(id: string): Promise<boolean> {
    const res = await this.pool.query('delete from public.matches where id = $1', [id]);
    return (res.rowCount ?? 0) > 0;
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
