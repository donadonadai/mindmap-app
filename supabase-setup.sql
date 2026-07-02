-- マインドマップ クラウド同期用テーブル
-- Supabase ダッシュボード → SQL Editor に貼り付けて Run する

create table public.maps (
  user_id    uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  id         text        not null,
  name       text        not null,
  data       jsonb       not null,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  primary key (user_id, id)
);

-- 行単位セキュリティ: 自分の行しか読み書きできない
alter table public.maps enable row level security;

create policy "select own maps" on public.maps
  for select using (auth.uid() = user_id);

create policy "insert own maps" on public.maps
  for insert with check (auth.uid() = user_id);

create policy "update own maps" on public.maps
  for update using (auth.uid() = user_id);

create policy "delete own maps" on public.maps
  for delete using (auth.uid() = user_id);
