-- Modo Blitz (partida individual cronometrada). Ejecutar DESPUÉS de questions/schema.sql.
create table if not exists blitz_sessions (
  id uuid primary key default gen_random_uuid(),
  category text,
  question_ids uuid[] not null,
  answers jsonb not null default '{}'::jsonb,
  score int not null default 0,
  correct_count int not null default 0,
  answered_count int not null default 0,
  streak int not null default 0,
  best_streak int not null default 0,
  started_at timestamptz not null default now(),
  ends_at timestamptz not null,
  finished_at timestamptz,
  player_name text check (player_name is null or char_length(player_name) between 2 and 20)
);

create index if not exists blitz_sessions_ranking_idx
  on blitz_sessions (score desc, finished_at)
  where player_name is not null;

-- Sin políticas: solo el backend (service_role) puede leer y escribir.
alter table blitz_sessions enable row level security;
