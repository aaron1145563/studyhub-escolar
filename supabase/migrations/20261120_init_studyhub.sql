create table if not exists public.studyhub_workspaces (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.studyhub_workspaces enable row level security;

revoke all on table public.studyhub_workspaces from anon;
grant select, insert, update, delete on table public.studyhub_workspaces to authenticated;

drop policy if exists "Users can view their own workspace" on public.studyhub_workspaces;
create policy "Users can view their own workspace"
  on public.studyhub_workspaces
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users can insert their own workspace" on public.studyhub_workspaces;
create policy "Users can insert their own workspace"
  on public.studyhub_workspaces
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update their own workspace" on public.studyhub_workspaces;
create policy "Users can update their own workspace"
  on public.studyhub_workspaces
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can delete their own workspace" on public.studyhub_workspaces;
create policy "Users can delete their own workspace"
  on public.studyhub_workspaces
  for delete
  to authenticated
  using ((select auth.uid()) = user_id);
