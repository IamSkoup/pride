# Pride Messenger

React + TypeScript + Vite application using Firebase Authentication, Realtime Database, Storage, Cloud Messaging, and a Cloudflare Worker.

## Local development

1. Copy `.env.example` to `.env` and fill in the Firebase Web configuration, the **new public** VAPID key, and `VITE_WORKER_URL`.
2. Run `npm ci` and `npm run dev`.
3. Open `http://localhost:5173`. The worker allows this exact development origin.

Never put a Firebase service-account key or a VAPID private key in `.env`, frontend code, or GitHub. The VAPID private key belongs in Firebase's managed key pair; only its public key is used by Vite.

## GitHub Pages

The production base path is `/pride/`. The build emits `dist/404.html` from the same app shell as `index.html` so GitHub Pages can serve BrowserRouter deep links after a refresh. The Pages workflow builds the app and supplies the `VITE_FIREBASE_*` values and `VITE_FIREBASE_VAPID_KEY` from GitHub Actions secrets. `VITE_WORKER_URL` is set to `https://pride-messenger-worker.kapani.workers.dev` in the workflow.

Add/update these repository Actions secrets before publishing: `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_DATABASE_URL`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_STORAGE_BUCKET`, `VITE_FIREBASE_MESSAGING_SENDER_ID`, `VITE_FIREBASE_APP_ID`, and `VITE_FIREBASE_VAPID_KEY` (the rotated public VAPID key).

## Firebase rules

Rules are kept in `database.rules.json` and `storage.rules`. After reviewing them, publish with:

```powershell
npx firebase-tools deploy --only database,storage --project pride-messenger
```

The tests use the local Realtime Database emulator. Start it in one terminal with `npx firebase-tools emulators:start --only database --project demo-pride`, then run `npm run test:rules` in another.

## Cloudflare Worker

The single Wrangler config is `worker/wrangler.toml`; the deployed Worker name and KV namespace remain the existing Pride Messenger resources. Run commands from the project root:

```powershell
npx wrangler --config worker/wrangler.toml deploy --dry-run
npx wrangler --config worker/wrangler.toml tail
```

The Worker needs the existing KV binding `RATE_LIMIT` and variables configured in that TOML. Keep `FIREBASE_PRIVATE_KEY` only as a Cloudflare Worker secret. The allowed origins are the production Pages origin (`https://iamskoup.github.io`) and exact local dev origin (`http://localhost:5173`).

Before a real Worker deployment, set/verify the Cloudflare secret `FIREBASE_PRIVATE_KEY`; then run `npx wrangler --config worker/wrangler.toml deploy` only when a production release is intended. No production deployment is part of a local build or dry-run.

## Build checks

```powershell
npm ci
npm run typecheck
npm run build
npm run test:rules
```

The Firebase Web API key and Firebase config are public client configuration. Never commit service-account credentials, environment files, debug logs, `node_modules`, Wrangler state, or generated `dist` output.
