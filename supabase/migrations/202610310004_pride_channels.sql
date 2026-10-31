-- Member-only text channels in public Prides.
create table public.pm_channel_messages (
 id uuid primary key default gen_random_uuid(),
 channel_id uuid not null references public.pm_channels(id) on delete cascade,
 author_id uuid not null references public.pm_profiles(id),
 client_id uuid not null,
 body text not null check(char_length(trim(body)) between 1 and 4000),
 created_at timestamptz not null default now(),
 edited_at timestamptz,
 unique(author_id,client_id)
);
create index pm_channel_messages_cursor_idx on public.pm_channel_messages(channel_id,created_at desc,id desc);
create or replace function public.pm_is_channel_member(p_channel_id uuid) returns boolean
 language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.pm_channels c join public.pm_pride_members m on m.pride_id=c.pride_id where c.id=p_channel_id and m.user_id=(select auth.uid()))
$$;
revoke all on function public.pm_is_channel_member(uuid) from public,anon,authenticated;
grant execute on function public.pm_is_channel_member(uuid) to authenticated;
alter table public.pm_channel_messages enable row level security;
create policy pm_channel_messages_member_read on public.pm_channel_messages for select to authenticated using(public.pm_is_channel_member(channel_id));
revoke all on public.pm_channel_messages from anon,authenticated;
grant select on public.pm_channel_messages to authenticated;
create or replace function public.pm_send_channel_message(p_channel_id uuid,p_body text,p_client_id uuid)
returns public.pm_channel_messages language plpgsql security definer set search_path='' as $$
declare v_user uuid:=(select auth.uid());v_channel public.pm_channels%rowtype;v_row public.pm_channel_messages%rowtype;
begin
 if v_user is null or not public.pm_is_channel_member(p_channel_id) then raise exception 'Channel not accessible';end if;
 if p_client_id is null or p_body is null or char_length(trim(p_body)) not between 1 and 4000 then raise exception 'Invalid message';end if;
 select * into v_channel from public.pm_channels where id=p_channel_id;
 if v_channel.kind='announcement' and not exists(select 1 from public.pm_pride_members where pride_id=v_channel.pride_id and user_id=v_user and role='owner') then raise exception 'Announcements are owner-only';end if;
 perform pg_advisory_xact_lock(hashtext(v_user::text));
 select * into v_row from public.pm_channel_messages where author_id=v_user and client_id=p_client_id;
 if found then
  if v_row.channel_id<>p_channel_id or v_row.body<>trim(p_body) then raise exception 'Request ID reused with different content';end if;
  return v_row;
 end if;
 if (select count(*) from public.pm_channel_messages where author_id=v_user and created_at>now()-interval '1 minute')>=60 then raise exception 'Channel message rate limit reached';end if;
 insert into public.pm_channel_messages(channel_id,author_id,client_id,body) values(p_channel_id,v_user,p_client_id,trim(p_body)) returning * into v_row;
 return v_row;
end $$;
revoke all on function public.pm_send_channel_message(uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.pm_send_channel_message(uuid,text,uuid) to authenticated;
alter publication supabase_realtime add table public.pm_channel_messages;
