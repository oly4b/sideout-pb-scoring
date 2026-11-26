import path from 'node:path';
import { LocalJsonAdapter } from './localJsonAdapter';
import { PostgresAdapter } from './postgresAdapter';
import type { DataRepository } from './repository';
import { SupabaseAdapter } from './supabaseAdapter';

let singleton: DataRepository | null = null;

export function getRepository(): DataRepository {
  if (singleton) return singleton;

  const supabaseUrl =
    process.env.SUPABASE_URL?.trim() ||
    process.env.VITE_SUPABASE_URL?.trim() ||
    process.env.SCHEDULER_SUPABASE_URL?.trim();
  const supabaseKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    process.env.SUPABASE_ANON_KEY?.trim() ||
    process.env.SUPABASE_PUBLISHABLE_KEY?.trim() ||
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() ||
    process.env.VITE_SUPABASE_ANON_KEY?.trim() ||
    process.env.SCHEDULER_SUPABASE_KEY?.trim();
  const databaseUrl = process.env.DATABASE_URL?.trim();

  if (supabaseUrl && supabaseKey) {
    let host = supabaseUrl;
    try {
      host = new URL(supabaseUrl).host;
    } catch {
      // keep raw string if URL parsing fails
    }
    console.log(`[DB] Using SupabaseAdapter (${host})`);
    singleton = new SupabaseAdapter(supabaseUrl, supabaseKey);
    return singleton;
  }

  if (databaseUrl) {
    console.log('[DB] Using PostgresAdapter (DATABASE_URL)');
    singleton = new PostgresAdapter(databaseUrl);
    return singleton;
  }

  const localPath = process.env.VERCEL
    ? '/tmp/momodinks-db.json'
    : path.resolve(process.cwd(), 'server/data/db.json');
  console.log(`[DB] Using LocalJsonAdapter (${localPath}) — set SUPABASE_URL or DATABASE_URL in .env to connect Postgres/Supabase`);
  singleton = new LocalJsonAdapter(localPath);
  return singleton;
}
