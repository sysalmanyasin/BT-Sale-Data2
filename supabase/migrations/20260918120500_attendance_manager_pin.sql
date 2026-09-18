-- ══════════════════════════════════════════════════════════════════════
-- Manager-mode PIN gate
--
-- Before this migration, "is this phone a manager phone" was decided
-- entirely by a checkbox in MainActivity's setup dialog, stored only
-- in that phone's local SharedPreferences (Prefs.isManagerMode) and
-- never sent to or checked against the server. Any staff member
-- installing the APK could tick it and start silently receiving
-- every coworker's check-in notification — there was no gate at all.
--
-- This adds a real one, but it's still a client-side-enforced gate in
-- the same spirit as the rest of this app's access control (see the
-- attendance_rls_fix migration's note on auth.js's Google allow-list —
-- nothing here has real per-device backend identity). What makes this
-- one actually hold up under the anon-key-is-public threat model the
-- rest of this schema accepts: the hash itself is NEVER selectable —
-- attendance_manager_pin has RLS enabled with NO policies at all
-- (default-deny), so even a technically inclined staff member curling
-- the REST API directly with the extracted anon key gets nothing back.
-- The only way in is the SECURITY DEFINER function below, which
-- checks a candidate PIN server-side and returns a bare boolean —
-- never the hash, never a way to iterate offline.
--
-- What this still does NOT protect against (be honest about the
-- ceiling): the RPC endpoint itself has no rate limiting beyond
-- Supabase's own defaults, so a determined attacker could still
-- brute-force a short numeric PIN online, just much more slowly and
-- noisily than an offline hash crack. And it only gates *future*
-- manager-mode setups — a phone already ticked as manager before this
-- shipped keeps working until someone clears its app storage. A real
-- fix for both would mean the PIN-login Edge Function + proper
-- Supabase Auth session approach the main attendance README already
-- flags as the "real" solution under Known limitations — a
-- substantially bigger lift than this.
-- ══════════════════════════════════════════════════════════════════════

create table if not exists attendance_manager_pin (
  id         boolean primary key default true,
  pin_hash   text not null,
  updated_at timestamptz not null default now(),
  constraint attendance_manager_pin_singleton check (id)
);

alter table attendance_manager_pin enable row level security;
-- Deliberately zero policies — unlike every other table in this
-- schema (all USING(true)), this one is default-deny for every role.
-- Only a SECURITY DEFINER function (owner privileges, bypasses RLS)
-- can read it.

create or replace function attendance_verify_manager_pin(candidate text)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from attendance_manager_pin
    where id = true and pin_hash = crypt(candidate, pin_hash)
  );
$$;

revoke all on function attendance_verify_manager_pin(text) from public;
grant execute on function attendance_verify_manager_pin(text) to anon;

-- Seed a temporary PIN so the function has something to check against
-- immediately — CHANGE THIS before relying on it. Run in the Supabase
-- SQL editor (never paste a real PIN into a chat/commit history):
--   update attendance_manager_pin set pin_hash = crypt('<your real PIN>', gen_salt('bf')), updated_at = now();
insert into attendance_manager_pin (id, pin_hash)
values (true, crypt('CHANGE-ME-0000', gen_salt('bf')))
on conflict (id) do nothing;
