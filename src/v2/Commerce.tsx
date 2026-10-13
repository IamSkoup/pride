import { useEffect, useState } from "react";
import { Gift, Sparkles } from "lucide-react";
import { get, ref } from "firebase/database";
import { requireDb } from "../services/firebase";
import { listen, worker } from "./data";

type Wallet = {
  balance?: number;
  dailyAt?: number;
  subscription?: { tier: string; expiresAt: number };
  frames?: Record<string, number>;
  equippedFrame?: string;
  ledger?: Array<{ id: string; label: string; amount: number; at: number }>;
};
type ReceivedGift = {
  id: string;
  instanceId: string;
  price: number;
  senderId: string;
  visible?: boolean;
  sold?: boolean;
};
const plans = [
  { id: "cheetah", name: "Cheetah", month: 53, year: 530 },
  { id: "leopard", name: "Leopard", month: 99, year: 990 },
  { id: "lion", name: "Lion", month: 166, year: 1660 },
];
const gifts = [
  { id: "sunstone", name: "Солнечный камень", price: 12, symbol: "◈" },
  { id: "acacia", name: "Венок акации", price: 35, symbol: "✿" },
  { id: "horizon", name: "Золотой горизонт", price: 65, symbol: "✦" },
  { id: "baobab", name: "Память баобаба", price: 110, symbol: "❖" },
];

export function CommercePanel({
  uid,
  onError,
}: {
  uid: string;
  onError: (message: string) => void;
}) {
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [inventory, setInventory] = useState<Record<string, ReceivedGift>>({});
  const [busy, setBusy] = useState("");
  const [period, setPeriod] = useState<"month" | "year">("month");
  useEffect(() => listen<Wallet>(`users/${uid}/claws`, setWallet), [uid]);
  useEffect(
    () =>
      listen<Record<string, ReceivedGift>>(`receivedGifts/${uid}`, (value) =>
        setInventory(value || {}),
      ),
    [uid],
  );
  async function act(
    key: string,
    route: string,
    body: Record<string, unknown>,
  ) {
    setBusy(key);
    try {
      await worker(route, body);
    } catch (error) {
      onError(
        error instanceof Error ? error.message : "Операция не выполнена.",
      );
    } finally {
      setBusy("");
    }
  }
  async function subscribe(plan: string) {
    const key = `pride-op:${uid}:${plan}:${period}`;
    let operationId = localStorage.getItem(key);
    if (!operationId) {
      operationId = crypto.randomUUID();
      localStorage.setItem(key, operationId);
    }
    await act(plan, "economy", {
      action: "subscribe",
      tier: plan,
      period,
      operationId,
    });
    // A successful wallet snapshot has the operation in its ledger; a failed request keeps the key for safe retry.
    const snapshot = await get(
      ref(requireDb(), `users/${uid}/claws/operations/${operationId}`),
    ).catch(() => null);
    if (snapshot?.val() === "subscribe") localStorage.removeItem(key);
  }
  const dailyReady =
    !wallet?.dailyAt || Date.now() - wallet.dailyAt >= 20 * 60 * 60 * 1000;
  return (
    <div className="v2-commerce">
      <span className="v2-kicker">РЫНОК САВАННЫ</span>
      <h1>Ваши Когти и подарки</h1>
      <div className="v2-wallet">
        <span className="v2-wallet-mark">✦</span>
        <div>
          <small>ВАШ БАЛАНС</small>
          <strong>{wallet?.balance ?? 0} Claws</strong>
        </div>
        <button
          className="v2-secondary"
          disabled={!dailyReady || Boolean(busy)}
          onClick={() => act("daily", "economy", { action: "daily" })}
        >
          {dailyReady ? "Забрать 3 Claws" : "Награда получена"}
        </button>
      </div>
      <section>
        <div className="v2-section-heading">
          <div>
            <span className="v2-kicker">PRIDE CLUB</span>
            <h2>Подписки</h2>
          </div>
          <div className="v2-switch">
            <button
              className={period === "month" ? "selected" : ""}
              onClick={() => setPeriod("month")}
            >
              Месяц
            </button>
            <button
              className={period === "year" ? "selected" : ""}
              onClick={() => setPeriod("year")}
            >
              Год
            </button>
          </div>
        </div>
        <div className="v2-plan-grid">
          {plans.map((plan) => (
            <article key={plan.id}>
              <Sparkles size={19} />
              <h3>{plan.name}</h3>
              <p>
                {plan.id === "lion"
                  ? "Все клубные оформления и файлы до 100 МБ"
                  : plan.id === "leopard"
                    ? "Клубные оформления и файлы до 75 МБ"
                    : "Тёплый клубный стиль и файлы до 50 МБ"}
              </p>
              <strong>
                {period === "month" ? plan.month : plan.year} Claws
              </strong>
              {wallet?.subscription?.tier === plan.id &&
              wallet.subscription.expiresAt > Date.now() ? (
                <small>
                  Активна до{" "}
                  {new Date(wallet.subscription.expiresAt).toLocaleDateString(
                    "ru-RU",
                  )}
                </small>
              ) : (
                <button
                  className="v2-primary"
                  disabled={
                    Boolean(busy) ||
                    (wallet?.balance || 0) <
                      (period === "month" ? plan.month : plan.year)
                  }
                  onClick={() => subscribe(plan.id)}
                >
                  {busy === plan.id ? "Оформляем…" : "Оформить"}
                </button>
              )}
            </article>
          ))}
        </div>
      </section>
      <section>
        <div className="v2-section-heading">
          <div>
            <span className="v2-kicker">КОЛЛЕКЦИЯ</span>
            <h2>Подарки</h2>
          </div>
        </div>
        {Object.keys(inventory).length ? (
          <div className="v2-gift-list">
            {Object.values(inventory).map((item) => (
              <article key={item.instanceId}>
                <span className="v2-gift-symbol">
                  {gifts.find((gift) => gift.id === item.id)?.symbol || "✦"}
                </span>
                <div>
                  <strong>
                    {gifts.find((gift) => gift.id === item.id)?.name ||
                      "Подарок"}
                  </strong>
                  <small>
                    {item.sold
                      ? "Обменян на Claws"
                      : item.visible
                        ? "Показан в профиле"
                        : "В коллекции"}
                  </small>
                </div>
                {!item.sold && (
                  <>
                    <button
                      className="v2-secondary"
                      disabled={Boolean(busy)}
                      onClick={() =>
                        act(item.instanceId, "gifts/show", {
                          instanceId: item.instanceId,
                        })
                      }
                    >
                      {item.visible ? "Скрыть" : "Показать"}
                    </button>
                    <button
                      className="v2-secondary"
                      disabled={Boolean(busy)}
                      onClick={() => {
                        if (
                          window.confirm(
                            `Обменять подарок на ${Math.floor(item.price / 2)} Claws?`,
                          )
                        )
                          act(item.instanceId, "gifts/sell", {
                            instanceId: item.instanceId,
                          });
                      }}
                    >
                      Обменять
                    </button>
                  </>
                )}
              </article>
            ))}
          </div>
        ) : (
          <p className="v2-muted">
            Подарки, полученные в личных беседах, появятся здесь.
          </p>
        )}
      </section>
      <section>
        <div className="v2-section-heading">
          <div>
            <span className="v2-kicker">ИСТОРИЯ</span>
            <h2>Операции</h2>
          </div>
        </div>
        {wallet?.ledger?.length ? (
          wallet.ledger
            .slice()
            .reverse()
            .slice(0, 12)
            .map((item) => (
              <div className="v2-ledger" key={item.id}>
                <span>{item.label}</span>
                <strong>
                  {item.amount > 0 ? "+" : ""}
                  {item.amount}
                </strong>
              </div>
            ))
        ) : (
          <p className="v2-muted">Здесь появятся награды и покупки.</p>
        )}
      </section>
    </div>
  );
}

export function GiftPicker({
  chatId,
  onClose,
  onError,
}: {
  chatId: string;
  onClose: () => void;
  onError: (message: string) => void;
}) {
  const [busy, setBusy] = useState("");
  async function send(giftId: string) {
    setBusy(giftId);
    const key = `pride-gift:${chatId}:${giftId}`;
    let instanceId = localStorage.getItem(key);
    if (!instanceId) {
      instanceId = crypto.randomUUID();
      localStorage.setItem(key, instanceId);
    }
    try {
      await worker("gifts/send", { chatId, giftId, instanceId });
      localStorage.removeItem(key);
      onClose();
    } catch (error) {
      onError(
        error instanceof Error
          ? error.message
          : "Не удалось отправить подарок.",
      );
    } finally {
      setBusy("");
    }
  }
  return (
    <div
      className="v2-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="v2-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Подарить сувенир"
      >
        <div className="v2-dialog-head">
          <div>
            <span className="v2-kicker">ПОДАРОК ИЗ САВАННЫ</span>
            <h2>Отправить подарок</h2>
          </div>
          <button onClick={onClose}>×</button>
        </div>
        <div className="v2-gift-options">
          {gifts.map((gift) => (
            <button
              key={gift.id}
              disabled={Boolean(busy)}
              onClick={() => send(gift.id)}
            >
              <span>{gift.symbol}</span>
              <strong>{gift.name}</strong>
              <small>{gift.price} Claws</small>
              <Gift size={16} />
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
