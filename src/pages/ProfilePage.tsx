import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { ArrowLeft, Bell, Camera, Check, LogOut, Save, Settings, Shield, Sun, Trash2, UserRound } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { deleteToken, getMessaging, getToken, isSupported } from 'firebase/messaging';
import { ref, serverTimestamp, set } from 'firebase/database';
import { useAuth } from '../context/AuthContext';
import { useFirebaseValue } from '../hooks/useFirebaseValue';
import { useToast } from '../components/Toast';
import { Avatar } from '../components/Avatar';
import { app, requireDb } from '../services/firebase';
import { logout, normalizeUsername, resetPassword, updateMyProfile, usernameAvailable } from '../services/auth';
import { uploadAvatar } from '../services/chats';

type Device = { name: string; token: string; addedAt: number };
export function ProfilePage({ settings = false }: { settings?: boolean }) {
  const { user, profile } = useAuth(); const navigate = useNavigate(); const { toast } = useToast();
  const [name, setName] = useState(''); const [username, setUsername] = useState(''); const [bio, setBio] = useState('');
  const [mood, setMood] = useState('На связи'); const [roar, setRoar] = useState(''); const [busy, setBusy] = useState(false);
  const [theme] = useFirebaseValue<string>(user ? `userSettings/${user.uid}/theme` : null);
  const [devices] = useFirebaseValue<Record<string, Device>>(user ? `devices/${user.uid}` : null);
  const fileInput = useRef<HTMLInputElement>(null);
  useEffect(() => { if (profile) { setName(profile.displayName); setUsername(profile.username); setBio(profile.bio || ''); setMood(profile.mood || 'На связи'); setRoar(profile.roarUntil && profile.roarUntil > Date.now() ? profile.roar || '' : ''); } }, [profile]);
  useEffect(() => { document.documentElement.dataset.theme = theme || 'dark'; }, [theme]);
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
  async function changeTheme(next: string) { if (!user) return; await set(ref(requireDb(), `userSettings/${user.uid}/theme`), next); }
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
    } catch (error) { toast((error as Error).message, 'error'); }
  }
  async function removeDevice(id: string) {
    if (!user) return;
    try { if (id === getDeviceId() && app && await isSupported()) await deleteToken(getMessaging(app)); await set(ref(requireDb(), `devices/${user.uid}/${id}`), null); toast('Устройство удалено из уведомлений'); }
    catch (error) { toast((error as Error).message, 'error'); }
  }
  async function sendReset() { if (!user?.email) return; try { await resetPassword(user.email); toast('Письмо для смены пароля отправлено'); } catch (error) { toast((error as Error).message, 'error'); } }
  async function exit() { await logout(); navigate('/'); }
  if (!profile) return <div className="page-loading">Загрузка профиля…</div>;
  return <div className="profile-page"><header className="profile-top"><Link to="/chats" className="back-link"><ArrowLeft size={19}/> К чатам</Link><Link to={settings ? '/profile' : '/settings'} className="back-link"><Settings size={17}/>{settings ? 'Профиль' : 'Настройки'}</Link></header><div className="profile-layout"><aside className="profile-preview"><div className="profile-cover"><span className="profile-cover-sun"/></div><div className="profile-preview-body"><div className="profile-avatar-wrap"><Avatar profile={profile} size={86}/><button className="camera-btn" onClick={() => fileInput.current?.click()} aria-label="Изменить аватар"><Camera size={16}/></button><input ref={fileInput} type="file" accept="image/*" hidden onChange={avatar}/></div><h1>{profile.displayName}</h1><p className="handle">@{profile.username}</p>{profile.roar && profile.roarUntil && profile.roarUntil > Date.now() && <div className="roar">{profile.roar}</div>}<p className="bio-preview">{profile.bio || 'Расскажите о себе — это увидят ваши друзья.'}</p><div className="profile-mood"><span className="online-dot"/>{profile.mood || 'На связи'}</div></div></aside><main className="profile-content"><span className="eyebrow">ВАШЕ ПРОСТРАНСТВО</span><h2>{settings ? 'Настройки' : 'Мой профиль'}</h2><p className="subtle">Управляйте тем, как вас видят и находят другие.</p><section className="settings-card"><div className="section-heading"><UserRound size={18}/><h3>Личные данные</h3></div><div className="two-col"><label>Имя<input value={name} maxLength={48} onChange={e => setName(e.target.value)}/></label><label>Username<input value={username} maxLength={24} onChange={e => setUsername(e.target.value)}/></label></div><label>О себе<textarea value={bio} maxLength={280} rows={3} onChange={e => setBio(e.target.value)} placeholder="Пара слов о себе"/></label><div className="two-col"><label>Настроение<select value={mood} onChange={e => setMood(e.target.value)}>{['На связи', 'Отдыхаю', 'В пути', 'Не беспокоить', 'Слушаю музыку'].map(v => <option key={v}>{v}</option>)}</select></label><label>Roar · исчезнет через 12 часов<input value={roar} maxLength={80} onChange={e => setRoar(e.target.value)} placeholder="Что у вас происходит?"/></label></div><button className="primary-btn" disabled={busy || !name.trim()} onClick={save}><Save size={17}/>{busy ? 'Сохранение…' : 'Сохранить профиль'}</button></section>
    <section className="settings-card"><div className="section-heading"><Sun size={18}/><h3>Оформление</h3></div><div className="theme-choices"><button className={theme === 'dark' || !theme ? 'selected' : ''} onClick={() => changeTheme('dark')}>Тёмная саванна {(theme === 'dark' || !theme) && <Check size={16}/>}</button><button className={theme === 'light' ? 'selected' : ''} onClick={() => changeTheme('light')}>Светлый песок {theme === 'light' && <Check size={16}/>}</button></div></section>
    <section className="settings-card"><div className="section-heading"><Bell size={18}/><h3>Уведомления и устройства</h3></div><p className="subtle">Включите push на каждом устройстве отдельно. Удаление устройства отключает уведомления для него.</p><button className="secondary-btn" onClick={enablePush}>Включить уведомления здесь</button><div className="devices">{Object.entries(devices || {}).map(([id, device]) => <div className="device-row" key={id}><span><strong>{device.name}</strong><small>Добавлено {device.addedAt ? new Date(device.addedAt).toLocaleDateString('ru-RU') : 'недавно'}</small></span><button className="icon-btn danger" onClick={() => removeDevice(id)} title="Удалить устройство"><Trash2 size={17}/></button></div>)}{!Object.keys(devices || {}).length && <p className="muted">Устройств для уведомлений пока нет.</p>}</div></section>
    <section className="settings-card"><div className="section-heading"><Shield size={18}/><h3>Безопасность</h3></div><p className="subtle">Пароль можно сменить по ссылке из письма на {user?.email}.</p><div className="settings-actions"><button className="secondary-btn" onClick={sendReset}>Сменить пароль</button><button className="text-danger" onClick={exit}><LogOut size={17}/> Выйти из аккаунта</button></div></section></main></div></div>;
}
function getDeviceId() { let id = localStorage.getItem('pride-device-id'); if (!id) { id = crypto.randomUUID(); localStorage.setItem('pride-device-id', id); } return id; }
function browserName() { const ua = navigator.userAgent; return ua.includes('Firefox') ? 'Firefox' : ua.includes('Edg') ? 'Edge' : ua.includes('Chrome') ? 'Chrome' : ua.includes('Safari') ? 'Safari' : 'Браузер'; }
