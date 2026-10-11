import { useEffect, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { ArrowDown, ArrowLeft, Bell, Check, CheckCheck, Circle, Copy, File, Gift, Info, Mic, MoreHorizontal, Paperclip, Pin, Phone, Play, Search, Send, Smile, Square, Video, X } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { onValue, orderByChild, query, limitToLast, push, ref, set, update } from 'firebase/database';
import { useAuth } from '../../context/AuthContext';
import { useFirebaseValue } from '../../hooks/useFirebaseValue';
import { useToast } from '../../components/Toast';
import { Avatar } from '../../components/Avatar';
import { CallOverlay } from './CallOverlay';
import { db, requireDb } from '../../services/firebase';
import { addMember, changeRole, deleteMessage, editMessage, forwardChatMedia, markRead, mediaObjectUrl, messagePreview, reactToMessage, removeMember, sendMessage, sendSavannaGift, setTyping, uploadChatMedia } from '../../services/chats';
import { findUser } from '../../services/auth';
import type { Chat, CustomRole, Media, Message, Profile, Role, RolePermission } from '../../types';
import { activeSubscriptionTier, maxUploadMegabytes } from '../../services/entitlements';

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
function MediaView({ media, previews = true, autoplay = false, playlist = [media] }: { media: Media; previews?: boolean; autoplay?: boolean; playlist?: Media[] }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { if (!previews) return; let active = true; let objectUrl = ''; mediaObjectUrl(media.url).then(value => { objectUrl = value; if (active) setUrl(value); else URL.revokeObjectURL(value); }).catch(e => { if (active) setError(e.message); }); return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); }; }, [media.url, previews]);
  if (!previews) return <span className="media-loading">Вложение · {media.name}</span>;
  if (error) return <span className="media-error">{error}</span>;
  if (!url) return <span className="media-loading">Загрузка файла…</span>;
  if (media.kind === 'image') return <a href={url} target="_blank" rel="noreferrer"><img className="message-image" src={url} alt={media.name}/></a>;
  if (media.kind === 'video' || media.kind === 'videoNote') return <video className={`message-video ${media.kind === 'videoNote' ? 'video-note' : ''}`} src={url} controls muted={autoplay} autoPlay={autoplay} playsInline preload="metadata"/>;
  if (media.kind === 'audio') return <button className="audio-media" onClick={() => window.dispatchEvent(new CustomEvent('pride:play-audio', { detail: { tracks: playlist.map(track => ({ name: track.name, url: track.url })), index: Math.max(0, playlist.findIndex(track => track.url === media.url)) } }))}><span className="audio-media-icon"><Play size={17}/></span><span><strong>{media.name}</strong><small>Открыть в плеере Pride</small></span></button>;
  return <a className="file-media" href={url} download={media.name}><File size={20}/><span>{media.name}<small>{Math.round(media.size / 1024)} КБ</small></span><ArrowDown size={17}/></a>;
}
function MessageItem({ message, own, chat, uid, role, messages, mediaPreviews, autoplayVideos, onReply, onForward, onEdit, onRetry }: { message: Message; own: boolean; chat: Chat; uid: string; role: Role; messages: Message[]; mediaPreviews: boolean; autoplayVideos: boolean; onReply: (m: Message) => void; onForward: (m: Message) => void; onEdit: (m: Message) => void; onRetry: (m: Message) => void }) {
  const { toast } = useToast();
  const [menu, setMenu] = useState(false);
  const [menuPosition, setMenuPosition] = useState({ x: 0, y: 0 });
  const [confirmDelete, setConfirmDelete] = useState<boolean | null>(null);
  const menuRef = useRef<HTMLDivElement>(null); const pressTimer = useRef<number | undefined>(undefined); const pressStart = useRef<{ x: number; y: number } | null>(null);
  const [reactions] = useFirebaseValue<Record<string, string>>(`reactions/${chat.id}/${message.id}`);
  const [readReceipts] = useFirebaseValue<Record<string, number>>(`readReceipts/${chat.id}`);
  const [sender] = useFirebaseValue<Profile>(chat.kind !== 'dm' ? `users/${message.senderId}` : null);
  const reply = messages.find(m => m.id === message.replyTo);
  const canDelete = own || role === 'owner' || role === 'moderator';
  const myReaction = reactions?.[uid];
  function openMenu(x: number, y: number) { const w = 210; const h = 340; setMenuPosition({ x: Math.max(8, Math.min(x, window.innerWidth - w - 8)), y: Math.max(8, Math.min(y + h > window.innerHeight ? y - h : y, window.innerHeight - h - 8)) }); setMenu(true); }
  function handleContextMenu(event: React.MouseEvent<HTMLDivElement>) { event.preventDefault(); openMenu(event.clientX, event.clientY); }
  function pointerDown(event: ReactPointerEvent<HTMLDivElement>) { if (event.pointerType !== 'touch') return; pressStart.current = { x: event.clientX, y: event.clientY }; pressTimer.current = window.setTimeout(() => { if (pressStart.current) openMenu(pressStart.current.x, pressStart.current.y); }, 500); }
  function pointerMove(event: ReactPointerEvent<HTMLDivElement>) { if (pressStart.current && Math.hypot(event.clientX - pressStart.current.x, event.clientY - pressStart.current.y) > 12) { window.clearTimeout(pressTimer.current); pressStart.current = null; } }
  function pointerEnd() { window.clearTimeout(pressTimer.current); pressStart.current = null; }
  useEffect(() => { if (!menu) return; const outside = (event: PointerEvent) => { if (!menuRef.current?.contains(event.target as Node)) setMenu(false); }; const escape = (event: globalThis.KeyboardEvent) => { if (event.key === 'Escape') setMenu(false); }; const close = () => setMenu(false); document.addEventListener('pointerdown', outside); document.addEventListener('keydown', escape); window.addEventListener('scroll', close, true); window.addEventListener('resize', close); return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); window.removeEventListener('scroll', close, true); window.removeEventListener('resize', close); }; }, [menu]);
  async function remove(all: boolean) { try { await deleteMessage(chat.id, message.id, all, uid); setMenu(false); } catch (e) { toast((e as Error).message, 'error'); } }
  async function togglePin() { try { await update(ref(requireDb(), `chats/${chat.id}`), { pinnedMessageId: chat.pinnedMessageId === message.id ? null : message.id }); setMenu(false); } catch (e) { toast((e as Error).message, 'error'); } }
  async function react(emoji: string) { try { await reactToMessage(chat.id, message.id, uid, myReaction === emoji ? null : emoji); setMenu(false); } catch (e) { toast((e as Error).message, 'error'); } }
  async function saveToTrail() {
    try {
      await set(ref(requireDb(), `trail/${uid}/${message.id}`), { chatId: chat.id, messageId: message.id, preview: messagePreview(message), authorId: message.senderId, chatTitle: chat.title || 'Личный чат', createdAt: message.createdAt, mediaKind: message.media?.kind || null });
      setMenu(false); toast('Сохранено в Тропу');
    } catch (error) { toast((error as Error).message, 'error'); }
  }
  const reactionCount = Object.values(reactions || {}).reduce<Record<string, number>>((all, emoji) => { all[emoji] = (all[emoji] || 0) + 1; return all; }, {});
  return <><div id={`m-${message.id}`} className={`message-line ${own ? 'own' : ''}`} onContextMenu={handleContextMenu} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerEnd} onPointerCancel={pointerEnd}><div className={`bubble ${message.status === 'error' ? 'failed' : ''}`}>
    {chat.kind !== 'dm' && !own && <div className="sender-name">{sender?.displayName || 'Участник'}</div>}
    {message.forwardedFrom && <div className="forwarded">Переслано</div>}
    {message.replyTo && (reply ? <button className="reply-quote" onClick={() => document.getElementById(`m-${reply.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })}><strong>{reply.senderId === uid ? 'Вы' : 'Собеседник'}</strong><span>{messagePreview(reply)}</span></button> : <div className="reply-quote unavailable"><strong>Ответ на сообщение</strong><span>Исходное сообщение удалено или больше недоступно</span></div>)}
    {message.deleted ? <span className="deleted-text">Сообщение удалено</span> : <>{message.type === 'gift' && message.gift ? <GiftMessage gift={message.gift} own={own}/> : <>{message.media && <MediaView media={message.media} previews={mediaPreviews} autoplay={autoplayVideos} playlist={messages.flatMap(item => item.media?.kind === 'audio' ? [item.media] : [])}/>} {message.text && <div className="message-text">{message.text}</div>}</>}</>}
    <div className="message-meta">{message.editedAt && <span>изменено</span>}<time>{message.createdAt ? new Date(message.createdAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : 'отправка'}</time>{own && message.status !== 'error' && (message.status === 'sending' ? <Check size={14}/> : <CheckCheck size={14} className={Object.entries(readReceipts || {}).some(([person, at]) => person !== uid && at >= message.createdAt) ? 'read' : ''}/>)}</div>
    {message.status === 'error' && <button className="retry-btn" onClick={() => onRetry(message)}>Не отправлено · Повторить</button>}
    {!message.deleted && <button className="message-more" aria-label="Действия с сообщением" onClick={event => { const rect = event.currentTarget.getBoundingClientRect(); openMenu(rect.left, rect.bottom + 4); }}><MoreHorizontal size={18}/></button>}
    {Object.keys(reactionCount).length > 0 && <div className="reactions">{Object.entries(reactionCount).map(([emoji, count]) => <button className={myReaction === emoji ? 'selected' : ''} key={emoji} onClick={() => react(emoji)}>{emoji} {count}</button>)}</div>}
  </div></div>{menu && createPortal(<div ref={menuRef} className="message-menu message-menu-portal" style={{ left: menuPosition.x, top: menuPosition.y }}><div className="emoji-row">{['♥️', '🔥', '👏', '👍'].map(emoji => <button key={emoji} onClick={() => react(emoji)}>{emoji}</button>)}</div><button onClick={() => { onReply(message); setMenu(false); }}>Ответить</button><button onClick={() => { onForward(message); setMenu(false); }}>Переслать</button><button onClick={saveToTrail}>Сохранить в Тропу</button><button onClick={() => { navigator.clipboard.writeText(message.text).then(() => toast('Скопировано')); setMenu(false); }} disabled={!message.text}>Скопировать</button>{own && <button onClick={() => { onEdit(message); setMenu(false); }}>Изменить</button>}{role === 'owner' && <button onClick={togglePin}>{chat.pinnedMessageId === message.id ? 'Открепить сообщение' : 'Закрепить сообщение'}</button>}<button onClick={() => { setConfirmDelete(false); setMenu(false); }}>Удалить у себя</button>{canDelete && <button className="danger" onClick={() => { setConfirmDelete(true); setMenu(false); }}>Удалить у всех</button>}</div>, document.body)}{confirmDelete !== null && <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) setConfirmDelete(null); }}><section className="modal delete-confirm" role="dialog" aria-modal="true" aria-labelledby={`delete-title-${message.id}`}><h2 id={`delete-title-${message.id}`}>{confirmDelete ? 'Удалить у всех?' : 'Удалить у себя?'}</h2><p className="subtle">{confirmDelete ? 'Сообщение и его вложение будут удалены из чата для всех участников.' : 'Сообщение будет скрыто только в вашем аккаунте.'}</p><div className="settings-actions"><button className="secondary-btn" onClick={() => setConfirmDelete(null)}>Отмена</button><button className="primary-btn danger" onClick={() => { void remove(confirmDelete); setConfirmDelete(null); }}>Удалить</button></div></section></div>}</>;
}
const giftProducts = [
  { id: 'sunstone', name: 'Солнечный камень', price: 12, tone: 'sunstone', note: 'Тёплый отблеск долгого дня' },
  { id: 'acacia', name: 'Венок акации', price: 35, tone: 'acacia', note: 'Знак близости и заботы' },
  { id: 'horizon', name: 'Золотой горизонт', price: 65, tone: 'horizon', note: 'Память о ярком закате' },
  { id: 'baobab', name: 'Память баобаба', price: 110, tone: 'baobab', note: 'Редкий знак крепкой связи' },
];
function GiftMessage({ gift, own }: { gift: NonNullable<Message['gift']>; own: boolean }) {
  const product = giftProducts.find(item => item.id === gift.id) || giftProducts[0];
  return <article className={`savanna-gift gift-${product.tone} ${own ? 'gift-own' : ''}`}><div className="gift-art" aria-hidden="true"><span/><i/><b/></div><div className="gift-message-copy"><small>{own ? 'ВЫ ПОДАРИЛИ' : 'ВАМ ПОДАРОК'}</small><strong>{product.name}</strong><span>{product.note}</span></div></article>;
}
function ChatDetails({ chat, members, uid, prefs, onClose }: { chat: Chat; members: Record<string, Role>; uid: string; prefs: { pinned?: boolean; archived?: boolean; mutedUntil?: number; background?: string } | null; onClose: () => void }) {
  const { toast } = useToast(); const [addQuery, setAddQuery] = useState('');
  const [activeTab, setActiveTab] = useState<'info' | 'members' | 'roles' | 'access' | 'notifications' | 'appearance'>('info');
  const [wallet] = useFirebaseValue<{ subscription?: { tier?: string; expiresAt: number } }>(`economy/${uid}`);
  const tier = activeSubscriptionTier(wallet?.subscription);
  const [spaceTitle, setSpaceTitle] = useState(chat.title); const [spaceDescription, setSpaceDescription] = useState(chat.description || ''); const [spacePublic, setSpacePublic] = useState(Boolean(chat.public)); const [savingSpace, setSavingSpace] = useState(false);
  useEffect(() => { setSpaceTitle(chat.title); setSpaceDescription(chat.description || ''); setSpacePublic(Boolean(chat.public)); }, [chat.title, chat.description, chat.public]);
  async function add() { try { const person = await findUser(addQuery); if (!person) throw new Error('Пользователь не найден.'); await addMember(chat.id, uid, person.uid); setAddQuery(''); toast('Участник добавлен'); } catch (e) { toast((e as Error).message, 'error'); } }
async function copyInvite() { try { await navigator.clipboard.writeText(`${location.origin}${import.meta.env.BASE_URL}invite/${chat.id}/${chat.inviteCode}`); toast('Ссылка скопирована'); } catch { toast('Не удалось скопировать ссылку.', 'error'); } }
  async function saveSpace() {
    if (members[uid] !== 'owner' || !spaceTitle.trim()) return;
    setSavingSpace(true);
    try {
      const title = spaceTitle.trim().slice(0, 64); const description = spaceDescription.trim().slice(0, 280);
      await update(ref(requireDb(), `chats/${chat.id}`), { title, description, public: spacePublic });
      await set(ref(requireDb(), `publicSpaces/${chat.id}`), spacePublic ? { id: chat.id, kind: chat.kind, title, description } : null);
      toast('Настройки пространства сохранены');
    } catch (error) { toast((error as Error).message, 'error'); }
    finally { setSavingSpace(false); }
  }
  async function regenerateInvite() { try { await update(ref(requireDb(), `chats/${chat.id}`), { inviteCode: crypto.randomUUID().replace(/-/g, '').slice(0, 16) }); toast('Приглашение обновлено'); } catch (error) { toast((error as Error).message, 'error'); } }
  async function toggle(key: 'pinned' | 'archived') { await update(ref(requireDb(), `userChatPrefs/${uid}/${chat.id}`), { [key]: !prefs?.[key] }); }
  async function setMute(value: string) {
    const durations: Record<string, number> = { hour: 60 * 60 * 1000, eight: 8 * 60 * 60 * 1000, day: 24 * 60 * 60 * 1000 };
    const mutedUntil = value === 'forever' ? Number.MAX_SAFE_INTEGER : Date.now() + (durations[value] || 0);
    await update(ref(requireDb(), `userChatPrefs/${uid}/${chat.id}`), { mutedUntil: value === 'off' ? 0 : mutedUntil });
  }
  async function setBackground(value: string) {
    try { await update(ref(requireDb(), `userChatPrefs/${uid}/${chat.id}`), { background: value || null }); toast('Фон беседы обновлён'); }
    catch (error) { toast((error as Error).message || 'Не удалось сохранить фон', 'error'); }
  }
  const tabs = chat.kind === 'dm'
    ? [{ id: 'info', label: 'Информация' }, { id: 'notifications', label: 'Уведомления' }, { id: 'appearance', label: 'Оформление' }]
    : [{ id: 'info', label: 'Информация' }, { id: 'members', label: `Участники · ${Object.keys(members).length}` }, { id: 'roles', label: 'Роли и права' }, { id: 'access', label: 'Приглашения и доступ' }, { id: 'notifications', label: 'Уведомления' }, { id: 'appearance', label: 'Оформление' }];
  return <aside className="details-panel">
    <div className="details-head"><strong>Разделы пространства</strong><button className="icon-btn" onClick={onClose} aria-label="Закрыть"><X size={19}/></button></div>
    <div className="details-hero"><Avatar name={chat.title || 'Личный чат'} size={76}/><h2>{chat.kind === 'dm' ? 'Личный чат' : chat.title}</h2><p>{chat.description || (chat.kind === 'dm' ? 'Ваше личное пространство для разговора' : chat.kind === 'channel' ? 'Канал' : 'Группа')}</p></div>
    <nav className="details-tabs" aria-label="Настройки чата">{tabs.map(tab => <button key={tab.id} className={activeTab === tab.id ? 'active' : ''} onClick={() => setActiveTab(tab.id as typeof activeTab)}>{tab.label}</button>)}</nav>
    <div className="details-actions compact-details-actions"><button onClick={() => toggle('pinned')}><Pin size={17}/>{prefs?.pinned ? 'Открепить чат' : 'Закрепить чат'}</button><button onClick={() => toggle('archived')}><ArchiveIcon/>{prefs?.archived ? 'Вернуть из архива' : 'В архив'}</button></div>
    {activeTab === 'info' && <section className="details-section"><div className="details-section-title">Описание</div><p className="subtle">{chat.description || 'Добавьте описание, чтобы участникам было понятно назначение пространства.'}</p>{chat.kind !== 'dm' && members[uid] === 'owner' && <div className="space-settings"><label>Название<input value={spaceTitle} maxLength={64} onChange={e => setSpaceTitle(e.target.value)}/></label><label>Описание<textarea value={spaceDescription} maxLength={280} rows={3} onChange={e => setSpaceDescription(e.target.value)}/></label><button className="secondary-btn" onClick={saveSpace} disabled={savingSpace || !spaceTitle.trim()}>{savingSpace ? 'Сохранение…' : 'Сохранить информацию'}</button></div>}</section>}
    {activeTab === 'members' && chat.kind !== 'dm' && <section className="details-section"><div className="details-section-title">Состав · {Object.keys(members).length}</div><div className="member-list">{Object.entries(members).map(([personId, role]) => <MemberRow key={personId} personId={personId} role={role} owner={chat.creatorId === uid} chatId={chat.id} actorId={uid}/>)}</div>{(members[uid] === 'owner' || members[uid] === 'admin') && <div className="details-add"><label>Добавить участника<div className="search-line"><input value={addQuery} onChange={e => setAddQuery(e.target.value)} onKeyDown={e => e.key === 'Enter' && add()} placeholder="@username"/><button className="icon-btn" onClick={add} disabled={!addQuery.trim()} aria-label="Добавить участника"><PlusIcon/></button></div></label></div>}</section>}
    {activeTab === 'roles' && chat.kind !== 'dm' && <section className="details-section"><div className="details-section-title">Роли и ответственность</div><div className="role-card"><strong>Владелец</strong><span>Полный контроль над названием, доступом, участниками и настройками.</span><small>{Object.values(members).filter(role => role === 'owner').length} участник</small></div><div className="role-card"><strong>Администратор</strong><span>Помогает приглашать участников и поддерживать порядок.</span><small>{Object.values(members).filter(role => role === 'admin').length} участников</small></div><div className="role-card"><strong>Модератор</strong><span>Следит за беседой и управляет сообщениями.</span><small>{Object.values(members).filter(role => role === 'moderator').length} участников</small></div><div className="role-card"><strong>Участник</strong><span>Общается в группе или читает публикации канала.</span><small>{Object.values(members).filter(role => role === 'member').length} участников</small></div><p className="subtle">Создавайте роли с нужными разрешениями и назначайте их участникам ниже.</p><CustomRoleManager chatId={chat.id} uid={uid} members={members}/></section>}
    {activeTab === 'access' && chat.kind !== 'dm' && <section className="details-section"><div className="details-section-title">Приглашения и публичность</div><p className="subtle">{spacePublic ? 'Пространство показывается в публичном поиске.' : 'Пространство доступно только по приглашению.'}</p>{members[uid] === 'owner' && <><label className="check-line"><input type="checkbox" checked={spacePublic} onChange={e => setSpacePublic(e.target.checked)}/> Показывать в поиске общедоступных пространств</label><button className="secondary-btn full" onClick={saveSpace} disabled={savingSpace}>Сохранить доступ</button></>}<button className="secondary-btn full" onClick={copyInvite}><Copy size={17}/> Копировать ссылку приглашения</button>{members[uid] === 'owner' && <button className="secondary-btn full" onClick={regenerateInvite}><Copy size={17}/> Обновить ссылку приглашения</button>}</section>}
    {activeTab === 'notifications' && <section className="details-section"><div className="details-section-title">Уведомления</div><label className="chat-notification-setting"><Bell size={17}/> Уведомления в чате<select aria-label="Уведомления в чате" value={(prefs?.mutedUntil || 0) > Date.now() ? 'muted' : 'off'} onChange={e => setMute(e.target.value)}>{(prefs?.mutedUntil || 0) > Date.now() && <option value="muted">Выключены</option>}<option value="off">Включены</option><option value="hour">Без звука · 1 час</option><option value="eight">Без звука · 8 часов</option><option value="day">Без звука · 24 часа</option><option value="forever">Без звука · без срока</option></select></label><p className="subtle">Это настройка только для вашего аккаунта.</p></section>}
    {activeTab === 'appearance' && <section className="details-section"><div className="details-section-title">Оформление беседы</div><label className="chat-bg-setting">Фон только для меня<select value={prefs?.background || ''} onChange={e => setBackground(e.target.value)}><option value="">Как в настройках</option><option value="plain">Без фотографии</option><option value="day">Утреннее плато</option><option value="grass">Тёплая трава</option><option value="savanna">Закат в саванне</option><option value="evening">Золотой горизонт</option><option value="stars">Сумеречные огни</option><option value="night">Ночная тропа</option><option value="cheetah" disabled={!tier || !['cheetah','leopard','lion'].includes(tier)}>Клубный · Медный свет {!tier ? '· Cheetah' : ''}</option><option value="leopard" disabled={!tier || !['leopard','lion'].includes(tier)}>Клубный · Гребень дюн · Leopard</option><option value="lion" disabled={tier !== 'lion'}>Клубный · Золотой горизонт · Lion</option></select></label><p className="subtle">Выбор применяется только к этой беседе на ваших устройствах. Клубные фоны требуют Pride Club.</p>{chat.kind !== 'dm' && members[uid] === 'owner' && <div className="space-settings"><div className="details-section-title">Параметры пространства</div><label className="check-line"><input type="checkbox" checked={spacePublic} onChange={e => setSpacePublic(e.target.checked)}/> Публичное пространство</label><button className="secondary-btn" onClick={saveSpace} disabled={savingSpace}>Сохранить видимость</button></div>}</section>}
  </aside>;
}
const ROLE_PERMISSIONS: Array<{ id: RolePermission; label: string }> = [
  { id: 'edit_space', label: 'Изменять описание и доступ' }, { id: 'invite_members', label: 'Приглашать участников' },
  { id: 'remove_members', label: 'Управлять участниками' }, { id: 'manage_messages', label: 'Удалять сообщения' },
  { id: 'pin_messages', label: 'Закреплять сообщения' }, { id: 'publish_channel', label: 'Публиковать в канале' },
  { id: 'send_announcement', label: 'Отправлять объявления' }, { id: 'manage_invites', label: 'Обновлять приглашения' },
  { id: 'manage_roles', label: 'Управлять ролями' },
];
function CustomRoleManager({ chatId, uid, members }: { chatId: string; uid: string; members: Record<string, Role> }) {
  const { toast } = useToast();
  const [roles] = useFirebaseValue<Record<string, CustomRole>>(`chatRoles/${chatId}`);
  const [assignments] = useFirebaseValue<Record<string, string>>(`roleAssignments/${chatId}`);
  const [name, setName] = useState('');
  const [color, setColor] = useState('#e89b55');
  const [permissions, setPermissions] = useState<Partial<Record<RolePermission, boolean>>>({});
  const owner = members[uid] === 'owner';
  async function saveRole() {
    const cleanName = name.trim().slice(0, 32);
    if (!owner || cleanName.length < 2) return;
    const id = `role_${crypto.randomUUID().replace(/-/g, '').slice(0, 18)}`;
    try {
      const completePermissions = Object.fromEntries(ROLE_PERMISSIONS.map(permission => [permission.id, permissions[permission.id] === true]));
      await set(ref(requireDb(), `chatRoles/${chatId}/${id}`), { id, name: cleanName, color, priority: Math.min(99, Object.keys(roles || {}).length + 1), permissions: completePermissions });
      setName(''); setPermissions({}); toast('Роль создана');
    } catch (error) { toast((error as Error).message, 'error'); }
  }
  async function assign(personId: string, roleId: string) {
    try { await set(ref(requireDb(), `roleAssignments/${chatId}/${personId}`), roleId || null); toast(roleId ? 'Роль назначена' : 'Дополнительная роль снята'); }
    catch (error) { toast((error as Error).message, 'error'); }
  }
  return <div className="custom-roles"><h3>Собственные роли</h3>{Object.entries(roles || {}).map(([roleId, role]) => <article className="role-card custom-role" key={roleId} style={{ borderLeftColor: role.color }}><strong>{role.name}</strong><span>{ROLE_PERMISSIONS.filter(permission => role.permissions?.[permission.id]).map(permission => permission.label).join(' · ') || 'Без дополнительных разрешений'}</span><small>Участников с ролью: {Object.values(assignments || {}).filter(value => value === roleId).length}</small></article>)}{!Object.keys(roles || {}).length && <p className="subtle">Пользовательские роли ещё не созданы.</p>}{owner && <div className="role-builder"><label>Название роли<input value={name} maxLength={32} onChange={event => setName(event.target.value)} placeholder="Например, Редактор"/></label><label className="role-color-label">Цвет роли<input type="color" value={color} onChange={event => setColor(event.target.value)}/></label><div className="role-permissions">{ROLE_PERMISSIONS.map(permission => <label className="check-line" key={permission.id}><input type="checkbox" checked={permissions[permission.id] === true} onChange={event => setPermissions(current => ({ ...current, [permission.id]: event.target.checked }))}/>{permission.label}</label>)}</div><button className="secondary-btn full" disabled={name.trim().length < 2} onClick={() => void saveRole()}>Создать роль</button>{Object.keys(roles || {}).length > 0 && <div className="role-assignments"><h3>Назначить участникам</h3>{Object.entries(members).filter(([personId, role]) => personId !== uid && role !== 'owner').map(([personId]) => <RoleAssignment key={personId} personId={personId} value={assignments?.[personId] || ''} roles={roles || {}} onChange={value => void assign(personId, value)}/>)}</div>}</div>}</div>;
}
function RoleAssignment({ personId, value, roles, onChange }: { personId: string; value: string; roles: Record<string, CustomRole>; onChange: (value: string) => void }) {
  const [person] = useFirebaseValue<Profile>(`users/${personId}`);
  return <label className="role-assignment"><span>{person?.displayName || person?.username || 'Участник'}</span><select value={value} onChange={event => onChange(event.target.value)}><option value="">Без роли</option>{Object.entries(roles).map(([id, role]) => <option key={id} value={id}>{role.name}</option>)}</select></label>;
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
  const { user, profile } = useAuth(); const navigate = useNavigate(); const { toast } = useToast();
  const [settings] = useFirebaseValue<{ messages?: { enterToSend?: boolean; mediaPreviews?: boolean; autoplayVideos?: boolean; chatBackground?: string }; privacy?: { typingIndicator?: boolean } }>(user ? `userSettings/${user.uid}` : null);
  const [wallet] = useFirebaseValue<{ balance?: number; subscription?: { tier?: string; expiresAt: number } }>(user ? `economy/${user.uid}` : null);
  const [chatPrefs] = useFirebaseValue<{ background?: string }>(user ? `userChatPrefs/${user.uid}/${id}` : null);
  const [chat, loading] = useFirebaseValue<Chat>(`chats/${id}`);
  const [members] = useFirebaseValue<Record<string, Role>>(`chatMembers/${id}`);
  const [typing] = useFirebaseValue<Record<string, number>>(`typing/${id}`);
  const [hidden] = useFirebaseValue<Record<string, boolean>>(user ? `hiddenMessages/${user.uid}/${id}` : null);
  const [draft] = useFirebaseValue<string>(user ? `drafts/${user.uid}/${id}` : null);
  const [text, setText] = useState(''); const [file, setFile] = useState<File | null>(null);
  const [reply, setReply] = useState<Message | null>(null); const [editing, setEditing] = useState<Message | null>(null);
  const [forwarding, setForwarding] = useState<Message | null>(null);
  const [busy, setBusy] = useState(false); const [progress, setProgress] = useState(0);
  const [recording, setRecording] = useState(false); const [recordSeconds, setRecordSeconds] = useState(0); const [videoNote, setVideoNote] = useState(false);
  const recorder = useRef<MediaRecorder | null>(null); const stream = useRef<MediaStream | null>(null); const discardRecording = useRef(false);
  const videoRecording = useRef(false); const recordingLimit = useRef<number | undefined>(undefined);
  const [showDetails, setShowDetails] = useState(false); const [showSearch, setShowSearch] = useState(false); const [search, setSearch] = useState('');
  const [startCall, setStartCall] = useState<boolean | null>(null);
  const [showGifts, setShowGifts] = useState(false); const [giftBusy, setGiftBusy] = useState(false);
  const pendingGiftId = useRef<{ productId: string; instanceId: string } | null>(null);
  const [count, setCount] = useState(80); const [pending, setPending] = useState<Message[]>([]);
  const messages = useMessages(id, count); const bottom = useRef<HTMLDivElement>(null); const fileInput = useRef<HTMLInputElement>(null); const composerInput = useRef<HTMLTextAreaElement>(null);
  const otherId = chat?.kind === 'dm' ? Object.keys(members || {}).find(key => key !== user?.uid) : null;
  const [other] = useFirebaseValue<Profile>(otherId ? `users/${otherId}` : null);
  const [presence] = useFirebaseValue<{ online: boolean; lastSeen: number }>(otherId ? `presence/${otherId}` : null);
  const [allChats] = useFirebaseValue<Record<string, boolean>>(user ? `userChats/${user.uid}` : null);
  const uploadLimitMb = maxUploadMegabytes(activeSubscriptionTier(wallet?.subscription));
  const visible = useMemo(() => [...messages, ...pending.filter(p => !messages.some(m => m.id === p.id))].filter(m => !hidden?.[m.id] && (!search || messagePreview(m).toLowerCase().includes(search.toLowerCase()))), [messages, pending, hidden, search]);
  const canWrite = chat && (chat.kind !== 'channel' || ['owner', 'admin'].includes(members?.[user?.uid || ''] || ''));
  useEffect(() => { setText(draft || ''); }, [id, draft]);
  useEffect(() => { bottom.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages.length, pending.length, id]);
  useEffect(() => { if (user && messages.length) markRead(id, user.uid).catch(() => {}); }, [id, user, messages.length]);
  useEffect(() => { if (!user) return; const timer = window.setTimeout(() => set(ref(requireDb(), `drafts/${user.uid}/${id}`), text.trim() || null).catch(() => {}), 500); return () => window.clearTimeout(timer); }, [id, text, user]);
  useEffect(() => { if (!user || !text.trim()) return; const timer = window.setTimeout(() => setTyping(id, user.uid, false).catch(() => {}), 2500); return () => window.clearTimeout(timer); }, [id, text, user]);
  useEffect(() => { if (!recording) return; const timer = window.setInterval(() => setRecordSeconds(value => value + 1), 1000); return () => window.clearInterval(timer); }, [recording]);
  useEffect(() => () => { window.clearTimeout(recordingLimit.current); if (recorder.current?.state === 'recording') recorder.current.stop(); stream.current?.getTracks().forEach(track => track.stop()); }, []);
  function updateText(value: string) { setText(value); if (user) setTyping(id, user.uid, Boolean(value.trim()), settings?.privacy?.typingIndicator !== false).catch(() => {}); }
  async function startRecording() {
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) { toast('Этот браузер не поддерживает запись голоса.', 'error'); return; }
    try {
      videoRecording.current = false;
      stream.current = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'].find(type => MediaRecorder.isTypeSupported(type));
      const active = new MediaRecorder(stream.current, mime ? { mimeType: mime } : undefined);
      recorder.current = active; discardRecording.current = false; setRecordSeconds(0);
      const chunks: BlobPart[] = [];
      active.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      active.onstop = () => {
        stream.current?.getTracks().forEach(track => track.stop()); stream.current = null; setRecording(false);
        if (discardRecording.current || !chunks.length) return;
        const type = active.mimeType || (videoRecording.current ? 'video/webm' : 'audio/webm');
        const extension = type.includes('mp4') ? (videoRecording.current ? 'mp4' : 'm4a') : 'webm';
        setFile(new globalThis.File(chunks, `${videoRecording.current ? 'Видеокружок' : 'Голосовое'}-${new Date().toISOString().slice(0, 19)}.${extension}`, { type }));
        setVideoNote(videoRecording.current);
      };
      active.start(); setRecording(true);
    } catch { toast('Доступ к микрофону не получен.', 'error'); }
  }
  async function startVideoNote() {
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) { toast('Этот браузер не поддерживает запись видео.', 'error'); return; }
    try {
      videoRecording.current = true;
      stream.current = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 480 }, height: { ideal: 480 } }, audio: true });
      const mime = ['video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'].find(type => MediaRecorder.isTypeSupported(type));
      const active = new MediaRecorder(stream.current, mime ? { mimeType: mime, videoBitsPerSecond: 650000 } : { videoBitsPerSecond: 650000 });
      recorder.current = active; discardRecording.current = false; setVideoNote(false); setFile(null); setRecordSeconds(0);
      const chunks: BlobPart[] = [];
      active.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      active.onstop = () => {
        stream.current?.getTracks().forEach(track => track.stop()); stream.current = null; setRecording(false);
        if (discardRecording.current || !chunks.length) return;
        const type = active.mimeType || 'video/webm';
        setFile(new globalThis.File(chunks, `Видеокружок-${new Date().toISOString().slice(0, 19)}.${type.includes('mp4') ? 'mp4' : 'webm'}`, { type }));
        setVideoNote(true);
      };
      active.start(500); setRecording(true);
      recordingLimit.current = window.setTimeout(() => { if (active.state === 'recording') active.stop(); }, 60000);
    } catch { videoRecording.current = false; stream.current?.getTracks().forEach(track => track.stop()); stream.current = null; toast('Разрешите доступ к камере и микрофону.', 'error'); }
  }
  function stopRecording(discard = false) { window.clearTimeout(recordingLimit.current); discardRecording.current = discard; if (recorder.current?.state === 'recording') recorder.current.stop(); }
  async function send(overrides?: { content: string; upload: File | null; replyId?: string; id?: string }) {
    if (!user || !chat || !canWrite || (!(overrides?.content ?? text).trim() && !(overrides?.upload ?? file))) return;
    setBusy(true); const content = overrides?.content ?? text; const upload = overrides?.upload ?? file; const replyId = overrides?.replyId ?? reply?.id;
    setText(''); setFile(null); setReply(null); setProgress(0);
    const messageId = overrides?.id || push(ref(requireDb(), `messages/${id}`)).key!;
    const optimistic: Message = { id: messageId, chatId: id, senderId: user.uid, text: content.trim(), createdAt: Date.now(), replyTo: replyId, status: 'sending' };
    setPending(old => [...old.filter(p => p.id !== messageId), optimistic]);
    try {
      let media: Media | undefined;
      if (upload) media = await uploadChatMedia(id, user.uid, upload, setProgress, videoNote && upload === file);
      await sendMessage(id, user.uid, content, media, replyId, undefined, messageId);
      await set(ref(requireDb(), `drafts/${user.uid}/${id}`), null);
      await setTyping(id, user.uid, false, settings?.privacy?.typingIndicator !== false);
      setPending(old => old.filter(p => p.id !== messageId)); setVideoNote(false);
    } catch (error) { setPending(old => old.map(p => p.id === messageId ? { ...p, status: 'error' } : p)); toast((error as Error).message, 'error'); setText(content); setFile(upload); }
    finally { setBusy(false); }
  }
  function retry(message: Message) { void send({ content: message.text, upload: file, replyId: message.replyTo, id: message.id }); }
  async function saveEdit() { if (!editing) return; try { await editMessage(id, editing.id, text); setEditing(null); setText(''); } catch (error) { toast((error as Error).message, 'error'); } }
  async function handleForward(targetId: string) { if (!forwarding || !user) return; try { const media = forwarding.media ? await forwardChatMedia(id, forwarding.id, targetId) : undefined; await sendMessage(targetId, user.uid, forwarding.text, media, undefined, `${id}:${forwarding.id}`); setForwarding(null); toast('Сообщение переслано'); } catch (e) { toast((e as Error).message, 'error'); } }
  async function sendGift(product: typeof giftProducts[number]) { if (!user) return; if (pendingGiftId.current?.productId !== product.id) pendingGiftId.current = { productId: product.id, instanceId: crypto.randomUUID() }; setGiftBusy(true); try { await sendSavannaGift(id, product.id, pendingGiftId.current.instanceId); pendingGiftId.current = null; setShowGifts(false); toast(`${product.name} отправлен`); } catch (error) { toast((error as Error).message, 'error'); } finally { setGiftBusy(false); } }
  function keyDown(e: KeyboardEvent<HTMLTextAreaElement>) { if (settings?.messages?.enterToSend !== false && e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); editing ? saveEdit() : send(); } }
  function resizeComposer(element: HTMLTextAreaElement) { element.style.height = 'auto'; element.style.height = `${Math.min(element.scrollHeight, window.matchMedia('(max-width: 760px)').matches ? 108 : 144)}px`; }
  useEffect(() => { if (composerInput.current) resizeComposer(composerInput.current); }, [text]);
  function pickFile(e: ChangeEvent<HTMLInputElement>) { const selected = e.target.files?.[0] || null; if (selected && selected.size > uploadLimitMb * 1024 * 1024) { toast(`Лимит вашего тарифа — ${uploadLimitMb} МБ. Подписки Pride Club открывают больше места.`, 'error'); e.target.value = ''; return; } setFile(selected); setVideoNote(false); e.target.value = ''; }
  if (loading) return <div className="panel-loading">Открываем разговор…</div>;
  if (!chat || !members?.[user?.uid || '']) return <div className="panel-loading">Чат недоступен. <Link to="/chats">К списку чатов</Link></div>;
  const title = chat.kind === 'dm' ? other?.displayName || 'Личный чат' : chat.title;
  const typingOthers = Object.entries(typing || {}).some(([uid, timestamp]) => uid !== user?.uid && Date.now() - timestamp < 6000);
  const background = chatPrefs?.background || settings?.messages?.chatBackground || 'savanna';
  return <div className="conversation" data-chat-background={background}>{chat.kind === 'dm' && otherId && <CallOverlay chatId={id} uid={user!.uid} myName={profile?.displayName || 'Участник Pride'} otherId={otherId} otherName={other?.displayName || 'Контакт'} startVideo={startCall} onClose={() => setStartCall(null)}/>}<header className="conversation-head"><button className="icon-btn mobile-back" onClick={() => navigate('/chats')} aria-label="Назад"><ArrowLeft/></button><Avatar profile={other} name={title} size={42}/><div className="conversation-title"><strong>{title}</strong><span>{typingOthers ? 'печатает…' : chat.kind === 'dm' ? presence?.online ? 'в сети' : presence?.lastSeen ? `был(а) ${new Date(presence.lastSeen).toLocaleString('ru-RU')}` : `@${other?.username || ''}` : `${Object.keys(members).length} участн.`}</span></div>{chat.kind === 'dm' && <><button className="icon-btn" onClick={() => setStartCall(false)} title="Позвонить" aria-label="Позвонить"><Phone size={19}/></button><button className="icon-btn" onClick={() => setStartCall(true)} title="Видеозвонок" aria-label="Видеозвонок"><Video size={20}/></button></>}<button className="icon-btn" onClick={() => setShowSearch(!showSearch)} title="Поиск по сообщениям"><Search size={20}/></button><button className="icon-btn" onClick={() => setShowDetails(!showDetails)} title="Информация"><Info size={20}/></button></header>
    {chat.pinnedMessageId && <button className="pinned-banner" onClick={() => document.getElementById(`m-${chat.pinnedMessageId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })}><Pin size={16}/> Закреплено: {messagePreview(messages.find(m => m.id === chat.pinnedMessageId) || { text: 'Сообщение', id: '', chatId: id, senderId: '', createdAt: 0 })}</button>}
    {showSearch && <div className="chat-search"><Search size={17}/><input autoFocus placeholder="Поиск в этом чате" value={search} onChange={e => setSearch(e.target.value)}/><button className="icon-btn" onClick={() => { setShowSearch(false); setSearch(''); }}><X size={17}/></button></div>}
    <div className="message-scroll"><div className="message-stack">{messages.length >= count && <button className="load-older" onClick={() => setCount(count + 80)}>Загрузить более ранние</button>}{visible.length ? visible.map(message => <MessageItem key={message.id} message={message} own={message.senderId === user?.uid} chat={chat} uid={user!.uid} role={members[user!.uid]} messages={messages} mediaPreviews={settings?.messages?.mediaPreviews !== false} autoplayVideos={settings?.messages?.autoplayVideos === true} onReply={setReply} onForward={setForwarding} onEdit={m => { setEditing(m); setText(m.text); }} onRetry={retry}/>) : <div className="no-messages"><MessageBubbleIcon/><strong>{search ? 'Ничего не найдено' : 'Начните этот разговор'}</strong><span>{search ? 'Попробуйте другой запрос' : 'Первое сообщение иногда меняет всё.'}</span></div>}<div ref={bottom}/></div></div>
    {canWrite ? <div className="composer-wrap">{recording && <div className="recording-bar"><span className="recording-pulse"/>{videoRecording.current ? 'Видеокружок' : 'Голосовое'} · {Math.floor(recordSeconds / 60)}:{String(recordSeconds % 60).padStart(2, '0')}<button onClick={() => stopRecording(true)}>Отменить</button><button onClick={() => stopRecording(false)}><Square size={14}/> Завершить</button></div>}{(reply || editing || file) && <div className="composer-context"><span>{editing ? `Изменение: ${editing.text}` : reply ? `Ответ: ${messagePreview(reply)}` : file ? `${videoNote ? 'Видеокружок' : 'Файл'}: ${file.name}` : ''}</span><button onClick={() => { setReply(null); setEditing(null); setFile(null); setVideoNote(false); setText(''); }} aria-label="Отменить"><X size={16}/></button></div>}{progress > 0 && progress < 100 && <div className="upload-progress" style={{ width: `${progress}%` }}/>}<div className="composer"><input ref={fileInput} type="file" hidden onChange={pickFile} accept="image/*,video/*,audio/*,.pdf,.txt,.doc,.docx,.zip"/><button className="icon-btn" title={`Прикрепить файл · до ${uploadLimitMb} МБ`} onClick={() => fileInput.current?.click()}><Paperclip size={20}/></button>{chat.kind === 'dm' && <button className="icon-btn gift-composer-btn" onClick={() => setShowGifts(true)} title="Подарить саванный сувенир" aria-label="Подарить"><Gift size={19}/></button>}<textarea ref={composerInput} rows={1} value={text} onChange={e => { updateText(e.target.value); resizeComposer(e.currentTarget); }} onKeyDown={keyDown} placeholder="Напишите сообщение…" aria-label="Сообщение"/><button className="icon-btn" onClick={startVideoNote} disabled={recording || busy} aria-label="Записать видеокружок до минуты" title="Видеокружок · до 1 минуты"><Circle size={20}/></button><button className="icon-btn" onClick={startRecording} disabled={recording || busy} aria-label="Записать голосовое сообщение" title="Записать голос"><Mic size={20}/></button><button className="send-btn" onClick={editing ? saveEdit : () => void send()} disabled={busy || recording || (!text.trim() && !file)} aria-label={editing ? 'Сохранить' : 'Отправить'}><Send size={19}/></button></div><div className="composer-hint">{settings?.messages?.enterToSend === false ? `Enter — новая строка · файл до ${uploadLimitMb} МБ` : `Enter — отправить · Shift + Enter — новая строка · файл до ${uploadLimitMb} МБ`}</div></div> : <div className="read-only">Только администраторы публикуют в канале.</div>}
    {showDetails && <ChatDetails chat={chat} members={members} uid={user!.uid} prefs={chatPrefs || null} onClose={() => setShowDetails(false)}/>}
    {forwarding && <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) setForwarding(null); }}><div className="modal"><div className="modal-head"><h2>Переслать в чат</h2><button className="icon-btn" onClick={() => setForwarding(null)}><X/></button></div><div className="forward-list">{Object.keys(allChats || {}).filter(chatId => chatId !== id).map(chatId => <ForwardRow key={chatId} id={chatId} onClick={() => handleForward(chatId)}/>)}</div>{Object.keys(allChats || {}).length <= 1 && <p className="subtle">Пока нет другого чата для пересылки.</p>}</div></div>}
    {showGifts && <div className="modal-backdrop gift-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setShowGifts(false); }}><section className="modal gift-picker" role="dialog" aria-modal="true" aria-labelledby="gift-title"><div className="modal-head"><div><span className="eyebrow">МАЛЕНЬКИЙ ЗНАК ВНИМАНИЯ</span><h2 id="gift-title">Подарки саванны</h2></div><button className="icon-btn" onClick={() => setShowGifts(false)} aria-label="Закрыть"><X/></button></div><p className="subtle">Подарок появится прямо в переписке и во вкладке подарков профиля. Баланс: {wallet?.balance ?? 0} Claws.</p><div className="gift-picker-grid">{giftProducts.map(product => <article className={`gift-option gift-${product.tone}`} key={product.id}><div className="gift-art" aria-hidden="true"><span/><i/><b/></div><strong>{product.name}</strong><span>{product.note}</span><button className="primary-btn" disabled={giftBusy || (wallet?.balance || 0) < product.price} onClick={() => void sendGift(product)}>{product.price} Claws · Подарить</button></article>)}</div><small className="subtle gift-sale-note">Получатель может выставить подарок в профиле или продать за 50% стоимости.</small></section></div>}
  </div>;
}
function MessageBubbleIcon() { return <div className="empty-bubble"><Smile size={30}/></div>; }
function ForwardRow({ id, onClick }: { id: string; onClick: () => void }) { const [chat] = useFirebaseValue<Chat>(`chats/${id}`); return chat ? <button className="forward-row" onClick={onClick}><Avatar name={chat.title || 'Личный чат'} size={38}/>{chat.title || 'Личный чат'}</button> : null; }

