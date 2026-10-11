import { useEffect, useMemo, useState } from 'react';
import { Archive, ArrowLeft, Bookmark, Compass, MessageCircle, Plus, Search, Settings, UserRound, Users, X } from 'lucide-react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { get, ref } from 'firebase/database';
import { useAuth } from '../context/AuthContext';
import { useFirebaseValue } from '../hooks/useFirebaseValue';
import { Avatar } from '../components/Avatar';
import { useToast } from '../components/Toast';
import { findUser } from '../services/auth';
import { createSpace, joinByInvite, joinPublicSpace, startDirectChat } from '../services/chats';
import { requireDb } from '../services/firebase';
import type { Chat, Profile } from '../types';
import { ChatPanel } from './chat/ChatPanel';

function ChatRow({ id, selected }: { id: string; selected: boolean }) {
  const { user } = useAuth();
  const [chat] = useFirebaseValue<Chat>(`chats/${id}`);
  const [members] = useFirebaseValue<Record<string, string>>(`chatMembers/${id}`);
  const [activity] = useFirebaseValue<{ updatedAt: number; lastText: string; lastSenderId: string }>(`chatActivity/${id}`);
  const [readAt] = useFirebaseValue<number>(user ? `readReceipts/${id}/${user.uid}` : null);
  const [prefs] = useFirebaseValue<{ pinned?: boolean; archived?: boolean }>(`userChatPrefs/${user?.uid}/${id}`);
  const otherUid = chat?.kind === 'dm' ? Object.keys(members || {}).find(key => key !== user?.uid) : null;
  const [other] = useFirebaseValue<Profile>(otherUid ? `users/${otherUid}` : null);
  const title = chat?.kind === 'dm' ? other?.displayName || 'Личный чат' : chat?.title || 'Загрузка…';
  if (!chat) return null;
  return <Link className={`chat-row ${selected ? 'selected' : ''}`} to={`/chat/${id}`}>
    <Avatar profile={other} name={chat.kind === 'dm' ? title : chat.title} size={48}/>
    <span className="chat-row-text"><span className="chat-row-title">{title}{prefs?.pinned && <span className="pin-dot">◆</span>}</span><span className="chat-row-preview">{activity?.lastText || (chat.kind === 'channel' ? 'Канал' : chat.kind === 'group' ? 'Группа' : 'Начните разговор')}</span></span>
    <span className="chat-row-end">{activity?.updatedAt && <time>{new Date(activity.updatedAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</time>}{activity?.lastSenderId !== user?.uid && activity?.updatedAt && activity.updatedAt > (readAt || 0) && <span className="unread-dot" aria-label="Есть непрочитанные сообщения"/>}</span>
  </Link>;
}

function SearchDialog({ onClose, query, onQueryChange }: { onClose: () => void; query: string; onQueryChange: (value: string) => void }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [section, setSection] = useState<'all' | 'people' | 'spaces'>('all');
  const [people, setPeople] = useState<Profile[]>([]);
  const [spaces, setSpaces] = useState<Array<{ id: string; title: string; kind: 'group' | 'channel'; description?: string }>>([]);
  const [busy, setBusy] = useState(false);
  const [joining, setJoining] = useState<string | null>(null);
  useEffect(() => {
    const term = query.trim().replace(/^@/, '').toLocaleLowerCase('ru');
    if (term.length < 2) { setPeople([]); setSpaces([]); setBusy(false); return; }
    let active = true;
    const timer = window.setTimeout(async () => {
      setBusy(true);
      try {
        const [peopleSnapshot, spacesSnapshot] = await Promise.all([
          get(ref(requireDb(), 'users')),
          get(ref(requireDb(), 'publicSpaces')),
        ]);
        if (!active) return;
        const matches = (Object.values(peopleSnapshot.val() || {}) as Profile[])
          .filter(person => person.uid !== user?.uid && `${person.displayName} ${person.username}`.toLocaleLowerCase('ru').includes(term))
          .slice(0, 30);
        const publicMatches = (Object.values(spacesSnapshot.val() || {}) as Array<{ id: string; title: string; kind: 'group' | 'channel'; description?: string }>)
          .filter(space => `${space.title} ${space.description || ''}`.toLocaleLowerCase('ru').includes(term))
          .slice(0, 30);
        setPeople(matches); setSpaces(publicMatches);
      } catch (error) { if (active) toast((error as Error).message, 'error'); }
      finally { if (active) setBusy(false); }
    }, 220);
    return () => { active = false; window.clearTimeout(timer); };
  }, [query, user?.uid, toast]);
  async function start(person: Profile) {
    if (!user) return;
    try { const id = await startDirectChat(user.uid, person); onClose(); navigate(`/chat/${id}`); }
    catch (error) { toast((error as Error).message, 'error'); }
  }
  async function join(space: { id: string; title: string }) {
    setJoining(space.id);
    try { await joinPublicSpace(space.id); onClose(); navigate(`/chat/${space.id}`); }
    catch (error) { toast((error as Error).message, 'error'); }
    finally { setJoining(null); }
  }
  const visiblePeople = section !== 'spaces'; const visibleSpaces = section !== 'people';
  return <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}><div className="modal directory-modal"><div className="modal-head"><div><span className="eyebrow">ОТКРЫТАЯ САВАННА</span><h2>Найти в Pride</h2></div><button className="icon-btn" onClick={onClose} aria-label="Закрыть"><X/></button></div><p className="subtle">Ищите людей по имени или @username, а также общедоступные группы и каналы.</p><div className="search-line"><Search size={17}/><input autoFocus value={query} onChange={e => onQueryChange(e.target.value)} placeholder="Имя, @username или название"/></div><div className="directory-tabs"><button className={section === 'all' ? 'active' : ''} onClick={() => setSection('all')}>Всё</button><button className={section === 'people' ? 'active' : ''} onClick={() => setSection('people')}>Люди</button><button className={section === 'spaces' ? 'active' : ''} onClick={() => setSection('spaces')}>Группы и каналы</button></div>{busy && <div className="empty-mini">Ищем…</div>}{query.trim().replace(/^@/, '').length < 2 && <div className="empty-mini">Введите хотя бы 2 символа для поиска.</div>}{visiblePeople && people.length > 0 && <section className="directory-results"><h3>Люди</h3>{people.map(person => <div className="found-user" key={person.uid}><Avatar profile={person} size={44}/><div><strong>{person.displayName}</strong><span>@{person.username}</span></div><Link className="secondary-btn" to={`/profile/${person.uid}`} onClick={onClose}>Профиль</Link><button className="secondary-btn" onClick={() => void start(person)}>Написать</button></div>)}</section>}{visibleSpaces && spaces.length > 0 && <section className="directory-results"><h3>Публичные группы и каналы</h3>{spaces.map(space => <div className="space-row" key={space.id}><Avatar name={space.title} size={42}/><span><strong>{space.title}</strong><small>{space.kind === 'channel' ? 'Канал' : 'Группа'} · {space.description || 'Публичное пространство'}</small></span><button className="secondary-btn" disabled={joining === space.id} onClick={() => void join(space)}>{joining === space.id ? 'Открываем…' : 'Открыть'}</button></div>)}</section>}{!busy && query.trim().replace(/^@/, '').length >= 2 && !people.length && !spaces.length && <div className="empty-mini">Совпадений не найдено. Попробуйте другое имя или название.</div>}</div></div>;
}

function CreateDialog({ onClose }: { onClose: () => void }) {
  const { user } = useAuth(); const navigate = useNavigate(); const { toast } = useToast();
  const [kind, setKind] = useState<'group' | 'channel'>('group');
  const [title, setTitle] = useState(''); const [description, setDescription] = useState('');
  const [isPublic, setPublic] = useState(false); const [username, setUsername] = useState('');
  const [people, setPeople] = useState<Profile[]>([]); const [busy, setBusy] = useState(false);
  async function add() {
    try { const person = await findUser(username); if (!person || person.uid === user?.uid) throw new Error('Пользователь не найден.'); if (!people.some(p => p.uid === person.uid)) setPeople([...people, person]); setUsername(''); }
    catch (error) { toast((error as Error).message, 'error'); }
  }
  async function create() {
    if (!user) return; setBusy(true);
    try { const id = await createSpace(user.uid, kind, title, description, isPublic, people); onClose(); navigate(`/chat/${id}`); toast(kind === 'group' ? 'Группа создана' : 'Канал создан'); }
    catch (error) { toast((error as Error).message, 'error'); }
    finally { setBusy(false); }
  }
  return <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}><div className="modal"><div className="modal-head"><div><span className="eyebrow">СОБЕРИТЕ СВОИХ</span><h2>Новое пространство</h2></div><button className="icon-btn" onClick={onClose} aria-label="Закрыть"><X/></button></div><div className="segmented"><button className={kind === 'group' ? 'active' : ''} onClick={() => setKind('group')}><Users size={16}/> Группа</button><button className={kind === 'channel' ? 'active' : ''} onClick={() => setKind('channel')}><Compass size={16}/> Канал</button></div><label>Название<input value={title} maxLength={64} onChange={e => setTitle(e.target.value)} placeholder={kind === 'group' ? 'Например, Наш прайд' : 'Например, Полевые заметки'}/></label><label>Описание<textarea value={description} maxLength={280} onChange={e => setDescription(e.target.value)} placeholder="О чём это пространство?" rows={3}/></label><label className="check-line"><input type="checkbox" checked={isPublic} onChange={e => setPublic(e.target.checked)}/> Публичное пространство</label><label>Участники <span className="muted">(по @username)</span><div className="search-line"><input value={username} onChange={e => setUsername(e.target.value)} onKeyDown={e => e.key === 'Enter' && add()} placeholder="@username"/><button className="secondary-btn" type="button" onClick={add} disabled={!username.trim()}>Добавить</button></div></label>{people.length > 0 && <div className="chips">{people.map(p => <button key={p.uid} onClick={() => setPeople(people.filter(x => x.uid !== p.uid))}>@{p.username} ×</button>)}</div>}<button className="primary-btn full" onClick={create} disabled={busy || !title.trim()}>{busy ? 'Создание…' : `Создать ${kind === 'group' ? 'группу' : 'канал'}`}</button></div></div>;
}

function ExploreDialog({ onClose }: { onClose: () => void }) {
  const [spaces] = useFirebaseValue<Record<string, { id: string; title: string; kind: 'group' | 'channel'; description: string }>>('publicSpaces');
  const [query, setQuery] = useState(''); const [busy, setBusy] = useState<string | null>(null);
  const navigate = useNavigate(); const { toast } = useToast();
  const found = Object.values(spaces || {}).filter(space => `${space.title} ${space.description}`.toLowerCase().includes(query.toLowerCase())).slice(0, 100);
  async function join(id: string) { setBusy(id); try { await joinPublicSpace(id); onClose(); navigate(`/chat/${id}`); } catch (e) { toast((e as Error).message, 'error'); } finally { setBusy(null); } }
  return <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}><div className="modal"><div className="modal-head"><div><span className="eyebrow">ОТКРЫТЫЕ ПРОСТРАНСТВА</span><h2>Исследовать</h2></div><button className="icon-btn" onClick={onClose} aria-label="Закрыть"><X/></button></div><div className="search-line"><input autoFocus value={query} onChange={e => setQuery(e.target.value)} placeholder="Название или тема"/></div><div className="space-list">{found.map(space => <div className="space-row" key={space.id}><Avatar name={space.title} size={40}/><span><strong>{space.title}</strong><small>{space.kind === 'channel' ? 'Канал' : 'Группа'} · {space.description || 'Без описания'}</small></span><button className="secondary-btn" disabled={busy === space.id} onClick={() => join(space.id)}>Открыть</button></div>)}{!found.length && <div className="empty-mini">Пока здесь тихо. Создайте первое публичное пространство.</div>}</div></div></div>;
}

export function MessengerPage() {
  const { id, inviteId, inviteCode } = useParams();
  const location = useLocation();
  const { user, profile } = useAuth(); const navigate = useNavigate(); const { toast } = useToast();
  const [list] = useFirebaseValue<Record<string, boolean>>(user ? `userChats/${user.uid}` : null);
  const [dialog, setDialog] = useState<'search' | 'create' | 'explore' | null>(null);
  const [filter, setFilter] = useState<'all' | 'groups' | 'channels' | 'archive'>('all');
  const [search, setSearch] = useState('');
  const [directoryQuery, setDirectoryQuery] = useState('');
  function openDirectory(value = directoryQuery) { setDirectoryQuery(value); setDialog('search'); }
  useEffect(() => { if (inviteId && inviteCode && user) joinByInvite(inviteId, inviteCode, user.uid).then(() => navigate(`/chat/${inviteId}`, { replace: true })).catch(error => toast(error.message, 'error')); }, [inviteId, inviteCode, user, navigate, toast]);
  const ids = useMemo(() => Object.keys(list || {}).reverse(), [list]);
  return <div className={`app-shell ${id ? 'mobile-chat-open' : ''}`}>
    <aside className="sidebar"><div className="sidebar-top"><div className="brand sidebar-brand"><span className="brand-mark">P</span><span>Pride<span className="brand-muted"> Messenger</span></span></div><div className="sidebar-heading"><div><span className="eyebrow">ВАШЕ ПРОСТРАНСТВО</span><h1>Сообщения</h1></div><button className="create-btn" title="Создать" aria-label="Создать группу или канал" onClick={() => setDialog('create')}><Plus size={22}/></button></div><div className="sidebar-searches"><label className="sidebar-search"><Search size={16}/><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Поиск в списке чатов" aria-label="Поиск в списке чатов"/></label><label className="sidebar-search directory-search" title="Поиск людей, групп и каналов"><UserRound size={16}/><input value={directoryQuery} onChange={e => setDirectoryQuery(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') openDirectory(); }} placeholder="Люди, группы, каналы" aria-label="Поиск людей, групп и каналов"/><button type="button" onClick={() => openDirectory()} aria-label="Искать людей, группы и каналы"><Search size={15}/></button></label></div><div className="filter-row"><button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>Все</button><button className={filter === 'groups' ? 'active' : ''} onClick={() => setFilter('groups')}>Группы</button><button className={filter === 'channels' ? 'active' : ''} onClick={() => setFilter('channels')}>Каналы</button><button className={filter === 'archive' ? 'active' : ''} onClick={() => setFilter('archive')}><Archive size={15}/></button></div></div><div className="chat-list"><Link className={`chat-row trail-chat-row ${location.pathname === '/trail' ? 'selected' : ''}`} to="/trail"><span className="trail-chat-mark"><Bookmark size={18}/></span><span className="chat-row-text"><span className="chat-row-title">Моя тропа</span><span className="chat-row-preview">Сохранённые сообщения и ссылки</span></span></Link>{ids.length ? ids.map(chatId => <FilteredChatRow key={chatId} id={chatId} selected={id === chatId} filter={filter} search={search}/>) : <div className="empty-list"><MessageCircle size={34}/><strong>Здесь начнутся разговоры</strong><span>Найдите человека по имени или username либо создайте группу.</span><button className="secondary-btn" onClick={() => openDirectory('')}>Найти в Pride</button></div>}</div><div className="sidebar-bottom"><button className="icon-btn" onClick={() => setDialog('explore')} title="Открытые пространства"><Compass size={19}/></button><Link className="sidebar-profile" to="/profile" aria-label="Профиль"><Avatar profile={profile} size={38}/><span><strong>Профиль</strong><small>{profile?.displayName || 'Мой аккаунт'} · @{profile?.username}</small></span></Link><Link className="sidebar-settings" to="/settings"><Settings size={17}/><span>Настройки</span></Link></div></aside>
    <main className="main-area">{id ? <ChatPanel id={id}/> : <div className="welcome-panel"><div className="welcome-sun"/><div className="welcome-content"><span className="eyebrow">PRIDE MESSENGER</span><h2>Каждый разговор<br/>с чего-то начинается.</h2><p>Выберите переписку слева или найдите человека, с которым давно хотели поговорить.</p><button className="primary-btn" onClick={() => setDialog('search')}><Search size={18}/> Найти человека</button></div><div className="welcome-horizon"/></div>}</main>
    <nav className="mobile-nav"><Link to="/chats" className={!id ? 'active' : ''}><MessageCircle size={21}/><span>Чаты</span></Link><button onClick={() => openDirectory('')}><Search size={22}/><span>Найти</span></button><button className="mobile-plus" onClick={() => setDialog('create')}><Plus size={25}/></button><Link to="/trail"><Bookmark size={20}/><span>Моя тропа</span></Link><Link to="/profile"><UserRound size={21}/><span>Профиль</span></Link></nav>
    {dialog === 'search' && <SearchDialog query={directoryQuery} onQueryChange={setDirectoryQuery} onClose={() => setDialog(null)}/>} {dialog === 'create' && <CreateDialog onClose={() => setDialog(null)}/>} {dialog === 'explore' && <ExploreDialog onClose={() => setDialog(null)}/>}<div className="mobile-chat-back"><button onClick={() => navigate('/chats')}><ArrowLeft size={20}/> К чатам</button></div>
  </div>;
}

function FilteredChatRow({ id, selected, filter, search }: { id: string; selected: boolean; filter: string; search: string }) {
  const { user } = useAuth();
  const [chat] = useFirebaseValue<Chat>(`chats/${id}`);
  const [members] = useFirebaseValue<Record<string, string>>(`chatMembers/${id}`);
  const otherUid = chat?.kind === 'dm' ? Object.keys(members || {}).find(uid => uid !== user?.uid) : null;
  const [other] = useFirebaseValue<Profile>(otherUid ? `users/${otherUid}` : null);
  const [prefs] = useFirebaseValue<{ archived?: boolean }>(`userChatPrefs/${user?.uid}/${id}`);
  const title = chat?.kind === 'dm' ? `${other?.displayName || ''} ${other?.username || ''}` : chat?.title || '';
  if (!chat || (filter === 'archive' ? !prefs?.archived : prefs?.archived) || (filter === 'groups' && chat.kind !== 'group') || (filter === 'channels' && chat.kind !== 'channel') || (search && !title.toLowerCase().includes(search.toLowerCase()))) return null;
  return <ChatRow id={id} selected={selected}/>;
}
