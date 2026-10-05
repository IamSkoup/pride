import { useEffect, useState, type FormEvent } from 'react';
import { ArrowRight, AtSign, Eye, EyeOff, Sun, ShieldCheck } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { explainAuthError, login, register, resetPassword, usernameAvailable, validUsername } from '../services/auth';
import { useAuth } from '../context/AuthContext';

export function AuthPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { user } = useAuth();
  const [mode, setMode] = useState<'login' | 'register' | 'reset'>('login');
  const [email, setEmail] = useState('');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [availability, setAvailability] = useState<string>('');
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => { if (user) { const next = params.get('next'); navigate(next?.startsWith('/') && !next.startsWith('//') ? next : '/chats', { replace: true }); } }, [user, navigate, params]);
  useEffect(() => {
    if (mode !== 'register' || !username) { setAvailability(''); return; }
    if (!validUsername(username)) { setAvailability('3–24 символа: a–z, 0–9, _'); return; }
    let active = true;
    const timer = window.setTimeout(() => usernameAvailable(username).then(ok => { if (active) setAvailability(ok ? 'Имя свободно' : 'Имя занято'); }).catch(() => { if (active) setAvailability('Не удалось проверить имя'); }), 350);
    return () => { active = false; window.clearTimeout(timer); };
  }, [mode, username]);
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setMessage('');
    try {
      if (mode === 'login') await login(identifier, password);
      if (mode === 'register') await register(email, password, name, username);
      if (mode === 'reset') { await resetPassword(email); setMessage('Письмо отправлено. Проверьте входящие и папку «Спам».'); }
    } catch (error) { setMessage(explainAuthError(error)); }
    finally { setBusy(false); }
  }
  return <main className="auth-page">
    <div className="auth-art"><div className="auth-sun"/><div className="landscape l1"/><div className="landscape l2"/><div className="auth-art-content"><div className="brand"><span className="brand-mark">P</span><span>Pride<span className="brand-muted"> Messenger</span></span></div><h1>Ближе, где бы<br/>ты ни был.</h1><p>Разговоры, друзья и ваши маленькие миры — в одном пространстве.</p><div className="auth-art-footer"><Sun size={16}/> Создан для настоящей связи</div></div></div>
    <div className="auth-form-side"><div className="auth-card"><div className="mobile-brand"><span className="brand-mark">P</span> Pride Messenger</div><span className="eyebrow">ВАШЕ ПРОСТРАНСТВО</span><h2>{mode === 'login' ? 'С возвращением' : mode === 'register' ? 'Создайте аккаунт' : 'Восстановление доступа'}</h2><p className="subtle">{mode === 'login' ? 'Продолжите общение там, где остановились.' : mode === 'register' ? 'Ваше имя в Pride начинается здесь.' : 'Мы отправим ссылку для сброса пароля на email.'}</p>
      <form onSubmit={submit}>
        {mode === 'register' && <><label>Отображаемое имя<input required maxLength={48} value={name} onChange={e => setName(e.target.value)} placeholder="Как к вам обращаться" /></label><label>Username<div className="input-icon"><AtSign size={17}/><input required value={username} onChange={e => setUsername(e.target.value)} placeholder="yourname" /></div><small className={availability === 'Имя свободно' ? 'valid' : ''}>{availability || 'Уникальное имя для поиска друзей'}</small></label></>}
        {mode === 'login' ? <label>Email или @username<input required value={identifier} onChange={e => setIdentifier(e.target.value)} placeholder="name@example.com или @username" autoComplete="username" /></label> : <label>Email<input type="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="name@example.com" autoComplete="email" /></label>}
        {mode !== 'reset' && <label>Пароль<div className="input-action"><input type={visible ? 'text' : 'password'} required minLength={6} value={password} onChange={e => setPassword(e.target.value)} placeholder="Не менее 6 символов" autoComplete={mode === 'register' ? 'new-password' : 'current-password'} /><button type="button" aria-label={visible ? 'Скрыть пароль' : 'Показать пароль'} onClick={() => setVisible(!visible)}>{visible ? <EyeOff size={18}/> : <Eye size={18}/>}</button></div></label>}
        {mode === 'login' && <button type="button" className="text-link forgot" onClick={() => { setMode('reset'); setMessage(''); }}>Забыли пароль?</button>}
        {message && <p className="form-message" role="status">{message}</p>}
        <button className="primary-btn submit" disabled={busy || (mode === 'register' && availability === 'Имя занято')} type="submit">{busy ? 'Подождите…' : mode === 'login' ? 'Войти' : mode === 'register' ? 'Создать аккаунт' : 'Отправить письмо'} <ArrowRight size={18}/></button>
      </form>
      <div className="auth-switch">{mode === 'login' ? <>Впервые здесь? <button onClick={() => { setMode('register'); setMessage(''); }}>Зарегистрироваться</button></> : <>Уже есть аккаунт? <button onClick={() => { setMode('login'); setMessage(''); }}>Войти</button></>}</div><div className="auth-trust"><ShieldCheck size={15}/> Ваши разговоры доступны только участникам</div>
    </div></div>
  </main>;
}
