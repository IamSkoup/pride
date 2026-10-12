import { useEffect, useState } from 'react';
import type { Profile } from '../types';

export function Avatar({ profile, name, size = 42 }: { profile?: Partial<Profile> | null; name?: string; size?: number }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [profile?.avatar]);
  const title = profile?.displayName || name || 'Pride';
  return <span className="avatar" style={{ width: size, height: size, fontSize: size * .33 }} aria-label={title}>
    {profile?.avatar && !failed ? <img src={profile.avatar} alt="" onError={() => setFailed(true)} /> : title.slice(0, 2).toUpperCase()}
  </span>;
}
