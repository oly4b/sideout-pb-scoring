import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey =
  (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined) ||
  (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined);

/** Whether frontend Supabase Realtime credentials (`VITE_SUPABASE_URL` + public key) are configured. */
export const isFrontendSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

/** Browser Supabase client used for live match `postgres_changes` subscriptions, or `null` when unconfigured. */
export const supabaseClient: SupabaseClient | null =
  supabaseUrl && supabaseAnonKey ? createClient(supabaseUrl, supabaseAnonKey) : null;
