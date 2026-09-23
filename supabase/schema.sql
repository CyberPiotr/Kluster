create extension if not exists pgcrypto;

create table if not exists public.games (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  max_players smallint not null check (max_players in (2,3)),
  status text not null default 'waiting' check (status in ('waiting','playing','finished')),
  state jsonb not null,
  version bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.game_players (
  id uuid primary key,
  game_id uuid not null references public.games(id) on delete cascade,
  seat smallint not null check (seat between 0 and 2),
  name text not null,
  color text not null,
  token_hash text not null,
  created_at timestamptz not null default now(),
  unique(game_id, seat)
);

create index if not exists games_code_idx on public.games(code);
create index if not exists game_players_game_id_idx on public.game_players(game_id);

alter table public.games enable row level security;
alter table public.game_players enable row level security;

drop policy if exists "prototype games are publicly readable" on public.games;
create policy "prototype games are publicly readable"
on public.games for select
to anon, authenticated
using (true);

-- Brak polityk INSERT/UPDATE/DELETE: klient przeglądarkowy nie może zapisywać stanu bez Edge Function.
-- game_players pozostaje prywatne; tokeny graczy są sprawdzane tylko po stronie Edge Function.

create or replace function public.touch_games_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_games_updated_at on public.games;
create trigger trg_games_updated_at
before update on public.games
for each row execute function public.touch_games_updated_at();

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'games'
  ) then
    alter publication supabase_realtime add table public.games;
  end if;
end $$;
