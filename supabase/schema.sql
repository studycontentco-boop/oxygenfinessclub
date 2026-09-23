create table if not exists public.content (
  id int primary key default 1 check (id = 1),
  payload jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.messages (
  id bigint generated always as identity primary key,
  name text not null,
  phone text,
  message text not null,
  at timestamptz not null default now(),
  read boolean not null default false
);

create table if not exists public.facilities (
  key text primary key,
  label text not null,
  file text not null,
  replaced boolean not null default false,
  replaced_name text,
  size bigint not null default 0,
  updated timestamptz
);

alter table public.content enable row level security;
alter table public.messages enable row level security;
alter table public.facilities enable row level security;

-- one-time compat: drop any earlier policy so this file is safe to re-run
drop policy if exists content_select_anon on public.content;
drop policy if exists content_all_authenticated on public.content;
drop policy if exists messages_insert_anon on public.messages;
drop policy if exists messages_select_authenticated on public.messages;
drop policy if exists messages_update_authenticated on public.messages;
drop policy if exists facilities_select_anon on public.facilities;
drop policy if exists facilities_all_authenticated on public.facilities;

create policy content_select_anon on public.content
  for select to anon using (true);

create policy content_all_authenticated on public.content
  for all to authenticated using (true) with check (true);

create policy messages_insert_anon on public.messages
  for insert to anon with check (true);

create policy messages_select_authenticated on public.messages
  for select to authenticated using (true);

create policy messages_update_authenticated on public.messages
  for update to authenticated using (true) with check (true);

create policy facilities_select_anon on public.facilities
  for select to anon using (true);

create policy facilities_all_authenticated on public.facilities
  for all to authenticated using (true) with check (true);

insert into storage.buckets (id, name, public)
values ('facility-images', 'facility-images', true)
on conflict (id) do nothing;

drop policy if exists "facility_images_select" on storage.objects;
drop policy if exists "facility_images_insert" on storage.objects;
drop policy if exists "facility_images_update" on storage.objects;
drop policy if exists "facility_images_delete" on storage.objects;

create policy "facility_images_select" on storage.objects
  for select using (bucket_id = 'facility-images');

create policy "facility_images_insert" on storage.objects
  for insert to authenticated with check (bucket_id = 'facility-images');

create policy "facility_images_update" on storage.objects
  for update to authenticated using (bucket_id = 'facility-images');

create policy "facility_images_delete" on storage.objects
  for delete to authenticated using (bucket_id = 'facility-images');