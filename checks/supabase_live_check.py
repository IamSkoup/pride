import os,json,urllib.request,urllib.error,secrets,uuid
REF='gnvihjeqheupzgcwcefv';ROOT='https://'+REF+'.supabase.co';MGMT='https://api.supabase.com/v1';ACCESS=os.environ['SUPABASE_ACCESS_TOKEN']
ids=[];conv=[];pride=[];objects=[];checks=[]
def request(url,method='GET',body=None,headers=None,expected=(200,201,204)):
 data=None if body is None else json.dumps(body).encode()
 req=urllib.request.Request(url,data=data,method=method,headers={'Content-Type':'application/json',**(headers or {})})
 try:
  with urllib.request.urlopen(req,timeout=40) as response:status=response.status;raw=response.read()
 except urllib.error.HTTPError as e:status=e.code;raw=e.read()
 try:result=json.loads(raw) if raw else None
 except:result=raw.decode()[:250]
 if status not in expected:raise RuntimeError(f'{method} {url.split("?")[0].split("/")[-1]} returned {status}: {str(result)[:350]}')
 return status,result
def management(path,method='GET',body=None):return request(MGMT+path,method,body,{'Authorization':'Bearer '+ACCESS})[1]
keys=management('/projects/'+REF+'/api-keys');PUB=next(x['api_key'] for x in keys if x['type']=='publishable');ADMIN=next(x['api_key'] for x in keys if x['name']=='service_role')
def api(path,method='GET',body=None,token=None,admin=False,expected=(200,201,204)):
 key=ADMIN if admin else PUB
 return request(ROOT+path,method,body,{'apikey':key,**({'Authorization':'Bearer '+(ADMIN if admin else token)} if admin or token else {}),'Prefer':'return=representation'},expected)
def assert_true(name,condition):
 if not condition:raise AssertionError(name)
 checks.append(name)
def create_user(n):
 label='pmtest'+secrets.token_hex(5);email=label+'@example.invalid';password='X9'+secrets.token_urlsafe(16)
 _,result=api('/auth/v1/admin/users','POST',{'email':email,'password':password,'email_confirm':True,'user_metadata':{'username':label,'display_name':n}},admin=True)
 ids.append(result['id'])
 _,session=api('/auth/v1/token?grant_type=password','POST',{'email':email,'password':password})
 return {'id':result['id'],'username':label,'token':session['access_token']}
def rpc(name,args,user):return api('/rest/v1/rpc/'+name,'POST',args,user['token'])[1]
def get(table,query,user):return api('/rest/v1/'+table+'?'+query,token=user['token'])[1]
def denied(path,method,body,user):
 status,_=api(path,method,body,user['token'],expected=(400,401,403,404,409));return status
try:
 a,b,c=(create_user(x) for x in ('Test A','Test B','Test C'))
 assert_true('three separate auth accounts',len({a['id'],b['id'],c['id']})==3)
 found=rpc('pm_find_person',{'p_username':b['username']},a)
 assert_true('exact username lookup',len(found)==1 and found[0]['id']==b['id'])
 dm=rpc('pm_start_dm',{'p_other_user_id':b['id']},a);conv.append(dm)
 assert_true('DM listed for both members',any(x['id']==dm for x in rpc('pm_list_conversations',{},b)))
 assert_true('DM hidden from outsider',all(x['id']!=dm for x in rpc('pm_list_conversations',{},c)))
 client_id=secrets.token_hex(16);uid=f'{client_id[:8]}-{client_id[8:12]}-4{client_id[13:16]}-a{client_id[17:20]}-{client_id[20:32]}'
 message=rpc('pm_send_message',{'p_conversation_id':dm,'p_body':'hello from A','p_client_id':uid},a)
 repeat=rpc('pm_send_message',{'p_conversation_id':dm,'p_body':'hello from A','p_client_id':uid},a)
 assert_true('send retry idempotent',message['id']==repeat['id'])
 assert_true('recipient reads message',len(get('pm_messages','select=id,body&conversation_id=eq.'+dm,b))==1)
 path=dm+'/'+a['id']+'/'+str(uuid.uuid4())+'.txt'
 upload=urllib.request.Request(ROOT+'/storage/v1/object/pm-attachments/'+path,data=b'private test attachment',method='POST',headers={'apikey':PUB,'Authorization':'Bearer '+a['token'],'Content-Type':'text/plain','x-upsert':'false'})
 try:
  with urllib.request.urlopen(upload,timeout=30) as response:upload_status=response.status
 except urllib.error.HTTPError as error:raise RuntimeError('Attachment upload '+str(error.code)+': '+error.read().decode()[:400])
 objects.append(path)
 assert_true('member uploads private attachment',upload_status in (200,201))
 attached=rpc('pm_send_attachment',{'p_conversation_id':dm,'p_body':'private attachment','p_client_id':'00000000-0000-4000-a000-000000000005','p_object_path':path},a)
 assert_true('attachment bound to message',attached['id'] and len(get('pm_attachments','select=id,object_path&message_id=eq.'+attached['id'],b))==1)
 assert_true('outsider cannot list attachment metadata',get('pm_attachments','select=id&message_id=eq.'+attached['id'],c)==[])
 status,_=api('/storage/v1/object/authenticated/pm-attachments/'+path,token=b['token']);assert_true('member downloads private attachment',status==200)
 status,_=api('/storage/v1/object/authenticated/pm-attachments/'+path,token=c['token'],expected=(400,401,403,404));assert_true('outsider cannot download attachment',status in (400,401,403,404))
 assert_true('message deletion blocked until file removed',denied('/rest/v1/rpc/pm_delete_message','POST',{'p_message_id':attached['id']},a) in (400,403))
 attachment_row=get('pm_attachments','select=id&message_id=eq.'+attached['id'],a)[0]
 assert_true('other member cannot unlink file',denied('/rest/v1/rpc/pm_unlink_attachment','POST',{'p_attachment_id':attachment_row['id']},b) in (400,403))
 assert_true('metadata cannot unlink before object deletion',denied('/rest/v1/rpc/pm_unlink_attachment','POST',{'p_attachment_id':attachment_row['id']},a) in (400,403))
 api('/storage/v1/object/pm-attachments','DELETE',{'prefixes':[path]},a['token']);objects.remove(path)
 rpc('pm_unlink_attachment',{'p_attachment_id':attachment_row['id']},a)
 rpc('pm_delete_message',{'p_message_id':attached['id']},a)
 assert_true('file and message deletion complete',get('pm_messages','select=id&id=eq.'+attached['id'],b)==[] and get('pm_attachments','select=id&message_id=eq.'+attached['id'],b)==[])
 assert_true('outsider cannot read message',get('pm_messages','select=id&conversation_id=eq.'+dm,c)==[])
 assert_true('outsider cannot send',denied('/rest/v1/rpc/pm_send_message','POST',{'p_conversation_id':dm,'p_body':'intrusion','p_client_id':uid},c) in (400,403))
 assert_true('recipient cannot edit sender message',denied('/rest/v1/rpc/pm_edit_message','POST',{'p_message_id':message['id'],'p_body':'intrusion'},b) in (400,403))
 edited=rpc('pm_edit_message',{'p_message_id':message['id'],'p_body':'edited by A'},a)
 assert_true('sender can edit own message',edited['body']=='edited by A')
 group=rpc('pm_create_group',{'p_title':'Test savanna','p_members':[b['id']]},a);conv.append(group)
 assert_true('group visible to participant',any(x['id']==group for x in rpc('pm_list_conversations',{},b)))
 assert_true('group hidden from outsider',get('pm_conversations','select=id&id=eq.'+group,c)==[])
 assert_true('outsider cannot add membership',denied('/rest/v1/pm_conversation_members','POST',{'conversation_id':group,'user_id':c['id'],'role':'member'},c) in (400,401,403))
 assert_true('cannot edit claws wallet',denied('/rest/v1/pm_claws_wallets?user_id=eq.'+a['id'],'PATCH',{'balance':99999},a) in (400,401,403))
 assert_true('cannot edit own subscription',denied('/rest/v1/pm_subscriptions?user_id=eq.'+a['id'],'PATCH',{'plan':'lion'},a) in (400,401,403))
 status,blocked=api('/rest/v1/pm_profiles?id=eq.'+b['id'],'PATCH',{'display_name':'intrusion'},a['token'],expected=(200,400,401,403))
 assert_true('cannot edit another profile',blocked==[] and get('pm_profiles','select=display_name&id=eq.'+b['id'],b)[0]['display_name']=='Test B')
 own=api('/rest/v1/pm_profiles?id=eq.'+a['id'],'PATCH',{'display_name':'Test A updated'},a['token'])[1]
 assert_true('owner updates own profile',len(own)==1 and own[0]['display_name']=='Test A updated')
 p=rpc('pm_create_pride',{'p_name':'Test Pride','p_description':'Automated test'},a);pride.append(p)
 assert_true('public pride visible',len(get('pm_prides','select=id&id=eq.'+p,c))==1)
 rpc('pm_join_pride',{'p_pride_id':p},b)
 assert_true('join pride persisted',len(get('pm_pride_members','select=user_id&pride_id=eq.'+p,b))==2)
 channels=get('pm_channels','select=id,name&pride_id=eq.'+p,b);assert_true('member sees pride channel',len(channels)==1)
 channel=channels[0]['id'];channel_client=str(uuid.uuid4())
 channel_message=rpc('pm_send_channel_message',{'p_channel_id':channel,'p_body':'Hello Pride','p_client_id':channel_client},b)
 repeat_channel=rpc('pm_send_channel_message',{'p_channel_id':channel,'p_body':'Hello Pride','p_client_id':channel_client},b)
 assert_true('channel send is idempotent',channel_message['id']==repeat_channel['id'])
 assert_true('another member reads channel',len(get('pm_channel_messages','select=id,body&channel_id=eq.'+channel,a))==1)
 assert_true('outsider cannot read channel',get('pm_channel_messages','select=id&channel_id=eq.'+channel,c)==[])
 assert_true('outsider cannot post to channel',denied('/rest/v1/rpc/pm_send_channel_message','POST',{'p_channel_id':channel,'p_body':'intrusion','p_client_id':str(uuid.uuid4())},c) in (400,403))
 assert_true('direct channel insert denied',denied('/rest/v1/pm_channel_messages','POST',{'channel_id':channel,'author_id':b['id'],'client_id':str(uuid.uuid4()),'body':'bypass'},b) in (400,401,403))
 print('PASS',len(checks),'checks:',', '.join(checks))
finally:
 if ids:
  if objects:
   try:api('/storage/v1/object/pm-attachments','DELETE',{'prefixes':objects},admin=True,expected=(200,201,204));print('Test object cleaned')
   except Exception as e:print('Object cleanup failed:',str(e)[:250])
  def q(u):return "'"+u.replace("'","''")+"'"
  sql='begin;'+''.join('delete from public.pm_conversations where id='+q(x)+';' for x in conv)+''.join('delete from public.pm_prides where id='+q(x)+';' for x in pride)+ 'delete from auth.users where id in ('+','.join(q(x) for x in ids)+');commit;'
  try:
   management('/projects/'+REF+'/database/query','POST',{'query':sql});print('Test data cleaned')
  except Exception as e:print('Cleanup failed:',str(e)[:350])
