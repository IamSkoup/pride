import { useEffect, useRef, useState, type FormEvent } from "react";
import { get, push, ref } from "firebase/database";
import { Gift, Paperclip, Send, Shield, X } from "lucide-react";
import { requireDb } from "../services/firebase";
import { mediaObjectUrl } from "../services/chats";
import { GiftPicker } from "./Commerce";
import {
  deleteInRoom,
  editInRoom,
  listen,
  messagesPath,
  olderMessages,
  reactInRoom,
  reportMessage,
  saveDraft,
  sendLegacyAttachment,
  sendToRoom,
  watchMessages,
  type Room,
  type RoomMessage,
  type PrideRole,
} from "./data";
import { errorMessage, time } from "./ui";

export function Conversation({
  room,
  uid,
  role,
  onError,
}: {
  room: Room;
  uid: string;
  role?: PrideRole;
  onError: (message: string) => void;
}) {
  const [messages, setMessages] = useState<RoomMessage[]>([]);
  const [older, setOlder] = useState<RoomMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [reply, setReply] = useState<RoomMessage | null>(null);
  const [pending, setPending] = useState<Record<string, RoomMessage>>({});
  const [loading, setLoading] = useState(true);
  const [olderBusy, setOlderBusy] = useState(false);
  const [authors, setAuthors] = useState<Record<string, string>>({});
  const bottom = useRef<HTMLDivElement>(null);
  const [legacyRole, setLegacyRole] = useState<string | null>(null);
  const [giftOpen, setGiftOpen] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (room.kind === "legacy")
      return listen<string>(`chatMembers/${room.id}/${uid}`, setLegacyRole);
  }, [room.id, room.kind, uid]);
  useEffect(() => {
    setLoading(true);
    setOlder([]);
    setMessages([]);
    setPending({});
    return watchMessages(
      room,
      (value) => {
        setMessages(value);
        setLoading(false);
      },
      (error) => {
        onError(errorMessage(error));
        setLoading(false);
      },
    );
  }, [room.id]);
  useEffect(
    () =>
      listen<string>(
        `${room.kind === "legacy" ? "drafts" : "v2/drafts"}/${uid}/${room.id}`,
        (value) => setDraft(value || ""),
      ),
    [room.id, uid],
  );
  useEffect(() => {
    const ids = [
      ...new Set(messages.map((message) => message.senderId)),
    ].filter((id) => id && !authors[id]);
    if (!ids.length) return;
    Promise.all(
      ids.map(async (id) => {
        const value = (
          await get(ref(requireDb(), `publicProfiles/${id}`))
        ).val() as { displayName?: string } | null;
        return [id, value?.displayName || "Участник"] as const;
      }),
    )
      .then((found) =>
        setAuthors((current) => ({ ...current, ...Object.fromEntries(found) })),
      )
      .catch(() => {});
  }, [messages]);
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [messages.length, room.id]);
  const combined = [
    ...older,
    ...messages.filter(
      (item) => !older.some((previous) => previous.id === item.id),
    ),
    ...Object.values(pending).filter(
      (item) => !messages.some((saved) => saved.id === item.id),
    ),
  ];
  async function submit(event: FormEvent) {
    event.preventDefault();
    const text = draft.trim();
    if (!text) return;
    const id = push(ref(requireDb(), messagesPath(room))).key!;
    const optimistic: RoomMessage = {
      id,
      senderId: uid,
      text,
      createdAt: Date.now(),
      replyTo: reply?.id,
      status: "sending",
    };
    setPending((current) => ({ ...current, [id]: optimistic }));
    setDraft("");
    setReply(null);
    saveDraft(room, uid, "").catch(() => {});
    try {
      await sendToRoom(room, uid, text, id, optimistic.replyTo);
      setPending((current) => {
        const next = { ...current };
        delete next[id];
        return next;
      });
    } catch (error) {
      setPending((current) => ({
        ...current,
        [id]: { ...optimistic, status: "error" },
      }));
      onError(errorMessage(error));
    }
  }
  async function retry(message: RoomMessage) {
    setPending((current) => ({
      ...current,
      [message.id]: { ...message, status: "sending" },
    }));
    try {
      await sendToRoom(room, uid, message.text, message.id, message.replyTo);
      setPending((current) => {
        const next = { ...current };
        delete next[message.id];
        return next;
      });
    } catch (error) {
      setPending((current) => ({
        ...current,
        [message.id]: { ...message, status: "error" },
      }));
      onError(errorMessage(error));
    }
  }
  async function loadOlder() {
    const first = (older[0] || messages[0])?.id;
    if (!first) return;
    setOlderBusy(true);
    try {
      const batch = await olderMessages(room, first);
      setOlder((current) => [
        ...batch.filter(
          (item) => !current.some((existing) => existing.id === item.id),
        ),
        ...current,
      ]);
    } catch (error) {
      onError(errorMessage(error));
    } finally {
      setOlderBusy(false);
    }
  }
  async function attach(file?: File) {
    if (!file) return;
    setUploadProgress(0);
    try {
      await sendLegacyAttachment(room, uid, file, setUploadProgress);
    } catch (error) {
      onError(errorMessage(error));
    } finally {
      setUploadProgress(null);
      if (fileInput.current) fileInput.current.value = "";
    }
  }
  const canWrite =
    room.kind === "legacy"
      ? room.chat?.kind !== "channel" ||
        legacyRole === "owner" ||
        legacyRole === "admin"
      : room.channel?.kind !== "chronicle" ||
        role === "owner" ||
        role === "admin";
  return (
    <div className="v2-conversation">
      <div className="v2-messages" aria-live="polite">
        {combined.length > 0 && (
          <button
            className="v2-load-more"
            onClick={loadOlder}
            disabled={olderBusy}
          >
            {olderBusy ? "Загружаем…" : "Показать ранние сообщения"}
          </button>
        )}
        {loading && <div className="v2-skeleton" />}
        {!loading && !combined.length && (
          <div className="v2-first-message">
            <span className="v2-avatar large">{room.title.slice(0, 1)}</span>
            <h2>Начало Тропы</h2>
            <p>Здесь пока тихо. Оставьте первый след.</p>
          </div>
        )}
        {combined.map((message) => (
          <MessageRow
            key={message.id}
            room={room}
            uid={uid}
            message={message}
            own={message.senderId === uid}
            canModerate={room.kind === "channel" && (role === "owner" || role === "admin" || role === "moderator")}
            author={authors[message.senderId]}
            onReply={() => setReply(message)}
            onRetry={() => retry(message)}
            onError={onError}
          />
        ))}
        <div ref={bottom} />
      </div>
      <div className="v2-composer-wrap">
        {reply && (
          <div className="v2-reply">
            <span>Ответ на сообщение · {reply.text.slice(0, 80)}</span>
            <button onClick={() => setReply(null)} aria-label="Отменить ответ">
              <X size={16} />
            </button>
          </div>
        )}
        {uploadProgress !== null && (
          <div className="v2-upload-status">
            Загрузка вложения · {uploadProgress}%
          </div>
        )}
        {canWrite ? (
          <form className="v2-composer" onSubmit={submit}>
            {room.kind === "legacy" && (
              <>
                <input
                  ref={fileInput}
                  type="file"
                  className="v2-file-input"
                  onChange={(event) => attach(event.target.files?.[0])}
                />
                <button
                  type="button"
                  className="v2-gift-trigger"
                  disabled={uploadProgress !== null}
                  onClick={() => fileInput.current?.click()}
                  aria-label="Прикрепить файл"
                >
                  <Paperclip size={18} />
                </button>
              </>
            )}
            {room.kind === "legacy" && room.chat?.kind === "dm" && (
              <button
                type="button"
                className="v2-gift-trigger"
                onClick={() => setGiftOpen(true)}
                aria-label="Подарить"
              >
                <Gift size={19} />
              </button>
            )}
            <textarea
              aria-label="Сообщение"
              value={draft}
              rows={1}
              maxLength={8000}
              placeholder={`Сообщение в ${room.title}`}
              onChange={(event) => {
                setDraft(event.target.value);
              }}
              onBlur={() => saveDraft(room, uid, draft).catch(() => {})}
              onKeyDown={(event) => {
                if (
                  event.key === "Enter" &&
                  !event.shiftKey &&
                  !event.nativeEvent.isComposing
                ) {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }
              }}
            />
            <button
              type="submit"
              disabled={!draft.trim()}
              aria-label="Отправить"
            >
              <Send size={19} />
            </button>
          </form>
        ) : (
          <div className="v2-readonly">
            <Shield size={17} /> Публиковать в Хронике могут управляющие
            Прайдом.
          </div>
        )}
        <small>Enter — отправить · Shift+Enter — новая строка</small>
      </div>
      {giftOpen && (
        <GiftPicker
          chatId={room.id}
          onClose={() => setGiftOpen(false)}
          onError={onError}
        />
      )}
    </div>
  );
}
function MessageRow({
  room,
  uid,
  message,
  own,
  canModerate,
  author,
  onReply,
  onRetry,
  onError,
}: {
  room: Room;
  uid: string;
  message: RoomMessage;
  own: boolean;
  canModerate: boolean;
  author?: string;
  onReply: () => void;
  onRetry: () => void;
  onError: (message: string) => void;
}) {
  const [legacyReactions, setLegacyReactions] = useState<
    Record<string, string>
  >({});
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(message.text);
  useEffect(() => {
    if (room.kind === "legacy" && !message.status)
      return listen<Record<string, string>>(
        `reactions/${room.id}/${message.id}`,
        (value) => setLegacyReactions(value || {}),
      );
  }, [room.id, room.kind, message.id, message.status]);
  const reactions =
    room.kind === "legacy" ? legacyReactions : message.reactions || {};
  const counts = Object.values(reactions).reduce<Record<string, number>>(
    (result, emoji) => {
      result[emoji] = (result[emoji] || 0) + 1;
      return result;
    },
    {},
  );
  async function react(emoji: string) {
    try {
      await reactInRoom(
        room,
        uid,
        message.id,
        reactions[uid] === emoji ? null : emoji,
      );
    } catch (error) {
      onError(errorMessage(error));
    }
  }
  async function saveEdit(event: FormEvent) {
    event.preventDefault();
    try {
      await editInRoom(room, message.id, text);
      setEditing(false);
    } catch (error) {
      onError(errorMessage(error));
    }
  }
  async function remove() {
    if (!window.confirm("Удалить сообщение у всех?")) return;
    try {
      await deleteInRoom(room, uid, message.id);
    } catch (error) {
      onError(errorMessage(error));
    }
  }
  async function report() {
    const reason = window.prompt("Причина жалобы на сообщение");
    if (reason === null) return;
    try { await reportMessage(room, message.id, reason); onError("Жалоба отправлена модераторам Прайда."); }
    catch (error) { onError(errorMessage(error)); }
  }
  return (
    <article className={`v2-message ${own ? "own" : ""}`}>
      <span className="v2-avatar tiny">
        {(author || (own ? "Я" : "У")).slice(0, 1)}
      </span>
      <div className="v2-message-content">
        <div className="v2-message-meta">
          <strong>{own ? "Вы" : author || "Участник"}</strong>
          <time>{time(message.createdAt)}</time>
          {message.status === "sending" && <em>Отправка…</em>}
        </div>
        {message.replyTo && (
          <div className="v2-message-reply">↳ Ответ на сообщение</div>
        )}
        {!message.deleted && message.media && (
          <LegacyMedia media={message.media} />
        )}
        {editing ? (
          <form className="v2-edit-message" onSubmit={saveEdit}>
            <textarea
              value={text}
              maxLength={8000}
              onChange={(event) => setText(event.target.value)}
            />
            <button type="submit">Сохранить</button>
            <button type="button" onClick={() => setEditing(false)}>
              Отмена
            </button>
          </form>
        ) : (
          <div className="v2-message-text">
            {message.deleted ? "Сообщение удалено" : message.text}
          </div>
        )}
        {Object.entries(counts).length > 0 && (
          <div className="v2-reactions">
            {Object.entries(counts).map(([emoji, count]) => (
              <button
                className={reactions[uid] === emoji ? "mine" : ""}
                key={emoji}
                onClick={() => react(emoji)}
              >
                {emoji} {count}
              </button>
            ))}
          </div>
        )}
        <div className="v2-message-actions">
          {message.status === "error" ? (
            <button onClick={onRetry}>Повторить отправку</button>
          ) : (
            !message.deleted &&
            !message.status && (
              <>
                <button onClick={onReply}>Ответить</button>
                {["❤️", "🔥", "👏", "👍"].map((emoji) => (
                  <button
                    key={emoji}
                    onClick={() => react(emoji)}
                    aria-label={`Реакция ${emoji}`}
                  >
                    {emoji}
                  </button>
                ))}
                {room.kind === "channel" && !own && <button onClick={report}>Пожаловаться</button>}
                {own && (
                  <>
                    <button
                      onClick={() => {
                        setText(message.text);
                        setEditing(true);
                      }}
                    >
                      Изменить
                    </button>
                    <button onClick={remove}>Удалить</button>
                  </>
                )}
                {!own && canModerate && <button onClick={remove}>Удалить</button>}
              </>
            )
          )}
        </div>
      </div>
    </article>
  );
}
function LegacyMedia({ media }: { media: NonNullable<RoomMessage["media"]> }) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    let objectUrl = "";
    mediaObjectUrl(media.url)
      .then((value) => {
        objectUrl = value;
        if (active) setUrl(value);
        else URL.revokeObjectURL(value);
      })
      .catch(() => {
        if (active) setError("Вложение недоступно.");
      });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [media.url]);
  return (
    <div className="v2-legacy-media">
      {url && media.kind === "image" ? (
        <img src={url} alt={media.name} />
      ) : url && media.kind === "video" ? (
        <video src={url} controls />
      ) : url && media.kind === "audio" ? (
        <audio src={url} controls />
      ) : url ? (
        <a href={url} download={media.name}>
          Скачать · {media.name}
        </a>
      ) : (
        error || "Открываем вложение…"
      )}
    </div>
  );
}
