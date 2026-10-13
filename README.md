# Pride Messenger 2.0

The active frontend starts in `src/main.tsx` and lives in `src/v2`. It is a new React interface with its own session, data, shell and style layers. The previous pages remain in the repository for data and compatibility reference; they are not imported by the active app.

## Data and compatibility

- Firebase Authentication keeps existing UIDs and credentials.
- The Worker copies each signed in user's public legacy profile from `users/{uid}` to `v2/usersPublic/{uid}` and syncs later profile changes. It records `migrationVersion: 2` and `v2/migrations/{uid}`. This is repeatable and leaves legacy data intact.
- Existing DM, group and channel records still read from `chats`, `userChats`, `messages`, `users/{uid}/claws`, `receivedGifts` and related nodes through `src/v2/data.ts`. Existing attachments use the authenticated Worker media endpoint.
- New Prides live in `v2/prides`, `v2/prideMembers`, `v2/userPrides`, `v2/channels`, `v2/channelPrides`, `v2/messages`, `v2/activity` and `v2/drafts`. The Worker authorizes writes; Firebase rules allow members to read only their spaces.
- No legacy nodes are deleted by the v2 migration. A complete historical copy of all legacy messages into `v2/messages` has not been performed; the compatibility layer remains necessary.

## Running locally

Set these Vite variables in a local `.env`: `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_DATABASE_URL`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_STORAGE_BUCKET`, `VITE_FIREBASE_APP_ID`, and `VITE_WORKER_URL`. Firebase web configuration is public client configuration. Never place a Firebase service account key in the frontend.

The production base path is `/pride/`. GitHub Pages uses `dist/404.html` for deep links and the workflow supplies Firebase configuration and the public VAPID key from repository secrets. The workflow sets `VITE_WORKER_URL` to the existing Worker URL.

```sh
npm ci
npm run dev
npm run typecheck
npm run test
npm run build
```

`npm run test:rules` needs the Firebase Realtime Database emulator running on port 9000. It checks both legacy and v2 access rules. In the managed cloud runtime, the HTTP proxy must be excluded for this localhost only test command.

The Worker is configured in `worker/wrangler.toml` and needs its existing `RATE_LIMIT` KV binding and Worker secret `FIREBASE_PRIVATE_KEY`. Run `npx wrangler --config worker/wrangler.toml deploy --dry-run` to verify its bundle.

Calls use `/api/calls/ice` for temporary TURN credentials. Cross-network calling needs a reachable TURN service, `TURN_URLS`, and a matching `TURN_SHARED_SECRET`; STUN alone cannot connect every network pair. Keep the service account key and TURN secret out of the repository.

## Release order

Review the existing Firebase project and back up RTDB before release. Publish the updated RTDB rules, publish the Worker with the same Cloudflare project and secret, and then publish the frontend. The existing GitHub Pages workflow builds with `/pride/` as base path. The Worker keeps its legacy API so an older frontend can continue to work during rollout. No production deployment is performed by local builds or dry runs.

## Scope still open

The new interface covers authentication, existing conversations, basic messages, replies, edits, reactions, legacy attachments, Prides, text and announcement channels, invites, basic ranks, moderator actions (reports, kick, ban, unban, message removal) and an admin audit log, indexed username prefix search, recent Pride activity, profile editing, Claws, subscriptions and gifts. The larger brief also calls for Cloudflare Realtime rooms, R2 uploads for v2 channels, AutoMod, full text search, stories, complex role overrides, offline message persistence and other social features. Those require further implementation and operational setup. The interface does not present those actions as complete. The current Cloudflare API token cannot list R2 buckets (API error 10000), so R2 integration remains blocked by account permissions.
