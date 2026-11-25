-- Weddy: database schema and access rules.
-- Rule of the house: the server decides who sees what. Deny by default.
-- The couple can only ever read: their wedding, their own member row,
-- announcements, seen COUNTS, outfit colours. Never rooms, members, gifts.

create extension if not exists pgcrypto;

-- ---------- Tables ----------

create table if not exists weddings (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  created_by uuid not null references auth.users(id) on delete cascade,
  partner_phone text not null,
  status text not null default 'pending' check (status in ('pending','live','ended')),
  join_code text unique not null default upper(encode(gen_random_bytes(4),'hex')),
  vendor_code text unique not null default upper(encode(gen_random_bytes(4),'hex')),
  partner_code text unique not null default upper(encode(gen_random_bytes(4),'hex')),
  helper_on boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists members (
  wedding_id uuid not null references weddings(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('couple','guest','vendor')),
  display_name text not null,
  side text check (side in ('bride','groom')),
  relation text,
  language text not null default 'en-IN',
  paused boolean not null default false,
  joined_at timestamptz not null default now(),
  primary key (wedding_id, user_id)
);

-- Couple block list: phones and devices. No one can read it from the app.
create table if not exists couple_block (
  wedding_id uuid not null references weddings(id) on delete cascade,
  kind text not null check (kind in ('phone','device')),
  value text not null,
  primary key (wedding_id, kind, value)
);

create table if not exists rooms (
  id uuid primary key default gen_random_uuid(),
  wedding_id uuid not null references weddings(id) on delete cascade,
  kind text not null check (kind in ('gifts','dresscode','surprise','vendor')),
  name text not null,
  owner_id uuid references auth.users(id) on delete set null,
  done boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists room_members (
  room_id uuid not null references rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null check (status in ('invited','joined')),
  added_by uuid references auth.users(id) on delete set null,
  added_at timestamptz not null default now(),
  primary key (room_id, user_id)
);

create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references rooms(id) on delete cascade,
  sender_id uuid references auth.users(id) on delete set null,
  kind text not null default 'text' check (kind in ('text','voice','system','helper')),
  body text,
  private_to uuid references auth.users(id) on delete cascade, -- helper notes: only this person sees it
  meta jsonb not null default '{}'::jsonb,                      -- e.g. gift ideas with Claim buttons
  created_at timestamptz not null default now()
);

create table if not exists announcements (
  id uuid primary key default gen_random_uuid(),
  wedding_id uuid not null references weddings(id) on delete cascade,
  author_id uuid references auth.users(id) on delete set null,
  body text not null,
  for_vendors boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists announcement_seen (
  announcement_id uuid not null references announcements(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  primary key (announcement_id, user_id)
);

create table if not exists gifts (
  id uuid primary key default gen_random_uuid(),
  wedding_id uuid not null references weddings(id) on delete cascade,
  name text not null,
  claimed_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists outfit_colours (
  id uuid primary key default gen_random_uuid(),
  wedding_id uuid not null references weddings(id) on delete cascade,
  function_name text not null,
  function_date date,
  bride jsonb not null default '[]'::jsonb,  -- [{ "hex": "#0B6E4F", "name": "emerald green" }]
  groom jsonb not null default '[]'::jsonb,
  guest_theme text,
  updated_at timestamptz not null default now()
);

create table if not exists flags (
  wedding_id uuid not null references weddings(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  flagged_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (wedding_id, user_id, flagged_by)
);

create table if not exists flag_clears (
  wedding_id uuid not null references weddings(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  cleared_by uuid not null references auth.users(id) on delete cascade,
  primary key (wedding_id, user_id, cleared_by)
);

-- Sarvam output cache (translations, read-aloud). Server only.
create table if not exists ai_cache (
  key text primary key,
  value text not null,
  created_at timestamptz not null default now()
);

-- ---------- Helper functions (run as the server, read the truth) ----------

-- The signed-in person's phone number, digits only.
-- Real verified phone first. Until the code provider is chosen, sign-in is a placeholder
-- that stores the number in the account email (p919876543210@phone.weddy.app).
create or replace function phone_of(u uuid) returns text
language sql stable security definer set search_path = public, auth as $$
  select coalesce(nullif(regexp_replace(coalesce(phone,''), '[^0-9]', '', 'g'), ''),
                  substring(email from '^p([0-9]+)@phone\.weddy\.app$'))
  from auth.users where id = u
$$;

create or replace function my_phone() returns text
language sql stable security definer set search_path = public, auth as $$
  select phone_of(auth.uid())
$$;

create or replace function my_role(w uuid) returns text
language sql stable security definer set search_path = public as $$
  select role from members where wedding_id = w and user_id = auth.uid()
$$;

create or replace function i_am_active_guest(w uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from members m join weddings wd on wd.id = m.wedding_id
    where m.wedding_id = w and m.user_id = auth.uid() and m.role = 'guest'
      and not m.paused and wd.status = 'live')
$$;

create or replace function can_read_room(r uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from rooms ro
    join members m on m.wedding_id = ro.wedding_id and m.user_id = auth.uid() and not m.paused
    where ro.id = r and (
      (ro.kind in ('gifts','dresscode') and m.role = 'guest')
      or (ro.kind = 'vendor' and m.role in ('guest','vendor'))
      or (ro.kind = 'surprise' and m.role = 'guest' and exists (
            select 1 from room_members rm where rm.room_id = ro.id and rm.user_id = auth.uid() and rm.status = 'joined'))
    ))
$$;

create or replace function is_blocked(w uuid, device text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from couple_block b where b.wedding_id = w and (
    (b.kind = 'phone' and b.value = my_phone()) or (b.kind = 'device' and device is not null and b.value = device)))
$$;

-- ---------- Row level security: deny by default ----------

alter table weddings enable row level security;
alter table members enable row level security;
alter table couple_block enable row level security;
alter table rooms enable row level security;
alter table room_members enable row level security;
alter table messages enable row level security;
alter table announcements enable row level security;
alter table announcement_seen enable row level security;
alter table gifts enable row level security;
alter table outfit_colours enable row level security;
alter table flags enable row level security;
alter table flag_clears enable row level security;
alter table ai_cache enable row level security;

-- weddings: any member reads the wedding row. Codes are hidden from non-couple by the get_codes RPC instead.
drop policy if exists wed_read on weddings;
create policy wed_read on weddings for select using (my_role(id) is not null);

-- members: you always see yourself; only active guests see the member list. The couple never does.
drop policy if exists mem_read on members;
create policy mem_read on members for select using (
  user_id = auth.uid() or i_am_active_guest(wedding_id));

-- rooms: the couple never matches any branch, so they get zero rows.
drop policy if exists room_read on rooms;
create policy room_read on rooms for select using (
  can_read_room(id)
  or (kind = 'surprise' and exists (select 1 from room_members rm where rm.room_id = id and rm.user_id = auth.uid()))
);

drop policy if exists rm_read on room_members;
create policy rm_read on room_members for select using (can_read_room(room_id) or user_id = auth.uid());

-- messages: readable if you can read the room; helper notes only by the person they are for.
drop policy if exists msg_read on messages;
create policy msg_read on messages for select using (
  can_read_room(room_id) and (private_to is null or private_to = auth.uid()));
drop policy if exists msg_write on messages;
create policy msg_write on messages for insert with check (
  sender_id = auth.uid() and kind in ('text','voice') and private_to is null and can_read_room(room_id)
  and not exists (select 1 from rooms ro where ro.id = room_id and ro.done));

-- announcements: members read; vendors only "for vendors" ones; only the couple posts.
drop policy if exists ann_read on announcements;
create policy ann_read on announcements for select using (
  (my_role(wedding_id) in ('couple','guest')) or (my_role(wedding_id) = 'vendor' and for_vendors));
drop policy if exists ann_write on announcements;
create policy ann_write on announcements for insert with check (
  author_id = auth.uid() and my_role(wedding_id) = 'couple');

-- seen: you can mark and read only your own row. The couple gets counts from seen_count().
drop policy if exists seen_write on announcement_seen;
create policy seen_write on announcement_seen for insert with check (user_id = auth.uid());
drop policy if exists seen_read on announcement_seen;
create policy seen_read on announcement_seen for select using (user_id = auth.uid());

-- gifts: active guests only. claimed_by is hidden through the gift_list view below.
drop policy if exists gift_write on gifts;
create policy gift_write on gifts for insert with check (i_am_active_guest(wedding_id) and claimed_by is null);

-- outfit colours: couple and guests read; only the couple writes.
drop policy if exists oc_read on outfit_colours;
create policy oc_read on outfit_colours for select using (my_role(wedding_id) in ('couple','guest'));
drop policy if exists oc_write on outfit_colours;
create policy oc_write on outfit_colours for all using (my_role(wedding_id) = 'couple')
  with check (my_role(wedding_id) = 'couple');

-- couple_block, flags, flag_clears, ai_cache: no policies = nobody reads them from the app.

-- Gift list without ever saying who claimed: only "claimed" and "claimed by me".
create or replace view gift_list with (security_invoker = false) as
  select g.id, g.wedding_id, g.name, (g.claimed_by is not null) as claimed,
         (g.claimed_by = auth.uid()) as mine, g.created_at
  from gifts g
  where i_am_active_guest(g.wedding_id);

-- ---------- Actions (RPCs). Each one checks who you are on the server. ----------

-- 1. Bride or groom creates the wedding.
create or replace function create_wedding(p_title text, p_partner_phone text, p_my_name text, p_language text, p_device text)
returns uuid language plpgsql security definer set search_path = public as $$
declare w uuid; me text := my_phone();
begin
  if auth.uid() is null or me is null then raise exception 'Please sign in first'; end if;
  if regexp_replace(p_partner_phone, '[^0-9]', '', 'g') = regexp_replace(me, '[^0-9]', '', 'g') then
    raise exception 'Partner number must be different from yours'; end if;
  insert into weddings (title, created_by, partner_phone) values (p_title, auth.uid(), regexp_replace(p_partner_phone, '[^0-9]', '', 'g'))
    returning id into w;
  insert into members (wedding_id, user_id, role, display_name, language) values (w, auth.uid(), 'couple', p_my_name, coalesce(p_language,'en-IN'));
  insert into couple_block values (w, 'phone', regexp_replace(me, '[^0-9]', '', 'g')) on conflict do nothing;
  insert into couple_block values (w, 'phone', regexp_replace(p_partner_phone, '[^0-9]', '', 'g')) on conflict do nothing;
  if p_device is not null then insert into couple_block values (w, 'device', p_device) on conflict do nothing; end if;
  return w;
end $$;

-- 2. Partner joins with the private couple link. Only works for the partner's number.
create or replace function join_as_partner(p_code text, p_my_name text, p_language text, p_device text)
returns uuid language plpgsql security definer set search_path = public as $$
declare wd weddings;
begin
  select * into wd from weddings where partner_code = upper(p_code);
  if wd.id is null then raise exception 'This couple link is not valid'; end if;
  if wd.partner_phone <> regexp_replace(my_phone(), '[^0-9]', '', 'g') then
    raise exception 'This couple link only works for the partner''s number'; end if;
  insert into members (wedding_id, user_id, role, display_name, language)
    values (wd.id, auth.uid(), 'couple', p_my_name, coalesce(p_language,'en-IN')) on conflict do nothing;
  if p_device is not null then insert into couple_block values (wd.id, 'device', p_device) on conflict do nothing; end if;
  if wd.status = 'pending' then
    update weddings set status = 'live' where id = wd.id;
    insert into rooms (wedding_id, kind, name) values (wd.id, 'gifts', 'Gifts'), (wd.id, 'dresscode', 'Dress code'), (wd.id, 'vendor', 'Vendors');
  end if;
  return wd.id;
end $$;

-- 3. Guest joins from the invitation QR: side, relation, language. No quiz, no approval.
create or replace function join_as_guest(p_code text, p_my_name text, p_side text, p_relation text, p_language text, p_device text)
returns uuid language plpgsql security definer set search_path = public as $$
declare wd weddings;
begin
  select * into wd from weddings where join_code = upper(p_code);
  if wd.id is null then raise exception 'This invitation code is not valid'; end if;
  if wd.status <> 'live' then raise exception 'This wedding is not open yet'; end if;
  if is_blocked(wd.id, p_device) then raise exception 'This number can''t join as a guest at this wedding'; end if;
  if my_role(wd.id) is not null then return wd.id; end if;
  insert into members (wedding_id, user_id, role, display_name, side, relation, language)
    values (wd.id, auth.uid(), 'guest', p_my_name, p_side, p_relation, coalesce(p_language,'en-IN'));
  return wd.id;
end $$;

-- 4. Vendor joins with the separate vendor link. No side or relation.
create or replace function join_as_vendor(p_code text, p_my_name text, p_language text, p_device text)
returns uuid language plpgsql security definer set search_path = public as $$
declare wd weddings;
begin
  select * into wd from weddings where vendor_code = upper(p_code);
  if wd.id is null then raise exception 'This vendor code is not valid'; end if;
  if wd.status <> 'live' then raise exception 'This wedding is not open yet'; end if;
  if is_blocked(wd.id, p_device) then raise exception 'This number can''t join as a vendor at this wedding'; end if;
  if my_role(wd.id) is not null then return wd.id; end if;
  insert into members (wedding_id, user_id, role, display_name, language)
    values (wd.id, auth.uid(), 'vendor', p_my_name, coalesce(p_language,'en-IN'));
  return wd.id;
end $$;

-- The couple's codes (QR, vendor link, couple link). Only the couple can read them.
create or replace function get_codes(p_wedding uuid)
returns table (join_code text, vendor_code text, partner_code text, status text)
language sql stable security definer set search_path = public as $$
  select join_code, vendor_code, partner_code, status from weddings where id = p_wedding and my_role(p_wedding) = 'couple'
$$;

-- Every sign-in by the couple puts that phone on the block list.
create or replace function couple_register_device(p_wedding uuid, p_device text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if my_role(p_wedding) = 'couple' and p_device is not null then
    insert into couple_block values (p_wedding, 'device', p_device) on conflict do nothing;
  end if;
end $$;

-- Either partner switches the helper on or off for the whole wedding.
create or replace function set_helper(p_wedding uuid, p_on boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if my_role(p_wedding) is distinct from 'couple' then raise exception 'Only the couple can do this'; end if;
  update weddings set helper_on = p_on where id = p_wedding;
end $$;

-- Seen head count, never names.
create or replace function seen_count(p_announcement uuid) returns integer
language sql stable security definer set search_path = public as $$
  select count(*)::int from announcement_seen s join announcements a on a.id = s.announcement_id
  where a.id = p_announcement and my_role(a.wedding_id) is not null
$$;

-- Surprise rooms ----------------------------------------------------------

create or replace function create_surprise_room(p_wedding uuid, p_name text) returns uuid
language plpgsql security definer set search_path = public as $$
declare r uuid;
begin
  if not i_am_active_guest(p_wedding) then raise exception 'Only guests can create surprise rooms'; end if;
  insert into rooms (wedding_id, kind, name, owner_id) values (p_wedding, 'surprise', p_name, auth.uid()) returning id into r;
  insert into room_members (room_id, user_id, status, added_by) values (r, auth.uid(), 'joined', auth.uid());
  return r;
end $$;

create or replace function add_to_room(p_room uuid, p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare ro rooms; adder text; added text; target_phone text;
begin
  select * into ro from rooms where id = p_room and kind = 'surprise';
  if ro.id is null or not can_read_room(p_room) then raise exception 'Not allowed'; end if;
  if ro.done then raise exception 'This surprise is done'; end if;
  -- Only existing, active guests of this wedding. Couple numbers can never be added.
  target_phone := phone_of(p_user);
  if not exists (select 1 from members where wedding_id = ro.wedding_id and user_id = p_user and role = 'guest' and not paused)
     or exists (select 1 from couple_block where wedding_id = ro.wedding_id and kind = 'phone'
                and value = regexp_replace(coalesce(target_phone,''), '[^0-9]', '', 'g')) then
    raise exception 'This person can''t be added'; end if;
  insert into room_members (room_id, user_id, status, added_by) values (p_room, p_user, 'invited', auth.uid())
    on conflict do nothing;
  select display_name into adder from members where wedding_id = ro.wedding_id and user_id = auth.uid();
  select display_name into added from members where wedding_id = ro.wedding_id and user_id = p_user;
  insert into messages (room_id, kind, body) values (p_room, 'system', adder || ' added ' || added);
end $$;

-- Join or decline quietly. Declining posts nothing.
create or replace function respond_invite(p_room uuid, p_accept boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_accept then
    update room_members set status = 'joined' where room_id = p_room and user_id = auth.uid() and status = 'invited';
  else
    delete from room_members where room_id = p_room and user_id = auth.uid() and status = 'invited';
  end if;
end $$;

-- Owner removes someone quietly.
create or replace function remove_from_room(p_room uuid, p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from rooms where id = p_room and owner_id = auth.uid()) then raise exception 'Only the room owner can remove people'; end if;
  if p_user = auth.uid() then raise exception 'Hand the room over first'; end if;
  delete from room_members where room_id = p_room and user_id = p_user;
end $$;

create or replace function hand_over_room(p_room uuid, p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from rooms where id = p_room and owner_id = auth.uid()) then raise exception 'Only the room owner can hand it over'; end if;
  if not exists (select 1 from room_members where room_id = p_room and user_id = p_user and status = 'joined') then
    raise exception 'They need to be in the room first'; end if;
  update rooms set owner_id = p_user where id = p_room;
end $$;

create or replace function surprise_done(p_room uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update rooms set done = true where id = p_room and owner_id = auth.uid() and kind = 'surprise';
  if not found then raise exception 'Only the room owner can mark it done'; end if;
  insert into messages (room_id, kind, body) values (p_room, 'system', 'Surprise done 🎉');
end $$;

-- Flagging ----------------------------------------------------------------

-- Any active guest flags a joiner: paused from all rooms, removed from every surprise room.
create or replace function flag_member(p_wedding uuid, p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not i_am_active_guest(p_wedding) or p_user = auth.uid() then raise exception 'Not allowed'; end if;
  insert into flags values (p_wedding, p_user, auth.uid()) on conflict do nothing;
  delete from flag_clears where wedding_id = p_wedding and user_id = p_user;
  update members set paused = true where wedding_id = p_wedding and user_id = p_user and role = 'guest';
  delete from room_members rm using rooms ro
    where rm.room_id = ro.id and ro.wedding_id = p_wedding and ro.kind = 'surprise' and rm.user_id = p_user;
end $$;

-- Any 2 members from the flagged person's side clear the flag.
create or replace function clear_flag(p_wedding uuid, p_user uuid) returns text
language plpgsql security definer set search_path = public as $$
declare their_side text; my_side text; n int;
begin
  select side into their_side from members where wedding_id = p_wedding and user_id = p_user;
  select side into my_side from members where wedding_id = p_wedding and user_id = auth.uid() and role = 'guest' and not paused;
  if my_side is null or my_side <> their_side or p_user = auth.uid() then
    raise exception 'Only guests from their side can clear this'; end if;
  insert into flag_clears values (p_wedding, p_user, auth.uid()) on conflict do nothing;
  select count(*) into n from flag_clears where wedding_id = p_wedding and user_id = p_user;
  if n >= 2 then
    update members set paused = false where wedding_id = p_wedding and user_id = p_user;
    delete from flags where wedding_id = p_wedding and user_id = p_user;
    delete from flag_clears where wedding_id = p_wedding and user_id = p_user;
    return 'cleared';
  end if;
  return 'waiting';
end $$;

-- Gifts -------------------------------------------------------------------

-- First claim wins. Never reveals who claimed.
create or replace function claim_gift(p_gift uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare w uuid;
begin
  select wedding_id into w from gifts where id = p_gift;
  if not i_am_active_guest(w) then raise exception 'Not allowed'; end if;
  update gifts set claimed_by = auth.uid() where id = p_gift and claimed_by is null;
  return found;
end $$;

create or replace function add_and_claim_gift(p_wedding uuid, p_name text) returns uuid
language plpgsql security definer set search_path = public as $$
declare g uuid;
begin
  if not i_am_active_guest(p_wedding) then raise exception 'Not allowed'; end if;
  insert into gifts (wedding_id, name, claimed_by) values (p_wedding, p_name, auth.uid()) returning id into g;
  return g;
end $$;

-- The couple ends the event. Rooms, block list and everything else are deleted a few days later
-- (delete_ended_weddings, run daily).
create or replace function end_event(p_wedding uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if my_role(p_wedding) is distinct from 'couple' then raise exception 'Only the couple can end the event'; end if;
  update weddings set status = 'ended' where id = p_wedding;
end $$;

-- ---------- Live updates ----------
do $$ begin
  alter publication supabase_realtime add table messages, announcements, room_members, members, gifts, outfit_colours;
exception when others then null; end $$;
