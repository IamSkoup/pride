import { useEffect, useState, type FormEvent } from "react";
import { get, ref } from "firebase/database";
import { Bell, X } from "lucide-react";
import { requireDb } from "../services/firebase";
import { updateMyProfile } from "../services/auth";
import {
  registerPushDevice,
  requestPushPermission,
} from "../services/notifications";
import type { Profile } from "../types";
import {
  changePrideRole,
  moderateMember,
  listen,
  watchActivity,
  worker,
  type Activity,
  type Pride,
  type PrideRole,
} from "./data";
import { errorMessage, time } from "./ui";

export function Member({
  uid,
  role,
  prideId,
  actorRole,
  onError,
}: {
  uid: string;
  role: PrideRole;
  prideId: string;
  actorRole?: PrideRole;
  onError: (message: string) => void;
}) {
  const [name, setName] = useState("Участник");
  useEffect(() => {
    get(ref(requireDb(), `publicProfiles/${uid}`))
      .then((snapshot) => setName(snapshot.val()?.displayName || "Участник"))
      .catch(() => {});
  }, [uid]);
  const canAct = actorRole === "owner" ? role !== "owner" : actorRole === "admin" ? role === "moderator" || role === "member" : actorRole === "moderator" && role === "member";
  async function moderate(action: "kick" | "ban") {
    const reason = window.prompt(action === "ban" ? "Причина блокировки (можно оставить пустой)" : "Причина исключения (можно оставить пустой)");
    if (reason === null) return;
    try { await moderateMember(prideId, uid, action, reason); }
    catch (error) { onError(errorMessage(error)); }
  }
  return (
    <div className="v2-member">
      <span className="v2-avatar tiny">{name.slice(0, 1)}</span>
      <strong>{name}</strong>
      {actorRole === "owner" && role !== "owner" ? (
        <select
          value={role}
          onChange={(event) =>
            changePrideRole(
              prideId,
              uid,
              event.target.value as "admin" | "moderator" | "member",
            ).catch((error) => onError(errorMessage(error)))
          }
        >
          <option value="member">Участник</option>
          <option value="moderator">Модератор</option>
          <option value="admin">Управляющий</option>
        </select>
      ) : (
        <small>
          {role === "owner"
            ? "Владелец"
            : role === "admin"
              ? "Управляющий"
              : role === "moderator"
                ? "Модератор"
              : "Участник"}
        </small>
      )}
      {canAct && <span className="v2-member-actions"><button onClick={() => moderate("kick")}>Исключить</button>{actorRole !== "moderator" && <button onClick={() => moderate("ban")}>Заблокировать</button>}</span>}
    </div>
  );
}
export function EventsPanel({
  uid,
  prides,
  onOpen,
  onError,
}: {
  uid: string;
  prides: Pride[];
  onOpen: (prideId: string, channelId: string) => void;
  onError: (message: string) => void;
}) {
  const [byPride, setByPride] = useState<Record<string, Activity[]>>({});
  const [permission, setPermission] = useState(
    typeof Notification === "undefined"
      ? "unsupported"
      : Notification.permission,
  );
  useEffect(() => {
    const unsubscribers = prides.map((pride) =>
      watchActivity(pride.id, (items) =>
        setByPride((current) => ({ ...current, [pride.id]: items })),
      ),
    );
    return () => unsubscribers.forEach((stop) => stop());
  }, [prides.map((item) => item.id).join(",")]);
  const items = Object.values(byPride)
    .flat()
    .sort((a, b) => b.at - a.at)
    .slice(0, 50);
  async function enablePush() {
    try {
      const result = await requestPushPermission();
      setPermission(result);
      if (result === "granted") await registerPushDevice(uid);
      else onError("Уведомления не разрешены браузером.");
    } catch (error) {
      onError(errorMessage(error));
    }
  }
  return (
    <div className="v2-events">
      <span className="v2-kicker">ПОСЛЕДНИЕ СОБЫТИЯ ПРАЙДОВ</span>
      <h1>Что нового</h1>
      {permission === "default" && (
        <button className="v2-push-enable" onClick={enablePush}>
          <Bell size={17} /> Включить уведомления о личных сообщениях
        </button>
      )}
      {items.length ? (
        items.map((item) => (
          <button
            key={`${item.prideId}:${item.id}`}
            onClick={() => onOpen(item.prideId, item.channelId)}
          >
            <span className="v2-avatar tiny">
              <Bell size={17} />
            </span>
            <span>
              <strong>
                {prides.find((pride) => pride.id === item.prideId)?.title ||
                  "Прайд"}
              </strong>
              <small>{item.preview}</small>
            </span>
            <time>{time(item.at)}</time>
          </button>
        ))
      ) : (
        <p className="v2-muted">
          Новые сообщения в ваших Прайдах появятся здесь.
        </p>
      )}
    </div>
  );
}
export function ProfilePanel({
  uid,
  profile,
  onLogout,
  onShop,
  onError,
}: {
  uid: string;
  profile: Profile | null;
  onLogout: () => void;
  onShop: () => void;
  onError: (message: string) => void;
}) {
  const [economy, setEconomy] = useState<{
    balance?: number;
    subscription?: { tier?: string; expiresAt?: number };
  } | null>(null);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(profile?.displayName || "");
  const [username, setUsername] = useState(profile?.username || "");
  const [bio, setBio] = useState(profile?.bio || "");
  const [saving, setSaving] = useState(false);
  useEffect(() => listen<typeof economy>(`users/${uid}/claws`, setEconomy), [uid]);
  useEffect(() => {
    setName(profile?.displayName || "");
    setUsername(profile?.username || "");
    setBio(profile?.bio || "");
  }, [profile?.displayName, profile?.username, profile?.bio]);
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!profile) return;
    setSaving(true);
    try {
      await updateMyProfile(uid, profile, {
        displayName: name.trim(),
        username: username.trim(),
        bio: bio.trim(),
      });
      setEditing(false);
      worker("v2/profile-sync").catch(() =>
        onError("Профиль сохранён. Синхронизация v2 будет повторена позже."),
      );
    } catch (error) {
      onError(errorMessage(error));
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="v2-profile">
      <div className="v2-profile-cover" />
      <span className="v2-avatar profile">
        {profile?.displayName?.slice(0, 1) || "Я"}
        {profile?.avatar && (
          <img
            src={profile.avatar}
            alt=""
            onError={(event) => {
              event.currentTarget.style.display = "none";
            }}
          />
        )}
      </span>
      <h1>{profile?.displayName || "Мой профиль"}</h1>
      <p>@{profile?.username}</p>
      <div className="v2-profile-grid">
        <article>
          <span>ОБО МНЕ</span>
          <p>{profile?.bio || "Пока без описания"}</p>
        </article>
        <article>
          <span>КОГТИ</span>
          <strong>{economy?.balance ?? 0}</strong>
        </article>
        <article>
          <span>ПОДПИСКА</span>
          <strong>
            {economy?.subscription?.expiresAt &&
            economy.subscription.expiresAt > Date.now()
              ? economy.subscription.tier?.toUpperCase()
              : "Без подписки"}
          </strong>
        </article>
      </div>
      <div className="v2-profile-actions">
        <button className="v2-primary" onClick={onShop}>
          Когти и подарки
        </button>
        <button className="v2-secondary" onClick={() => setEditing(true)}>
          Изменить профиль
        </button>
        <button className="v2-secondary" onClick={onLogout}>
          Выйти из аккаунта
        </button>
      </div>
      {editing && (
        <div
          className="v2-overlay"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setEditing(false);
          }}
        >
          <section
            className="v2-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="Изменить профиль"
          >
            <div className="v2-dialog-head">
              <h2>Изменить профиль</h2>
              <button onClick={() => setEditing(false)} aria-label="Закрыть">
                <X size={19} />
              </button>
            </div>
            <form onSubmit={save}>
              <label>
                Имя
                <input
                  required
                  maxLength={48}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </label>
              <label>
                Username
                <input
                  required
                  maxLength={24}
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                />
              </label>
              <label>
                О себе
                <textarea
                  maxLength={280}
                  rows={3}
                  value={bio}
                  onChange={(event) => setBio(event.target.value)}
                />
              </label>
              <button className="v2-primary" disabled={saving}>
                {saving ? "Сохраняем…" : "Сохранить"}
              </button>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}
