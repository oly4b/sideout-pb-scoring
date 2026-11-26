import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type {
  SchedulerAttendee,
  SchedulerBookedSession,
  SchedulerPollPlayer,
  SchedulerUpcomingPayload,
} from '../../shared/types';
import { resolveVenue } from '../../shared/venues';

let schedulerClient: SupabaseClient | null = null;

function getSchedulerClient(): SupabaseClient | null {
  if (schedulerClient) return schedulerClient;

  const url =
    process.env.SCHEDULER_SUPABASE_URL?.trim() ||
    process.env.VITE_SUPABASE_URL?.trim() ||
    process.env.SUPABASE_URL?.trim();
  const key =
    process.env.SCHEDULER_SUPABASE_KEY?.trim() ||
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() ||
    process.env.VITE_SUPABASE_ANON_KEY?.trim() ||
    process.env.SUPABASE_ANON_KEY?.trim();

  if (!url || !key) return null;

  schedulerClient = createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
  return schedulerClient;
}

export function getTodayJstDateKey(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

export async function fetchSchedulerUpcoming(
  minDateInput?: string
): Promise<SchedulerUpcomingPayload> {
  const minDate = minDateInput?.trim() || getTodayJstDateKey();
  const client = getSchedulerClient();

  if (!client) {
    return {
      connected: false,
      min_date: minDate,
      sessions: [],
      players: [],
      error: 'Scheduler Supabase credentials not configured (SCHEDULER_SUPABASE_URL / KEY).',
    };
  }

  const [bookedRes, attendeesRes, votesRes] = await Promise.all([
    client
      .from('booked_sessions')
      .select('date_key, start_hour, end_hour, venue_id, venue_name, map_url, court_type')
      .gte('date_key', minDate)
      .order('date_key', { ascending: true }),
    client
      .from('session_attendees')
      .select('session_date, start_hour, end_hour, venue_id, venue_name, attendee_name, status')
      .gte('session_date', minDate),
    client
      .from('calendar_votes')
      .select('name, note')
      .order('created_at', { ascending: true }),
  ]);

  if (bookedRes.error) {
    return {
      connected: false,
      min_date: minDate,
      sessions: [],
      players: [],
      error: bookedRes.error.message,
    };
  }

  const attendeesByDate = new Map<string, SchedulerAttendee[]>();
  const playerMap = new Map<string, SchedulerPollPlayer>();

  for (const row of attendeesRes.data ?? []) {
    const dateKey = String(row.session_date ?? '');
    const name = String(row.attendee_name ?? '').trim();
    if (!dateKey || !name) continue;
    const status: 'yes' | 'maybe' = row.status === 'maybe' ? 'maybe' : 'yes';

    const list = attendeesByDate.get(dateKey) ?? [];
    list.push({ attendee_name: name, status });
    attendeesByDate.set(dateKey, list);

    if (!playerMap.has(name.toLowerCase())) {
      playerMap.set(name.toLowerCase(), { name, note: '' });
    }
  }

  for (const row of votesRes.data ?? []) {
    const name = String(row.name ?? '').trim();
    if (!name) continue;
    const note = String(row.note ?? '').trim();
    if (!playerMap.has(name.toLowerCase())) {
      playerMap.set(name.toLowerCase(), { name, note });
    } else if (note) {
      const existing = playerMap.get(name.toLowerCase())!;
      if (!existing.note) existing.note = note;
    }
  }

  const sessions: SchedulerBookedSession[] = (bookedRes.data ?? []).map((row) => {
    const courtType: 'indoor' | 'outdoor' =
      row.court_type === 'outdoor' ? 'outdoor' : 'indoor';
    const resolved = resolveVenue(
      String(row.venue_id ?? 'other'),
      row.venue_name ? String(row.venue_name) : '',
      courtType
    );

    return {
      date_key: String(row.date_key),
      start_hour: Number(row.start_hour ?? 19),
      end_hour: Number(row.end_hour ?? 21),
      venue_id: resolved.id,
      venue_short_name: resolved.shortName,
      venue_full_name: resolved.fullName,
      map_url: String(row.map_url ?? ''),
      court_type: courtType,
      attendees: attendeesByDate.get(String(row.date_key)) ?? [],
    };
  });

  return {
    connected: true,
    min_date: minDate,
    sessions,
    players: Array.from(playerMap.values()),
  };
}
