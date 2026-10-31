-- Members may read private attachments; only the uploader may create/remove them.
create or replace function public.pm_attachment_path_allowed(p_name text) returns boolean
language plpgsql stable security definer set search_path='' as $$
declare v_chat uuid;
begin
 if (select auth.uid()) is null or p_name is null or p_name !~ '^[0-9a-fA-F-]{36}/[0-9a-fA-F-]{36}/[0-9a-fA-F-]{36}\.[a-z0-9]{1,8}$' then return false;end if;
 v_chat:=split_part(p_name,'/',1)::uuid;
 return public.pm_is_member(v_chat);
exception when invalid_text_representation then return false;
end $$;
drop policy pm_attachment_upload on storage.objects;
create policy pm_attachment_upload on storage.objects for insert to authenticated
 with check (bucket_id='pm-attachments' and public.pm_attachment_path_allowed(name) and split_part(name,'/',2)=(select auth.uid())::text);
drop policy pm_attachment_remove on storage.objects;
create policy pm_attachment_remove on storage.objects for delete to authenticated
 using (bucket_id='pm-attachments' and public.pm_attachment_path_allowed(name) and split_part(name,'/',2)=(select auth.uid())::text);

create or replace function public.pm_send_attachment(p_conversation_id uuid,p_body text,p_client_id uuid,p_object_path text)
returns public.pm_messages language plpgsql security definer set search_path='' as $$
declare v_user uuid:=(select auth.uid());v_object storage.objects%rowtype;v_message public.pm_messages%rowtype;v_existing uuid;v_size bigint;
begin
 if v_user is null or not public.pm_attachment_path_allowed(p_object_path) or split_part(p_object_path,'/',1)<>p_conversation_id::text or split_part(p_object_path,'/',2)<>v_user::text then raise exception 'Attachment not accessible';end if;
 select * into v_object from storage.objects where bucket_id='pm-attachments' and name=p_object_path;
 if not found then raise exception 'Attachment not uploaded';end if;
 v_size:=(v_object.metadata->>'size')::bigint;
 if v_size is null or v_size not between 1 and 10485760 then raise exception 'Invalid attachment size';end if;
 v_message:=public.pm_send_message(p_conversation_id,p_body,p_client_id);
 select message_id into v_existing from public.pm_attachments where object_path=p_object_path;
 if v_existing is not null and v_existing<>v_message.id then raise exception 'Attachment already linked';end if;
 insert into public.pm_attachments(conversation_id,message_id,sender_id,object_path,mime_type,size_bytes)
 values(p_conversation_id,v_message.id,v_user,p_object_path,coalesce(v_object.metadata->>'mimetype','application/octet-stream'),v_size)
 on conflict(object_path) do nothing;
 return v_message;
end $$;
