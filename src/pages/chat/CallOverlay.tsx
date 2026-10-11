import { useEffect, useRef, useState } from 'react';
import { Phone, PhoneOff, Video, X } from 'lucide-react';
import { onDisconnect, onValue, push, ref, set, update, type DataSnapshot } from 'firebase/database';
import { requireDb } from '../../services/firebase';
import { useFirebaseValue } from '../../hooks/useFirebaseValue';
import { useToast } from '../../components/Toast';

type Signal = { callerId: string; callerName: string; video: boolean; status: 'ringing' | 'active'; createdAt: number; offer?: RTCSessionDescriptionInit; answer?: RTCSessionDescriptionInit };
export function CallOverlay({ chatId, uid, myName, otherId, otherName, startVideo, onClose }: { chatId: string; uid: string; myName: string; otherId: string; otherName: string; startVideo: boolean | null; onClose: () => void }) {
  const [signal] = useFirebaseValue<Signal>(`calls/${chatId}`); const { toast } = useToast();
  const [local, setLocal] = useState<MediaStream | null>(null); const [remote, setRemote] = useState<MediaStream | null>(null); const [active, setActive] = useState(false); const [busy, setBusy] = useState(false);
  const peer = useRef<RTCPeerConnection | null>(null); const localRef = useRef<HTMLVideoElement>(null); const remoteRef = useRef<HTMLVideoElement>(null); const candidateIds = useRef(new Set<string>()); const localStream = useRef<MediaStream | null>(null); const unsubscribe = useRef<Array<() => void>>([]);
  const mine = signal?.callerId === uid; const incoming = Boolean(signal && !mine && signal.status === 'ringing' && signal.callerId === otherId);
  const db = requireDb(); const room = ref(db, `calls/${chatId}`);
  useEffect(() => { if (localRef.current) localRef.current.srcObject = local; }, [local]);
  useEffect(() => { if (remoteRef.current) remoteRef.current.srcObject = remote; }, [remote]);
  useEffect(() => () => { unsubscribe.current.forEach(stop => stop()); peer.current?.close(); localStream.current?.getTracks().forEach(track => track.stop()); }, []);
  async function prepare(video: boolean, caller: boolean) {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Для звонков нужен доступный HTTPS-сайт и браузер с поддержкой камеры.');
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: video ? { facingMode: 'user' } : false });
    localStream.current = stream; setLocal(stream); candidateIds.current.clear(); unsubscribe.current.forEach(stop => stop()); unsubscribe.current = [];
    const connection = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] }); peer.current = connection;
    stream.getTracks().forEach(track => connection.addTrack(track, stream));
    connection.ontrack = event => setRemote(event.streams[0] || new MediaStream([event.track]));
    connection.onconnectionstatechange = () => { if (connection.connectionState === 'connected') setActive(true); if (connection.connectionState === 'failed') toast('Звонок не прошёл через сеть. Попробуйте другую сеть.', 'error'); };
    const outbound = ref(db, `calls/${chatId}/${caller ? 'callerCandidates' : 'calleeCandidates'}`);
    connection.onicecandidate = event => { if (event.candidate) void push(outbound, event.candidate.toJSON()); };
    const inbound = ref(db, `calls/${chatId}/${caller ? 'calleeCandidates' : 'callerCandidates'}`);
    unsubscribe.current.push(onValue(inbound, snap => { void addCandidates(connection, snap, candidateIds.current); }));
    if (caller) unsubscribe.current.push(onValue(ref(db, `calls/${chatId}/answer`), async snap => { const answer = snap.val() as RTCSessionDescriptionInit | null; if (answer && !connection.currentRemoteDescription) { try { await connection.setRemoteDescription(answer); const candidates = await new Promise<DataSnapshot>(resolve => onValue(inbound, value => resolve(value), { onlyOnce: true })); await addCandidates(connection, candidates, candidateIds.current); } catch { /* The peer may already have hung up. */ } } }));
    return connection;
  }
  async function start(video: boolean) {
    if (busy) return; setBusy(true);
    try {
      if (signal) throw new Error('В этом чате уже идёт или ожидается звонок.');
      const pc = await prepare(video, true); const offer = await pc.createOffer(); await pc.setLocalDescription(offer);
      await set(room, { callerId: uid, callerName: myName, video, status: 'ringing', createdAt: Date.now(), offer: pc.localDescription?.toJSON() });
      await onDisconnect(room).remove();
    } catch (error) { toast((error as Error).message || 'Не удалось начать звонок.', 'error'); await end(false); }
    finally { setBusy(false); }
  }
  async function accept() {
    if (!signal || busy) return; setBusy(true);
    try {
      const pc = await prepare(signal.video, false); await pc.setRemoteDescription(signal.offer!);
      const answer = await pc.createAnswer(); await pc.setLocalDescription(answer);
      await update(room, { answer: pc.localDescription?.toJSON(), status: 'active' }); setActive(true);
      const inbound = ref(db, `calls/${chatId}/callerCandidates`); const candidates = await new Promise<DataSnapshot>(resolve => onValue(inbound, value => resolve(value), { onlyOnce: true })); await addCandidates(pc, candidates, candidateIds.current);
    } catch (error) { toast((error as Error).message || 'Не удалось подключить звонок.', 'error'); await end(false); }
    finally { setBusy(false); }
  }
  async function end(close = true) {
    unsubscribe.current.forEach(stop => stop()); unsubscribe.current = []; peer.current?.close(); peer.current = null; localStream.current?.getTracks().forEach(track => track.stop()); localStream.current = null; setLocal(null); setRemote(null); setActive(false);
    if (close) await set(room, null).catch(() => {});
    onClose();
  }
  useEffect(() => { if (startVideo !== null) void start(startVideo); }, [startVideo]);
  const show = mine || incoming || (signal?.callerId === otherId && signal.status === 'active');
  if (!show) return null;
  return <div className="call-backdrop"><section className="call-window"><header><span>{active ? 'Звонок соединён' : incoming ? `${signal?.callerName} звонит вам` : 'Вызов…'}</span><button className="icon-btn" onClick={() => void end()} aria-label="Закрыть"><X/></button></header><div className="call-videos"><video className={signal?.video ? '' : 'audio-output'} ref={remoteRef} autoPlay playsInline/><video className="call-local" ref={localRef} autoPlay muted playsInline/><div className="call-title">{signal?.video ? 'Видеозвонок' : 'Аудиозвонок'}<strong>{otherName}</strong><small>{active ? 'На связи' : incoming ? 'Входящий вызов' : 'Ожидаем ответ…'}</small></div></div><footer>{incoming ? <button className="call-accept" disabled={busy} onClick={() => void accept()}><Phone size={18}/> Ответить</button> : (mine || active) && <><button className="call-control" onClick={() => local?.getAudioTracks().forEach(track => track.enabled = !track.enabled)} title="Включить или выключить микрофон"><Phone size={18}/></button><button className="call-control" disabled={!signal?.video} onClick={() => local?.getVideoTracks().forEach(track => track.enabled = !track.enabled)} title="Камера"><Video size={18}/></button></>}<button className="call-end" onClick={() => void end()} aria-label="Завершить звонок"><PhoneOff size={19}/></button></footer></section></div>;
}
async function addCandidates(connection: RTCPeerConnection, snapshot: DataSnapshot, seen: Set<string>) {
  const items = snapshot.val() as Record<string, RTCIceCandidateInit> | null;
  for (const [id, candidate] of Object.entries(items || {})) {
    if (seen.has(id) || !connection.remoteDescription) continue;
    try { await connection.addIceCandidate(candidate); seen.add(id); } catch { /* Ignore candidates arriving as the peer disconnects. */ }
  }
}
