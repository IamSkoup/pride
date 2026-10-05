import type { Profile } from '../types';

export function Avatar({ profile, name, size = 42 }: { profile?: Profile | null; name?: string; size?: number }) {
  const title = profile?.displayName || name || 'Pride';
  return <span className="avatar" style={{ width: size, height: size, fontSize: size * .33 }} aria-label={title}>
    {profile?.avatar ? <img src={profile.avatar} alt="" /> : title.slice(0, 2).toUpperCase()}
  </span>;
}
