import {
  createContext,
  useContext,
  useEffect,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  createUserWithEmailAndPassword,
  deleteUser,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
  type User,
} from "firebase/auth";
import { runTransaction, ref, set, update } from "firebase/database";
import { requireAuth, requireDb } from "../services/firebase";
import { bootstrap } from "./data";

type Session = {
  user: User | null;
  loading: boolean;
  logout: () => Promise<void>;
};
const SessionContext = createContext<Session>({
  user: null,
  loading: true,
  logout: async () => {},
});
function explainError(cause: unknown) {
  const code = (cause as { code?: string })?.code;
  const messages: Record<string, string> = {
    "auth/invalid-credential": "Неверный логин или пароль.",
    "auth/email-already-in-use": "Этот email уже занят.",
    "auth/invalid-email": "Проверьте адрес email.",
    "auth/weak-password": "Пароль слишком короткий.",
    "auth/network-request-failed": "Нет соединения. Попробуйте снова.",
    "auth/too-many-requests": "Слишком много попыток. Попробуйте позже.",
  };
  return (
    messages[code || ""] ||
    (cause instanceof Error ? cause.message : "Не удалось войти.")
  );
}
export const useSession = () => useContext(SessionContext);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(
    () =>
      onAuthStateChanged(requireAuth(), (current) => {
        setUser(current);
        setLoading(false);
      }),
    [],
  );
  useEffect(() => {
    if (user)
      bootstrap().catch(() => {
        /* Legacy data remains readable during migration retry. */
      });
  }, [user?.uid]);
  return (
    <SessionContext.Provider
      value={{ user, loading, logout: () => signOut(requireAuth()) }}
    >
      {children}
    </SessionContext.Provider>
  );
}

export function SignIn() {
  const [mode, setMode] = useState<"login" | "register" | "reset">("login");
  const [identifier, setIdentifier] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (mode === "reset") {
        await sendPasswordResetEmail(requireAuth(), email.trim());
        setError("Письмо для восстановления отправлено.");
        return;
      }
      if (mode === "login") {
        let address = identifier.trim();
        if (!address.includes("@") || address.startsWith("@")) {
          const handle = address.replace(/^@/, "").toLowerCase();
          const base = import.meta.env.VITE_WORKER_URL;
          if (!base)
            throw new Error("Вход по имени требует настроенный Worker.");
          const response = await fetch(
            `${base.replace(/\/$/, "")}/api/auth/resolve-username`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ username: handle, password }),
            },
          );
          if (!response.ok) throw new Error("Неверный логин или пароль.");
          address = ((await response.json()) as { email: string }).email;
        }
        await signInWithEmailAndPassword(requireAuth(), address, password);
      } else {
        const handle = username.trim().toLowerCase();
        if (!/^[a-z0-9_]{3,24}$/.test(handle))
          throw new Error("Username: 3–24 символа, a–z, 0–9 или _.");
        if (!name.trim() || name.trim().length > 48)
          throw new Error("Укажите имя до 48 символов.");
        const credentials = await createUserWithEmailAndPassword(
          requireAuth(),
          email.trim(),
          password,
        );
        const uid = credentials.user.uid;
        let claimed = false;
        try {
          const claim = await runTransaction(
            ref(requireDb(), `usernames/${handle}`),
            (current) => (current === null ? { uid } : undefined),
            { applyLocally: false },
          );
          if (!claim.committed) throw new Error("Username уже занят.");
          claimed = true;
          const profile = {
            uid,
            username: handle,
            displayName: name.trim(),
            bio: "",
            createdAt: Date.now(),
          };
          await update(ref(requireDb()), {
            [`users/${uid}`]: profile,
            [`publicProfiles/${uid}`]: {
              uid,
              username: handle,
              displayName: name.trim(),
            },
            [`userPrivate/${uid}/email`]: credentials.user.email,
            [`userSettings/${uid}/theme`]: "night",
          });
        } catch (error) {
          if (claimed)
            await set(ref(requireDb(), `usernames/${handle}`), null).catch(
              () => {},
            );
          await deleteUser(credentials.user).catch(() => {});
          throw error;
        }
      }
    } catch (cause) {
      setError(explainError(cause));
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="v2-auth">
      <section className="v2-auth-scene">
        <div className="v2-logo">P</div>
        <span className="v2-kicker">PRIDE MESSENGER 2.0</span>
        <h1>
          Разговоры находят
          <br />
          свою территорию.
        </h1>
        <p>Близкие люди, живые сообщества и важные моменты — на одной тропе.</p>
        <div className="v2-landscape" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
      </section>
      <section className="v2-auth-form">
        <div className="v2-form-card">
          <span className="v2-kicker">ДОБРО ПОЖАЛОВАТЬ</span>
          <h2>
            {mode === "login"
              ? "С возвращением"
              : mode === "register"
                ? "Начни свой путь"
                : "Вернуть доступ"}
          </h2>
          <p>
            {mode === "login"
              ? "Войди, чтобы продолжить разговор."
              : mode === "register"
                ? "Создай профиль и найди свой Прайд."
                : "Мы отправим ссылку на почту."}
          </p>
          <form onSubmit={submit}>
            {mode === "register" && (
              <>
                <label>
                  Имя
                  <input
                    required
                    maxLength={48}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    autoComplete="name"
                  />
                </label>
                <label>
                  Username
                  <input
                    required
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    autoComplete="username"
                    placeholder="yourname"
                  />
                </label>
              </>
            )}
            {mode === "login" ? (
              <label>
                Email или @username
                <input
                  required
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  autoComplete="username"
                />
              </label>
            ) : (
              <label>
                Email
                <input
                  required
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                />
              </label>
            )}
            {mode !== "reset" && (
              <label>
                Пароль
                <input
                  required
                  minLength={6}
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete={
                    mode === "register" ? "new-password" : "current-password"
                  }
                />
              </label>
            )}
            {error && (
              <div className="v2-form-status" role="status">
                {error}
              </div>
            )}
            <button type="submit" className="v2-primary" disabled={busy}>
              {busy
                ? "Подождите…"
                : mode === "login"
                  ? "Войти в Pride"
                  : mode === "register"
                    ? "Создать аккаунт"
                    : "Отправить ссылку"}
            </button>
          </form>
          <div className="v2-auth-links">
            <button
              onClick={() => {
                setError("");
                setMode(mode === "register" ? "login" : "register");
              }}
            >
              {mode === "register"
                ? "Уже есть аккаунт? Войти"
                : "Создать аккаунт"}
            </button>
            <button
              onClick={() => {
                setError("");
                setMode(mode === "reset" ? "login" : "reset");
              }}
            >
              {mode === "reset" ? "Вернуться ко входу" : "Забыли пароль?"}
            </button>
          </div>
        </div>
      </section>
    </main>
  );
}
