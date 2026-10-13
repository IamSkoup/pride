import {
  get,
  limitToLast,
  onValue,
  orderByKey,
  orderByChild,
  query,
  ref,
  set,
  endBefore,
  type DataSnapshot,
} from "firebase/database";
import { requireAuth, requireDb } from "../services/firebase";
import {
  sendMessage as sendLegacyMessage,
  startDirectChat,
  createSpace,
  reactToMessage,
  editMessage,
  deleteMessage,
  uploadChatMedia,
} from "../services/chats";
import type { Chat, Media, Message, Profile } from "../types";

export type Pride = {
  id: string;
  title: string;
  description?: string;
  ownerId: string;
  inviteCode: string;
  createdAt: number;
};
export type Channel = {
  id: string;
  prideId: string;
  title: string;
  kind: "text" | "chronicle";
  createdAt: number;
};
export type Room = {
  id: string;
  title: string;
  kind: "legacy" | "channel";
  chat?: Chat;
  pride?: Pride;
  channel?: Channel;
};
export type RoomMessage = {
  id: string;
  senderId: string;
  text: string;
  createdAt: number;
  replyTo?: string;
  deleted?: boolean;
  media?: Media;
  reactions?: Record<string, string>;
  status?: "sending" | "error";
  type?: string;
};
export type Activity = {
  id: string;
  prideId: string;
  channelId: string;
  senderId: string;
  preview: string;
  at: number;
};
export type PrideRole = "owner" | "admin" | "moderator" | "member";
export type Report = { id: string; channelId: string; messageId: string; senderId: string; reporterId: string; reason: string; preview: string; status: "open" | "resolved"; createdAt: number; resolvedAt?: number };
export type AuditEvent = { actorId: string; action: string; at: number; targetId?: string; channelId?: string; messageId?: string; reason?: string; title?: string; previousRole?: PrideRole; nextRole?: PrideRole };
export type Ban = { actorId: string; at: number; reason: string };

const records = <T>(value: Record<string, T> | null): T[] =>
  Object.values(value || {});
export function listen<T>(
  path: string,
  onData: (value: T | null) => void,
  onError?: (error: Error) => void,
) {
  return onValue(
    ref(requireDb(), path),
    (snapshot) => onData(snapshot.val() as T | null),
    onError,
  );
}
export async function worker<T>(
  path: string,
  body: Record<string, unknown> = {},
): Promise<T> {
  const base = import.meta.env.VITE_WORKER_URL;
  if (!base) throw new Error("Cloudflare Worker не настроен.");
  const user = requireAuth().currentUser;
  if (!user) throw new Error("Войдите в аккаунт.");
  const response = await fetch(`${base.replace(/\/$/, "")}/api/${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${await user.getIdToken()}`,
    },
    body: JSON.stringify(body),
  });
  const result = (await response.json().catch(() => ({}))) as T & {
    error?: string;
  };
  if (!response.ok)
    throw new Error(result.error || `Ошибка сервиса (${response.status}).`);
  return result;
}
export async function bootstrap() {
  return worker<{ migrated: boolean; version: number }>("v2/bootstrap");
}
export async function createPride(title: string) {
  return worker<{ prideId: string; channelId: string }>("v2/pride", { title });
}
export async function createChannel(
  prideId: string,
  title: string,
  kind: Channel["kind"],
) {
  return worker<{ channelId: string }>("v2/channel", { prideId, title, kind });
}
export async function joinPride(prideId: string, code: string) {
  return worker<{ prideId: string }>("v2/join", { prideId, code });
}
export async function changePrideRole(
  prideId: string,
  targetId: string,
  role: "admin" | "moderator" | "member",
) {
  return worker("v2/role", { prideId, targetId, role });
}
export async function moderateMember(prideId: string, targetId: string, action: "kick" | "ban", reason: string) {
  return worker(`v2/${action}`, { prideId, targetId, reason });
}
export async function unbanMember(prideId: string, targetId: string) {
  return worker("v2/unban", { prideId, targetId });
}
export async function reportMessage(room: Room, messageId: string, reason: string) {
  if (room.kind !== "channel") throw new Error("Жалобы на сообщения доступны в Прайдах.");
  return worker("v2/report", { prideId: room.pride!.id, channelId: room.id, messageId, reason });
}
export async function resolveReport(prideId: string, reportId: string) {
  return worker("v2/resolve-report", { prideId, reportId });
}
export async function sendToRoom(
  room: Room,
  uid: string,
  text: string,
  messageId: string,
  replyTo?: string,
) {
  if (room.kind === "legacy")
    return sendLegacyMessage(
      room.id,
      uid,
      text,
      undefined,
      replyTo,
      undefined,
      messageId,
    );
  await worker("v2/message", {
    prideId: room.pride!.id,
    channelId: room.id,
    messageId,
    text,
    replyTo,
  });
  return messageId;
}
export async function sendLegacyAttachment(
  room: Room,
  uid: string,
  file: File,
  onProgress: (percent: number) => void,
) {
  if (room.kind !== "legacy")
    throw new Error("Вложения доступны в личных беседах и группах.");
  const media = await uploadChatMedia(room.id, uid, file, onProgress);
  return sendLegacyMessage(room.id, uid, "", media);
}
export async function reactInRoom(
  room: Room,
  uid: string,
  messageId: string,
  emoji: string | null,
) {
  if (room.kind === "legacy")
    return reactToMessage(room.id, messageId, uid, emoji);
  return worker("v2/react", {
    prideId: room.pride!.id,
    channelId: room.id,
    messageId,
    emoji,
  });
}
export async function editInRoom(room: Room, messageId: string, text: string) {
  if (room.kind === "legacy") return editMessage(room.id, messageId, text);
  return worker("v2/edit", {
    prideId: room.pride!.id,
    channelId: room.id,
    messageId,
    text,
  });
}
export async function deleteInRoom(room: Room, uid: string, messageId: string) {
  if (room.kind === "legacy")
    return deleteMessage(room.id, messageId, true, uid);
  return worker("v2/delete", {
    prideId: room.pride!.id,
    channelId: room.id,
    messageId,
  });
}
export async function createLegacyGroup(
  uid: string,
  title: string,
  kind: "group" | "channel",
) {
  return createSpace(uid, kind, title, "", false, []);
}
export async function openDirect(uid: string, otherUid: string) {
  return startDirectChat(uid, { uid: otherUid });
}
export async function exactUser(username: string): Promise<Profile | null> {
  const normalized = username.trim().replace(/^@/, "").toLowerCase();
  if (!/^[a-z0-9_]{3,24}$/.test(normalized)) return null;
  const claim = (
    await get(ref(requireDb(), `usernames/${normalized}`))
  ).val() as { uid?: string } | null;
  return claim?.uid
    ? ((
        await get(ref(requireDb(), `users/${claim.uid}`))
      ).val() as Profile | null)
    : null;
}
export async function searchUsers(query: string) {
  return worker<{
    users: Array<Pick<Profile, "uid" | "username" | "displayName" | "avatar">>;
  }>("v2/user-search", { query });
}
export async function legacyRooms(
  ids: Record<string, boolean> | null,
): Promise<Room[]> {
  const found = await Promise.allSettled(
    Object.keys(ids || {})
      .map(async (id) => {
        const chat = (
          await get(ref(requireDb(), `chats/${id}`))
        ).val() as Chat | null;
        if (!chat) return null;
        let title = chat.title || "Личный чат";
        if (chat.kind === "dm") {
          const members = (
            await get(ref(requireDb(), `chatMembers/${id}`))
          ).val() as Record<string, string> | null;
          const otherUid = Object.keys(members || {}).find(
            (uid) => uid !== requireAuth().currentUser?.uid,
          );
          if (otherUid) {
            const other = (
              await get(ref(requireDb(), `publicProfiles/${otherUid}`))
            ).val() as { displayName?: string } | null;
            title = other?.displayName || title;
          }
        }
        return { id, title, kind: "legacy", chat } as Room;
      }),
  );
  return found
    .filter(
      (result): result is PromiseFulfilledResult<Room | null> =>
        result.status === "fulfilled",
    )
    .map((result) => result.value)
    .filter((room): room is Room => Boolean(room))
    .sort((a, b) => (b.chat?.updatedAt || 0) - (a.chat?.updatedAt || 0));
}
export async function pridesFor(
  ids: Record<string, boolean> | null,
): Promise<Pride[]> {
  const found = await Promise.all(
    Object.keys(ids || {})
      .map(
        async (id) =>
          (
            await get(ref(requireDb(), `v2/prides/${id}`))
          ).val() as Pride | null,
      ),
  );
  return found.filter((pride): pride is Pride => Boolean(pride));
}
export function messagesPath(room: Room) {
  return room.kind === "legacy"
    ? `messages/${room.id}`
    : `v2/messages/${room.id}`;
}
export function watchActivity(
  prideId: string,
  onData: (items: Activity[]) => void,
) {
  return onValue(
    query(
      ref(requireDb(), `v2/activity/${prideId}`),
      orderByChild("at"),
      limitToLast(15),
    ),
    (snapshot) =>
      onData(
        Object.values((snapshot.val() as Record<string, Activity>) || {}).map(
          (item) => ({ ...item, prideId }),
        ),
      ),
  );
}
export function watchMessages(
  room: Room,
  onData: (messages: RoomMessage[]) => void,
  onError: (error: Error) => void,
) {
  return onValue(
    query(ref(requireDb(), messagesPath(room)), orderByKey(), limitToLast(40)),
    (snapshot) => onData(snapshotToMessages(snapshot)),
    onError,
  );
}
export async function olderMessages(
  room: Room,
  firstId: string,
): Promise<RoomMessage[]> {
  const snapshot = await get(
    query(
      ref(requireDb(), messagesPath(room)),
      orderByKey(),
      endBefore(firstId),
      limitToLast(40),
    ),
  );
  return snapshotToMessages(snapshot);
}
function snapshotToMessages(snapshot: DataSnapshot): RoomMessage[] {
  return records(
    snapshot.val() as Record<
      string,
      Message & { reactions?: Record<string, string> }
    > | null,
  )
    .map((item) => ({
      id: item.id,
      senderId: item.senderId,
      text: item.text || "",
      createdAt: item.createdAt || 0,
      replyTo: item.replyTo,
      deleted: item.deleted,
      media: item.media,
      reactions: item.reactions,
      type: item.type,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}
export async function saveDraft(room: Room, uid: string, text: string) {
  await set(
    ref(
      requireDb(),
      `${room.kind === "legacy" ? "drafts" : "v2/drafts"}/${uid}/${room.id}`,
    ),
    text || null,
  );
}
