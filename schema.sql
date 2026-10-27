-- =====================================================================
-- Aspire CRM - database schema, roles and security rules (Supabase / Postgres)
-- Run this ONCE in Supabase: SQL Editor -> New query -> paste -> Run
-- =====================================================================

-- ---------- Tables ----------------------------------------------------

create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text not null,
  full_name   text not null default '',
  role        text not null default 'employee'
              check (role in ('super_admin', 'supervisor', 'employee')),
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

create table if not exists public.leads (
  id               uuid primary key default gen_random_uuid(),
  full_name        text not null,
  phone            text,
  email            text,
  source           text,
  expected_capital numeric,
  status           text not null default 'new'
                   check (status in ('new','not_reached','contacted','interested',
                                     'not_interested','negotiating','signed')),
  assigned_to      uuid references public.profiles(id) on delete set null,
  created_by       uuid default auth.uid() references public.profiles(id) on delete set null,
  next_follow_up   date,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create table if not exists public.lead_notes (
  id          uuid primary key default gen_random_uuid(),
  lead_id     uuid not null references public.leads(id) on delete cascade,
  author_id   uuid default auth.uid() references public.profiles(id) on delete set null,
  kind        text not null default 'note' check (kind in ('note','system')),
  body        text not null,
  created_at  timestamptz not null default now()
);

create index if not exists leads_assigned_idx  on public.leads (assigned_to);
create index if not exists leads_status_idx    on public.leads (status);
create index if not exists leads_created_idx   on public.leads (created_at desc);
create index if not exists notes_lead_idx      on public.lead_notes (lead_id, created_at desc);

-- ---------- Helper: role of the signed-in user (null if inactive) -----

create or replace function public.current_user_role()
returns text
language sql stable security definer set search_path = public
as $$
  select role from public.profiles where id = auth.uid() and active
$$;

-- ---------- Auto-create a profile for every new auth user -------------
-- NOTE: always 'employee'. Roles are only changed by a Super Admin
-- (through the admin-users Edge Function or the Team page).

create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (new.id, new.email, split_part(coalesce(new.email, ''), '@', 1), 'employee')
  on conflict (id) do nothing;
  return new;
end
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- Guard + audit triggers on leads ---------------------------

create or replace function public.guard_lead_update()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if public.current_user_role() = 'employee'
     and new.assigned_to is distinct from old.assigned_to then
    raise exception 'Employees cannot reassign leads';
  end if;
  new.updated_at := now();
  return new;
end
$$;

drop trigger if exists leads_guard_update on public.leads;
create trigger leads_guard_update
  before update on public.leads
  for each row execute function public.guard_lead_update();

create or replace function public.log_lead_changes()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.status is distinct from old.status then
    insert into public.lead_notes (lead_id, author_id, kind, body)
    values (new.id, auth.uid(), 'system',
            'Status changed: ' || old.status || ' -> ' || new.status);
  end if;
  if new.assigned_to is distinct from old.assigned_to then
    insert into public.lead_notes (lead_id, author_id, kind, body)
    values (new.id, auth.uid(), 'system',
            'Assigned to ' || coalesce(
              (select full_name from public.profiles where id = new.assigned_to),
              'nobody'));
  end if;
  return new;
end
$$;

drop trigger if exists leads_log_changes on public.leads;
create trigger leads_log_changes
  after update on public.leads
  for each row execute function public.log_lead_changes();

-- ---------- Row Level Security ---------------------------------------

alter table public.profiles   enable row level security;
alter table public.leads      enable row level security;
alter table public.lead_notes enable row level security;

-- profiles: every active user can read names/roles; only Super Admin edits.
drop policy if exists profiles_read   on public.profiles;
drop policy if exists profiles_update on public.profiles;
create policy profiles_read on public.profiles
  for select to authenticated
  using (public.current_user_role() is not null);
create policy profiles_update on public.profiles
  for update to authenticated
  using (public.current_user_role() = 'super_admin')
  with check (public.current_user_role() = 'super_admin');

-- leads
drop policy if exists leads_select on public.leads;
drop policy if exists leads_insert on public.leads;
drop policy if exists leads_update on public.leads;
drop policy if exists leads_delete on public.leads;

-- Super Admin + Supervisor see everything; Employee sees only own leads.
create policy leads_select on public.leads
  for select to authenticated
  using (
    public.current_user_role() in ('super_admin', 'supervisor')
    or (public.current_user_role() = 'employee' and assigned_to = auth.uid())
  );

create policy leads_insert on public.leads
  for insert to authenticated
  with check (
    public.current_user_role() in ('super_admin', 'supervisor')
    or (public.current_user_role() = 'employee' and assigned_to = auth.uid())
  );

create policy leads_update on public.leads
  for update to authenticated
  using (
    public.current_user_role() in ('super_admin', 'supervisor')
    or (public.current_user_role() = 'employee' and assigned_to = auth.uid())
  )
  with check (
    public.current_user_role() in ('super_admin', 'supervisor')
    or (public.current_user_role() = 'employee' and assigned_to = auth.uid())
  );

create policy leads_delete on public.leads
  for delete to authenticated
  using (public.current_user_role() = 'super_admin');

-- notes: visible/addable wherever the parent lead is visible (RLS on leads applies).
drop policy if exists notes_select on public.lead_notes;
drop policy if exists notes_insert on public.lead_notes;

create policy notes_select on public.lead_notes
  for select to authenticated
  using (exists (select 1 from public.leads l where l.id = lead_id));

create policy notes_insert on public.lead_notes
  for insert to authenticated
  with check (
    kind = 'note'
    and author_id = auth.uid()
    and exists (select 1 from public.leads l where l.id = lead_id)
  );

-- ---------- Privileges ------------------------------------------------
revoke all on public.profiles, public.leads, public.lead_notes from anon;
grant select, update on public.profiles   to authenticated;
grant select, insert, update, delete on public.leads to authenticated;
grant select, insert on public.lead_notes to authenticated;

-- =====================================================================
-- AFTER running this file:
--   1) Create your own user: Authentication -> Users -> Add user
--      (tick "Auto Confirm User").
--   2) Make that user the first Super Admin (replace the email):
--
--      update public.profiles
--         set role = 'super_admin', full_name = 'Your Name'
--       where email = 'you@aspire.com';
-- =====================================================================
