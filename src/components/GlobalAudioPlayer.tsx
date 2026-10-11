import { useEffect, useRef, useState } from 'react';
import { AudioLines, Pause, Play, SkipForward, UserRound, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useToast } from './Toast';
import { apiFetch, mediaObjectUrl } from '../services/chats';
import { updateMyProfile } from '../services/auth';

type Track = { name: string; url: string };
type PlayEvent = CustomEvent<{ tracks: Track[]; index: number }>;

export function GlobalAudioPlayer() {
  const { user, profile } = useAuth();
  const { toast } = useToast();
  const audio = useRef<HTMLAudioElement>(null);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [index, setIndex] = useState(0);
  const [source, setSource] = useState('');
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const current = tracks[index];

  useEffect(() => {
    const play = (event: Event) => {
      const detail = (event as PlayEvent).detail;
      setTracks(detail.tracks); setIndex(detail.index); setPosition(0);
    };
    window.addEventListener('pride:play-audio', play);
    return () => window.removeEventListener('pride:play-audio', play);
  }, []);
  useEffect(() => { if (!user) { audio.current?.pause(); setTracks([]); setSource(''); setPlaying(false); } }, [user?.uid]);

  useEffect(() => {
    let active = true;
    let objectUrl = '';
    if (!current) { setSource(''); setPlaying(false); return; }
    mediaObjectUrl(current.url).then(url => {
      objectUrl = url;
      if (active) setSource(url); else URL.revokeObjectURL(url);
    }).catch(error => { if (active) toast((error as Error).message, 'error'); });
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [current?.url, toast]);

  useEffect(() => { if (source && audio.current) void audio.current.play().then(() => setPlaying(true)).catch(() => setPlaying(false)); }, [source]);
  if (!current) return null;
  function toggle() {
    if (!audio.current) return;
    if (audio.current.paused) void audio.current.play().then(() => setPlaying(true)).catch(() => toast('Не удалось начать воспроизведение.', 'error'));
    else { audio.current.pause(); setPlaying(false); }
  }
  function next() { if (index + 1 < tracks.length) { setIndex(index + 1); setPosition(0); } else if (audio.current) { audio.current.currentTime = 0; void audio.current.play(); } }
  function seek(value: number) { if (audio.current) { audio.current.currentTime = value; setPosition(value); } }
  async function addToProfile() {
    if (!user || !profile) return;
    try {
      const response = await apiFetch('/api/media/share', { method: 'POST', body: JSON.stringify({ path: current.url }) });
      if (!response.ok) throw new Error('Не удалось подготовить публичную ссылку на трек.');
      const { url } = await response.json() as { url: string };
      await updateMyProfile(user.uid, profile, { musicTitle: current.name.slice(0, 60), musicUrl: url });
      toast('Трек добавлен в профиль');
    } catch (error) { toast((error as Error).message, 'error'); }
  }
  return <div className="music-dock" role="region" aria-label="Музыкальный плеер"><audio ref={audio} src={source || undefined} onTimeUpdate={event => setPosition(event.currentTarget.currentTime)} onLoadedMetadata={event => setDuration(event.currentTarget.duration || 0)} onEnded={next}/><span className="music-dock-art"><AudioLines size={19}/></span><span className="music-dock-track"><strong>{current.name}</strong><small>{playing ? 'Сейчас играет' : 'Плеер Pride'}</small></span><button className="icon-btn" onClick={toggle} aria-label={playing ? 'Пауза' : 'Продолжить'}>{playing ? <Pause size={18}/> : <Play size={18}/>}</button><button className="icon-btn" onClick={next} aria-label="Следующий трек"><SkipForward size={18}/></button><input className="music-seek" type="range" min="0" max={duration || 1} step="0.1" value={Math.min(position, duration || 0)} onChange={event => seek(Number(event.target.value))} aria-label="Позиция трека"/><button className="music-profile-add" onClick={() => void addToProfile()}><UserRound size={15}/> В профиль</button><button className="icon-btn" onClick={() => { audio.current?.pause(); setTracks([]); setSource(''); }} aria-label="Закрыть плеер"><X size={17}/></button></div>;
}
