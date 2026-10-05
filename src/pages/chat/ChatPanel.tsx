import { useEffect, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react';
import { ArrowDown, ArrowLeft, Check, CheckCheck, Copy, File, Info, Mic, MoreHorizontal, Paperclip, Pin, Search, Send, Smile, Square, X } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { onValue, orderByChild, query, limitToLast, push, ref, set, update } from 'firebase/database';
import { useAuth } from '../../context/AuthContext';
import { useFirebaseValue } from '../../hooks/useFirebaseValue';
import { useToast } from '../../components/Toast';
import { Avatar } from '../../components/Avatar';
import { db, requireDb } from '../../services/firebase';
import { addMember, changeRole, deleteMessage, editMessage, markRead, mediaObjectUrl, messagePreview, reactToMessage, removeMember, sendMessage, setTyping, uploadChatMedia } from '../../services/chats';
import { findUser } from '../../services/auth';
import type { Chat, Media, Message, Profile, Role } from '../../types';

function useMessages(chatId: string, count: number) {
  const [messages, setMessages] = useState<Message[]>([]);
  useEffect(() => {
    if (!db) return;
    return onValue(query(ref(db, `messages/${chatId}`), orderByChild('createdAt'), limitToLast(count)), snap => {
      setMessages(Object.values(snap.val() || {}) as Message[]);
    });
  }, [chatId, count]);
  return messages;
}
function MediaView({ media }: { media: Media }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { let active = true; let objectUrl = ''; mediaObjectUrl(media.url).then(value => { objectUrl = value; if (active) setUrl(value); else URL.revokeObjectURL(value); }).catch(e => { if (active) setError(e.message); }); return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); }; }, [media.url]);
  if (error) return <span className="media-error">{error}</span>;
  if (!url) return <span className="media-loading">Загрузка файла…</span>;
  if (media.kind === 'image') return <a href={url} target="_blank" rel="noreferrer"><img className="message-image" src={url} alt={media.name}/></a>;
  if (media.kind === 'video') return <video className="message-video" src={url} controls preload="metadata"/>;
  if (media.kind === 'audio') return <div className="audio-media"><strong>{media.name}</strong><audio src={url} controls preload="metadata"/></div>;
  return <a className="file-media" href={url} download={media.name}><File size={20}/><span>{media.name}<small>{Math.round(media.size / 1024)} КБ</small></span><ArrowDown size={17}/></a>;
}
function MessageItem({ message, own, chat, uid, role, messages, onReply, onForward, onEdit, onRetry }: { message: Message; own: boolean; chat: Chat; uid: string; role: Role; messages: Message[]; onReply: (m: Message) => void; onForward: (m: Message) => void; onEdit: (m: Message) => void; onRetry: (m: Message) => void }) {
  const { toast } = useToast();
  const [menu, setMenu] = useState(false);
  const [reactions] = useFirebaseValue<Record<string, string>>(`reactions/${chat.id}/${message.id}`);
  const [readReceipts] = useFirebaseValue<Record<string, number>>(`readReceipts/${chat.id}`);
  const [sender] = useFirebaseValue<Profile>(chat.kind !== 'dm' ? `users/${message.senderId}` : null);
  const reply = messages.find(m => m.id === message.replyTo);
  const canDelete = own || role === 'owner' || role === 'moderator';
  const myReaction = reactions?.[uid];
  async function remove(all: boolean) { try { await deleteMessage(chat.id, message.id, all, uid); setMenu(false); } catch (e) { toast((e as Error).message, 'error'); } }
  async function togglePin() { try { await update(ref(requireDb(), `chats/${chat.id}`), { pinnedMessageId: chat.pinnedMessageId === message.id ? null : message.id }); setMenu(false); } catch (e) { toast((e as Error).message, 'error'); } }
  async function react(emoji: string) { try { await reactToMessage(chat.id, message.id, uid, myReaction === emoji ? null : emoji); setMenu(false); } catch (e) { toast((e as Error).message, 'error'); } }
  const reactionCount = Object.values(reactions || {}).reduce<Record<string, number>>((all, emoji) => { all[emoji] = (all[emoji] || 0) + 1; return all; }, {});
  return <div id={`m-${message.id}`} className={`message-line ${own ? 'own' : ''}`}><div className={`bubble ${message.status === 'error' ? 'failed' : ''}`}>
    {chat.kind !== 'dm' && !own && <div className="sender-name">{sender?.displayName || 'Участник'}</div>}
    {message.forwardedFrom && <div className="forwarded">Переслано</div>}
    {reply && <button className="reply-quote" onClick={() => document.getElementById(`m-${reply.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })}><strong>{reply.senderId === uid ? 'Вы' : 'Собеседник'}</strong><span>{messagePreview(reply)}</span></button>}
    {message.deleted ? <span className="deleted-text">Сообщение удалено</span> : <>{message.media && <MediaView media={message.media}/>} {message.text && <div className="message-text">{message.text}</div>}</>}
    <div className="message-meta">{message.editedAt && <span>изменено</span>}<time>{message.createdAt ? new Date(message.createdAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : 'отправка'}</time>{own && message.status !== 'error' && (message.status === 'sending' ? <Check size={14}/> : <CheckCheck size={14} className={Object.entries(readReceipts || {}).some(([person, at]) => person !== uid && at >= message.createdAt) ? 'read' : ''}/>)}</div>
    {message.status === 'error' && <button className="retry-btn" onClick={() => onRetry(message)}>Не отправлено · Повторить</button>}
    {!message.deleted && <><button className="message-more" aria-label="Действия с сообщением" onClick={() => setMenu(!menu)}><MoreHorizontal size={18}/></button>{menu && <div className="message-menu"><div className="emoji-row">{['♥️', '🔥', '👏', '👍'].map(emoji => <button key={emoji} onClick={() => react(emoji)}>{emoji}</button>)}</div><button onClick={() => { onReply(message); setMenu(false); }}>Ответить</button><button onClick={() => { onForward(message); setMenu(false); }}>Переслать</button><button onClick={() => { navigator.clipboard.writeText(message.text).then(() => toast('Скопировано')); setMenu(false); }} disabled={!message.text}>Скопировать</button>{own && <button onClick={() => { onEdit(message); setMenu(false); }}>Изменить</button>}{role === 'owner' && <button onClick={togglePin}>{chat.pinnedMessageId === message.id ? 'Открепить сообщение' : 'Закрепить сообщение'}</button>}<button onClick={() => remove(false)}>Удалить у себя</button>{canDelete && <button className="danger" onClick={() => remove(true)}>Удалить у всех</button>}</div>}</>}
    {Object.keys(reactionCount).length > 0 && <div className="reactions">{Object.entries(reactionCount).map(([emoji, count]) => <button className={myReaction === emoji ? 'selected' : ''} key={emoji} onClick={() => react(emoji)}>{emoji} {count}</button>)}</div>}
  </div></div>;
}
function ChatDetails({ chat, members, uid, onClose }: { chat: Chat; members: Record<string, Role>; uid: string; onClose: () => void }) {
  const { toast } = useToast(); const [addQuery, setAddQuery] = useState('');
  const [prefs] = useFirebaseValue<{ pinned?: boolean; archived?: boolean }>(`userChatPrefs/${uid}/${chat.id}`);
  async function add() { try { const person = await findUser(addQuery); if (!person) throw new Error('Пользователь не найден.'); await addMember(chat.id, uid, person.uid); setAddQuery(''); toast('Участник добавлен'); } catch (e) { toast((e as Error).message, 'error'); } }
  async function copyInvite() { await navigator.clipboard.writeText(`${location.origin}/invite/${chat.id}/${chat.inviteCode}`); toast('Ссылка скопирована'); }
  async function toggle(key: 'pinned' | 'archived') { await update(ref(requireDb(), `userChatPrefs/${uid}/${chat.id}`), { [key]: !prefs?.[key] }); }
  return <aside className="details-panel"><div className="details-head"><strong>Информация</strong><button className="icon-btn" onClick={onClose} aria-label="Закрыть"><X size={19}/></button></div><div className="details-hero"><Avatar name={chat.title || 'Личный чат'} size={76}/><h2>{chat.kind === 'dm' ? 'Личный чат' : chat.title}</h2><p>{chat.description || (chat.kind === 'dm' ? 'Ваше личное пространство для разговора' : chat.kind === 'channel' ? 'Канал' : 'Группа')}</p></div><div className="details-actions"><button onClick={() => toggle('pinned')}><Pin size={17}/>{prefs?.pinned ? 'Открепить чат' : 'Закрепить чат'}</button><button onClick={() => toggle('archived')}><ArchiveIcon/>{prefs?.archived ? 'Вернуть из архива' : 'В архив'}</button>{chat.kind !== 'dm' && <button onClick={copyInvite}><Copy size={17}/> Копировать приглашение</button>}</div>{chat.kind !== 'dm' && <><div className="details-section-title">Участники · {Object.keys(members).length}</div><div className="member-list">{Object.entries(members).map(([personId, role]) => <MemberRow key={personId} personId={personId} role={role} owner={chat.creatorId === uid} chatId={chat.id} actorId={uid}/>)}</div>{(members[uid] === 'owner' || members[uid] === 'admin') && <div className="details-add"><div className="search-line"><input value={addQuery} onChange={e => setAddQuery(e.target.value)} onKeyDown={e => e.key === 'Enter' && add()} placeholder="@username"/><button className="icon-btn" onClick={add} disabled={!addQuery.trim()} aria-label="Добавить участника"><PlusIcon/></button></div></div>}</>}</aside>;
}
function ArchiveIcon() { return <span className="tiny-icon">▣</span>; }
function PlusIcon() { return <span className="tiny-icon">+</span>; }
function MemberRow({ personId, role, owner, chatId, actorId }: { personId: string; role: Role; owner: boolean; chatId: string; actorId: string }) {
  const [person] = useFirebaseValue<Profile>(`users/${personId}`); const { toast } = useToast();
  async function roleChange(next: Role) { try { await changeRole(chatId, actorId, personId, next); } catch (e) { toast((e as Error).message, 'error'); } }
  async function remove() { try { await removeMember(chatId, actorId, personId); } catch (e) { toast((e as Error).message, 'error'); } }
  return <div className="member-row"><Avatar profile={person} size={35}/><span><strong>{person?.displayName || 'Участник'}</strong><small>@{person?.username || personId.slice(0, 7)}</small></span>{owner && personId !== actorId ? <><select value={role} onChange={e => roleChange(e.target.value as Role)} aria-label="Роль"><option value="member">Участник</option><option value="moderator">Модератор</option><option value="admin">Админ</option></select><button className="icon-btn danger" onClick={remove} title="Удалить участника"><X size={15}/></button></> : <small>{role === 'owner' ? 'Владелец' : role === 'admin' ? 'Админ' : role === 'moderator' ? 'Модератор' : ''}</small>}</div>;
}

export function ChatPanel({ id }: { id: string }) {
  const { user } = useAuth(); const navigate = useNavigate(); const { toast } = useToast();
  const [chat, loading] = useFirebaseValue<Chat>(`chats/${id}`);
  const [members] = useFirebaseValue<Record<string, Role>>(`chatMembers/${id}`);
  const [typing] = useFirebaseValue<Record<string, number>>(`typing/${id}`);
  const [hidden] = useFirebaseValue<Record<string, boolean>>(user ? `hiddenMessages/${user.uid}/${id}` : null);
  const [draft] = useFirebaseValue<string>(user ? `drafts/${user.uid}/${id}` : null);
  const [text, setText] = useState(''); const [file, setFile] = useState<File | null>(null);
  const [reply, setReply] = useState<Message | null>(null); const [editing, setEditing] = useState<Message | null>(null);
  const [forwarding, setForwarding] = useState<Message | null>(null);
  const [busy, setBusy] = useState(false); const [progress, setProgress] = useState(0);
  const [recording, setRecording] = useState(false); const [recordSeconds, setRecordSeconds] = useState(0);
  const recorder = useRef<MediaRecorder | null>(null); const stream = useRef<MediaStream | null>(null); const discardRecording = useRef(false);
  const [showDetails, setShowDetails] = useState(false); const [showSearch, setShowSearch] = useState(false); const [search, setSearch] = useState('');
  const [count, setCount] = useState(80); const [pending, setPending] = useState<Message[]>([]);
  const messages = useMessages(id, count); const bottom = useRef<HTMLDivElement>(null); const fileInput = useRef<HTMLInputElement>(null);
  const otherId = chat?.kind === 'dm' ? Object.keys(members || {}).find(key => key !== user?.uid) : null;
  const [other] = useFirebaseValue<Profile>(otherId ? `users/${otherId}` : null);
  const [presence] = useFirebaseValue<{ online: boolean; lastSeen: number }>(otherId ? `presence/${otherId}` : null);
  const [allChats] = useFirebaseValue<Record<string, boolean>>(user ? `userChats/${user.uid}` : null);
  const visible = useMemo(() => [...messages, ...pending.filter(p => !messages.some(m => m.id === p.id))].filter(m => !hidden?.[m.id] && (!search || messagePreview(m).toLowerCase().includes(search.toLowerCase()))), [messages, pending, hidden, search]);
  const canWrite = chat && (chat.kind !== 'channel' || ['owner', 'admin'].includes(members?.[user?.uid || ''] || ''));
  useEffect(() => { setText(draft || ''); }, [id, draft]);
  useEffect(() => { bottom.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages.length, pending.length, id]);
  useEffect(() => { if (user && messages.length) markRead(id, user.uid).catch(() => {}); }, [id, user, messages.length]);
  useEffect(() => { if (!user) return; const timer = window.setTimeout(() => set(ref(requireDb(), `drafts/${user.uid}/${id}`), text.trim() || null).catch(() => {}), 500); return () => window.clearTimeout(timer); }, [id, text, user]);
  useEffect(() => { if (!user || !text.trim()) return; const timer = window.setTimeout(() => setTyping(id, user.uid, false).catch(() => {}), 2500); return () => window.clearTimeout(timer); }, [id, text, user]);
  useEffect(() => { if (!recording) return; const timer = window.setInterval(() => setRecordSeconds(value => value + 1), 1000); return () => window.clearInterval(timer); }, [recording]);
  useEffect(() => () => { if (recorder.current?.state === 'recording') recorder.current.stop(); stream.current?.getTracks().forEach(track => track.stop()); }, []);
  function updateText(value: string) { setText(value); if (user) setTyping(id, user.uid, Boolean(value.trim())).catch(() => {}); }
  async function startRecording() {
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) { toast('Этот браузер не поддерживает запись голоса.', 'error'); return; }
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'].find(type => MediaRecorder.isTypeSupported(type));
      const active = new MediaRecorder(stream.current, mime ? { mimeType: mime } : undefined);
      recorder.current = active; discardRecording.current = false; setRecordSeconds(0);
      const chunks: BlobPart[] = [];
      active.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      active.onstop = () => {
        stream.current?.getTracks().forEach(track => track.stop()); stream.current = null; setRecording(false);
        if (discardRecording.current || !chunks.length) return;
        const type = active.mimeType || 'audio/webm';
        const extension = type.includes('mp4') ? 'm4a' : 'webm';
        setFile(new globalThis.File(chunks, `Голосовое-${new Date().toISOString().slice(0, 19)}.${extension}`, { type }));
      };
      active.start(); setRecording(true);
    } catch { toast('Доступ к микрофону не получен.', 'error'); }
  }
  function stopRecording(discard = false) { discardRecording.current = discard; if (recorder.current?.state === 'recording') recorder.current.stop(); }
  async function send(overrides?: { content: string; upload: File | null; replyId?: string; id?: string }) {
    if (!user || !chat || !canWrite || (!(overrides?.content ?? text).trim() && !(overrides?.upload ?? file))) return;
    setBusy(true); const content = overrides?.content ?? text; const upload = overrides?.upload ?? file; const replyId = overrides?.replyId ?? reply?.id;
    setText(''); setFile(null); setReply(null); setProgress(0);
    const messageId = overrides?.id || push(ref(requireDb(), `messages/${id}`)).key!;
    const optimistic: Message = { id: messageId, chatId: id, senderId: user.uid, text: content.trim(), createdAt: Date.now(), replyTo: replyId, status: 'sending' };
    setPending(old => [...old.filter(p => p.id !== messageId), optimistic]);
    try {
      let media: Media | undefined;
      if (upload) media = await uploadChatMedia(id, user.uid, upload, setProgress);
      await sendMessage(id, user.uid, content, media, replyId, undefined, messageId);
      await set(ref(requireDb(), `drafts/${user.uid}/${id}`), null);
      await setTyping(id, user.uid, false);
      setPending(old => old.filter(p => p.id !== messageId));
    } catch (error) { setPending(old => old.map(p => p.id === messageId ? { ...p, status: 'error' } : p)); toast((error as Error).message, 'error'); setText(content); setFile(upload); }
    finally { setBusy(false); }
  }
  function retry(message: Message) { void send({ content: message.text, upload: file, replyId: message.replyTo, id: message.id }); }
  async function saveEdit() { if (!editing) return; try { await editMessage(id, editing.id, text); setEditing(null); setText(''); } catch (error) { toast((error as Error).message, 'error'); } }
  async function handleForward(targetId: string) { if (!forwarding || !user) return; try { await sendMessage(targetId, user.uid, forwarding.text, forwarding.media, undefined, forwarding.id); setForwarding(null); toast('Сообщение переслано'); } catch (e) { toast((e as Error).message, 'error'); } }
  function keyDown(e: KeyboardEvent<HTMLTextAreaElement>) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); editing ? saveEdit() : send(); } }
  function pickFile(e: ChangeEvent<HTMLInputElement>) { setFile(e.target.files?.[0] || null); e.target.value = ''; }
  if (loading) return <div className="panel-loading">Открываем разговор…</div>;
  if (!chat || !members?.[user?.uid || '']) return <div className="panel-loading">Чат недоступен. <Link to="/chats">К списку чатов</Link></div>;
  const title = chat.kind === 'dm' ? other?.displayName || 'Личный чат' : chat.title;
  const typingOthers = Object.entries(typing || {}).some(([uid, timestamp]) => uid !== user?.uid && Date.now() - timestamp < 6000);
  return <div className="conversation"><header className="conversation-head"><button className="icon-btn mobile-back" onClick={() => navigate('/chats')} aria-label="Назад"><ArrowLeft/></button><Avatar profile={other} name={title} size={42}/><div className="conversation-title"><strong>{title}</strong><span>{typingOthers ? 'печатает…' : chat.kind === 'dm' ? presence?.online ? 'в сети' : presence?.lastSeen ? `был(а) ${new Date(presence.lastSeen).toLocaleString('ru-RU')}` : `@${other?.username || ''}` : `${Object.keys(members).length} участн.`}</span></div><button className="icon-btn" onClick={() => setShowSearch(!showSearch)} title="Поиск по сообщениям"><Search size={20}/></button><button className="icon-btn" onClick={() => setShowDetails(!showDetails)} title="Информация"><Info size={20}/></button></header>
    {chat.pinnedMessageId && <button className="pinned-banner" onClick={() => document.getElementById(`m-${chat.pinnedMessageId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })}><Pin size={16}/> Закреплено: {messagePreview(messages.find(m => m.id === chat.pinnedMessageId) || { text: 'Сообщение', id: '', chatId: id, senderId: '', createdAt: 0 })}</button>}
    {showSearch && <div className="chat-search"><Search size={17}/><input autoFocus placeholder="Поиск в этом чате" value={search} onChange={e => setSearch(e.target.value)}/><button className="icon-btn" onClick={() => { setShowSearch(false); setSearch(''); }}><X size={17}/></button></div>}
    <div className="message-scroll"><div className="message-stack">{messages.length >= count && <button className="load-older" onClick={() => setCount(count + 80)}>Загрузить более ранние</button>}{visible.length ? visible.map(message => <MessageItem key={message.id} message={message} own={message.senderId === user?.uid} chat={chat} uid={user!.uid} role={members[user!.uid]} messages={messages} onReply={setReply} onForward={setForwarding} onEdit={m => { setEditing(m); setText(m.text); }} onRetry={retry}/>) : <div className="no-messages"><MessageBubbleIcon/><strong>{search ? 'Ничего не найдено' : 'Начните этот разговор'}</strong><span>{search ? 'Попробуйте другой запрос' : 'Первое сообщение иногда меняет всё.'}</span></div>}<div ref={bottom}/></div></div>
    {canWrite ? <div className="composer-wrap">{recording && <div className="recording-bar"><span className="recording-pulse"/>Запись · {Math.floor(recordSeconds / 60)}:{String(recordSeconds % 60).padStart(2, '0')}<button onClick={() => stopRecording(true)}>Отменить</button><button onClick={() => stopRecording(false)}><Square size={14}/> Завершить</button></div>}{(reply || editing || file) && <div className="composer-context"><span>{editing ? `Изменение: ${editing.text}` : reply ? `Ответ: ${messagePreview(reply)}` : file ? `Файл: ${file.name}` : ''}</span><button onClick={() => { setReply(null); setEditing(null); setFile(null); setText(''); }} aria-label="Отменить"><X size={16}/></button></div>}{progress > 0 && progress < 100 && <div className="upload-progress" style={{ width: `${progress}%` }}/>}<div className="composer"><input ref={fileInput} type="file" hidden onChange={pickFile} accept="image/*,video/*,audio/*,.pdf,.txt,.doc,.docx,.zip"/><button className="icon-btn" title="Прикрепить файл" onClick={() => fileInput.current?.click()}><Paperclip size={20}/></button><textarea rows={1} value={text} onChange={e => updateText(e.target.value)} onKeyDown={keyDown} placeholder="Напишите сообщение…" aria-label="Сообщение"/><button className="icon-btn" onClick={startRecording} disabled={recording || busy} aria-label="Записать голосовое сообщение" title="Записать голос"><Mic size={20}/></button><button className="send-btn" onClick={editing ? saveEdit : () => void send()} disabled={busy || recording || (!text.trim() && !file)} aria-label={editing ? 'Сохранить' : 'Отправить'}><Send size={19}/></button></div><div className="composer-hint">Enter — отправить · Shift + Enter — новая строка</div></div> : <div className="read-only">Только администраторы публикуют в канале.</div>}
    {showDetails && <ChatDetails chat={chat} members={members} uid={user!.uid} onClose={() => setShowDetails(false)}/>}
    {forwarding && <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) setForwarding(null); }}><div className="modal"><div className="modal-head"><h2>Переслать в чат</h2><button className="icon-btn" onClick={() => setForwarding(null)}><X/></button></div><div className="forward-list">{Object.keys(allChats || {}).filter(chatId => chatId !== id).map(chatId => <ForwardRow key={chatId} id={chatId} onClick={() => handleForward(chatId)}/>)}</div>{Object.keys(allChats || {}).length <= 1 && <p className="subtle">Пока нет другого чата для пересылки.</p>}</div></div>}
  </div>;
}
function MessageBubbleIcon() { return <div className="empty-bubble"><Smile size={30}/></div>; }
function ForwardRow({ id, onClick }: { id: string; onClick: () => void }) { const [chat] = useFirebaseValue<Chat>(`chats/${id}`); return chat ? <button className="forward-row" onClick={onClick}><Avatar name={chat.title || 'Личный чат'} size={38}/>{chat.title || 'Личный чат'}</button> : null; }
