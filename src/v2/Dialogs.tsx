import { useEffect, useState, type FormEvent } from "react";
import { Compass, MessageCircle, Search, X } from "lucide-react";
import {
  createChannel,
  createLegacyGroup,
  createPride,
  exactUser,
  joinPride,
  openDirect,
  searchUsers,
  type Pride,
  type Room,
} from "./data";
import type { Profile } from "../types";
import { errorMessage, type Dialog } from "./ui";

export function SearchDialog({
  rooms,
  prides,
  uid,
  onClose,
  onSelect,
  onPride,
  onChat,
  onError,
}: {
  rooms: Room[];
  prides: Pride[];
  uid: string;
  onClose: () => void;
  onSelect: (room: Room) => void;
  onPride: (pride: Pride) => void;
  onChat: (id: string) => void;
  onError: (message: string) => void;
}) {
  const [value, setValue] = useState("");
  const [users, setUsers] = useState<
    Array<Pick<Profile, "uid" | "username" | "displayName" | "avatar">>
  >([]);
  const needle = value.toLowerCase();
  useEffect(() => {
    const handle = value.trim().replace(/^@/, "");
    if (handle.length < 2) {
      setUsers([]);
      return;
    }
    let active = true;
    const timer = window.setTimeout(
      () =>
        searchUsers(handle)
          .then((result) => {
            if (active) setUsers(result.users);
          })
          .catch((error) => {
            if (active) onError(errorMessage(error));
          }),
      250,
    );
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [value]);
  async function selectUser(otherUid: string) {
    try {
      onChat(await openDirect(uid, otherUid));
    } catch (error) {
      onError(errorMessage(error));
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
        className="v2-dialog v2-search-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Поиск"
      >
        <div className="v2-search-field">
          <Search size={20} />
          <input
            autoFocus
            placeholder="Чат, Прайд или @username…"
            value={value}
            onChange={(event) => setValue(event.target.value)}
          />
          <button onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <div className="v2-search-results">
          {rooms
            .filter((item) => item.title.toLowerCase().includes(needle))
            .map((item) => (
              <button key={item.id} onClick={() => onSelect(item)}>
                <MessageCircle size={18} />
                {item.title}
              </button>
            ))}
          {prides
            .filter((item) => item.title.toLowerCase().includes(needle))
            .map((item) => (
              <button key={item.id} onClick={() => onPride(item)}>
                <Compass size={18} />
                {item.title}
              </button>
            ))}
          {users
            .filter((user) => user.uid !== uid)
            .map((user) => (
              <button key={user.uid} onClick={() => selectUser(user.uid)}>
                <span className="v2-avatar tiny">
                  {user.displayName.slice(0, 1).toUpperCase()}
                </span>
                <span>
                  {user.displayName} <small>@{user.username}</small>
                </span>
              </button>
            ))}
        </div>
      </section>
    </div>
  );
}
export function CreateDialog({
  kind,
  pride,
  uid,
  onClose,
  onDone,
  onError,
}: {
  kind: Dialog;
  pride?: Pride;
  uid: string;
  onClose: () => void;
  onDone: (path: string) => void;
  onError: (message: string) => void;
}) {
  const [value, setValue] = useState("");
  const [extra, setExtra] = useState("");
  const [channelKind, setChannelKind] = useState<"text" | "chronicle">("text");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setValue("");
    setExtra("");
  }, [kind]);
  if (!kind) return null;
  const titles = {
    dm: "Новое сообщение",
    group: "Создать группу",
    pride: "Новый Прайд",
    channel: "Новая Тропа",
    join: "Вступить в Прайд",
  };
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      if (kind === "dm") {
        const found = await exactUser(value);
        if (!found)
          throw new Error("Пользователь не найден. Введите точный @username.");
        onDone(`/chat/${await openDirect(uid, found.uid)}`);
      }
      if (kind === "group")
        onDone(`/chat/${await createLegacyGroup(uid, value, "group")}`);
      if (kind === "pride") {
        const result = await createPride(value);
        onDone(`/pride/${result.prideId}/channel/${result.channelId}`);
      }
      if (kind === "channel" && pride) {
        const result = await createChannel(pride.id, value, channelKind);
        onDone(`/pride/${pride.id}/channel/${result.channelId}`);
      }
      if (kind === "join") {
        const match = /\/invite\/([a-zA-Z0-9_-]+)\/([a-zA-Z0-9_-]+)/.exec(
          value,
        );
        const prideId = match?.[1] || value.trim();
        if (!extra && !match) throw new Error("Укажите код зова.");
        await joinPride(prideId, match?.[2] || extra);
        onDone(`/pride/${prideId}`);
      }
    } catch (error) {
      onError(errorMessage(error));
    } finally {
      setBusy(false);
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
        aria-label={titles[kind]}
      >
        <div className="v2-dialog-head">
          <div>
            <span className="v2-kicker">НОВЫЙ ШАГ</span>
            <h2>{titles[kind]}</h2>
          </div>
          <button onClick={onClose} aria-label="Закрыть">
            <X size={20} />
          </button>
        </div>
        <form onSubmit={submit}>
          <label>
            {kind === "dm"
              ? "Username"
              : kind === "join"
                ? "Ссылка зова или ID Прайда"
                : "Название"}
            <input
              autoFocus
              required
              maxLength={kind === "join" ? 300 : 64}
              value={value}
              onChange={(event) => setValue(event.target.value)}
              placeholder={
                kind === "dm"
                  ? "@username"
                  : kind === "join"
                    ? "Вставьте ссылку"
                    : "Введите название"
              }
            />
          </label>
          {kind === "join" && (
            <label>
              Код зова, если указан ID
              <input
                value={extra}
                onChange={(event) => setExtra(event.target.value)}
              />
            </label>
          )}
          {kind === "channel" && (
            <label>
              Тип
              <select
                value={channelKind}
                onChange={(event) =>
                  setChannelKind(event.target.value as "text" | "chronicle")
                }
              >
                <option value="text">Тропа · общение</option>
                <option value="chronicle">Хроника · объявления</option>
              </select>
            </label>
          )}
          <button className="v2-primary" disabled={busy}>
            {busy ? "Сохраняем…" : kind === "join" ? "Вступить" : "Продолжить"}
          </button>
        </form>
      </section>
    </div>
  );
}
