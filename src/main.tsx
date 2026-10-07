import React, { lazy, Suspense, useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ToastProvider } from './components/Toast';
import { configured } from './services/firebase';
import { AuthPage } from './pages/AuthPage';
import './styles.css';

const MessengerPage = lazy(() => import('./pages/MessengerPage').then(module => ({ default: module.MessengerPage })));
const ProfilePage = lazy(() => import('./pages/ProfilePage').then(module => ({ default: module.ProfilePage })));

function OfflineBanner() { const [online, setOnline] = useState(navigator.onLine); useEffect(() => { const up = () => setOnline(true); const down = () => setOnline(false); window.addEventListener('online', up); window.addEventListener('offline', down); return () => { window.removeEventListener('online', up); window.removeEventListener('offline', down); }; }, []); return online ? null : <div className="offline-banner" role="status">Нет соединения. Отправка будет доступна после восстановления сети.</div>; }

function Gate({ children }: { children: React.ReactNode }) { const { user, loading } = useAuth(); const location = useLocation(); if (loading) return <div className="page-loading">Pride Messenger открывается…</div>; return user ? children : <Navigate to={`/?next=${encodeURIComponent(location.pathname)}`} replace/>; }
function App() {
  if (!configured) return <div className="setup-screen"><span className="brand-mark">P</span><h1>Pride Messenger</h1><p>Чтобы запустить мессенджер, создайте файл <code>.env</code> по образцу <code>.env.example</code> и добавьте настройки Firebase. Затем перезапустите Vite.</p><code>cp .env.example .env</code></div>;
  const basename = import.meta.env.BASE_URL.replace(/\/$/, '') || '/';
  return <BrowserRouter basename={basename}><ToastProvider><AuthProvider><OfflineBanner/><Suspense fallback={<div className="page-loading">Загрузка…</div>}><Routes><Route path="/" element={<AuthPage/>}/><Route path="/chats" element={<Gate><MessengerPage/></Gate>}/><Route path="/chat/:id" element={<Gate><MessengerPage/></Gate>}/><Route path="/invite/:inviteId/:inviteCode" element={<Gate><MessengerPage/></Gate>}/><Route path="/profile" element={<Gate><ProfilePage/></Gate>}/><Route path="/settings" element={<Gate><ProfilePage settings/></Gate>}/><Route path="*" element={<Navigate to="/chats" replace/>}/></Routes></Suspense></AuthProvider></ToastProvider></BrowserRouter>;
}
ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);
if ('serviceWorker' in navigator) window.addEventListener('load', () => {
  const base = import.meta.env.BASE_URL;
  navigator.serviceWorker.register(`${base}sw.js`, { scope: base }).catch(error => console.error('Pride service worker registration failed', error));
});
