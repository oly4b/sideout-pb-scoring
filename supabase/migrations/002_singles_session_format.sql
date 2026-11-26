alter table public.sessions
  drop constraint if exists sessions_format_check;

alter table public.sessions
  add constraint sessions_format_check
  check (format in ('open_play', 'rotating_partners', 'set_partners', 'king_of_court', 'singles'));
