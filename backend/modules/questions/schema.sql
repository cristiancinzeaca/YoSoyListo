-- Módulo de preguntas. Ejecutar en Supabase → SQL Editor.
create extension if not exists pgcrypto;

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

-- Sin políticas: solo el backend (service_role) puede leer y escribir.
alter table questions enable row level security;

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
