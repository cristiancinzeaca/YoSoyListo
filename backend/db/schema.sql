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
alter table matches add constraint matches_mode_check check (mode in ('duel', 'room', 'conquista', 'conquista18'));

-- ---------------------------------------------------------------------
-- Cuentas con Google, monedas y tienda
-- ---------------------------------------------------------------------
-- Los perfiles de invitado antiguos tienen token_hash; las cuentas de Google usan sesiones.
alter table players alter column token_hash drop not null;
alter table players add column if not exists google_sub text unique;
alter table players add column if not exists email text;
alter table players add column if not exists coins int not null default 0;
alter table players add column if not exists avatar text;

-- Nombres únicos: name_key es el nombre sin mayúsculas, acentos ni separadores (lo calcula
-- el servidor, ver modules/players/names.js). Las filas antiguas se rellenan al arrancar.
alter table players add column if not exists name_key text;
create unique index if not exists players_name_key_idx on players (name_key);

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
-- «Compra un país»: dueños, ataques y funciones de monedas
-- ---------------------------------------------------------------------
create table if not exists country_owners (
  country text primary key,
  player_id uuid not null references players (id) on delete cascade,
  value int not null,
  defense int[] not null default '{}', -- preguntas elegidas por el dueño (posición en el banco)
  fortify int not null default 0,
  income_at timestamptz not null default now(),
  bought_at timestamptz not null default now(),
  defenses_won int not null default 0
);
create index if not exists country_owners_player_idx on country_owners (player_id);

create table if not exists country_attacks (
  id uuid primary key default gen_random_uuid(),
  country text not null,
  attacker_id uuid not null references players (id) on delete cascade,
  owner_id uuid references players (id) on delete set null,
  seqs int[] not null,
  perms jsonb not null,
  current int not null default 0,
  deadline timestamptz not null,
  status text not null default 'active' check (status in ('active', 'won', 'lost')),
  created_at timestamptz not null default now()
);
create index if not exists country_attacks_attacker_idx on country_attacks (attacker_id, country, created_at);

-- Cambio de nombre atómico: libre, con saldo, y cobra p_cost (gratis si la clave no cambia).
create or replace function rename_player(p_id uuid, p_name text, p_key text, p_cost int)
returns table (ok boolean, reason text, cost int, coins_left int)
language plpgsql as $$
declare
  me players%rowtype;
  price int;
begin
  select * into me from players where id = p_id for update;
  if not found then return; end if;
  if exists (select 1 from players where name_key = p_key and id <> p_id) then
    return query select false, 'taken'::text, 0, me.coins;
    return;
  end if;
  price := case when me.name_key = p_key then 0 else p_cost end;
  if me.coins < price then
    return query select false, 'coins'::text, price, me.coins;
    return;
  end if;
  begin
    update players set name = p_name, name_key = p_key, coins = coins - price where id = p_id;
  exception when unique_violation then
    return query select false, 'taken'::text, 0, me.coins;
    return;
  end;
  if price > 0 then
    insert into coin_ledger (player_id, amount, reason) values (p_id, -price, 'rename');
  end if;
  return query select true, null::text, price, me.coins - price;
end;
$$;

-- Cobra monedas si hay saldo suficiente.
create or replace function pay_coins(p_id uuid, p_amount int, p_reason text)
returns table (ok boolean, balance int)
language plpgsql as $$
declare
  bal int;
begin
  update players set coins = coins - p_amount where id = p_id and coins >= p_amount returning coins into bal;
  if not found then
    return query select false, (select p.coins from players p where p.id = p_id);
    return;
  end if;
  insert into coin_ledger (player_id, amount, reason) values (p_id, -p_amount, p_reason);
  return query select true, bal;
end;
$$;

-- Da monedas fuera del tope diario (rentas de países, defensas, indemnizaciones).
create or replace function add_coins(p_id uuid, p_amount int, p_reason text)
returns table (balance int)
language plpgsql as $$
declare
  bal int;
begin
  update players set coins = coins + p_amount where id = p_id returning coins into bal;
  if not found then return; end if;
  insert into coin_ledger (player_id, amount, reason) values (p_id, p_amount, p_reason);
  return query select bal;
end;
$$;

-- Compra atómica de un país libre.
create or replace function buy_country(p_id uuid, p_country text, p_price int)
returns table (ok boolean, reason text, coins_left int)
language plpgsql as $$
declare
  bal int;
begin
  perform 1 from players where id = p_id for update;
  if not found then return; end if;
  if exists (select 1 from country_owners where country = p_country) then
    return query select false, 'taken'::text, (select p.coins from players p where p.id = p_id);
    return;
  end if;
  update players set coins = coins - p_price where id = p_id and coins >= p_price returning coins into bal;
  if not found then
    return query select false, 'coins'::text, (select p.coins from players p where p.id = p_id);
    return;
  end if;
  begin
    insert into country_owners (country, player_id, value) values (p_country, p_id, p_price);
  exception when unique_violation then
    update players set coins = coins + p_price where id = p_id returning coins into bal;
    return query select false, 'taken'::text, bal;
    return;
  end;
  insert into coin_ledger (player_id, amount, reason) values (p_id, -p_price, 'country:buy:' || p_country);
  return query select true, 'ok'::text, bal;
end;
$$;

-- Cobra las rentas acumuladas de todos los países del jugador (máx. p_max_days días).
create or replace function collect_income(p_id uuid, p_rate double precision, p_max_days double precision)
returns table (amount int, balance int)
language plpgsql as $$
declare
  total int := 0;
  bal int;
begin
  perform 1 from players where id = p_id for update;
  if not found then return; end if;
  select coalesce(sum(floor(o.value * p_rate * least(extract(epoch from now() - o.income_at) / 86400.0, p_max_days))), 0)::int
    into total from country_owners o where o.player_id = p_id;
  update country_owners set income_at = now() where player_id = p_id;
  update players set coins = coins + total where id = p_id returning coins into bal;
  if total > 0 then insert into coin_ledger (player_id, amount, reason) values (p_id, total, 'country:income'); end if;
  return query select total, bal;
end;
$$;

-- El atacante conquista el país (solo si el dueño no ha cambiado entretanto).
create or replace function conquer_country(p_country text, p_attacker uuid, p_owner uuid, p_compensation double precision)
returns table (ok boolean, compensation int)
language plpgsql as $$
declare
  v int;
  comp int;
begin
  select o.value into v from country_owners o where o.country = p_country and o.player_id = p_owner for update;
  if not found then
    return query select false, 0;
    return;
  end if;
  comp := floor(v * p_compensation)::int;
  update country_owners set player_id = p_attacker, defense = '{}', fortify = 0, income_at = now(), bought_at = now(), defenses_won = 0
    where country = p_country;
  update players set coins = coins + comp where id = p_owner;
  insert into coin_ledger (player_id, amount, reason) values (p_owner, comp, 'country:compensation:' || p_country);
  return query select true, comp;
end;
$$;

-- Ataque fallido: el dueño se queda el coste del ataque y el país sube de valor.
create or replace function defend_country(p_country text, p_owner uuid, p_fee int, p_gain int)
returns void
language plpgsql as $$
begin
  update country_owners set value = value + p_gain, defenses_won = defenses_won + 1 where country = p_country and player_id = p_owner;
  if found then
    update players set coins = coins + p_fee where id = p_owner;
    insert into coin_ledger (player_id, amount, reason) values (p_owner, p_fee, 'country:defense:' || p_country);
  end if;
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
alter table country_owners enable row level security;
alter table country_attacks enable row level security;

-- ---------- Chat ----------
-- Canales: 'lobby' (sala general), 'match:<código>' (partida) y 'dm:<id>:<id>' (privados, ids ordenados).
alter table players add column if not exists chat_muted_until timestamptz;
alter table players add column if not exists dm_open boolean not null default true;

create table if not exists chat_messages (
  id uuid primary key default gen_random_uuid(),
  channel text not null,
  sender_id uuid not null references players (id) on delete cascade,
  recipient_id uuid references players (id) on delete cascade,
  body text not null check (char_length(body) between 1 and 200),
  hidden boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists chat_messages_channel_idx on chat_messages (channel, created_at desc);
create index if not exists chat_messages_sender_idx on chat_messages (sender_id, created_at desc);
create index if not exists chat_messages_recipient_idx on chat_messages (recipient_id, created_at desc) where recipient_id is not null;

create table if not exists chat_reports (
  message_id uuid not null references chat_messages (id) on delete cascade,
  reporter_id uuid not null references players (id) on delete cascade,
  reason text not null,
  resolved boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (message_id, reporter_id)
);

create table if not exists chat_blocks (
  blocker_id uuid not null references players (id) on delete cascade,
  blocked_id uuid not null references players (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id)
);

create table if not exists chat_reads (
  player_id uuid not null references players (id) on delete cascade,
  channel text not null,
  read_at timestamptz not null default now(),
  primary key (player_id, channel)
);

-- Marca un canal como leído hasta ahora.
create or replace function mark_chat_read(p_player uuid, p_channel text)
returns void
language sql as $$
  insert into chat_reads (player_id, channel, read_at) values (p_player, p_channel, now())
  on conflict (player_id, channel) do update set read_at = excluded.read_at;
$$;

-- Bloquear (sin error si ya estaba bloqueado).
create or replace function block_player(p_blocker uuid, p_blocked uuid)
returns void
language sql as $$
  insert into chat_blocks (blocker_id, blocked_id) values (p_blocker, p_blocked) on conflict do nothing;
$$;

-- Reportar un mensaje. Con p_hide_at reportes distintos se oculta; si al autor le han
-- ocultado p_mute_after mensajes en 7 días, queda silenciado p_mute_hours horas.
create or replace function report_chat_message(
  p_message uuid, p_reporter uuid, p_reason text, p_hide_at int, p_mute_after int, p_mute_hours int
) returns table (reports int, hidden boolean, muted boolean)
language plpgsql as $$
declare
  msg chat_messages%rowtype;
  n int;
  hid int;
  was_hidden boolean;
  mute boolean := false;
begin
  select * into msg from chat_messages where id = p_message for update;
  if not found then return; end if;
  was_hidden := msg.hidden;
  insert into chat_reports (message_id, reporter_id, reason) values (p_message, p_reporter, p_reason)
  on conflict (message_id, reporter_id) do nothing;
  select count(*)::int into n from chat_reports where message_id = p_message and not resolved;
  if n >= p_hide_at and not was_hidden then
    update chat_messages set hidden = true where id = p_message;
    select count(*)::int into hid from chat_messages
      where sender_id = msg.sender_id and hidden and created_at > now() - interval '7 days';
    if hid >= p_mute_after then
      update players set chat_muted_until = greatest(coalesce(chat_muted_until, now()), now() + make_interval(hours => p_mute_hours))
        where id = msg.sender_id;
      mute := true;
    end if;
  end if;
  return query select n, (was_hidden or n >= p_hide_at), mute;
end;
$$;

-- Borra los mensajes viejos (los privados se guardan más tiempo).
create or replace function prune_chat(p_public_days int, p_private_days int)
returns int
language plpgsql as $$
declare
  n int;
begin
  delete from chat_messages
    where (recipient_id is null and created_at < now() - make_interval(days => p_public_days))
       or (recipient_id is not null and created_at < now() - make_interval(days => p_private_days));
  get diagnostics n = row_count;
  return n;
end;
$$;

alter table chat_messages enable row level security;
alter table chat_reports enable row level security;
alter table chat_blocks enable row level security;
alter table chat_reads enable row level security;

-- ---------- Héroes y niveles ----------
alter table players add column if not exists xp int not null default 0;
alter table players add column if not exists hero jsonb;

create or replace function add_xp(p_id uuid, p_amount int)
returns table (xp int)
language sql as $$
  update players set xp = players.xp + greatest(p_amount, 0) where id = p_id returning players.xp;
$$;

-- ---------- Fecha de nacimiento (obligatoria) y regalo de cumpleaños ----------
alter table players add column if not exists birthdate date;
alter table players add column if not exists birthday_gift_year int;

-- Regalo de cumpleaños: una sola vez por año.
create or replace function birthday_gift(p_id uuid, p_year int, p_amount int)
returns table (balance int)
language plpgsql as $$
declare
  bal int;
begin
  update players set coins = coins + p_amount, birthday_gift_year = p_year
    where id = p_id and (birthday_gift_year is null or birthday_gift_year < p_year)
    returning coins into bal;
  if not found then return; end if;
  insert into coin_ledger (player_id, amount, reason) values (p_id, p_amount, 'gift:birthday');
  return query select bal;
end;
$$;

-- ---------- Campaña «Las Crónicas de Sapiencia» ----------
-- players.campaign = { done: [ids de escenas/combates superados], items: [piezas ganadas] }
alter table players add column if not exists campaign jsonb not null default '{}'::jsonb;

create table if not exists campaign_runs (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references players (id) on delete cascade,
  node text not null,
  questions jsonb not null,
  current int not null default 0,
  hearts int not null,
  enemy_hp int not null,
  deadline timestamptz not null,
  status text not null default 'active' check (status in ('active', 'won', 'lost')),
  created_at timestamptz not null default now()
);
create index if not exists campaign_runs_player_idx on campaign_runs (player_id, created_at desc);
alter table campaign_runs enable row level security;

-- Marca un nodo como superado y añade piezas (sin duplicados). Devuelve si era la primera vez.
create or replace function campaign_complete(p_id uuid, p_node text, p_items text[])
returns table (first_time boolean)
language plpgsql as $$
declare
  c jsonb;
  done jsonb;
  items jsonb;
begin
  select campaign into c from players where id = p_id for update;
  if not found then return; end if;
  done := coalesce(c->'done', '[]'::jsonb);
  items := coalesce(c->'items', '[]'::jsonb);
  if done ? p_node then
    return query select false;
    return;
  end if;
  done := done || to_jsonb(p_node);
  if p_items is not null then
    for i in 1 .. coalesce(array_length(p_items, 1), 0) loop
      if not items ? p_items[i] then items := items || to_jsonb(p_items[i]); end if;
    end loop;
  end if;
  update players set campaign = jsonb_build_object('done', done, 'items', items) where id = p_id;
  return query select true;
end;
$$;
