import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import cors from 'cors';
import express from 'express';
import { createInitialLiveState } from '../../shared/pickleballEngine';
import { computeDuprRatings } from '../../shared/ratingEngine';
import { generateNextRound } from '../../shared/rotationEngine';
import { computePlayerDetailStats, computeStandings } from '../../shared/statsEngine';
import type { Match, Player } from '../../shared/types';
import { getRepository } from './db';
import { fetchSchedulerUpcoming } from './schedulerSync';

const app = express();
app.use(cors());
app.use(express.json({ limit: '5mb' }));

const repo = getRepository();

/** Returns a player's court nickname or first name, falling back when player metadata is missing. */
function firstName(player: Player | undefined, fallback: string): string {
  if (!player) return fallback;
  return player.nickname?.trim() || player.name.split(' ')[0];
}

// Health & Database Status
app.get('/api/health', async (_req, res) => {
  const status = await repo.getStatus();
  res.json({ ok: true, db: status });
});

app.get('/api/db/status', async (_req, res) => {
  const status = await repo.getStatus();
  res.json(status);
});

app.get('/api/scheduler/upcoming', async (req, res) => {
  try {
    const minDate = typeof req.query.minDate === 'string' ? req.query.minDate : undefined;
    const payload = await fetchSchedulerUpcoming(minDate);
    res.json(payload);
  } catch (err) {
    res.status(500).json({
      connected: false,
      min_date: '',
      sessions: [],
      players: [],
      error: err instanceof Error ? err.message : 'Failed to fetch scheduler data',
    });
  }
});

app.get('/api/db/schema', (_req, res) => {
  const schemaPath = path.resolve(process.cwd(), 'supabase/migrations/001_initial_schema.sql');
  const sql = fs.existsSync(schemaPath) ? fs.readFileSync(schemaPath, 'utf-8') : '';
  res.json({ sql });
});

app.get('/api/export', async (_req, res) => {
  try {
    const dump = await repo.exportAll();
    res.json(dump);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Export failed' });
  }
});

app.get('/api/export-project', (_req, res) => {
  const zipPath = path.resolve(process.cwd(), 'server/data/sideout-pb-scoring.zip');
  if (!fs.existsSync(zipPath)) {
    res.status(404).json({ error: 'Project archive not found' });
    return;
  }
  res.download(zipPath, 'sideout-pb-scoring.zip');
});

const SEED_COLORS = ['#1D4ED8', '#15803D', '#E25747', '#B45309', '#0E7490', '#BE185D', '#3F6212'];

/** Recomputes DUPR-style ratings across all completed matches and persists any changed player ratings. */
async function syncPlayerRatings(existingPlayers?: Player[]): Promise<Player[]> {
  const [players, matches] = await Promise.all([
    existingPlayers ? Promise.resolve(existingPlayers) : repo.listPlayers(),
    repo.listMatches(),
  ]);
  const { ratings } = computeDuprRatings(players, matches);
  const updatedList: Player[] = [];

  for (const p of players) {
    const computed = ratings.get(p.id)?.rating ?? null;
    const current = p.skill_rating ?? null;
    if (computed !== current) {
      const updated = await repo.updatePlayer(p.id, { skill_rating: computed });
      updatedList.push(updated ?? { ...p, skill_rating: computed });
    } else {
      updatedList.push(p);
    }
  }
  return updatedList;
}

// Players
app.get('/api/players', async (_req, res) => {
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
            skill_rating: null,
            avatar_color: SEED_COLORS[i % SEED_COLORS.length],
          });
        }
        players = await repo.listPlayers();
      }
    }
    players = await syncPlayerRatings(players);
    res.json(players);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to list players' });
  }
});

app.post('/api/players', async (req, res) => {
  try {
    const { name, nickname, skill_rating, avatar_color } = req.body ?? {};
    if (!name || typeof name !== 'string' || !name.trim()) {
      res.status(400).json({ error: 'Player name is required' });
      return;
    }
    const created = await repo.createPlayer({ name, nickname, skill_rating, avatar_color });
    res.status(201).json(created);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to create player' });
  }
});

app.patch('/api/players/:id', async (req, res) => {
  try {
    const updated = await repo.updatePlayer(req.params.id, req.body ?? {});
    if (!updated) {
      res.status(404).json({ error: 'Player not found' });
      return;
    }
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to update player' });
  }
});

app.delete('/api/players/:id', async (req, res) => {
  try {
    const ok = await repo.deletePlayer(req.params.id);
    res.json({ deleted: ok });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to delete player' });
  }
});

app.get('/api/standings', async (_req, res) => {
  try {
    const [players, matches] = await Promise.all([repo.listPlayers(), repo.listMatches()]);
    res.json(computeStandings(players, matches));
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to compute standings' });
  }
});

app.get('/api/players/:id/stats', async (req, res) => {
  try {
    const [players, matches] = await Promise.all([repo.listPlayers(), repo.listMatches()]);
    const stats = computePlayerDetailStats(req.params.id, players, matches);
    if (!stats) {
      res.status(404).json({ error: 'Player not found' });
      return;
    }
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to compute player stats' });
  }
});

// Sessions
app.get('/api/sessions', async (_req, res) => {
  try {
    const sessions = await repo.listSessions();
    res.json(sessions);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to list sessions' });
  }
});

app.get('/api/sessions/:id', async (req, res) => {
  try {
    const session = await repo.getSession(req.params.id);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    res.json(session);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to load session' });
  }
});

/** Persists scheduled doubles matches and initial `LiveGameState` records for a generated session round. */
async function createMatchesForProposal(params: {
  session: Awaited<ReturnType<typeof repo.createSession>>;
  roundNumber: number;
  proposalMatches: ReturnType<typeof generateNextRound>['matches'];
  playerMap: Map<string, Player>;
}): Promise<Match[]> {
  const { session, roundNumber, proposalMatches, playerMap } = params;
  const createdMatches: Match[] = [];

  for (const pm of proposalMatches) {
    const a1 = playerMap.get(pm.teamA[0]);
    const a2 = playerMap.get(pm.teamA[1]);
    const b1 = playerMap.get(pm.teamB[0]);
    const b2 = playerMap.get(pm.teamB[1]);

    const liveState = createInitialLiveState({
      gameType: 'doubles',
      scoringMode: session.scoring_mode,
      targetScore: session.target_score,
      winByTwo: session.win_by_two,
      initialServingTeam: 'A',
      teamAPlayers: pm.teamA,
      teamBPlayers: pm.teamB,
    });

    const match = await repo.createMatch({
      session_id: session.id,
      round_number: roundNumber,
      court_number: pm.court_number,
      game_type: 'doubles',
      scoring_mode: session.scoring_mode,
      target_score: session.target_score,
      win_by_two: session.win_by_two,
      status: 'scheduled',
      team_a_name: `${firstName(a1, 'P1')} & ${firstName(a2, 'P2')}`,
      team_b_name: `${firstName(b1, 'P3')} & ${firstName(b2, 'P4')}`,
      participants: [
        { player_id: pm.teamA[0], team: 'A', starting_side: 'right' },
        { player_id: pm.teamA[1], team: 'A', starting_side: 'left' },
        { player_id: pm.teamB[0], team: 'B', starting_side: 'right' },
        { player_id: pm.teamB[1], team: 'B', starting_side: 'left' },
      ],
      live_state: liveState,
    });
    createdMatches.push(match);
  }

  return createdMatches;
}

app.post('/api/sessions', async (req, res) => {
  try {
    const body = req.body ?? {};
    if (!body.title || !Array.isArray(body.player_ids) || body.player_ids.length < 4) {
      res.status(400).json({ error: 'Session title and at least 4 players are required' });
      return;
    }
    const session = await repo.createSession({
      title: body.title,
      format: body.format ?? 'rotating_partners',
      courts_count: Number(body.courts_count ?? 2),
      scoring_mode: body.scoring_mode ?? 'side_out',
      target_score: Number(body.target_score ?? 11) as 7 | 11 | 15 | 21,
      win_by_two: body.win_by_two !== false,
      location: body.location ?? null,
      player_ids: body.player_ids,
      team_slots: body.team_slots,
    });

    // Automatically generate Round 1 matches
    const players = await repo.listPlayers();
    const playerMap = new Map(players.map((p) => [p.id, p]));
    const proposal = generateNextRound({
      format: session.format,
      courtsCount: session.courts_count,
      sessionPlayers: session.players,
      previousMatches: [],
      nextRoundNumber: 1,
    });

    const createdMatches = await createMatchesForProposal({
      session,
      roundNumber: 1,
      proposalMatches: proposal.matches,
      playerMap,
    });

    res.status(201).json({ ...session, matches: createdMatches });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to create session' });
  }
});

app.post('/api/sessions/:id/next-round', async (req, res) => {
  try {
    const session = await repo.getSession(req.params.id);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
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
      nextRoundNumber,
    });

    const createdMatches = await createMatchesForProposal({
      session,
      roundNumber: nextRoundNumber,
      proposalMatches: proposal.matches,
      playerMap,
    });

    const updated = await repo.updateSession(session.id, { current_round: nextRoundNumber });
    res.json({ session: updated, new_matches: createdMatches, sitting_out: proposal.sitting_out });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to generate round' });
  }
});

app.get('/api/sessions/:id/standings', async (req, res) => {
  try {
    const session = await repo.getSession(req.params.id);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    const allPlayers = await repo.listPlayers();
    const sessionPlayerIds = new Set(session.players.map((p) => p.player_id));
    const sessionPlayers = allPlayers.filter((p) => sessionPlayerIds.has(p.id));
    res.json(computeStandings(sessionPlayers, session.matches ?? []));
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to compute session standings' });
  }
});

app.post('/api/sessions/:id/end', async (req, res) => {
  try {
    const updated = await repo.updateSession(req.params.id, {
      status: 'completed',
      ended_at: new Date().toISOString(),
    });
    if (!updated) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to end session' });
  }
});

app.delete('/api/sessions/:id', async (req, res) => {
  try {
    const ok = await repo.deleteSession(req.params.id);
    res.json({ deleted: ok });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to delete session' });
  }
});

// Matches
app.get('/api/matches', async (req, res) => {
  try {
    const matches = await repo.listMatches({
      sessionId: typeof req.query.sessionId === 'string' ? req.query.sessionId : undefined,
      playerId: typeof req.query.playerId === 'string' ? req.query.playerId : undefined,
      status:
        req.query.status === 'scheduled' ||
        req.query.status === 'in_progress' ||
        req.query.status === 'completed'
          ? req.query.status
          : undefined,
    });
    res.json(matches);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to list matches' });
  }
});

app.get('/api/matches/:id', async (req, res) => {
  try {
    const match = await repo.getMatch(req.params.id);
    if (!match) {
      res.status(404).json({ error: 'Match not found' });
      return;
    }
    res.json(match);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to fetch match' });
  }
});

app.post('/api/matches', async (req, res) => {
  try {
    const body = req.body ?? {};
    const gameType = body.game_type ?? 'doubles';
    const scoringMode = body.scoring_mode ?? 'side_out';
    const targetScore = Number(body.target_score ?? 11) as 7 | 11 | 15 | 21;
    const winByTwo = body.win_by_two !== false;
    const participants = Array.isArray(body.participants) ? body.participants : [];

    const teamA = participants.filter((p: { team: string }) => p.team === 'A');
    const teamB = participants.filter((p: { team: string }) => p.team === 'B');

    const liveState =
      body.live_state ??
      createInitialLiveState({
        gameType,
        scoringMode,
        targetScore,
        winByTwo,
        initialServingTeam: body.initial_serving_team ?? 'A',
        teamAPlayers: [teamA[0]?.player_id ?? null, teamA[1]?.player_id ?? null],
        teamBPlayers: [teamB[0]?.player_id ?? null, teamB[1]?.player_id ?? null],
      });

    const created = await repo.createMatch({
      session_id: body.session_id ?? null,
      round_number: body.round_number ?? null,
      court_number: body.court_number ?? null,
      game_type: gameType,
      scoring_mode: scoringMode,
      target_score: targetScore,
      win_by_two: winByTwo,
      status: body.status ?? 'in_progress',
      team_a_name: body.team_a_name || 'Team A',
      team_b_name: body.team_b_name || 'Team B',
      participants,
      live_state: liveState,
    });
    res.status(201).json(created);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to create match' });
  }
});

app.patch('/api/matches/:id', async (req, res) => {
  try {
    const updated = await repo.updateMatch(req.params.id, req.body ?? {});
    if (!updated) {
      res.status(404).json({ error: 'Match not found' });
      return;
    }
    if (updated.status === 'completed') {
      await syncPlayerRatings().catch(() => undefined);
    }
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to update match' });
  }
});

app.post('/api/matches/:id/quick-score', async (req, res) => {
  try {
    const { team_a_score, team_b_score } = req.body ?? {};
    const a = Number(team_a_score);
    const b = Number(team_b_score);
    if (!Number.isFinite(a) || !Number.isFinite(b) || a < 0 || b < 0 || a === b) {
      res.status(400).json({ error: 'Enter valid non-tied scores to record a quick result' });
      return;
    }
    const existing = await repo.getMatch(req.params.id);
    if (!existing) {
      res.status(404).json({ error: 'Match not found' });
      return;
    }
    const now = new Date().toISOString();
    const duration = Math.max(
      60,
      Math.round((Date.now() - new Date(existing.started_at).getTime()) / 1000)
    );
    const updated = await repo.updateMatch(req.params.id, {
      status: 'completed',
      team_a_score: a,
      team_b_score: b,
      winner_team: a > b ? 'A' : 'B',
      completed_at: now,
      duration_seconds: existing.duration_seconds || duration,
    });
    await syncPlayerRatings().catch(() => undefined);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to save quick score' });
  }
});

app.delete('/api/matches/:id', async (req, res) => {
  try {
    const ok = await repo.deleteMatch(req.params.id);
    if (ok) {
      await syncPlayerRatings().catch(() => undefined);
    }
    res.json({ deleted: ok });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to delete match' });
  }
});

// Serve built SPA in production if dist/ exists (skipped on Vercel where static files are served by CDN)
if (!process.env.VERCEL) {
  const distDir = path.resolve(process.cwd(), 'dist');
  if (fs.existsSync(distDir)) {
    app.use(express.static(distDir));
    app.get('/{*splat}', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  const PORT = Number(process.env.PORT ?? 4000);
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[API] Sideout Pickleball server listening on http://localhost:${PORT}`);
  });
}

export default app;
