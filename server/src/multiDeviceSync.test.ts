import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { afterAll, describe, expect, it } from 'vitest';
import {
  recordRally,
  tagRallyOutcome,
  undoLastRally,
} from '../../shared/pickleballEngine';
import type { Match } from '../../shared/types';
import app from './index';

async function apiJson<T>(
  reqPath: string,
  init?: { method?: string; body?: string }
): Promise<{ status: number; body: T }> {
  const method = init?.method ?? 'GET';
  const payload = init?.body ? Buffer.from(init.body, 'utf-8') : null;

  const req = Readable.from(payload ? [payload] : []) as unknown as {
    method: string;
    url: string;
    headers: Record<string, string>;
    socket: Record<string, unknown>;
  };
  req.method = method;
  req.url = reqPath;
  req.headers = {
    'content-type': 'application/json',
    ...(payload ? { 'content-length': String(payload.length) } : {}),
  };
  req.socket = {};

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const headers: Record<string, string | string[]> = {};
    const res = new EventEmitter() as unknown as {
      statusCode: number;
      setHeader: (k: string, v: string | string[]) => void;
      getHeader: (k: string) => string | string[] | undefined;
      removeHeader: (k: string) => void;
      writeHead: (code: number) => void;
      write: (chunk: Buffer | string) => boolean;
      end: (chunk?: Buffer | string) => void;
    };
    res.statusCode = 200;
    res.setHeader = (k, v) => {
      headers[k.toLowerCase()] = v;
    };
    res.getHeader = (k) => headers[k.toLowerCase()];
    res.removeHeader = (k) => {
      delete headers[k.toLowerCase()];
    };
    res.writeHead = (code) => {
      res.statusCode = code;
    };
    res.write = (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      return true;
    };
    res.end = (chunk) => {
      if (chunk) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      try {
        const raw = Buffer.concat(chunks).toString('utf-8');
        resolve({ status: res.statusCode, body: (raw ? JSON.parse(raw) : {}) as T });
      } catch (err) {
        reject(err);
      }
    };

    (app as unknown as (rq: unknown, rs: unknown, next: (e?: unknown) => void) => void)(
      req,
      res,
      (err) => {
        if (err) reject(err);
      }
    );
  });
}

describe('multi-device live sync & optimistic version guard', () => {
  afterAll(() => {
    const testDbPath = path.join(os.tmpdir(), `momodinks-vitest-${process.pid}.json`);
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
  });

  it('allows sequential updates with matching expected_version and rejects stale device writes with 409', async () => {
    const created = await apiJson<Match>('/api/matches', {
      method: 'POST',
      body: JSON.stringify({
        game_type: 'doubles',
        scoring_mode: 'side_out',
        target_score: 11,
        win_by_two: true,
        team_a_name: 'Device A Team',
        team_b_name: 'Device B Team',
        participants: [],
      }),
    });
    expect(created.status).toBe(201);
    const match = created.body;
    expect(match.live_state?.version).toBe(0);

    // Device 1 scores a rally (expected_version: 0 -> new version: 1)
    const d1State = recordRally(match.live_state!, 'A', match.id);
    const d1Res = await apiJson<Match>(`/api/matches/${match.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        team_a_score: d1State.teamAScore,
        team_b_score: d1State.teamBScore,
        live_state: d1State,
        rallies: d1State.rallies,
        expected_version: 0,
      }),
    });
    expect(d1Res.status).toBe(200);
    expect(d1Res.body.live_state?.version).toBe(1);
    expect(d1Res.body.team_a_score).toBe(1);

    // Device 2 still had version 0 and tries to score -> must get 409 Conflict with latest_match
    const d2StaleState = recordRally(match.live_state!, 'B', match.id);
    const d2Conflict = await apiJson<{ error: string; latest_match: Match }>(
      `/api/matches/${match.id}`,
      {
        method: 'PATCH',
        body: JSON.stringify({
          team_a_score: d2StaleState.teamAScore,
          team_b_score: d2StaleState.teamBScore,
          live_state: d2StaleState,
          rallies: d2StaleState.rallies,
          expected_version: 0,
        }),
      }
    );
    expect(d2Conflict.status).toBe(409);
    expect(d2Conflict.body.latest_match.live_state?.version).toBe(1);
    expect(d2Conflict.body.latest_match.team_a_score).toBe(1);

    // Device 2 syncs to latest_match, then scores on version 1 -> succeeds cleanly (version 2)
    const syncedState = d2Conflict.body.latest_match.live_state!;
    const d2NextState = recordRally(syncedState, 'B', match.id);
    const d2Retry = await apiJson<Match>(`/api/matches/${match.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        team_a_score: d2NextState.teamAScore,
        team_b_score: d2NextState.teamBScore,
        live_state: d2NextState,
        rallies: d2NextState.rallies,
        expected_version: syncedState.version,
      }),
    });
    expect(d2Retry.status).toBe(200);
    expect(d2Retry.body.live_state?.version).toBe(2);
    expect(d2Retry.body.rallies).toHaveLength(2);
  });

  it('survives rapid bursts, tagging, undo, and stale conflict probes without rally seq corruption', async () => {
    const created = await apiJson<Match>('/api/matches', {
      method: 'POST',
      body: JSON.stringify({
        game_type: 'singles',
        scoring_mode: 'rally',
        target_score: 11,
        win_by_two: true,
        team_a_name: 'Burst A',
        team_b_name: 'Burst B',
        participants: [],
      }),
    });
    const match = created.body;

    let state = match.live_state!;
    const baseVersion = state.version ?? 0;

    for (let i = 0; i < 8; i++) {
      state = recordRally(state, i % 2 === 0 ? 'A' : 'B', match.id);
      state = tagRallyOutcome(state, state.rallies[state.rallies.length - 1].seq, 'winner');
    }
    state = undoLastRally(state, 'A', [null, null], [null, null]);

    const firstRes = await apiJson<Match>(`/api/matches/${match.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        team_a_score: state.teamAScore,
        team_b_score: state.teamBScore,
        live_state: state,
        rallies: state.rallies,
        expected_version: baseVersion,
      }),
    });
    expect(firstRes.status).toBe(200);

    const staleRes = await apiJson<{ error: string; latest_match?: Match }>(
      `/api/matches/${match.id}`,
      {
        method: 'PATCH',
        body: JSON.stringify({
          team_a_score: 99,
          team_b_score: 0,
          live_state: state,
          rallies: state.rallies,
          expected_version: baseVersion,
        }),
      }
    );
    expect(staleRes.status).toBe(409);

    const fetched = await apiJson<Match>(`/api/matches/${match.id}`);
    expect(fetched.status).toBe(200);
    expect(fetched.body.rallies).toHaveLength(7);
    expect(fetched.body.team_a_score).toBe(4);
    expect(fetched.body.team_b_score).toBe(3);
  });
});
