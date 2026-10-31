-- A message cannot disappear while a linked Storage object remains.
create or replace function public.pm_delete_message(p_message_id uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare v_row public.pm_messages%rowtype;
begin
 select * into v_row from public.pm_messages where id=p_message_id for update;
 if not found or v_row.sender_id<>(select auth.uid()) or v_row.created_at<now()-interval '48 hours' then raise exception 'Cannot delete message';end if;
 if exists(select 1 from public.pm_attachments where message_id=p_message_id) then raise exception 'Remove attachments before deleting message';end if;
 delete from public.pm_messages where id=p_message_id;
 return true;
end $$;
create or replace function public.pm_unlink_attachment(p_attachment_id uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare v_row public.pm_attachments%rowtype;v_created_at timestamptz;
begin
 select * into v_row from public.pm_attachments where id=p_attachment_id for update;
 if not found or v_row.sender_id<>(select auth.uid()) then raise exception 'Attachment not accessible';end if;
 select created_at into v_created_at from public.pm_messages where id=v_row.message_id;
 if v_created_at<now()-interval '48 hours' then raise exception 'Cannot delete attachment';end if;
 if exists(select 1 from storage.objects where bucket_id='pm-attachments' and name=v_row.object_path) then raise exception 'Remove Storage object first';end if;
 delete from public.pm_attachments where id=p_attachment_id;
 return true;
end $$;
revoke all on function public.pm_unlink_attachment(uuid) from public,anon,authenticated;
grant execute on function public.pm_unlink_attachment(uuid) to authenticated;
