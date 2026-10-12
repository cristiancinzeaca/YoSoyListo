-- =====================================================================
-- Yo Soy Listo · Base de datos completa
-- Ejecutar en Supabase → SQL Editor → New query → pegar todo → Run.
-- Se puede ejecutar varias veces sin problema (no borra datos).
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- Preguntas
-- ---------------------------------------------------------------------
create table if not exists questions (
  id uuid primary key default gen_random_uuid(),
  text text not null check (char_length(text) between 5 and 500),
  options text[] not null check (array_length(options, 1) between 2 and 6),
  correct_index smallint not null,
  category text not null default 'general',
  difficulty smallint not null default 2 check (difficulty between 1 and 3),
  explanation text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint correct_index_in_range
    check (correct_index >= 0 and correct_index < array_length(options, 1))
);

create index if not exists questions_active_category_idx on questions (active, category);

-- N preguntas activas al azar, opcionalmente de una categoría.
create or replace function random_questions(p_limit int, p_category text default null)
returns setof questions
language sql stable as $$
  select * from questions
  where active and (p_category is null or category = p_category)
  order by random()
  limit p_limit;
$$;

-- Categorías con preguntas activas y cuántas tiene cada una.
create or replace function question_categories()
returns table (category text, total bigint)
language sql stable as $$
  select category, count(*) as total
  from questions
  where active
  group by category
  order by category;
$$;

-- Avisos de los jugadores sobre preguntas con errores.
create table if not exists question_reports (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null references questions (id) on delete cascade,
  reason text not null check (char_length(reason) between 2 and 300),
  player_id uuid,
  created_at timestamptz not null default now()
);

create index if not exists question_reports_question_idx on question_reports (question_id);

-- ---------------------------------------------------------------------
-- Jugadores (perfil de invitado: sin email ni contraseña)
-- ---------------------------------------------------------------------
create table if not exists players (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 20),
  token_hash text not null unique,
  rating int not null default 1000,
  duels_played int not null default 0,
  duels_won int not null default 0,
  rooms_played int not null default 0,
  rooms_won int not null default 0,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create index if not exists players_rating_idx on players (rating desc) where duels_played > 0;

-- Suma el resultado de una partida a las estadísticas del jugador (de forma atómica).
create or replace function apply_player_result(
  p_id uuid, p_rating int, p_duels int, p_duel_wins int, p_rooms int, p_room_wins int
) returns void
language sql as $$
  update players set
    rating = coalesce(p_rating, rating),
    duels_played = duels_played + p_duels,
    duels_won = duels_won + p_duel_wins,
    rooms_played = rooms_played + p_rooms,
    rooms_won = rooms_won + p_room_wins,
    last_seen_at = now()
  where id = p_id;
$$;

-- ---------------------------------------------------------------------
-- Modo Blitz (partida individual de 60 segundos)
-- ---------------------------------------------------------------------
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

alter table blitz_sessions add column if not exists player_id uuid references players (id) on delete set null;

create index if not exists blitz_sessions_ranking_idx
  on blitz_sessions (score desc, finished_at)
  where player_name is not null;
create index if not exists blitz_sessions_player_idx on blitz_sessions (player_id);

-- ---------------------------------------------------------------------
-- Partidas en red (duelos y salas privadas)
-- ---------------------------------------------------------------------
create table if not exists matches (
  id uuid primary key default gen_random_uuid(),
  mode text not null check (mode in ('duel', 'room')),
  category text,
  question_count int not null,
  vs_bot boolean not null default false,
  started_at timestamptz not null,
  finished_at timestamptz not null default now()
);

create table if not exists match_players (
  match_id uuid not null references matches (id) on delete cascade,
  player_id uuid references players (id) on delete set null,
  name text not null,
  is_bot boolean not null default false,
  score int not null,
  correct_count int not null,
  position int not null,
  rating_before int,
  rating_after int
);

create index if not exists match_players_player_idx on match_players (player_id);

-- ---------------------------------------------------------------------
-- Preguntas de aproximación (respuesta numérica) para el modo Conquista
-- ---------------------------------------------------------------------
create table if not exists numeric_questions (
  id uuid primary key default gen_random_uuid(),
  text text not null check (char_length(text) between 5 and 500),
  answer double precision not null,
  unit text,
  category text not null default 'general',
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create or replace function random_numeric_questions(p_limit int)
returns setof numeric_questions
language sql stable as $$
  select * from numeric_questions where active order by random() limit p_limit;
$$;

-- Estadísticas del modo Conquista.
alter table players add column if not exists conquista_played int not null default 0;
alter table players add column if not exists conquista_won int not null default 0;

create or replace function apply_conquista_result(p_id uuid, p_won int)
returns void
language sql as $$
  update players set
    conquista_played = conquista_played + 1,
    conquista_won = conquista_won + p_won,
    last_seen_at = now()
  where id = p_id;
$$;

alter table matches drop constraint if exists matches_mode_check;
alter table matches add constraint matches_mode_check check (mode in ('duel', 'room', 'conquista'));

-- ---------------------------------------------------------------------
-- Cuentas con Google, monedas y tienda
-- ---------------------------------------------------------------------
-- Los perfiles de invitado antiguos tienen token_hash; las cuentas de Google usan sesiones.
alter table players alter column token_hash drop not null;
alter table players add column if not exists google_sub text unique;
alter table players add column if not exists email text;
alter table players add column if not exists coins int not null default 0;
alter table players add column if not exists avatar text;

-- Una fila por dispositivo con la sesión iniciada.
create table if not exists player_sessions (
  token_hash text primary key,
  player_id uuid not null references players (id) on delete cascade,
  created_at timestamptz not null default now(),
  last_used_at timestamptz not null default now()
);
create index if not exists player_sessions_player_idx on player_sessions (player_id);

-- Comodines (cantidad) y avatares comprados («avatar:toro», cantidad 1).
create table if not exists player_items (
  player_id uuid not null references players (id) on delete cascade,
  item text not null,
  qty int not null default 0 check (qty >= 0),
  primary key (player_id, item)
);

-- Historial de monedas: lo ganado en partidas (positivo) y lo gastado en la tienda (negativo).
create table if not exists coin_ledger (
  id bigserial primary key,
  player_id uuid not null references players (id) on delete cascade,
  amount int not null,
  reason text not null,
  created_at timestamptz not null default now()
);
create index if not exists coin_ledger_player_idx on coin_ledger (player_id, created_at);

alter table blitz_sessions add column if not exists helpers jsonb not null default '{}'::jsonb;
alter table blitz_sessions add column if not exists coins int;

-- Suma monedas de una partida respetando el tope diario (hora de Madrid).
-- La primera partida del día da además un bonus.
create or replace function award_coins(p_id uuid, p_amount int, p_reason text, p_daily_cap int, p_daily_bonus int)
returns table (awarded int, bonus int, balance int)
language plpgsql as $$
declare
  day_start timestamptz := date_trunc('day', now() at time zone 'Europe/Madrid') at time zone 'Europe/Madrid';
  earned int;
  games_today int;
  give int;
  extra int := 0;
  bal int;
begin
  perform 1 from players where id = p_id for update;
  if not found then return; end if;
  select coalesce(sum(l.amount), 0), count(*) into earned, games_today
    from coin_ledger l
    where l.player_id = p_id and l.reason like 'game:%' and l.created_at >= day_start;
  give := greatest(0, least(p_amount, p_daily_cap - earned));
  if games_today = 0 and p_daily_bonus > 0 then extra := p_daily_bonus; end if;
  -- Se apunta aunque sea 0, para que el bonus diario solo se dé una vez.
  insert into coin_ledger (player_id, amount, reason) values (p_id, give, p_reason);
  if extra > 0 then insert into coin_ledger (player_id, amount, reason) values (p_id, extra, 'bonus:daily'); end if;
  update players set coins = coins + give + extra where id = p_id returning coins into bal;
  return query select give, extra, bal;
end;
$$;

-- Compra atómica: resta las monedas y suma el artículo, o no hace nada.
create or replace function buy_item(p_id uuid, p_item text, p_price int, p_qty int, p_unique boolean)
returns table (ok boolean, coins_left int, item_qty int)
language plpgsql as $$
declare
  bal int;
  q int;
begin
  perform 1 from players where id = p_id for update;
  if not found then return; end if;
  select coalesce((select pi.qty from player_items pi where pi.player_id = p_id and pi.item = p_item), 0) into q;
  if p_unique and q > 0 then
    return query select false, (select p.coins from players p where p.id = p_id), q;
    return;
  end if;
  update players set coins = coins - p_price where id = p_id and coins >= p_price returning coins into bal;
  if not found then
    return query select false, (select p.coins from players p where p.id = p_id), q;
    return;
  end if;
  insert into player_items (player_id, item, qty) values (p_id, p_item, p_qty)
    on conflict (player_id, item) do update set qty = player_items.qty + excluded.qty
    returning player_items.qty into q;
  insert into coin_ledger (player_id, amount, reason) values (p_id, -p_price, 'buy:' || p_item);
  return query select true, bal, q;
end;
$$;

-- Gasta un comodín. Devuelve cuántos quedan (o ninguna fila si no tenía).
create or replace function use_item(p_id uuid, p_item text)
returns table (item_left int)
language plpgsql as $$
declare
  q int;
begin
  update player_items set qty = qty - 1 where player_id = p_id and item = p_item and qty > 0 returning qty into q;
  if not found then return; end if;
  return query select q;
end;
$$;

-- ---------------------------------------------------------------------
-- Seguridad: activar RLS sin políticas. Así solo el backend
-- (service_role) puede leer y escribir; la anon key no ve nada.
-- ---------------------------------------------------------------------
alter table questions enable row level security;
alter table question_reports enable row level security;
alter table players enable row level security;
alter table blitz_sessions enable row level security;
alter table matches enable row level security;
alter table match_players enable row level security;
alter table numeric_questions enable row level security;
alter table player_sessions enable row level security;
alter table player_items enable row level security;
alter table coin_ledger enable row level security;
