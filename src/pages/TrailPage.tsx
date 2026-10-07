import { ArrowLeft, Bookmark, Trash2 } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { ref, set } from 'firebase/database';
import { useAuth } from '../context/AuthContext';
import { useFirebaseValue } from '../hooks/useFirebaseValue';
import { requireDb } from '../services/firebase';
import { useToast } from '../components/Toast';

type TrailEntry = { chatId: string; messageId: string; preview: string; authorId: string; chatTitle: string; createdAt: number; mediaKind?: string | null };

export function TrailPage() {
  const { user } = useAuth();
  const [entries] = useFirebaseValue<Record<string, TrailEntry>>(user ? `trail/${user.uid}` : null);
  const { toast } = useToast();
  const navigate = useNavigate();
  const ordered = Object.entries(entries || {}).sort((a, b) => b[1].createdAt - a[1].createdAt);
  async function remove(id: string) {
    if (!user) return;
    try { await set(ref(requireDb(), `trail/${user.uid}/${id}`), null); toast('Удалено из Тропы'); }
    catch (error) { toast((error as Error).message, 'error'); }
  }
  return <main className="trail-page"><header className="profile-top"><Link to="/chats" className="back-link"><ArrowLeft size={19}/> К чатам</Link></header><section className="trail-content"><span className="eyebrow">ЛИЧНАЯ КОЛЛЕКЦИЯ</span><h1><Bookmark size={25}/> Тропа</h1><p className="subtle">Сохранённые ссылки на сообщения видны только вам. Если исходное сообщение станет недоступно, запись останется здесь.</p>{ordered.length ? <div className="trail-list">{ordered.map(([id, item]) => <TrailRow key={id} item={item} onOpen={() => navigate(`/chat/${item.chatId}`, { state: { messageId: item.messageId } })} onRemove={() => void remove(id)}/>)}</div> : <div className="trail-empty"><Bookmark size={30}/><strong>Пока ничего не сохранено</strong><span>В меню сообщения выберите «Сохранить в Тропу».</span></div>}</section></main>;
}

function TrailRow({ item, onOpen, onRemove }: { item: TrailEntry; onOpen: () => void; onRemove: () => void }) {
  const [message] = useFirebaseValue<{ id?: string }>(`messages/${item.chatId}/${item.messageId}`);
  return <article className="trail-row"><button className="trail-open" onClick={onOpen} disabled={!message}><strong>{item.chatTitle || 'Исходный чат'}</strong><span>{message ? item.preview || (item.mediaKind ? `Вложение · ${item.mediaKind}` : 'Сообщение') : 'Исходное сообщение больше недоступно'}</span><small>{new Date(item.createdAt).toLocaleString('ru-RU')} · {item.mediaKind || 'текст'}</small></button><button className="icon-btn danger" onClick={onRemove} aria-label="Удалить из Тропы"><Trash2 size={17}/></button></article>;
}
