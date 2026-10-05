import { onValue, ref } from 'firebase/database';
import { useEffect, useState } from 'react';
import { db } from '../services/firebase';

export function useFirebaseValue<T>(path: string | null): [T | null, boolean, Error | null] {
  const [value, setValue] = useState<T | null>(null);
  const [loading, setLoading] = useState(Boolean(path));
  const [error, setError] = useState<Error | null>(null);
  useEffect(() => {
    if (!path || !db) { setValue(null); setLoading(false); return; }
    setLoading(true);
    return onValue(ref(db, path), snap => { setValue(snap.val() as T | null); setLoading(false); setError(null); }, err => { setError(err); setLoading(false); });
  }, [path]);
  return [value, loading, error];
}
