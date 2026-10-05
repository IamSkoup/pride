# Pride Messenger

Pride Messenger — веб мессенджер на React, TypeScript, Vite, Firebase Authentication, Realtime Database и Storage. Cloudflare Worker обслуживает вход по username, ссылки приглашения, закрытые вложения и отправку push через FCM.

## Реализовано

- Регистрация по email и паролю с атомарным резервированием уникального `@username` через RTDB transaction; вход по email или username, восстановление пароля.
- Поиск человека по точному username, личные чаты, группы и каналы, приглашения, роли участников, поиск и вступление в публичные пространства.
- Сообщения в реальном времени: текст, файлы до 25 МБ, голосовые записи с микрофона, ответы, пересылка, редактирование, удаление для себя и для всех, реакции, поиск внутри чата, метка прочтения, набор текста, черновики, пагинация по 80 сообщений.
- Профиль: имя, username, bio, аватар, короткий статус Roar на 12 часов, настроение; две темы.
- Push регистрация по устройствам, удаление токена устройства, браузерные push при отправке сообщений.
- Адаптивный интерфейс, PWA manifest, service worker с offline cache интерфейса.

Данные пользователей и переписки не подменяются mock данными. До настройки Firebase приложение показывает экран конфигурации.

## Структура

```text
src/context/       авторизация и профиль
src/pages/         вход, мессенджер, профиль, настройки
src/pages/chat/    чат и сообщения
src/services/      Firebase, auth, чаты, медиа
src/hooks/         подписка на RTDB
worker/index.ts    защищённый API Cloudflare
database.rules.json
storage.rules
public/sw.js       PWA cache и push
```

## Локальный запуск

```bash
npm install
cp .env.example .env
npm run dev
```

В Windows PowerShell используйте `Copy-Item .env.example .env` и `npm.cmd`, если запуск `npm.ps1` запрещён политикой PowerShell.

Заполните `.env` значениями из Firebase Console → Project settings → Your apps → Web app:

| Переменная | Значение |
| --- | --- |
| `VITE_FIREBASE_API_KEY` | Web API key |
| `VITE_FIREBASE_AUTH_DOMAIN` | Auth domain |
| `VITE_FIREBASE_DATABASE_URL` | URL Realtime Database, включая регион |
| `VITE_FIREBASE_PROJECT_ID` | Project ID |
| `VITE_FIREBASE_STORAGE_BUCKET` | Storage bucket |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | Messaging sender ID |
| `VITE_FIREBASE_APP_ID` | Web app ID |
| `VITE_FIREBASE_VAPID_KEY` | Web push certificate public key |
| `VITE_WORKER_URL` | `https://pride-messenger-worker.kapani.workers.dev` |

Frontend Firebase config не является секретным. Service account private key **никогда не помещайте** в `.env`, `VITE_*` или репозиторий.

## Firebase: пошагово

1. Создайте проект в [Firebase Console](https://console.firebase.google.com/).
2. Откройте Project settings → General → Your apps → Add app → Web. Скопируйте web config в `.env`.
3. Откройте Build → Authentication → Get started → Sign-in method и включите **Email/Password**. В Authentication → Settings → Authorized domains добавьте домен сайта и локальный домен для разработки.
4. Откройте Build → Realtime Database → Create database. Выберите ближайший регион. Скопируйте точный URL базы в `VITE_FIREBASE_DATABASE_URL`.
5. Установите [Firebase CLI](https://firebase.google.com/docs/cli) и выполните `firebase login`, затем `firebase use --add` (или `firebase use <project-id>`). Разверните правила командой `firebase deploy --only database,storage`. Файл правил RTDB: `database.rules.json`.
6. В Build → Storage включите bucket. Укажите точное имя bucket в `.env` и Worker. Правила находятся в `storage.rules`. Для вложений чатам прямой доступ через Storage Rules запрещён: Worker проверяет членство и передаёт файл через Google Cloud Storage API.
7. В Project settings → Cloud Messaging создайте Web Push certificate key pair. Публичный VAPID key укажите в `VITE_FIREBASE_VAPID_KEY`. В Google Cloud Console включите **Firebase Cloud Messaging API**.
8. Создайте сервисный аккаунт с доступом к Realtime Database, Storage Object и FCM. Его email и private key используются **только** в Cloudflare Worker. У Firebase service account JSON эти значения называются `client_email` и `private_key`.

Правила по умолчанию закрыты. Обязательно разверните их до тестирования. Для production проверьте их также в Firebase Emulator на сценариях двух разных пользователей.

## Cloudflare Worker: пошагово

1. Создайте Cloudflare аккаунт. В проекте выполните `npx wrangler login`.
2. Создайте KV namespace: `npx wrangler kv namespace create RATE_LIMIT`. Скопируйте полученный ID.
3. Скопируйте `wrangler.toml.example` в `wrangler.toml`. Заполните `id` KV namespace, `FIREBASE_PROJECT_ID`, `FIREBASE_DATABASE_URL`, `FIREBASE_STORAGE_BUCKET`, `FIREBASE_WEB_API_KEY`, `FIREBASE_SERVICE_ACCOUNT_EMAIL` и точный `FRONTEND_ORIGIN` опубликованного сайта. `wrangler.toml` с реальными настройками не должен содержать private key.
4. Сохраните private key как секрет: `npx wrangler secret put FIREBASE_PRIVATE_KEY`. Вставьте поле `private_key` из service account JSON, включая BEGIN/END строки. Worker также понимает строки с `\n` вместо переносов.
5. Выполните `npx wrangler deploy`. Wrangler покажет Worker URL. Укажите его в `VITE_WORKER_URL` и пересоберите frontend.
6. Проверка: откройте `https://<worker-url>/api/health` — ожидается `{"ok":true}`. Проверьте регистрацию и вход по username двумя браузерами. Для push включите уведомления на втором устройстве и отправьте ему сообщение.

В `FRONTEND_ORIGIN` Worker укажите HTTPS origin опубликованного сайта. Worker также отдельно разрешает точный адрес `http://localhost:5173` для локальной разработки; wildcard `*` не используется.

Worker проверяет Firebase ID token через Identity Toolkit для защищённых запросов, членство в чате для media и push и пароль на стороне сервера перед возвратом email при входе по username. Личные чаты создаются через Worker с условной записью RTDB (`If-Match: null_etag`), чтобы два одновременных запроса не создали разные записи. KV ограничивает частоту попыток; дополнительно включите Cloudflare Rate Limiting/WAF для публичного endpoint входа.

## Build и публикация

```bash
npm run build
firebase deploy --only hosting
```

Для локальной проверки правил запустите `firebase emulators:start --only database --project demo-pride` в одном терминале, затем `npm run test:rules` в другом. Тест использует отдельный demo проект и не обращается к production базе.

`firebase.json` содержит rewrite маршрутов React Router на `index.html`. При другом статическом хостинге настройте аналогичный SPA fallback и HTTPS. Укажите опубликованный домен в Firebase Authentication Authorized domains и в `FRONTEND_ORIGIN` Worker.

## Важные ограничения текущей версии

Эта версия реализует рабочее ядро переписки, но ещё не включает ленту, Stories, Trails, Pride Radio, звонки, подписки и биллинг, опросы, запланированные сообщения и админ панель. Эти разделы намеренно не представлены неработающими кнопками. Управление устройствами удаляет push токен, но не отзывает все Firebase Auth сессии этого устройства. Полноценный production запуск требует настроенных Firebase/Cloudflare ресурсов и проверки в двух аккаунтах; без ваших ключей и опубликованного Worker такой тест локально невозможен.

## Если что-то не работает

- **`PERMISSION_DENIED`**: проверьте, что правила RTDB и Storage опубликованы именно в используемый проект и URL базы указан полностью.
- **Вход по username не работает**: проверьте `VITE_WORKER_URL`, `FRONTEND_ORIGIN`, KV binding, service account secrets и `/api/health`.
- **Файлы не открываются**: проверьте членство в чате, bucket, права service account на Storage Objects и Worker logs (`npx wrangler tail`).
- **Push не приходит**: нужен HTTPS, разрешение браузера, VAPID key, включённый FCM API, активный токен в `devices/{uid}` и корректный Worker URL.
- **PWA показывает старый интерфейс**: обновите вкладку; при необходимости удалите установленное приложение и данные сайта, затем установите заново.
