import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';

type ToastContextType = { toast: (message: string, type?: 'error' | 'success') => void };
const Context = createContext<ToastContextType>({ toast: () => {} });
export const useToast = () => useContext(Context);
export function ToastProvider({ children }: { children: ReactNode }) {
  const [notice, setNotice] = useState<{ message: string; type: 'error' | 'success' } | null>(null);
  const toast = useCallback((message: string, type: 'error' | 'success' = 'success') => {
    setNotice({ message, type });
    window.setTimeout(() => setNotice(null), 5000);
  }, []);
  return <Context.Provider value={{ toast }}>{children}{notice && <div className={`toast ${notice.type}`} role="status">{notice.message}<button aria-label="Закрыть" onClick={() => setNotice(null)}><X size={16} /></button></div>}</Context.Provider>;
}
