-- PrideMessenger core; deploy only to the dedicated empty PrideMessenger Supabase project.
create extension if not exists pgcrypto;

create table public.pm_profiles (
 id uuid primary key references auth.users(id) on delete cascade,
 username text not null check (username ~ '^[A-Za-z0-9_]{3,24}$'),
 display_name text not null check (char_length(trim(display_name)) between 1 and 60),
 bio text not null default '' check (char_length(bio)<=500),
 avatar_path text,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create unique index pm_profiles_username_ci on public.pm_profiles(lower(username));

create table public.pm_conversations (
 id uuid primary key default gen_random_uuid(),
 kind text not null check (kind in ('dm','group')),
 dm_pair_key text unique,
 title text,
 created_by uuid not null references public.pm_profiles(id),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 check ((kind='dm' and dm_pair_key is not null and title is null) or (kind='group' and dm_pair_key is null and char_length(trim(title)) between 2 and 80))
);
create index pm_conversations_updated_idx on public.pm_conversations(updated_at desc);
create table public.pm_conversation_members (
 conversation_id uuid not null references public.pm_conversations(id) on delete cascade,
 user_id uuid not null references public.pm_profiles(id) on delete cascade,
 role text not null check (role in ('owner','member')),
 joined_at timestamptz not null default now(),
 last_read_at timestamptz,
 primary key(conversation_id,user_id)
);
create index pm_conversation_members_user_idx on public.pm_conversation_members(user_id,conversation_id);
create table public.pm_messages (
 id uuid primary key default gen_random_uuid(),
 conversation_id uuid not null references public.pm_conversations(id) on delete cascade,
 sender_id uuid not null references public.pm_profiles(id),
 client_id uuid not null,
 body text not null check (char_length(trim(body)) between 1 and 4000),
 created_at timestamptz not null default now(),
 edited_at timestamptz,
 unique(sender_id,client_id)
);
create index pm_messages_cursor_idx on public.pm_messages(conversation_id,created_at desc,id desc);
create table public.pm_notifications (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references public.pm_profiles(id) on delete cascade,
 kind text not null,
 title text not null,
 body text not null,
 conversation_id uuid references public.pm_conversations(id) on delete cascade,
 created_at timestamptz not null default now(),
 read_at timestamptz
);
create index pm_notifications_user_idx on public.pm_notifications(user_id,created_at desc);
create table public.pm_lookup_events (
 user_id uuid not null references public.pm_profiles(id) on delete cascade,
 created_at timestamptz not null default now()
);
create index pm_lookup_events_user_idx on public.pm_lookup_events(user_id,created_at desc);

create table public.pm_prides (
 id uuid primary key default gen_random_uuid(),
 name text not null check (char_length(trim(name)) between 2 and 80),
 description text not null default '' check (char_length(description)<=1000),
 visibility text not null default 'public' check (visibility in ('public','private')),
 owner_id uuid not null references public.pm_profiles(id),
 created_at timestamptz not null default now()
);
create index pm_prides_public_idx on public.pm_prides(created_at desc) where visibility='public';
create table public.pm_pride_members (
 pride_id uuid not null references public.pm_prides(id) on delete cascade,
 user_id uuid not null references public.pm_profiles(id) on delete cascade,
 role text not null check (role in ('owner','member')),
 joined_at timestamptz not null default now(),
 primary key(pride_id,user_id)
);
create index pm_pride_members_user_idx on public.pm_pride_members(user_id,pride_id);
create table public.pm_channels (
 id uuid primary key default gen_random_uuid(),
 pride_id uuid not null references public.pm_prides(id) on delete cascade,
 name text not null check (char_length(trim(name)) between 2 and 60),
 kind text not null default 'text' check (kind in ('text','announcement')),
 created_at timestamptz not null default now(),
 unique(pride_id,name)
);

create table public.pm_claws_wallets (
 user_id uuid primary key references public.pm_profiles(id) on delete cascade,
 balance bigint not null default 0 check (balance>=0),
 updated_at timestamptz not null default now()
);
create table public.pm_claws_ledger (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references public.pm_profiles(id) on delete cascade,
 amount bigint not null check (amount<>0),
 reason text not null,
 source_id uuid not null,
 created_at timestamptz not null default now(),
 unique(user_id,source_id)
);
create table public.pm_subscriptions (
 user_id uuid primary key references public.pm_profiles(id) on delete cascade,
 plan text not null default 'savanna' check (plan in ('savanna','cheetah','leopard','lion')),
 starts_at timestamptz,
 expires_at timestamptz
);
create table public.pm_orders (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references public.pm_profiles(id) on delete cascade,
 plan text not null check (plan in ('cheetah','leopard','lion')),
 amount_minor bigint not null check (amount_minor in (14900,34900,69900)),
 pridecoin_invoice_id text unique,
 status text not null default 'pending' check (status in ('pending','paid','cancelled','refunded')),
 created_at timestamptz not null default now()
);

create or replace function public.pm_after_signup() returns trigger language plpgsql security definer set search_path='' as $$
declare v_username text:=new.raw_user_meta_data->>'username';v_name text:=new.raw_user_meta_data->>'display_name';
begin
 if v_username is null or v_username !~ '^[A-Za-z0-9_]{3,24}$' or char_length(trim(coalesce(v_name,''))) not between 1 and 60 then raise exception 'Invalid PrideMessenger registration data';end if;
 insert into public.pm_profiles(id,username,display_name) values(new.id,v_username,trim(v_name));
 insert into public.pm_claws_wallets(user_id) values(new.id);
 insert into public.pm_subscriptions(user_id) values(new.id);
 return new;
end $$;
create trigger pm_on_auth_user_created after insert on auth.users for each row execute function public.pm_after_signup();

create or replace function public.pm_is_member(p_conversation_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.pm_conversation_members where conversation_id=p_conversation_id and user_id=(select auth.uid()))
$$;
create or replace function public.pm_is_pride_member(p_pride_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.pm_pride_members where pride_id=p_pride_id and user_id=(select auth.uid()))
$$;
create or replace function public.pm_find_person(p_username text) returns table(id uuid,username text,display_name text) language plpgsql security definer set search_path='' as $$
declare v_user uuid:=(select auth.uid());
begin
 if v_user is null then raise exception 'Sign in first';end if;
 if p_username is null or p_username !~ '^[A-Za-z0-9_]{3,24}$' then return;end if;
 perform pg_advisory_xact_lock(hashtext(v_user::text));
 if (select count(*) from public.pm_lookup_events where user_id=v_user and created_at>now()-interval '1 minute')>=20 then raise exception 'Too many searches';end if;
 insert into public.pm_lookup_events(user_id) values(v_user);
 return query select p.id,p.username,p.display_name from public.pm_profiles p where lower(p.username)=lower(p_username) limit 1;
end $$;
create or replace function public.pm_start_dm(p_other_user_id uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare v_user uuid:=(select auth.uid());v_pair text;v_id uuid;
begin
 if v_user is null or p_other_user_id is null or v_user=p_other_user_id then raise exception 'Invalid recipient';end if;
 if not exists(select 1 from public.pm_profiles where id=p_other_user_id) then raise exception 'Recipient not found';end if;
 v_pair:=least(v_user,p_other_user_id)::text||':'||greatest(v_user,p_other_user_id)::text;
 insert into public.pm_conversations(kind,dm_pair_key,created_by) values('dm',v_pair,v_user) on conflict(dm_pair_key) do nothing returning id into v_id;
 if v_id is null then select id into v_id from public.pm_conversations where dm_pair_key=v_pair;end if;
 insert into public.pm_conversation_members(conversation_id,user_id,role) values(v_id,v_user,'member'),(v_id,p_other_user_id,'member') on conflict do nothing;
 return v_id;
end $$;
create or replace function public.pm_create_group(p_title text,p_members uuid[]) returns uuid language plpgsql security definer set search_path='' as $$
declare v_user uuid:=(select auth.uid());v_id uuid;
begin
 if v_user is null then raise exception 'Sign in first';end if;
 if p_title is null or char_length(trim(p_title)) not between 2 and 80 then raise exception 'Invalid group title';end if;
 if cardinality(coalesce(p_members,'{}'::uuid[]))>20 then raise exception 'Too many members';end if;
 if (select count(*) from public.pm_conversations where created_by=v_user and kind='group' and created_at>now()-interval '1 hour')>=5 then raise exception 'Group creation limit reached';end if;
 insert into public.pm_conversations(kind,title,created_by) values('group',trim(p_title),v_user) returning id into v_id;
 insert into public.pm_conversation_members(conversation_id,user_id,role) values(v_id,v_user,'owner');
 insert into public.pm_conversation_members(conversation_id,user_id,role)
 select v_id,x,'member' from (select distinct unnest(coalesce(p_members,'{}'::uuid[])) x) m where x<>v_user;
 return v_id;
end $$;
create or replace function public.pm_send_message(p_conversation_id uuid,p_body text,p_client_id uuid) returns public.pm_messages language plpgsql security definer set search_path='' as $$
declare v_user uuid:=(select auth.uid());v_row public.pm_messages%rowtype;
begin
 if v_user is null or not public.pm_is_member(p_conversation_id) then raise exception 'Conversation not accessible';end if;
 if p_client_id is null or p_body is null or char_length(trim(p_body)) not between 1 and 4000 then raise exception 'Invalid message';end if;
 perform pg_advisory_xact_lock(hashtext(v_user::text));
 select * into v_row from public.pm_messages where sender_id=v_user and client_id=p_client_id;
 if found then
  if v_row.conversation_id<>p_conversation_id or v_row.body<>trim(p_body) then raise exception 'Request ID reused with different content';end if;
  return v_row;
 end if;
 if (select count(*) from public.pm_messages where sender_id=v_user and created_at>now()-interval '1 minute')>=60 then raise exception 'Message rate limit reached';end if;
 insert into public.pm_messages(conversation_id,sender_id,client_id,body) values(p_conversation_id,v_user,p_client_id,trim(p_body)) returning * into v_row;
 update public.pm_conversations set updated_at=now() where id=p_conversation_id;
 insert into public.pm_notifications(user_id,kind,title,body,conversation_id)
 select user_id,'message','Новое сообщение',left(trim(p_body),160),p_conversation_id from public.pm_conversation_members where conversation_id=p_conversation_id and user_id<>v_user;
 return v_row;
end $$;
create or replace function public.pm_edit_message(p_message_id uuid,p_body text) returns public.pm_messages language plpgsql security definer set search_path='' as $$
declare v_row public.pm_messages%rowtype;
begin
 if p_body is null or char_length(trim(p_body)) not between 1 and 4000 then raise exception 'Invalid message';end if;
 select * into v_row from public.pm_messages where id=p_message_id for update;
 if not found or v_row.sender_id<>(select auth.uid()) or v_row.created_at<now()-interval '48 hours' then raise exception 'Cannot edit message';end if;
 update public.pm_messages set body=trim(p_body),edited_at=now() where id=p_message_id returning * into v_row;
 return v_row;
end $$;
create or replace function public.pm_delete_message(p_message_id uuid) returns boolean language plpgsql security definer set search_path='' as $$
declare v_row public.pm_messages%rowtype;
begin
 select * into v_row from public.pm_messages where id=p_message_id for update;
 if not found or v_row.sender_id<>(select auth.uid()) or v_row.created_at<now()-interval '48 hours' then raise exception 'Cannot delete message';end if;
 delete from public.pm_messages where id=p_message_id;
 return true;
end $$;
create or replace function public.pm_mark_read(p_conversation_id uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 update public.pm_conversation_members set last_read_at=now() where conversation_id=p_conversation_id and user_id=(select auth.uid());
 if not found then raise exception 'Conversation not accessible';end if;
 update public.pm_notifications set read_at=now() where user_id=(select auth.uid()) and conversation_id=p_conversation_id and read_at is null;
end $$;
create or replace function public.pm_list_conversations() returns table(id uuid,kind text,title text,peer_name text,updated_at timestamptz,last_body text,last_at timestamptz) language sql stable security definer set search_path='' as $$
 select c.id,c.kind,c.title,
 (select p.display_name from public.pm_conversation_members m2 join public.pm_profiles p on p.id=m2.user_id where m2.conversation_id=c.id and m2.user_id<>(select auth.uid()) order by m2.joined_at limit 1),
 c.updated_at,l.body,l.created_at
 from public.pm_conversations c
 join public.pm_conversation_members mine on mine.conversation_id=c.id and mine.user_id=(select auth.uid())
 left join lateral (select body,created_at from public.pm_messages msg where msg.conversation_id=c.id order by created_at desc,id desc limit 1) l on true
 order by c.updated_at desc limit 100
$$;
create or replace function public.pm_create_pride(p_name text,p_description text default '') returns uuid language plpgsql security definer set search_path='' as $$
declare v_user uuid:=(select auth.uid());v_id uuid;
begin
 if v_user is null then raise exception 'Sign in first';end if;
 if p_name is null or char_length(trim(p_name)) not between 2 and 80 or char_length(coalesce(p_description,''))>1000 then raise exception 'Invalid Pride details';end if;
 if (select count(*) from public.pm_prides where owner_id=v_user and created_at>now()-interval '1 hour')>=3 then raise exception 'Pride creation limit reached';end if;
 insert into public.pm_prides(name,description,owner_id) values(trim(p_name),trim(coalesce(p_description,'')),v_user) returning id into v_id;
 insert into public.pm_pride_members(pride_id,user_id,role) values(v_id,v_user,'owner');
 insert into public.pm_channels(pride_id,name,kind) values(v_id,'общая-тропа','text');
 return v_id;
end $$;
create or replace function public.pm_join_pride(p_pride_id uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 if (select auth.uid()) is null then raise exception 'Sign in first';end if;
 if not exists(select 1 from public.pm_prides where id=p_pride_id and visibility='public') then raise exception 'Pride not open for joining';end if;
 insert into public.pm_pride_members(pride_id,user_id,role) values(p_pride_id,(select auth.uid()),'member') on conflict do nothing;
end $$;

alter table public.pm_profiles enable row level security;
alter table public.pm_conversations enable row level security;
alter table public.pm_conversation_members enable row level security;
alter table public.pm_messages enable row level security;
alter table public.pm_notifications enable row level security;
alter table public.pm_lookup_events enable row level security;
alter table public.pm_prides enable row level security;
alter table public.pm_pride_members enable row level security;
alter table public.pm_channels enable row level security;
alter table public.pm_claws_wallets enable row level security;
alter table public.pm_claws_ledger enable row level security;
alter table public.pm_subscriptions enable row level security;
alter table public.pm_orders enable row level security;
create policy pm_profiles_read on public.pm_profiles for select to authenticated using ((select auth.uid()) is not null);
create policy pm_profiles_self_update on public.pm_profiles for update to authenticated using (id=(select auth.uid())) with check (id=(select auth.uid()));
create policy pm_conversations_member_read on public.pm_conversations for select to authenticated using (public.pm_is_member(id));
create policy pm_members_member_read on public.pm_conversation_members for select to authenticated using (public.pm_is_member(conversation_id));
create policy pm_messages_member_read on public.pm_messages for select to authenticated using (public.pm_is_member(conversation_id));
create policy pm_notifications_self_read on public.pm_notifications for select to authenticated using (user_id=(select auth.uid()));
create policy pm_prides_visible on public.pm_prides for select to authenticated using (visibility='public' or public.pm_is_pride_member(id));
create policy pm_pride_members_member_read on public.pm_pride_members for select to authenticated using (public.pm_is_pride_member(pride_id));
create policy pm_channels_pride_read on public.pm_channels for select to authenticated using (public.pm_is_pride_member(pride_id));
create policy pm_claws_wallet_self_read on public.pm_claws_wallets for select to authenticated using (user_id=(select auth.uid()));
create policy pm_claws_ledger_self_read on public.pm_claws_ledger for select to authenticated using (user_id=(select auth.uid()));
create policy pm_subscriptions_self_read on public.pm_subscriptions for select to authenticated using (user_id=(select auth.uid()));
create policy pm_orders_self_read on public.pm_orders for select to authenticated using (user_id=(select auth.uid()));
revoke all on public.pm_profiles,public.pm_conversations,public.pm_conversation_members,public.pm_messages,public.pm_notifications,public.pm_lookup_events,public.pm_prides,public.pm_pride_members,public.pm_channels,public.pm_claws_wallets,public.pm_claws_ledger,public.pm_subscriptions,public.pm_orders from anon,authenticated;
grant select on public.pm_profiles,public.pm_conversations,public.pm_conversation_members,public.pm_messages,public.pm_notifications,public.pm_prides,public.pm_pride_members,public.pm_channels,public.pm_claws_wallets,public.pm_claws_ledger,public.pm_subscriptions,public.pm_orders to authenticated;
grant update(display_name,bio,avatar_path) on public.pm_profiles to authenticated;
revoke all on function public.pm_after_signup(),public.pm_is_member(uuid),public.pm_is_pride_member(uuid),public.pm_find_person(text),public.pm_start_dm(uuid),public.pm_create_group(text,uuid[]),public.pm_send_message(uuid,text,uuid),public.pm_edit_message(uuid,text),public.pm_delete_message(uuid),public.pm_mark_read(uuid),public.pm_list_conversations(),public.pm_create_pride(text,text),public.pm_join_pride(uuid) from public,anon,authenticated;
grant execute on function public.pm_is_member(uuid),public.pm_is_pride_member(uuid),public.pm_find_person(text),public.pm_start_dm(uuid),public.pm_create_group(text,uuid[]),public.pm_send_message(uuid,text,uuid),public.pm_edit_message(uuid,text),public.pm_delete_message(uuid),public.pm_mark_read(uuid),public.pm_list_conversations(),public.pm_create_pride(text,text),public.pm_join_pride(uuid) to authenticated;
alter publication supabase_realtime add table public.pm_messages,public.pm_conversation_members,public.pm_notifications;
