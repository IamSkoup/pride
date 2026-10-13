import { useEffect, useState } from "react";
import { limitToLast, onValue, orderByChild, orderByKey, query, ref } from "firebase/database";
import { requireDb } from "../services/firebase";
import { resolveReport, unbanMember, type AuditEvent, type Ban, type PrideRole, type Report } from "./data";
import { errorMessage, time } from "./ui";

const auditLabels: Record<string, string> = {
  pride_created: "Создан Прайд", member_joined: "Участник вступил", channel_created: "Создана Тропа",
  role_changed: "Изменён ранг", member_kicked: "Участник исключён", member_banned: "Участник заблокирован",
  member_unbanned: "Блокировка снята", message_deleted_by_author: "Сообщение удалено автором",
  message_deleted_by_moderator: "Сообщение удалено модератором", report_resolved: "Жалоба обработана",
};

export function ModerationPanel({ prideId, role, onOpen, onError }: {
  prideId: string; role?: PrideRole; onOpen: (channelId: string) => void; onError: (message: string) => void;
}) {
  const [reports, setReports] = useState<Report[]>([]);
  const [audit, setAudit] = useState<AuditEvent[]>([]);
  const [bans, setBans] = useState<Record<string, Ban>>({});
  const review = role === "owner" || role === "admin" || role === "moderator";
  const manageBans = role === "owner" || role === "admin";
  useEffect(() => {
    if (!review) return;
    const stop = onValue(query(ref(requireDb(), `v2/reports/${prideId}`), orderByChild("createdAt"), limitToLast(50)), snapshot =>
      setReports((Object.values(snapshot.val() || {}) as Report[]).sort((a, b) => b.createdAt - a.createdAt)), error => onError(errorMessage(error)));
    return stop;
  }, [prideId, review]);
  useEffect(() => {
    if (!manageBans) return;
    const stopAudit = onValue(query(ref(requireDb(), `v2/audit/${prideId}`), orderByChild("at"), limitToLast(50)), snapshot =>
      setAudit((Object.values(snapshot.val() || {}) as AuditEvent[]).sort((a, b) => b.at - a.at)), error => onError(errorMessage(error)));
    const stopBans = onValue(query(ref(requireDb(), `v2/bans/${prideId}`), orderByKey(), limitToLast(50)), snapshot =>
      setBans(snapshot.val() || {}), error => onError(errorMessage(error)));
    return () => { stopAudit(); stopBans(); };
  }, [prideId, manageBans]);
  if (!review) return null;
  async function resolve(id: string) {
    try { await resolveReport(prideId, id); } catch (error) { onError(errorMessage(error)); }
  }
  async function unban(uid: string) {
    try { await unbanMember(prideId, uid); } catch (error) { onError(errorMessage(error)); }
  }
  return <div className="v2-moderation">
    <details>
      <summary>Жалобы · {reports.filter(item => item.status === "open").length}</summary>
      {reports.length ? reports.map(item => <article key={item.id} className="v2-moderation-item">
        <strong>{item.status === "open" ? "Открыта" : "Обработана"} · {time(item.createdAt)}</strong>
        <p>{item.reason}</p>
        <small>Сообщение: {item.preview || "без текста"}</small>
        <div><button onClick={() => onOpen(item.channelId)}>Открыть Тропу</button>{item.status === "open" && <button onClick={() => resolve(item.id)}>Отметить обработанной</button>}</div>
      </article>) : <p className="v2-muted">Жалоб пока нет.</p>}
    </details>
    {manageBans && <>
      <details><summary>Блокировки · {Object.keys(bans).length}</summary>
        {Object.entries(bans).length ? Object.entries(bans).map(([uid, ban]) => <article key={uid} className="v2-moderation-item">
          <strong>{uid}</strong><small>{ban.reason || "Без причины"} · {time(ban.at)}</small>
          <button onClick={() => unban(uid)}>Разблокировать</button>
        </article>) : <p className="v2-muted">Блокировок нет.</p>}
      </details>
      <details><summary>Журнал действий</summary>
        {audit.length ? audit.map((event, index) => <article key={`${event.at}:${index}`} className="v2-moderation-item">
          <strong>{auditLabels[event.action] || event.action}</strong>
          <small>{time(event.at)} · {event.actorId}{event.targetId ? ` → ${event.targetId}` : ""}</small>
          {event.reason && <p>{event.reason}</p>}
        </article>) : <p className="v2-muted">Записей пока нет.</p>}
      </details>
    </>}
  </div>;
}
