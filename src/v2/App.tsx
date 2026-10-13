import { useEffect, useState } from "react";
import { BrowserRouter, useLocation, useNavigate } from "react-router-dom";
import {
  Bell,
  Compass,
  Hash,
  LogOut,
  Menu,
  MessageCircle,
  Plus,
  Search,
  UserRound,
  Users,
  X,
} from "lucide-react";
import { configured } from "../services/firebase";
import { getEconomy } from "../services/economy";
import type { Profile } from "../types";
import { SessionProvider, SignIn, useSession } from "./Auth";
import { CommercePanel } from "./Commerce";
import {
  bootstrap,
  joinPride,
  legacyRooms,
  listen,
  pridesFor,
  type Channel,
  type Pride,
  type Room,
  type PrideRole,
} from "./data";
import { Conversation } from "./Conversation";
import { Member, EventsPanel, ProfilePanel } from "./Panels";
import { ModerationPanel } from "./Moderation";
import { SearchDialog, CreateDialog } from "./Dialogs";
import { errorMessage, type Dialog } from "./ui";
import "./styles.css";

export function App() {
  if (!configured)
    return (
      <main className="v2-setup">
        <div className="v2-logo">P</div>
        <h1>Pride Messenger 2.0</h1>
        <p>
          Добавьте параметры Firebase и адрес Worker в окружение Vite, затем
          перезапустите приложение.
        </p>
      </main>
    );
  return (
    <BrowserRouter
      basename={import.meta.env.BASE_URL.replace(/\/$/, "") || "/"}
    >
      <SessionProvider>
        <Gate />
      </SessionProvider>
    </BrowserRouter>
  );
}
function Gate() {
  const { user, loading } = useSession();
  if (loading)
    return (
      <div className="v2-boot">
        <div className="v2-logo">P</div>
        <span>Открываем Pride…</span>
      </div>
    );
  return user ? <Shell key={user.uid} /> : <SignIn />;
}
function Shell() {
  const { user, logout } = useSession();
  const uid = user!.uid;
  const navigate = useNavigate();
  const location = useLocation();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [prides, setPrides] = useState<Pride[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [members, setMembers] = useState<Record<string, PrideRole>>({});
  const [dialog, setDialog] = useState<Dialog>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [panel, setPanel] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [notice, setNotice] = useState("");
  const [section, setSection] = useState<
    "chats" | "prides" | "profile" | "alerts"
  >("chats");
  const parts = location.pathname.split("/").filter(Boolean);
  const selectedPride =
    parts[0] === "pride"
      ? prides.find((item) => item.id === parts[1])
      : undefined;
  const room =
    parts[0] === "chat"
      ? rooms.find((item) => item.id === parts[1])
      : parts[0] === "pride" && parts[2] === "channel"
        ? channels.find((item) => item.id === parts[3]) && selectedPride
          ? {
              id: parts[3],
              title: channels.find((item) => item.id === parts[3])!.title,
              kind: "channel" as const,
              pride: selectedPride,
              channel: channels.find((item) => item.id === parts[3]),
            }
          : undefined
        : undefined;
  const activeSection =
    parts[0] === "pride" || parts[0] === "prides"
      ? "prides"
      : parts[0] === "profile" || parts[0] === "shop"
        ? "profile"
        : parts[0] === "alerts"
          ? "alerts"
          : parts[0] === "chat" || parts[0] === "chats"
            ? "chats"
        : section;
  useEffect(
    () =>
      listen<Profile>(`users/${uid}`, setProfile, (error) =>
        setNotice(errorMessage(error)),
      ),
    [uid],
  );
  useEffect(() => {
    if (profile) {
      bootstrap().catch(() => {});
      getEconomy().catch(() => {});
    }
  }, [profile?.uid]);
  useEffect(
    () =>
      listen<Record<string, boolean>>(`userChats/${uid}`, (value) => {
        legacyRooms(value)
          .then(setRooms)
          .catch((error) => setNotice(errorMessage(error)));
      }),
    [uid],
  );
  useEffect(
    () =>
      listen<Record<string, boolean>>(`v2/userPrides/${uid}`, (value) => {
        pridesFor(value)
          .then(setPrides)
          .catch((error) => setNotice(errorMessage(error)));
      }),
    [uid],
  );
  useEffect(() => {
    if (!selectedPride) {
      setChannels([]);
      setMembers({});
      return;
    }
    return listen<Record<string, Channel>>(
      `v2/channels/${selectedPride.id}`,
      (value) =>
        setChannels(
          Object.values(value || {}).sort((a, b) => a.createdAt - b.createdAt),
        ),
    );
  }, [selectedPride?.id]);
  useEffect(() => {
    if (!selectedPride) return;
    return listen<Record<string, PrideRole>>(
      `v2/prideMembers/${selectedPride.id}`,
      (value) => setMembers(value || {}),
    );
  }, [selectedPride?.id]);
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen(true);
      }
      if (event.key === "Escape") {
        setSearchOpen(false);
        setDialog(null);
        setPanel(false);
        setDrawer(false);
      }
    };
    document.addEventListener("keydown", listener);
    return () => document.removeEventListener("keydown", listener);
  }, []);
  useEffect(() => {
    if (parts[0] === "invite" && parts[1] && parts[2]) {
      joinPride(parts[1], parts[2])
        .then(() => navigate(`/pride/${parts[1]}`))
        .catch((error) => setNotice(errorMessage(error)));
    }
  }, [location.pathname]);
  const filteredRooms = rooms;
  function selectSection(next: typeof section) {
    setSection(next);
    setDrawer(false);
    if (next === "profile") navigate("/profile");
    else
      navigate(
        next === "prides"
          ? "/prides"
          : next === "alerts"
            ? "/alerts"
            : "/chats",
      );
  }
  function openRoom(next: Room) {
    navigate(
      next.kind === "legacy"
        ? `/chat/${next.id}`
        : `/pride/${next.pride!.id}/channel/${next.id}`,
    );
    setDrawer(false);
  }
  return (
    <div className="v2-app">
      <aside className="v2-rail">
        <button
          className="v2-rail-logo"
          onClick={() => selectSection("chats")}
          aria-label="Главная"
        >
          P
        </button>
        <div className="v2-rail-divider" />
        <button
          className={activeSection === "chats" ? "active" : ""}
          onClick={() => selectSection("chats")}
          title="Чаты"
        >
          <MessageCircle size={21} />
        </button>
        <button
          className={activeSection === "prides" ? "active" : ""}
          onClick={() => selectSection("prides")}
          title="Прайды"
        >
          <Compass size={21} />
        </button>
        <div className="v2-rail-prides">
          {prides.slice(0, 6).map((pride) => (
            <button
              className={selectedPride?.id === pride.id ? "active" : ""}
              key={pride.id}
              title={pride.title}
              onClick={() => {
                setSection("prides");
                navigate(`/pride/${pride.id}`);
              }}
            >
              {pride.title.slice(0, 1).toUpperCase()}
            </button>
          ))}
        </div>
        <button onClick={() => setDialog("pride")} title="Создать Прайд">
          <Plus size={20} />
        </button>
        <div className="v2-rail-spacer" />
        <button
          className={activeSection === "alerts" ? "active" : ""}
          onClick={() => selectSection("alerts")}
          title="Уведомления"
        >
          <Bell size={20} />
        </button>
        <button
          className={activeSection === "profile" ? "active" : ""}
          onClick={() => selectSection("profile")}
          title="Профиль"
        >
          <UserRound size={20} />
        </button>
      </aside>
      <aside className={`v2-sidebar ${drawer ? "open" : ""}`}>
        <div className="v2-sidebar-top">
          <div>
            <span className="v2-kicker">PRIDE MESSENGER</span>
            <h2>
              {selectedPride?.title ||
                (activeSection === "prides"
                  ? "Мои Прайды"
                  : activeSection === "profile"
                    ? "Мой профиль"
                    : activeSection === "alerts"
                      ? "Уведомления"
                      : "Сообщения")}
            </h2>
          </div>
          <button
            className="v2-icon"
            onClick={() => setDrawer(false)}
            aria-label="Закрыть список"
          >
            <X size={18} />
          </button>
        </div>
        {activeSection === "chats" && (
          <>
            <button
              className="v2-search-trigger"
              onClick={() => setSearchOpen(true)}
            >
              <Search size={17} /> Поиск и переход <kbd>Ctrl K</kbd>
            </button>
            <div className="v2-list-head">
              <span>БЕСЕДЫ · {rooms.length}</span>
              <button onClick={() => setDialog("dm")} title="Новый чат">
                <Plus size={18} />
              </button>
            </div>
            <div className="v2-room-list">
              {filteredRooms.map((item) => (
                <button
                  key={item.id}
                  className={`v2-room ${room?.id === item.id ? "selected" : ""}`}
                  onClick={() => openRoom(item)}
                >
                  <span className="v2-avatar">
                    {item.title.slice(0, 1).toUpperCase()}
                    {item.chat?.avatar && (
                      <img
                        src={item.chat.avatar}
                        alt=""
                        onError={(event) => {
                          event.currentTarget.style.display = "none";
                        }}
                      />
                    )}
                  </span>
                  <span>
                    <strong>{item.title}</strong>
                    <small>
                      {item.chat?.kind === "dm"
                        ? "Личные сообщения"
                        : item.chat?.kind === "group"
                          ? "Группа"
                          : "Канал"}
                    </small>
                  </span>
                </button>
              ))}
              {rooms.length === 0 && (
                <p className="v2-muted v2-empty-list">
                  Здесь пока тихо. Начните переписку.
                </p>
              )}
            </div>
            <button
              className="v2-side-action"
              onClick={() => setDialog("group")}
            >
              <Users size={17} /> Создать группу
            </button>
          </>
        )}
        {activeSection === "prides" && (
          <>
            <div className="v2-list-head">
              <span>ТЕРРИТОРИИ</span>
              <button onClick={() => setDialog("pride")} title="Новый Прайд">
                <Plus size={18} />
              </button>
            </div>
            <div className="v2-room-list">
              {prides.map((item) => (
                <button
                  key={item.id}
                  className={`v2-room ${selectedPride?.id === item.id ? "selected" : ""}`}
                  onClick={() => {
                    navigate(`/pride/${item.id}`);
                    setDrawer(false);
                  }}
                >
                  <span className="v2-avatar pride">
                    {item.title.slice(0, 1).toUpperCase()}
                  </span>
                  <span>
                    <strong>{item.title}</strong>
                    <small>Прайд</small>
                  </span>
                </button>
              ))}
            </div>
            <button
              className="v2-side-action"
              onClick={() => setDialog("join")}
            >
              <Plus size={17} /> Вступить по зову
            </button>
            {selectedPride && (
              <>
                <div className="v2-list-head">
                  <span>ТРОПЫ</span>
                  {(members[uid] === "owner" || members[uid] === "admin") && (
                    <button
                      onClick={() => setDialog("channel")}
                      title="Новая Тропа"
                    >
                      <Plus size={18} />
                    </button>
                  )}
                </div>
                <div className="v2-room-list">
                  {channels.map((channel) => (
                    <button
                      className={`v2-channel ${room?.id === channel.id ? "selected" : ""}`}
                      key={channel.id}
                      onClick={() =>
                        openRoom({
                          id: channel.id,
                          title: channel.title,
                          kind: "channel",
                          pride: selectedPride,
                          channel,
                        })
                      }
                    >
                      <Hash size={17} />
                      <span>{channel.title}</span>
                      {channel.kind === "chronicle" && <small>Хроника</small>}
                    </button>
                  ))}
                </div>
              </>
            )}
          </>
        )}
        {activeSection === "profile" && (
          <div className="v2-side-copy">
            Ваш профиль и существующие данные аккаунта доступны в новом
            интерфейсе.
          </div>
        )}
        {activeSection === "alerts" && (
          <div className="v2-side-copy">Важные события ваших бесед.</div>
        )}
        <div className="v2-sidebar-footer">
          <span className="v2-avatar self">
            {(profile?.displayName || user?.email || "Я")
              .slice(0, 1)
              .toUpperCase()}
            {profile?.avatar && (
              <img
                src={profile.avatar}
                alt=""
                onError={(event) => {
                  event.currentTarget.style.display = "none";
                }}
              />
            )}
          </span>
          <span>
            <strong>{profile?.displayName || "Мой профиль"}</strong>
            <small>@{profile?.username || "pride"}</small>
          </span>
          <button onClick={logout} title="Выйти" aria-label="Выйти">
            <LogOut size={17} />
          </button>
        </div>
      </aside>
      <main className="v2-main">
        <header className="v2-main-header">
          <button
            className="v2-icon v2-menu"
            onClick={() => setDrawer(true)}
            aria-label="Открыть список"
          >
            <Menu size={20} />
          </button>
          <div className="v2-header-icon">
            {room?.kind === "channel" ? (
              <Hash size={21} />
            ) : room ? (
              <MessageCircle size={20} />
            ) : (
              <Compass size={21} />
            )}
          </div>
          <div>
            <strong>
              {room?.title ||
                (parts[0] === "shop"
                  ? "Когти и подарки"
                  : activeSection === "profile"
                    ? "Мой профиль"
                    : activeSection === "alerts"
                      ? "События"
                      : activeSection === "prides"
                        ? "Прайды"
                        : "Обзор")}
            </strong>
            <small>
              {room?.kind === "channel"
                ? `${room.pride!.title} · ${room.channel!.kind === "chronicle" ? "Хроника" : "Тропа"}`
                : room
                  ? "Беседа"
                  : "Pride Messenger 2.0"}
            </small>
          </div>
          <div className="v2-main-header-spacer" />
          {room && (
            <button
              className="v2-icon"
              onClick={() => setPanel(!panel)}
              aria-label="Сведения"
            >
              <Users size={20} />
            </button>
          )}
          <button
            className="v2-icon"
            onClick={() => setSearchOpen(true)}
            aria-label="Поиск"
          >
            <Search size={20} />
          </button>
        </header>
        {room ? (
          <Conversation
            key={room.id}
            room={room}
            uid={uid}
            role={room.kind === "channel" ? members[uid] : undefined}
            onError={setNotice}
          />
        ) : parts[0] === "shop" ? (
          <CommercePanel uid={uid} onError={setNotice} />
        ) : activeSection === "profile" ? (
          <ProfilePanel
            uid={uid}
            profile={profile}
            onLogout={logout}
            onShop={() => navigate("/shop")}
            onError={setNotice}
          />
        ) : activeSection === "alerts" ? (
          <EventsPanel
            uid={uid}
            prides={prides}
            onError={setNotice}
            onOpen={(prideId, channelId) =>
              navigate(`/pride/${prideId}/channel/${channelId}`)
            }
          />
        ) : (
          <div className="v2-welcome">
            <div className="v2-welcome-sun" />
            <span className="v2-kicker">СОЦИАЛЬНАЯ САВАННА</span>
            <h1>
              {activeSection === "prides"
                ? "Найди свою территорию."
                : "Ближе к тем, кто важен."}
            </h1>
            <p>
              {activeSection === "prides"
                ? "Создайте Прайд с Тропами для бесед или примите зов друзей."
                : "Выберите беседу слева или начните новую. Здесь найдётся место каждому разговору."}
            </p>
            <div className="v2-welcome-actions">
              <button
                className="v2-primary"
                onClick={() =>
                  setDialog(activeSection === "prides" ? "pride" : "dm")
                }
              >
                {activeSection === "prides"
                  ? "Создать Прайд"
                  : "Новое сообщение"}
              </button>
              <button
                className="v2-secondary"
                onClick={() =>
                  setDialog(activeSection === "prides" ? "join" : "group")
                }
              >
                {activeSection === "prides"
                  ? "Вступить по зову"
                  : "Создать группу"}
              </button>
            </div>
          </div>
        )}
      </main>
      {panel && room && (
        <aside className="v2-details">
          <div className="v2-details-head">
            <strong>Сведения</strong>
            <button className="v2-icon" onClick={() => setPanel(false)}>
              <X size={19} />
            </button>
          </div>
          <div className="v2-details-hero">
            <span className="v2-avatar large">
              {room.title.slice(0, 1).toUpperCase()}
              {room.chat?.avatar && (
                <img
                  src={room.chat.avatar}
                  alt=""
                  onError={(event) => {
                    event.currentTarget.style.display = "none";
                  }}
                />
              )}
            </span>
            <h2>{room.title}</h2>
            <p>
              {room.kind === "channel"
                ? room.pride?.description || "Тропа Прайда"
                : room.chat?.description || "Беседа"}
            </p>
          </div>
          {room.kind === "channel" && (
            <>
              <div className="v2-detail-label">
                УЧАСТНИКИ · {Object.keys(members).length}
              </div>
              {Object.entries(members).map(([id, role]) => (
                <Member
                  key={id}
                  uid={id}
                  role={role}
                  prideId={room.pride!.id}
                  actorRole={members[uid]}
                  onError={setNotice}
                />
              ))}
              <ModerationPanel
                prideId={room.pride!.id}
                role={members[uid]}
                onOpen={(channelId) => navigate(`/pride/${room.pride!.id}/channel/${channelId}`)}
                onError={setNotice}
              />
              <button
                className="v2-side-action"
                onClick={() =>
                  navigator.clipboard
                    .writeText(
                      `${window.location.origin}${import.meta.env.BASE_URL}invite/${room.pride!.id}/${room.pride!.inviteCode}`,
                    )
                    .then(() => setNotice("Зов скопирован"))
                    .catch(() => setNotice("Не удалось скопировать зов."))
                }
              >
                Скопировать зов
              </button>
            </>
          )}
        </aside>
      )}
      <nav className="v2-bottom-nav">
        <button
          className={activeSection === "chats" ? "active" : ""}
          onClick={() => selectSection("chats")}
        >
          <MessageCircle size={20} />
          Чаты
        </button>
        <button
          className={activeSection === "prides" ? "active" : ""}
          onClick={() => selectSection("prides")}
        >
          <Compass size={20} />
          Прайды
        </button>
        <button onClick={() => setDrawer(true)}>
          <Hash size={20} />
          Обзор
        </button>
        <button
          className={activeSection === "alerts" ? "active" : ""}
          onClick={() => selectSection("alerts")}
        >
          <Bell size={20} />
          События
        </button>
        <button
          className={activeSection === "profile" ? "active" : ""}
          onClick={() => selectSection("profile")}
        >
          <UserRound size={20} />Я
        </button>
      </nav>
      {searchOpen && (
        <SearchDialog
          rooms={rooms}
          prides={prides}
          uid={uid}
          onClose={() => setSearchOpen(false)}
          onSelect={(next) => {
            openRoom(next);
            setSearchOpen(false);
          }}
          onPride={(pride) => {
            navigate(`/pride/${pride.id}`);
            setSearchOpen(false);
          }}
          onChat={(id) => {
            navigate(`/chat/${id}`);
            setSearchOpen(false);
          }}
          onError={setNotice}
        />
      )}
      <CreateDialog
        kind={dialog}
        pride={selectedPride}
        uid={uid}
        onClose={() => setDialog(null)}
        onDone={(path) => {
          setDialog(null);
          navigate(path);
        }}
        onError={setNotice}
      />
      {notice && (
        <div className="v2-toast" role="status">
          {notice}
          <button onClick={() => setNotice("")} aria-label="Закрыть">
            <X size={16} />
          </button>
        </div>
      )}
    </div>
  );
}
