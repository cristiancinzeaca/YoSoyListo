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
alter table players add column if not exists free_rename_used boolean not null default false;
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
  first_free boolean := false;
begin
  select * into me from players where id = p_id for update;
  if not found then return; end if;
  if exists (select 1 from players where name_key = p_key and id <> p_id) then
    return query select false, 'taken'::text, 0, me.coins;
    return;
  end if;
  -- Solo mayúsculas/acentos: gratis. El primer cambio de verdad: gratis. Después: p_cost.
  if me.name_key = p_key then
    price := 0;
  elsif not coalesce(me.free_rename_used, false) then
    price := 0;
    first_free := true;
  else
    price := p_cost;
  end if;
  if me.coins < price then
    return query select false, 'coins'::text, price, me.coins;
    return;
  end if;
  begin
    update players set name = p_name, name_key = p_key, coins = coins - price,
      free_rename_used = coalesce(free_rename_used, false) or first_free
      where id = p_id;
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

-- ---------- Cuentas con correo y contraseña ----------
alter table players add column if not exists password_hash text;
alter table players add column if not exists email_verified boolean not null default false;
-- Portal de juegos del que viene (crazygames…): cuentas anónimas, sin correo.
alter table players add column if not exists portal_source text;
-- Invitado de la web (juega sin registrarse): cuándo empezó. Se queda aunque luego guarde su cuenta.
alter table players add column if not exists guest_at timestamptz;

-- Visitas a la web (sin cookies ni datos personales): totales por día, origen y página.
create table if not exists visits (
  day date not null,
  source text not null,
  page text not null,
  views integer not null default 0,
  uniques integer not null default 0,
  primary key (day, source, page)
);

create or replace function count_visits(p_rows jsonb)
returns void
language sql as $$
  insert into visits (day, source, page, views, uniques)
  select (r->>'day')::date, left(r->>'source', 20), left(r->>'page', 60), sum((r->>'views')::int), sum((r->>'uniques')::int)
  from jsonb_array_elements(p_rows) r
  group by 1, 2, 3
  on conflict (day, source, page) do update
    set views = visits.views + excluded.views, uniques = visits.uniques + excluded.uniques;
$$;
create unique index if not exists players_email_password_idx on players (lower(email)) where password_hash is not null;

-- Enlaces de un solo uso: confirmar el correo ('verify') o cambiar la contraseña ('reset').
create table if not exists auth_tokens (
  token_hash text primary key,
  player_id uuid not null references players (id) on delete cascade,
  kind text not null check (kind in ('verify', 'reset')),
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists auth_tokens_player_idx on auth_tokens (player_id, kind);
alter table auth_tokens enable row level security;

-- ---------- Reto diario y racha ----------
alter table players add column if not exists streak int not null default 0;
alter table players add column if not exists streak_best int not null default 0;
alter table players add column if not exists streak_day text; -- 'YYYY-MM-DD' (hora de Madrid)

create table if not exists daily_runs (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references players (id) on delete cascade,
  day text not null, -- 'YYYY-MM-DD' (hora de Madrid)
  questions jsonb not null,
  answers jsonb not null default '{"list": []}'::jsonb,
  current int not null default 0,
  correct int not null default 0,
  score int not null default 0,
  deadline timestamptz not null,
  status text not null default 'active' check (status in ('active', 'done')),
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  unique (player_id, day)
);
create index if not exists daily_runs_day_idx on daily_runs (day, status, score desc);
alter table daily_runs enable row level security;

-- Las mismas preguntas para todos ese día (orden fijo según la fecha).
create or replace function daily_questions(p_day text, p_limit int)
returns setof questions
language sql stable as $$
  select * from questions where active order by md5(id::text || p_day) limit p_limit;
$$;

-- Al terminar el reto: actualiza la racha de días seguidos. Devuelve la racha y la mejor.
create or replace function finish_daily(p_id uuid, p_day text)
returns table (streak int, best int)
language plpgsql as $$
declare
  me players%rowtype;
  s int;
begin
  select * into me from players where id = p_id for update;
  if not found then return; end if;
  if me.streak_day = p_day then
    s := me.streak;
  elsif me.streak_day = to_char(p_day::date - 1, 'YYYY-MM-DD') then
    s := me.streak + 1;
  else
    s := 1;
  end if;
  update players set streak = s, streak_best = greatest(streak_best, s), streak_day = p_day where id = p_id;
  return query select s, greatest(me.streak_best, s);
end;
$$;

-- ---------- Liga semanal ----------
-- week = lunes en que empieza la semana ('YYYY-MM-DD', hora de Madrid). Puntos = experiencia ganada esa semana.
create table if not exists weekly_points (
  week text not null,
  player_id uuid not null references players (id) on delete cascade,
  points int not null default 0,
  updated_at timestamptz not null default now(),
  primary key (week, player_id)
);
create index if not exists weekly_points_rank_idx on weekly_points (week, points desc, updated_at);
alter table weekly_points enable row level security;

create table if not exists weekly_payouts (
  week text primary key,
  paid_at timestamptz not null default now()
);
alter table weekly_payouts enable row level security;

create table if not exists weekly_prizes (
  week text not null,
  player_id uuid not null references players (id) on delete cascade,
  rank int not null,
  coins int not null,
  seen boolean not null default false,
  primary key (week, player_id)
);
alter table weekly_prizes enable row level security;

create or replace function add_week_points(p_id uuid, p_week text, p_amount int)
returns void
language sql as $$
  insert into weekly_points (week, player_id, points) values (p_week, p_id, greatest(p_amount, 0))
  on conflict (week, player_id) do update set points = weekly_points.points + excluded.points, updated_at = now();
$$;

-- Reparte los premios de una semana ya cerrada. Solo la primera llamada paga; devuelve cuántos cobraron.
create or replace function pay_weekly_prizes(p_week text, p_prizes int[])
returns table (paid int)
language plpgsql as $$
declare
  r record;
  n int := 0;
begin
  insert into weekly_payouts (week) values (p_week) on conflict do nothing;
  if not found then
    return query select 0;
    return;
  end if;
  for r in
    select w.player_id, row_number() over (order by w.points desc, w.updated_at asc) as rk
    from weekly_points w
    where w.week = p_week and w.points > 0
    order by w.points desc, w.updated_at asc
    limit coalesce(array_length(p_prizes, 1), 0)
  loop
    insert into weekly_prizes (week, player_id, rank, coins) values (p_week, r.player_id, r.rk, p_prizes[r.rk]);
    perform add_coins(r.player_id, p_prizes[r.rk], 'weekly:' || p_week);
    n := n + 1;
  end loop;
  return query select n;
end;
$$;

-- ---------- Panel de administración: actividad ----------
-- Un resumen de quién se registra y quién juega (horas de Madrid). Solo lo usa /api/admin/stats.
create or replace function admin_stats()
returns table (stats jsonb)
language sql stable as $$
  with
  tz as (select (now() at time zone 'Europe/Madrid')::date as today),
  acc as (select * from players where google_sub is not null or password_hash is not null or (portal_source is not null and portal_source <> 'web')),
  guests as (
    select p.*,
      (p.duels_played + p.rooms_played + p.conquista_played > 0
        or exists (select 1 from blitz_sessions b where b.player_id = p.id)
        or exists (select 1 from daily_runs r where r.player_id = p.id)) as played,
      (p.google_sub is not null or p.password_hash is not null) as saved,
      ((p.last_seen_at at time zone 'Europe/Madrid')::date > (p.created_at at time zone 'Europe/Madrid')::date) as came_back
    from players p where p.guest_at > now() - interval '14 days'
  ),
  days as (select generate_series((select today from tz) - 13, (select today from tz), interval '1 day')::date as day),
  human_matches as (
    select m.id, m.mode, m.vs_bot, m.finished_at, (m.finished_at at time zone 'Europe/Madrid')::date as day
    from matches m
    where m.finished_at > now() - interval '30 days'
  )
  select jsonb_build_object(
    'players', (select count(*) from acc),
    'new_today', (select count(*) from acc where (created_at at time zone 'Europe/Madrid')::date = (select today from tz)),
    'new_7d', (select count(*) from acc where created_at > now() - interval '7 days'),
    'new_30d', (select count(*) from acc where created_at > now() - interval '30 days'),
    'active_today', (select count(*) from acc where (last_seen_at at time zone 'Europe/Madrid')::date = (select today from tz)),
    'active_7d', (select count(*) from acc where last_seen_at > now() - interval '7 days'),
    'by_google', (select count(*) from acc where google_sub is not null),
    'by_email', (select count(*) from acc where google_sub is null and password_hash is not null),
    'by_portal', (select count(*) from acc where portal_source is not null),
    'with_hero', (select count(*) from acc where hero is not null),
    'guests_14d', (select jsonb_build_object(
        'created', count(*),
        'played', count(*) filter (where played),
        'came_back', count(*) filter (where came_back),
        'saved', count(*) filter (where saved)
      ) from guests),
    'visits_14d', (select jsonb_build_object('views', coalesce(sum(views), 0), 'uniques', coalesce(sum(uniques), 0))
      from visits where day > (select today from tz) - 14),
    'visit_sources', (select coalesce(jsonb_agg(x order by x.uniques desc, x.views desc), '[]'::jsonb) from (
        select source, sum(uniques)::int as uniques, sum(views)::int as views
        from visits where day > (select today from tz) - 14 and source <> 'interno'
        group by source) x),
    'visit_pages', (select coalesce(jsonb_agg(x order by x.views desc), '[]'::jsonb) from (
        select page, sum(views)::int as views, sum(uniques)::int as uniques
        from visits where day > (select today from tz) - 7
        group by page order by sum(views) desc limit 15) x),
    'matches_7d', (select coalesce(jsonb_object_agg(mode, n), '{}'::jsonb) from (select mode, count(*) as n from human_matches where finished_at > now() - interval '7 days' group by mode) x),
    'blitz_7d', (select count(*) from blitz_sessions where player_id is not null and started_at > now() - interval '7 days'),
    'daily_today', (select count(*) from daily_runs where day = to_char((select today from tz), 'YYYY-MM-DD') and status = 'done'),
    'per_day', (
      select jsonb_agg(jsonb_build_object(
        'day', to_char(d.day, 'YYYY-MM-DD'),
        'signups', (select count(*) from acc where (created_at at time zone 'Europe/Madrid')::date = d.day),
        'visitors', (select coalesce(sum(uniques), 0) from visits v where v.day = d.day),
        'guests', (select count(*) from players g where (g.guest_at at time zone 'Europe/Madrid')::date = d.day),
        'matches', (select count(*) from human_matches h where h.day = d.day),
        'blitz', (select count(*) from blitz_sessions b where b.player_id is not null and (b.started_at at time zone 'Europe/Madrid')::date = d.day),
        'daily', (select count(*) from daily_runs r where r.day = to_char(d.day, 'YYYY-MM-DD') and r.status = 'done')
      ) order by d.day)
      from days d
    ),
    'recent_players', (
      select coalesce(jsonb_agg(p order by p.created_at desc), '[]'::jsonb) from (
        select a.name, a.created_at, a.last_seen_at, a.xp, a.coins, a.streak,
          case when a.google_sub is not null then 'google' when a.password_hash is not null then 'email' else coalesce(a.portal_source, 'email') end as method,
          coalesce(a.email, '') as email, a.email_verified as verified,
          a.duels_played + a.rooms_played + a.conquista_played as games,
          (select count(*) from blitz_sessions b where b.player_id = a.id) as blitz,
          (a.hero is not null) as hero
        from acc a order by a.created_at desc limit 500
      ) p
    ),
    'recent_matches', (
      select coalesce(jsonb_agg(m order by m.finished_at desc), '[]'::jsonb) from (
        select h.mode, h.finished_at, h.vs_bot,
          (select jsonb_agg(jsonb_build_object('name', mp.name, 'bot', mp.is_bot, 'pos', mp.position) order by mp.position)
             from match_players mp where mp.match_id = h.id) as players
        from human_matches h order by h.finished_at desc limit 30
      ) m
    )
  );
$$;

-- Preguntas retiradas o reescritas (las nuevas versiones entran por seed.sql).
update questions set active = false
where active and text in (
  '¿Cuál es el videojuego más vendido de la historia?'
);
