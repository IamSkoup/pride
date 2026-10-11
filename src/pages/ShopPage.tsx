import { useEffect, useState } from 'react';
import { ArrowLeft, Check, Coins, Sparkles } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Avatar } from '../components/Avatar';
import { useToast } from '../components/Toast';
import { economyAction, getEconomy, type Economy } from '../services/economy';

const plans = [
  { id: 'cheetah', name: 'Cheetah', mark: '01', monthly: 53, yearly: 530, limit: '50 МБ', detail: 'Спокойный первый шаг в Pride Club: вместительные вложения и авторское оформление беседы.', features: ['Файлы до 50 МБ', 'Фон сообщения «Медный свет»', 'Профиль в тёплой палитре заката'] },
  { id: 'leopard', name: 'Leopard', mark: '02', monthly: 99, yearly: 990, limit: '75 МБ', detail: 'Больше пространства для медиа, выразительные фоны и глубокий вечерний стиль.', features: ['Файлы до 75 МБ', 'Фоны «Медный свет» и «Гребень дюн»', 'Расширенный градиент профиля'] },
  { id: 'lion', name: 'Lion', mark: '03', monthly: 166, yearly: 1660, limit: '100 МБ', detail: 'Полный набор оформления Pride: простор для крупных файлов и все эксклюзивные фоны.', features: ['Файлы до 100 МБ', 'Все три клубных фона сообщений', 'Премиальный профиль с золотым горизонтом'] },
];
const frames = [
  { id: 'ember', name: 'Угольный отблеск', price: 35, color: 'ember' },
  { id: 'sunset', name: 'Закатное золото', price: 60, color: 'sunset' },
  { id: 'constellation', name: 'Звёздная тропа', price: 90, color: 'constellation' },
  { id: 'dune', name: 'Линия дюн', price: 75, color: 'dune' },
  { id: 'acacia', name: 'Ветви акации', price: 110, color: 'acacia' },
  { id: 'copper', name: 'Медный ореол', price: 130, color: 'copper' },
];
export default function ShopPage() {
  const { user } = useAuth(); const { toast } = useToast();
  const [wallet, setWallet] = useState<Economy | null>(null); const [period, setPeriod] = useState<'month' | 'year'>('month'); const [busy, setBusy] = useState('');
  async function refresh() { if (user) try { setWallet(await getEconomy()); } catch (error) { toast((error as Error).message, 'error'); } }
  useEffect(() => { void refresh(); }, [user?.uid]);
  async function run(key: string, action: () => Promise<Economy>, message: string) {
    if (busy) return false; setBusy(key);
    try { setWallet(await action()); toast(message); return true; } catch (error) { toast((error as Error).message, 'error'); return false; }
    finally { setBusy(''); }
  }
  const daysLeft = (until?: number) => until && until > Date.now() ? Math.ceil((until - Date.now()) / 86400000) : 0;
  const dailyReady = !wallet?.dailyAt || Date.now() - wallet.dailyAt >= 20 * 60 * 60 * 1000;
  return <main className="shop-page">
    <header className="profile-top"><Link to="/chats" className="back-link"><ArrowLeft size={19}/> К чатам</Link><Link to="/profile" className="back-link">Профиль</Link></header>
    <section className="shop-content"><span className="eyebrow">РЫНОК ПРАЙДА</span><h1>Соберите свой образ</h1><p className="subtle">Поддержите свой прайд, откройте оформление профиля и отметьте важные разговоры подарком.</p>
      <div className="wallet-card"><div className="wallet-claw">✦</div><div><small>ВАШ КОШЕЛЁК</small><strong>{wallet?.balance ?? '—'} Claws</strong><span>1 Claw = 1,5 ₽ · цены подписок показаны в Claws</span></div><button className="secondary-btn" disabled title="Пополнение станет доступно после подключения платёжного провайдера"><Coins size={17}/> Купить Claws</button></div>
      <div className="daily-reward"><div><strong><Sparkles size={17}/> Награда дня</strong><span>Забирайте 3 Claws раз в сутки — маленький бонус за возвращение.</span></div><button className="primary-btn" disabled={!dailyReady || busy !== ''} onClick={() => void run('daily', () => economyAction('daily'), '+3 Claws уже в кошельке')}>{dailyReady ? 'Забрать 3 Claws' : 'Уже получено'}</button></div>
      <div className="shop-section-head"><div><span className="eyebrow">PRIDE CLUB</span><h2>Подписки</h2></div><div className="segmented shop-period"><button className={period === 'month' ? 'active' : ''} onClick={() => setPeriod('month')}>Месяц</button><button className={period === 'year' ? 'active' : ''} onClick={() => setPeriod('year')}>Год · −17%</button></div></div>
      <div className="plan-grid">{plans.map(plan => { const price = period === 'year' ? plan.yearly : plan.monthly; const active = wallet?.subscription?.tier === plan.id && daysLeft(wallet.subscription.expiresAt) > 0; return <article className={`plan-card plan-${plan.id}`} key={plan.id}><span className="plan-mark" aria-hidden="true">{plan.mark}</span><span className="eyebrow">PRIDE CLUB · {plan.limit}</span><h3>{plan.name}</h3><p>{plan.detail}</p><ul className="plan-features">{plan.features.map(feature => <li key={feature}><Check size={14}/>{feature}</li>)}</ul><strong className="plan-price">{price} <small>Claws / {period === 'year' ? 'год' : 'месяц'}</small></strong><small className="rub-equivalent">≈ {(price * 1.5).toLocaleString('ru-RU')} ₽</small>{active ? <span className="active-plan"><Check size={16}/> Активна · ещё {daysLeft(wallet?.subscription?.expiresAt)} дн.</span> : <button className="primary-btn" disabled={!wallet || busy !== ''} onClick={() => void run(plan.id, () => economyAction('subscribe', { tier: plan.id, period }), `${plan.name} подключён`)}>{busy === plan.id ? 'Оформляем…' : 'Оформить за Claws'}</button>}</article>; })}</div>
      <section className="shop-section"><div className="shop-section-head"><div><span className="eyebrow">НА 30 ДНЕЙ</span><h2>Рамки профиля</h2></div><span className="shop-note">Аренда сохраняется в аккаунте</span></div><div className="frame-grid">{frames.map(frame => { const active = daysLeft(wallet?.frames?.[frame.id]) > 0; return <article className="frame-card" key={frame.id}><div className={`frame-demo frame-${frame.color}`}><span><Avatar name="P" size={42}/></span></div><h3>{frame.name}</h3><p>{frame.price} Claws <small>· ≈ {(frame.price * 1.5).toLocaleString('ru-RU')} ₽</small></p>{active ? <button className="secondary-btn" disabled={busy !== ''} onClick={() => void run(`equip-${frame.id}`, () => economyAction('equip', { equipped: frame.id }), 'Рамка выбрана')}>{wallet?.equippedFrame === frame.id ? 'Сейчас надета' : 'Надеть рамку'}</button> : <button className="secondary-btn" disabled={!wallet || busy !== ''} onClick={() => void run(frame.id, () => economyAction('frame', { frame: frame.id }), 'Рамка добавлена на 30 дней')}>{busy === frame.id ? 'Добавляем…' : 'Арендовать на 30 дней'}</button>}</article>; })}</div></section>
      <section className="gifts-callout"><div className="gift-emblem"><span/></div><div className="gift-copy"><strong>Подарки отправляют из чата</strong><p>Откройте личную переписку и выберите сувенир саванны. Он появится в сообщениях и подарках профиля; получатель сможет оставить его или вернуть половину цены в Claws.</p></div></section>
      <section className="ledger"><h2>История кошелька</h2>{wallet?.ledger?.length ? wallet.ledger.slice().reverse().slice(0,8).map(entry => <div className="ledger-row" key={entry.id}><span>{entry.label}<small>{new Date(entry.at).toLocaleString('ru-RU')}</small></span><strong className={entry.amount >= 0 ? 'positive' : ''}>{entry.amount > 0 ? '+' : ''}{entry.amount} Claws</strong></div>) : <p className="subtle">Здесь появятся награды и покупки.</p>}</section>
      <p className="shop-footnote">Пополнение за рубли откроем после подключения платёжного провайдера и проверки платежей. Claws начисляются только после подтверждения оплаты на сервере.</p>
    </section>
  </main>;
}
