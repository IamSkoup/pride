import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { ArrowLeft, Bell, Camera, Check, LogOut, Save, Settings, Shield, Sun, Trash2, UserRound } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { deleteToken, getMessaging, getToken, isSupported } from 'firebase/messaging';
import { get, ref, serverTimestamp, set, update } from 'firebase/database';
import { useAuth } from '../context/AuthContext';
import { useFirebaseValue } from '../hooks/useFirebaseValue';
import { useToast } from '../components/Toast';
import { Avatar } from '../components/Avatar';
import { app, requireDb } from '../services/firebase';
import { logout, normalizeUsername, resetPassword, updateMyProfile, usernameAvailable } from '../services/auth';
import { setPresence, uploadAvatar } from '../services/chats';
import type { ThemeName } from '../types';

type Device = { name: string; token: string; addedAt: number };
type SettingsSection = 'profile' | 'messages' | 'privacy' | 'appearance' | 'notifications' | 'security';
type UserPreferences = { messages?: { enterToSend?: boolean; mediaPreviews?: boolean; autoplayVideos?: boolean; chatBackground?: string }; privacy?: { allowNewDMs?: boolean; allowGroupAdds?: boolean; showPresence?: boolean; readReceipts?: boolean; typingIndicator?: boolean }; notifications?: { enabled?: boolean; preview?: boolean } };
const SETTINGS_SECTIONS: Array<{ id: SettingsSection; label: string }> = [
  { id: 'profile', label: 'Профиль' }, { id: 'messages', label: 'Сообщения' }, { id: 'privacy', label: 'Конфиденциальность' },
  { id: 'appearance', label: 'Оформление' }, { id: 'notifications', label: 'Уведомления и устройства' }, { id: 'security', label: 'Безопасность' },
];
export function ProfilePage({ settings = false }: { settings?: boolean }) {
  const { user, profile, theme, setTheme } = useAuth(); const navigate = useNavigate(); const { toast } = useToast();
  const [name, setName] = useState(''); const [username, setUsername] = useState(''); const [bio, setBio] = useState('');
  const [mood, setMood] = useState('На связи'); const [roar, setRoar] = useState(''); const [busy, setBusy] = useState(false);
  const [activeSection, setActiveSection] = useState<SettingsSection | null>(settings ? null : 'profile');
  const [preferences] = useFirebaseValue<UserPreferences>(user ? `userSettings/${user.uid}` : null);
  const [devices] = useFirebaseValue<Record<string, Device>>(user ? `devices/${user.uid}` : null);
  const fileInput = useRef<HTMLInputElement>(null);
  useEffect(() => { if (profile) { setName(profile.displayName); setUsername(profile.username); setBio(profile.bio || ''); setMood(profile.mood || 'На связи'); setRoar(profile.roarUntil && profile.roarUntil > Date.now() ? profile.roar || '' : ''); } }, [profile]);
  async function save() {
    if (!user || !profile) return; setBusy(true);
    try {
      if (normalizeUsername(username) !== profile.username && !(await usernameAvailable(username))) throw new Error('Этот username занят.');
      await updateMyProfile(user.uid, profile, { displayName: name.trim(), username, bio: bio.trim(), mood, roar: roar.trim(), roarUntil: roar.trim() ? Date.now() + 12 * 60 * 60 * 1000 : 0 });
      toast('Профиль сохранён');
    } catch (e) { toast((e as Error).message, 'error'); } finally { setBusy(false); }
  }
  async function avatar(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file || !user || !profile) return;
    setBusy(true); try { await updateMyProfile(user.uid, profile, { avatar: await uploadAvatar(user.uid, file) }); toast('Аватар обновлён'); } catch (error) { toast((error as Error).message, 'error'); } finally { setBusy(false); }
  }
  async function changeTheme(next: ThemeName) {
    try { await setTheme(next); toast('Тема применена и сохранена в аккаунте'); }
    catch { toast('Тема применена на этом устройстве, но Firebase не сохранил её для аккаунта.', 'error'); }
  }
  async function changeNotificationSetting(key: 'enabled' | 'preview', value: boolean) {
    if (!user) return;
    try { await set(ref(requireDb(), `userSettings/${user.uid}/notifications/${key}`), value); }
    catch (error) { toast((error as Error).message, 'error'); }
  }
  async function changePreference(section: 'privacy' | 'messages', key: string, value: boolean | string) {
    if (!user) return;
    try {
      await set(ref(requireDb(), `userSettings/${user.uid}/${section}/${key}`), value);
      if (section === 'privacy' && key === 'showPresence') await setPresence(user.uid);
      if (section === 'privacy' && value === false && (key === 'readReceipts' || key === 'typingIndicator')) {
        const chats = (await get(ref(requireDb(), `userChats/${user.uid}`))).val() as Record<string, boolean> | null;
        const updates: Record<string, null> = {};
        for (const chatId of Object.keys(chats || {})) updates[`${key === 'readReceipts' ? 'readReceipts' : 'typing'}/${chatId}/${user.uid}`] = null;
        if (Object.keys(updates).length) await update(ref(requireDb()), updates);
      }
      toast('Настройка сохранена');
    } catch (error) { toast((error as Error).message, 'error'); }
  }
  async function enablePush() {
    if (!user || !app) return;
    try {
      if (!(await isSupported())) throw new Error('Браузер не поддерживает push уведомления.');
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') throw new Error('Разрешите уведомления в настройках браузера.');
      const registration = await navigator.serviceWorker.ready;
      const vapidKey = import.meta.env.VITE_FIREBASE_VAPID_KEY;
      if (!vapidKey) throw new Error('VITE_FIREBASE_VAPID_KEY не настроен.');
      const token = await getToken(getMessaging(app), { vapidKey, serviceWorkerRegistration: registration });
      if (!token) throw new Error('Не удалось получить push токен.');
      const deviceId = getDeviceId();
      await set(ref(requireDb(), `devices/${user.uid}/${deviceId}`), { name: `${navigator.platform || 'Устройство'} · ${browserName()}`, token, addedAt: serverTimestamp() });
      toast('Уведомления включены на этом устройстве');
    } catch (error) {
      const code = (error as { code?: string }).code;
      const detail = code === 'messaging/token-subscribe-failed'
        ? 'Firebase Messaging не принял запрос регистрации браузера. Проверьте новый публичный VAPID key в GitHub Actions, включённые Firebase Cloud Messaging API и корректное ограничение Web API key.'
        : (error as Error).message;
      toast(detail, 'error');
    }
  }
  async function removeDevice(id: string) {
    if (!user) return;
    try { if (id === getDeviceId() && app && await isSupported()) await deleteToken(getMessaging(app)); await set(ref(requireDb(), `devices/${user.uid}/${id}`), null); toast('Устройство удалено из уведомлений'); }
    catch (error) { toast((error as Error).message, 'error'); }
  }
  async function sendReset() { if (!user?.email) return; try { await resetPassword(user.email); toast('Письмо для смены пароля отправлено'); } catch (error) { toast((error as Error).message, 'error'); } }
  async function exit() { await logout(); navigate('/'); }
  if (!profile) return <div className="page-loading">Загрузка профиля…</div>;
  const selectedSection = activeSection || 'profile';
  const isSection = (section: SettingsSection) => settings ? selectedSection === section : section === 'profile';
  return <div className="profile-page">
    <header className="profile-top"><Link to="/chats" className="back-link"><ArrowLeft size={19}/> К чатам</Link><Link to={settings ? '/profile' : '/settings'} className="back-link"><Settings size={17}/>{settings ? 'Профиль' : 'Настройки'}</Link></header>
    <div className={`profile-layout ${settings ? 'settings-layout' : ''}`} data-settings-index={!activeSection}>
      {!settings && <aside className="profile-preview"><div className="profile-cover"><span className="profile-cover-sun"/></div><div className="profile-preview-body"><div className="profile-avatar-wrap"><Avatar profile={profile} size={86}/><button className="camera-btn" onClick={() => fileInput.current?.click()} aria-label="Изменить аватар"><Camera size={16}/></button><input ref={fileInput} type="file" accept="image/*" hidden onChange={avatar}/></div><h1>{profile.displayName}</h1><p className="handle">@{profile.username}</p>{profile.roar && profile.roarUntil && profile.roarUntil > Date.now() && <div className="roar">{profile.roar}</div>}<p className="bio-preview">{profile.bio || 'Расскажите о себе — это увидят ваши друзья.'}</p><div className="profile-mood"><span className="online-dot"/>{profile.mood || 'На связи'}</div></div></aside>}
      {settings && <nav className="settings-nav" aria-label="Разделы настроек">{SETTINGS_SECTIONS.map(section => <button key={section.id} className={selectedSection === section.id ? 'active' : ''} onClick={() => setActiveSection(section.id)}>{section.label}</button>)}</nav>}
      <main className="profile-content">
        <span className="eyebrow">ВАШЕ ПРОСТРАНСТВО</span><h2>{settings ? SETTINGS_SECTIONS.find(section => section.id === selectedSection)?.label : 'Мой профиль'}</h2>
        {settings && <button className="settings-back" onClick={() => setActiveSection(null)}><ArrowLeft size={17}/> Все настройки</button>}
        {isSection('profile') && <section className="settings-card"><div className="section-heading"><UserRound size={18}/><h3>Личные данные</h3></div><div className="two-col"><label>Имя<input value={name} maxLength={48} onChange={e => setName(e.target.value)}/></label><label>Username<input value={username} maxLength={24} onChange={e => setUsername(e.target.value)}/></label></div><label>О себе<textarea value={bio} maxLength={280} rows={3} onChange={e => setBio(e.target.value)} placeholder="Пара слов о себе"/></label><div className="two-col"><label>Настроение<select value={mood} onChange={e => setMood(e.target.value)}>{['На связи', 'Отдыхаю', 'В пути', 'Не беспокоить', 'Слушаю музыку'].map(v => <option key={v}>{v}</option>)}</select></label><label>Roar · исчезнет через 12 часов<input value={roar} maxLength={80} onChange={e => setRoar(e.target.value)} placeholder="Что у вас происходит?"/></label></div><button className="primary-btn" disabled={busy || !name.trim()} onClick={save}><Save size={17}/>{busy ? 'Сохранение…' : 'Сохранить профиль'}</button></section>}
        {isSection('messages') && <section className="settings-card"><div className="section-heading"><Bell size={18}/><h3>Поведение сообщений</h3></div><label className="check-line"><input type="checkbox" checked={preferences?.messages?.enterToSend !== false} onChange={e => changePreference('messages','enterToSend',e.target.checked)}/> Enter отправляет сообщение</label><label className="check-line"><input type="checkbox" checked={preferences?.messages?.mediaPreviews !== false} onChange={e => changePreference('messages','mediaPreviews',e.target.checked)}/> Показывать предпросмотр вложений</label><label className="check-line"><input type="checkbox" checked={preferences?.messages?.autoplayVideos === true} onChange={e => changePreference('messages','autoplayVideos',e.target.checked)}/> Автовоспроизведение видео без звука</label><label>Фон чатов по умолчанию<select value={preferences?.messages?.chatBackground || 'plain'} onChange={e => changePreference('messages','chatBackground',e.target.value)}>{[['plain','Без рисунка'],['grass','Сухая трава'],['savanna','Силуэты саванны'],['evening','Вечерний горизонт'],['stars','Ночные звёзды']].map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label></section>}
        {isSection('privacy') && <section className="settings-card"><div className="section-heading"><Shield size={18}/><h3>Конфиденциальность</h3></div><label className="check-line"><input type="checkbox" checked={preferences?.privacy?.allowNewDMs !== false} onChange={e => changePreference('privacy','allowNewDMs',e.target.checked)}/> Разрешать новые личные сообщения</label><label className="check-line"><input type="checkbox" checked={preferences?.privacy?.allowGroupAdds !== false} onChange={e => changePreference('privacy','allowGroupAdds',e.target.checked)}/> Разрешать добавление в группы</label><label className="check-line"><input type="checkbox" checked={preferences?.privacy?.showPresence !== false} onChange={e => changePreference('privacy','showPresence',e.target.checked)}/> Показывать статус онлайн и время посещения</label><label className="check-line"><input type="checkbox" checked={preferences?.privacy?.readReceipts !== false} onChange={e => changePreference('privacy','readReceipts',e.target.checked)}/> Отправлять отметки о прочтении</label><label className="check-line"><input type="checkbox" checked={preferences?.privacy?.typingIndicator !== false} onChange={e => changePreference('privacy','typingIndicator',e.target.checked)}/> Показывать индикатор набора текста</label></section>}
        {isSection('appearance') && <section className="settings-card"><div className="section-heading"><Sun size={18}/><h3>Темы саванны</h3></div><div className="theme-choices">{([['day','Дневная саванна'],['evening','Вечерняя саванна'],['night','Ночная саванна']] as const).map(([value,label])=><button key={value} className={theme===value?'selected':''} aria-pressed={theme===value} onClick={() => changeTheme(value)}>{label}{theme===value&&<Check size={16}/>}</button>)}</div></section>}
        {isSection('notifications') && <section className="settings-card"><div className="section-heading"><Bell size={18}/><h3>Уведомления и устройства</h3></div><p className="subtle">Push включается на каждом устройстве отдельно. Настройка ниже применяется ко всем устройствам.</p><label className="check-line"><input type="checkbox" checked={preferences?.notifications?.enabled !== false} onChange={e => changeNotificationSetting('enabled', e.target.checked)}/> Получать push-уведомления</label><label className="check-line"><input type="checkbox" checked={preferences?.notifications?.preview !== false} onChange={e => changeNotificationSetting('preview', e.target.checked)}/> Показывать текст сообщений в уведомлениях</label><button className="secondary-btn" onClick={enablePush}>Включить уведомления здесь</button><div className="devices">{Object.entries(devices || {}).map(([id, device]) => <div className="device-row" key={id}><span><strong>{device.name}</strong><small>Добавлено {device.addedAt ? new Date(device.addedAt).toLocaleDateString('ru-RU') : 'недавно'}</small></span><button className="icon-btn danger" onClick={() => removeDevice(id)} title="Удалить устройство"><Trash2 size={17}/></button></div>)}{!Object.keys(devices || {}).length && <p className="muted">Устройств для уведомлений пока нет.</p>}</div></section>}
        {isSection('security') && <section className="settings-card"><div className="section-heading"><Shield size={18}/><h3>Безопасность</h3></div><p className="subtle">Пароль можно сменить по ссылке из письма на {user?.email}.</p><div className="settings-actions"><button className="secondary-btn" onClick={sendReset}>Сменить пароль</button><button className="text-danger" onClick={exit}><LogOut size={17}/> Выйти из аккаунта</button></div></section>}
      </main>
    </div>
  </div>;
}
function getDeviceId() { let id = localStorage.getItem('pride-device-id'); if (!id) { id = crypto.randomUUID(); localStorage.setItem('pride-device-id', id); } return id; }
function browserName() { const ua = navigator.userAgent; return ua.includes('Firefox') ? 'Firefox' : ua.includes('Edg') ? 'Edge' : ua.includes('Chrome') ? 'Chrome' : ua.includes('Safari') ? 'Safari' : 'Браузер'; }
