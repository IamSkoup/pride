import { useCallback, useEffect, useMemo, useState } from 'react';
import { Archive, ArrowLeft, Bookmark, Check, Compass, MessageCircle, Plus, Search, Settings, UserRound, Users, X } from 'lucide-react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { get, ref } from 'firebase/database';
import { useAuth } from '../context/AuthContext';
import { useFirebaseValue } from '../hooks/useFirebaseValue';
import { Avatar } from '../components/Avatar';
import { useToast } from '../components/Toast';
import { findUser } from '../services/auth';
import { createSpace, joinByInvite, joinPublicSpace, startDirectChat } from '../services/chats';
import { requireDb } from '../services/firebase';
import type { Chat, PublicProfile } from '../types';
import { ChatPanel } from './chat/ChatPanel';
import { TrailPage } from './TrailPage';

function ChatRow({ id, selected }: { id: string; selected: boolean }) {
  const { user } = useAuth();
  const [chat] = useFirebaseValue<Chat>(`chats/${id}`);
  const [members] = useFirebaseValue<Record<string, string>>(`chatMembers/${id}`);
  const [activity] = useFirebaseValue<{ updatedAt: number; lastText: string; lastSenderId: string }>(`chatActivity/${id}`);
  const [publicReadAt] = useFirebaseValue<number>(user ? `readReceipts/${id}/${user.uid}` : null);
  const [privateReadAt] = useFirebaseValue<number>(user ? `userLastRead/${user.uid}/${id}` : null);
  const [readReceiptsEnabled] = useFirebaseValue<boolean>(user ? `userSettings/${user.uid}/privacy/readReceipts` : null);
  const [prefs] = useFirebaseValue<{ pinned?: boolean; archived?: boolean }>(`userChatPrefs/${user?.uid}/${id}`);
  const otherUid = chat?.kind === 'dm' ? Object.keys(members || {}).find(key => key !== user?.uid) : null;
  const [other] = useFirebaseValue<PublicProfile>(otherUid ? `publicProfiles/${otherUid}` : null);
  const title = chat?.kind === 'dm' ? other?.displayName || 'Личный чат' : chat?.title || 'Загрузка…';
  if (!chat) return null;
  return <Link className={`chat-row ${selected ? 'selected' : ''}`} to={`/chat/${id}`}>
    <Avatar profile={chat.kind === 'dm' ? other : { displayName: chat.title, avatar: chat.avatar }} name={title} size={48}/>
    <span className="chat-row-text"><span className="chat-row-title">{title}{prefs?.pinned && <span className="pin-dot">◆</span>}</span><span className="chat-row-preview">{activity?.lastText || (chat.kind === 'channel' ? 'Канал' : chat.kind === 'group' ? 'Группа' : 'Начните разговор')}</span></span>
    <span className="chat-row-end">{activity?.updatedAt && <time>{new Date(activity.updatedAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</time>}{activity?.lastSenderId !== user?.uid && activity?.updatedAt && activity.updatedAt > ((readReceiptsEnabled === false ? privateReadAt : publicReadAt) || 0) && <span className="unread-dot" aria-label="Есть непрочитанные сообщения"/>}</span>
  </Link>;
}

function SearchDialog({ onClose, query, onQueryChange }: { onClose: () => void; query: string; onQueryChange: (value: string) => void }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [section, setSection] = useState<'all' | 'people' | 'spaces'>('all');
  const [people, setPeople] = useState<PublicProfile[]>([]);
  const [spaces, setSpaces] = useState<Array<{ id: string; title: string; kind: 'group' | 'channel'; description?: string; avatar?: string }>>([]);
  const [busy, setBusy] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [joining, setJoining] = useState<string | null>(null);
  useEffect(() => {
    const term = query.trim().replace(/^@/, '').toLocaleLowerCase('ru');
    let active = true;
    if (term.length < 2) {
      setPeople([]); setSpaces([]); setSearchError(''); setBusy(false);
      return () => { active = false; };
    }
    setPeople([]); setSpaces([]); setSearchError(''); setBusy(true);
    let timeout: number | undefined;
    let expired = false;
    const timer = window.setTimeout(async () => {
      try {
        const search = async () => {
          const [peopleSnapshot, spacesSnapshot] = await Promise.all([
            get(ref(requireDb(), 'publicProfiles')),
            get(ref(requireDb(), 'publicSpaces')),
          ]);
          if (!active) return;
          const matches = (Object.values(peopleSnapshot.val() || {}) as PublicProfile[])
            .filter(person => person.uid !== user?.uid && `${person.displayName} ${person.username}`.toLocaleLowerCase('ru').includes(term))
            .slice(0, 30);
          if (!matches.some(person => person.username === term) && /^[a-z0-9_]{3,24}$/.test(term)) {
            const exactMatch = await findUser(term);
            if (!active || expired) return;
            if (exactMatch && exactMatch.uid !== user?.uid) matches.unshift(exactMatch);
          }
          if (!active || expired) return;
          const publicMatches = (Object.values(spacesSnapshot.val() || {}) as Array<{ id: string; title: string; kind: 'group' | 'channel'; description?: string; avatar?: string }>)
            .filter(space => `${space.title} ${space.description || ''}`.toLocaleLowerCase('ru').includes(term))
            .slice(0, 30);
          setPeople(matches); setSpaces(publicMatches);
        };
        const deadline = new Promise<never>((_, reject) => {
          timeout = window.setTimeout(() => {
            expired = true;
            reject(new Error('Поиск не ответил за 12 секунд. Проверьте подключение и повторите попытку.'));
          }, 12_000);
        });
        await Promise.race([search(), deadline]);
      } catch (error) { if (active) setSearchError((error as Error).message || 'Не удалось загрузить результаты.'); }
      finally { if (timeout) window.clearTimeout(timeout); if (active) setBusy(false); }
    }, 220);
    return () => { active = false; window.clearTimeout(timer); if (timeout) window.clearTimeout(timeout); };
  }, [query, user?.uid, toast]);
  async function start(person: PublicProfile) {
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
  return <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}><div className="modal directory-modal"><div className="modal-head"><div><span className="eyebrow">ОТКРЫТАЯ САВАННА</span><h2>Найти в Pride</h2></div><button className="icon-btn" onClick={onClose} aria-label="Закрыть"><X/></button></div><p className="subtle">Ищите людей по имени или @username, а также общедоступные группы и каналы.</p><div className="search-line"><Search size={17}/><input autoFocus value={query} onChange={e => onQueryChange(e.target.value)} placeholder="Имя, @username или название"/></div><div className="directory-tabs"><button className={section === 'all' ? 'active' : ''} onClick={() => setSection('all')}>Всё</button><button className={section === 'people' ? 'active' : ''} onClick={() => setSection('people')}>Люди</button><button className={section === 'spaces' ? 'active' : ''} onClick={() => setSection('spaces')}>Группы и каналы</button></div>{busy && <div className="empty-mini">Ищем…</div>}{searchError && <div className="empty-mini danger">Поиск не загрузился: {searchError}</div>}{query.trim().replace(/^@/, '').length < 2 && <div className="empty-mini">Введите хотя бы 2 символа для поиска.</div>}{visiblePeople && people.length > 0 && <section className="directory-results"><h3>Люди</h3>{people.map(person => <div className="found-user" key={person.uid}><Avatar profile={person} size={44}/><div><strong>{person.displayName}</strong><span>@{person.username}</span></div><Link className="secondary-btn" to={`/profile/${person.uid}`} onClick={onClose}>Профиль</Link><button className="secondary-btn" onClick={() => void start(person)}>Написать</button></div>)}</section>}{visibleSpaces && spaces.length > 0 && <section className="directory-results"><h3>Публичные группы и каналы</h3>{spaces.map(space => <div className="space-row" key={space.id}><Avatar profile={{ displayName: space.title, avatar: space.avatar }} name={space.title} size={42}/><span><strong>{space.title}</strong><small>{space.kind === 'channel' ? 'Канал' : 'Группа'} · {space.description || 'Публичное пространство'}</small></span><button className="secondary-btn" disabled={joining === space.id} onClick={() => void join(space)}>{joining === space.id ? 'Открываем…' : 'Открыть'}</button></div>)}</section>}{!busy && !searchError && query.trim().replace(/^@/, '').length >= 2 && !people.length && !spaces.length && <div className="empty-mini">Совпадений не найдено. Попробуйте другое имя или название.</div>}</div></div>;
}

function CreateDialog({ onClose }: { onClose: () => void }) {
  const { user } = useAuth(); const navigate = useNavigate(); const { toast } = useToast();
  const [kind, setKind] = useState<'group' | 'channel'>('group');
  const [title, setTitle] = useState(''); const [description, setDescription] = useState('');
  const [isPublic, setPublic] = useState(false); const [query, setQuery] = useState('');
  const [people, setPeople] = useState<PublicProfile[]>([]); const [busy, setBusy] = useState(false);
  const [chatLinks, loadingLinks] = useFirebaseValue<Record<string, boolean>>(user ? `userChats/${user.uid}` : null);
  const [profileIndex, loadingProfiles] = useFirebaseValue<Record<string, PublicProfile>>('publicProfiles');
  const [contacts, setContacts] = useState<PublicProfile[]>([]);
  useEffect(() => {
    let active = true;
    async function loadContacts() {
      if (!user || loadingLinks || loadingProfiles) return;
      try {
        const ids = Object.keys(chatLinks || {}).slice(-80);
        const peerIds = await Promise.all(ids.map(async chatId => {
          const [chatSnapshot, memberSnapshot] = await Promise.all([get(ref(requireDb(), `chats/${chatId}`)), get(ref(requireDb(), `chatMembers/${chatId}`))]);
          if (chatSnapshot.val()?.kind !== 'dm') return null;
          return Object.keys(memberSnapshot.val() || {}).find(uid => uid !== user.uid) || null;
        }));
        if (!active) return;
        const unique = [...new Set(peerIds.filter((uid): uid is string => Boolean(uid)))];
        setContacts(unique.map(uid => profileIndex?.[uid]).filter((person): person is PublicProfile => Boolean(person)));
      } catch (error) { if (active) toast((error as Error).message, 'error'); }
    }
    void loadContacts();
    return () => { active = false; };
  }, [user?.uid, chatLinks, loadingLinks, loadingProfiles, profileIndex, toast]);
  const normalizedQuery = query.trim().replace(/^@/, '').toLocaleLowerCase('ru');
  const contactIds = new Set(contacts.map(person => person.uid));
  const visibleContacts = contacts.filter(person => !normalizedQuery || `${person.displayName} ${person.username}`.toLocaleLowerCase('ru').includes(normalizedQuery));
  const visibleDirectory = Object.values(profileIndex || {}).filter(person => person.uid !== user?.uid && !contactIds.has(person.uid) && normalizedQuery.length >= 2 && `${person.displayName} ${person.username}`.toLocaleLowerCase('ru').includes(normalizedQuery)).slice(0, 12);
  function togglePerson(person: PublicProfile) {
    setPeople(current => current.some(item => item.uid === person.uid) ? current.filter(item => item.uid !== person.uid) : [...current, person]);
  }
  async function addByUsername() {
    try {
      const person = await findUser(query);
      if (!person || person.uid === user?.uid) throw new Error('Пользователь не найден.');
      togglePerson(person); setQuery('');
    } catch (error) { toast((error as Error).message, 'error'); }
  }
  async function create() {
    if (!user) return; setBusy(true);
    try { const id = await createSpace(user.uid, kind, title, description, isPublic, people); onClose(); navigate(`/chat/${id}`); toast(kind === 'group' ? 'Группа создана' : 'Канал создан'); }
    catch (error) { toast((error as Error).message, 'error'); }
    finally { setBusy(false); }
  }
  const personOption = (person: PublicProfile) => <button key={person.uid} type="button" className={`contact-option ${people.some(item => item.uid === person.uid) ? 'selected' : ''}`} onClick={() => togglePerson(person)} aria-pressed={people.some(item => item.uid === person.uid)}><Avatar profile={person} size={36}/><span><strong>{person.displayName}</strong><small>@{person.username}</small></span><Check size={17}/></button>;
  return <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}><div className="modal create-space-modal"><div className="modal-head"><div><span className="eyebrow">СОБЕРИТЕ СВОИХ</span><h2>Новое пространство</h2></div><button className="icon-btn" onClick={onClose} aria-label="Закрыть"><X/></button></div><div className="segmented"><button className={kind === 'group' ? 'active' : ''} onClick={() => setKind('group')}><Users size={16}/> Группа</button><button className={kind === 'channel' ? 'active' : ''} onClick={() => setKind('channel')}><Compass size={16}/> Канал</button></div><label>Название<input value={title} maxLength={64} onChange={e => setTitle(e.target.value)} placeholder={kind === 'group' ? 'Например, Наш прайд' : 'Например, Полевые заметки'}/></label><label>Описание<textarea value={description} maxLength={280} onChange={e => setDescription(e.target.value)} placeholder="О чём это пространство?" rows={3}/></label><label className="check-line"><input type="checkbox" checked={isPublic} onChange={e => setPublic(e.target.checked)}/> Публичное пространство</label><section className="contact-picker"><div className="contact-picker-heading"><strong>Участники</strong><small>Выбрано: {people.length}</small></div><div className="search-line"><Search size={16}/><input value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void addByUsername(); } }} placeholder="Найти контакт или @username"/><button type="button" className="secondary-btn" onClick={() => void addByUsername()} disabled={!query.trim()}>Добавить</button></div>{people.length > 0 && <div className="chips">{people.map(person => <button key={person.uid} onClick={() => togglePerson(person)}>@{person.username} ×</button>)}</div>}<div className="contact-list">{visibleContacts.length > 0 && <><h3>Ваши контакты</h3>{visibleContacts.slice(0, 30).map(personOption)}</>}{visibleDirectory.length > 0 && <><h3>Найти в Pride</h3>{visibleDirectory.map(personOption)}</>}{!visibleContacts.length && !visibleDirectory.length && <div className="empty-mini">{loadingLinks || loadingProfiles ? 'Загружаем контакты…' : normalizedQuery.length >= 2 ? 'Совпадений нет. Проверьте username или попробуйте другое имя.' : 'Начните вводить имя или выберите недавний личный чат.'}</div>}</div></section><button className="primary-btn full" onClick={create} disabled={busy || !title.trim()}>{busy ? 'Создание…' : `Создать ${kind === 'group' ? 'группу' : 'канал'}`}</button></div></div>;
}

function ExploreDialog({ onClose }: { onClose: () => void }) {
  const [spaces] = useFirebaseValue<Record<string, { id: string; title: string; kind: 'group' | 'channel'; description: string; avatar?: string }>>('publicSpaces');
  const [query, setQuery] = useState(''); const [busy, setBusy] = useState<string | null>(null);
  const navigate = useNavigate(); const { toast } = useToast();
  const found = Object.values(spaces || {}).filter(space => `${space.title} ${space.description}`.toLowerCase().includes(query.toLowerCase())).slice(0, 100);
  async function join(id: string) { setBusy(id); try { await joinPublicSpace(id); onClose(); navigate(`/chat/${id}`); } catch (e) { toast((e as Error).message, 'error'); } finally { setBusy(null); } }
  return <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}><div className="modal"><div className="modal-head"><div><span className="eyebrow">ОТКРЫТЫЕ ПРОСТРАНСТВА</span><h2>Исследовать</h2></div><button className="icon-btn" onClick={onClose} aria-label="Закрыть"><X/></button></div><div className="search-line"><input autoFocus value={query} onChange={e => setQuery(e.target.value)} placeholder="Название или тема"/></div><div className="space-list">{found.map(space => <div className="space-row" key={space.id}><Avatar profile={{ displayName: space.title, avatar: space.avatar }} name={space.title} size={40}/><span><strong>{space.title}</strong><small>{space.kind === 'channel' ? 'Канал' : 'Группа'} · {space.description || 'Без описания'}</small></span><button className="secondary-btn" disabled={busy === space.id} onClick={() => join(space.id)}>Открыть</button></div>)}{!found.length && <div className="empty-mini">Пока здесь тихо. Создайте первое публичное пространство.</div>}</div></div></div>;
}

export function MessengerPage() {
  const { id, inviteId, inviteCode } = useParams();
  const location = useLocation();
  const { user, profile } = useAuth(); const navigate = useNavigate(); const { toast } = useToast();
  const [list] = useFirebaseValue<Record<string, boolean>>(user ? `userChats/${user.uid}` : null);
  const [dialog, setDialog] = useState<'search' | 'create' | 'explore' | null>(null);
  const [filter, setFilter] = useState<'all' | 'groups' | 'channels' | 'archive'>('all');
  const [search, setSearch] = useState('');
  const [activityByChat, setActivityByChat] = useState<Record<string, number>>({});
  const [pinnedByChat, setPinnedByChat] = useState<Record<string, boolean>>({});
  const [directoryQuery, setDirectoryQuery] = useState('');
  function openDirectory(value = directoryQuery) { setDirectoryQuery(value); setDialog('search'); }
  useEffect(() => { if (inviteId && inviteCode && user) joinByInvite(inviteId, inviteCode, user.uid).then(() => navigate(`/chat/${inviteId}`, { replace: true })).catch(error => toast(error.message, 'error')); }, [inviteId, inviteCode, user, navigate, toast]);
  const reportActivity = useCallback((chatId: string, timestamp: number) => setActivityByChat(current => current[chatId] === timestamp ? current : { ...current, [chatId]: timestamp }), []);
  const reportPinned = useCallback((chatId: string, pinned: boolean) => setPinnedByChat(current => current[chatId] === pinned ? current : { ...current, [chatId]: pinned }), []);
  const ids = useMemo(() => Object.keys(list || {}).reverse().sort((a, b) => Number(pinnedByChat[b]) - Number(pinnedByChat[a]) || (activityByChat[b] || 0) - (activityByChat[a] || 0)), [list, activityByChat, pinnedByChat]);
  return <div className={`app-shell ${id || location.pathname === '/trail' ? 'mobile-chat-open' : ''}`}>
    <aside className="sidebar"><div className="sidebar-top"><div className="brand sidebar-brand"><span className="brand-mark">P</span><span>Pride<span className="brand-muted"> Messenger</span></span></div><div className="sidebar-heading"><div><span className="eyebrow">ВАШЕ ПРОСТРАНСТВО</span><h1>Сообщения</h1></div><button className="create-btn" title="Создать" aria-label="Создать группу или канал" onClick={() => setDialog('create')}><Plus size={22}/></button></div><div className="sidebar-searches"><label className="sidebar-search"><Search size={16}/><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Поиск чатов" aria-label="Поиск в списке чатов"/></label><label className="sidebar-search directory-search" title="Поиск людей, групп и каналов"><UserRound size={16}/><input value={directoryQuery} onChange={e => setDirectoryQuery(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') openDirectory(); }} placeholder="Люди и группы" aria-label="Поиск людей, групп и каналов"/><button type="button" onClick={() => openDirectory()} aria-label="Искать людей, группы и каналы"><Search size={15}/></button></label></div><div className="filter-row"><button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>Все</button><button className={filter === 'groups' ? 'active' : ''} onClick={() => setFilter('groups')}>Группы</button><button className={filter === 'channels' ? 'active' : ''} onClick={() => setFilter('channels')}>Каналы</button><button className={filter === 'archive' ? 'active' : ''} onClick={() => setFilter('archive')}><Archive size={15}/></button></div></div><div className="chat-list"><Link className={`chat-row trail-chat-row ${location.pathname === '/trail' ? 'selected' : ''}`} to="/trail"><span className="trail-chat-mark"><Bookmark size={18}/></span><span className="chat-row-text"><span className="chat-row-title">Моя тропа</span><span className="chat-row-preview">Сохранённые сообщения и ссылки</span></span></Link>{ids.length ? ids.map(chatId => <FilteredChatRow key={chatId} id={chatId} selected={id === chatId} filter={filter} search={search} reportActivity={reportActivity} activityRank={activityByChat[chatId]} reportPinned={reportPinned}/>) : <div className="empty-list"><MessageCircle size={34}/><strong>Здесь начнутся разговоры</strong><span>Найдите человека по имени или username либо создайте группу.</span><button className="secondary-btn" onClick={() => openDirectory('')}>Найти в Pride</button></div>}</div><div className="sidebar-bottom"><button className="icon-btn" onClick={() => setDialog('explore')} title="Открытые пространства"><Compass size={19}/></button><Link className="sidebar-profile" to="/profile" aria-label="Профиль"><Avatar profile={profile} size={38}/><span><strong>Профиль</strong><small>{profile?.displayName || 'Мой аккаунт'} · @{profile?.username}</small></span></Link><Link className="sidebar-settings" to="/settings"><Settings size={17}/><span>Настройки</span></Link></div></aside>
    <main className="main-area">{id ? <ChatPanel id={id}/> : location.pathname === '/trail' ? <TrailPage embedded/> : <div className="welcome-panel"><div className="welcome-content"><span className="eyebrow">PRIDE MESSENGER</span><h2>Каждый разговор<br/>с чего-то начинается.</h2><p>Выберите переписку слева или найдите человека, с которым давно хотели поговорить.</p><button className="primary-btn" onClick={() => setDialog('search')}><Search size={18}/> Найти человека</button></div></div>}</main>
    <nav className="mobile-nav"><Link to="/chats" className={!id ? 'active' : ''}><MessageCircle size={21}/><span>Чаты</span></Link><button onClick={() => openDirectory('')}><Search size={22}/><span>Найти</span></button><button className="mobile-plus" onClick={() => setDialog('create')}><Plus size={25}/></button><Link to="/trail"><Bookmark size={20}/><span>Моя тропа</span></Link><Link to="/profile"><UserRound size={21}/><span>Профиль</span></Link></nav>
    {dialog === 'search' && <SearchDialog query={directoryQuery} onQueryChange={setDirectoryQuery} onClose={() => setDialog(null)}/>} {dialog === 'create' && <CreateDialog onClose={() => setDialog(null)}/>} {dialog === 'explore' && <ExploreDialog onClose={() => setDialog(null)}/>}<div className="mobile-chat-back"><button onClick={() => navigate('/chats')}><ArrowLeft size={20}/> К чатам</button></div>
  </div>;
}

function FilteredChatRow({ id, selected, filter, search, reportActivity, activityRank, reportPinned }: { id: string; selected: boolean; filter: string; search: string; reportActivity: (chatId: string, timestamp: number) => void; activityRank?: number; reportPinned: (chatId: string, pinned: boolean) => void }) {
  const { user } = useAuth();
  const [chat] = useFirebaseValue<Chat>(`chats/${id}`);
  const [members] = useFirebaseValue<Record<string, string>>(`chatMembers/${id}`);
  const otherUid = chat?.kind === 'dm' ? Object.keys(members || {}).find(uid => uid !== user?.uid) : null;
  const [other] = useFirebaseValue<PublicProfile>(otherUid ? `publicProfiles/${otherUid}` : null);
  const [prefs] = useFirebaseValue<{ archived?: boolean; pinned?: boolean }>(`userChatPrefs/${user?.uid}/${id}`);
  const [activity] = useFirebaseValue<{ updatedAt?: number }>(`chatActivity/${id}`);
  useEffect(() => { reportActivity(id, activity?.updatedAt || chat?.updatedAt || activityRank || 0); }, [id, activity?.updatedAt, chat?.updatedAt, activityRank, reportActivity]);
  useEffect(() => { reportPinned(id, Boolean(prefs?.pinned)); }, [id, prefs?.pinned, reportPinned]);
  const title = chat?.kind === 'dm' ? `${other?.displayName || ''} ${other?.username || ''}` : chat?.title || '';
  if (!chat || (filter === 'archive' ? !prefs?.archived : prefs?.archived) || (filter === 'groups' && chat.kind !== 'group') || (filter === 'channels' && chat.kind !== 'channel') || (search && !title.toLowerCase().includes(search.toLowerCase()))) return null;
  return <ChatRow id={id} selected={selected}/>;
}
