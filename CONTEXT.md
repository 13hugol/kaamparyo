# KaamParyo — Context Log

Purpose: Persist conversation context, decisions, and rationale to keep everyone aligned across sessions.

How to use
- Add new session entries at the top (reverse-chronological).
- Capture: summary, key decisions, action items, and links to code.
- Keep secrets out of this file (never paste tokens, passwords, or full .env values).

---

## Session Log

### Session: [fill date/time]
- Summary: Initial codebase scan and mapping; set up persistent context log (this file).
- Decisions: Create and maintain CONTEXT.md for ongoing context saving.
- Action Items:
  - [ ] Add future session summaries here.
  - [ ] Record major architectural changes and their rationale.
  - [ ] Track open questions and assumptions.
- Links: `src/index.js`, `src/app.js`, `src/routes/*`, `src/models/*`, `src/services/*`, `README.md`.

---

## Current System Snapshot (high level)

- Stack: Node.js + Express, MongoDB (Mongoose), Socket.IO (optional Redis adapter), static frontend in `public/`.
- Entrypoints:
  - Local server: `src/index.js` (HTTP + Socket.IO, optional Redis adapter, Mongo connect, scheduler).
  - Serverless: `api/index.js` (Vercel handler using `src/app.js`).
- App composition: `src/app.js` wires routes, JSON, CORS, static `public/` and `/uploads`.

### Routes (REST)
- Auth: `src/routes/auth.js` — OTP login (in-memory), JWT issue, profile CRUD.
- Tasks: `src/routes/tasks.js` — create/nearby/accept/start/complete/approve/reject, edit/delete, chat, reviews, expenses, bidding, heatmap, upload proof.
- Users: `src/routes/users.js` — profiles, tasks by user, wallet, metrics, ID/portfolio upload, block/report, loyalty.
- Admin: `src/routes/admin.js` — tasks, categories upsert, disputes, platform stats, settings.
- Categories: `src/routes/categories.js` — public list.
- Settings: `src/routes/settings.js` — public get + demo update.

### Models (Mongo)
- `User`, `Task`, `Transaction`, `Message`, `Review`, `Category`, `Settings` with geospatial and status indexes where relevant.

### Real-time (Socket.IO)
- Rooms for taskers/requesters and per-task rooms.
- Events: task lifecycle (`task_posted/assigned/started/completed/paid/cancelled`), chat messages, typing, and bid notifications.
- Location sharing: `location_update` ➜ emits `tasker_location` / `requester_location` to `task:{taskId}`.

### Services
- Payments: `src/services/payments.js` — mock intents, capture, refunds (no real gateway).
- OTP: in-memory store with TTL.
- Notify: optional Telegram; simple S3-like facade writing to `/uploads`.
- Scheduler: recurring and scheduled task processing (runs in `src/index.js`).

### Notable behaviors
- Optional Redis adapter for Socket.IO; gracefully falls back if unavailable.
- File uploads stored locally under `/uploads` (non-persistent on serverless).
- Environment values drive fees and defaults; avoid committing secrets.

---

## Open Questions
- [ ] Production file storage provider (S3/Cloudinary) and migration plan.
- [ ] Real payment gateway integration and webhook handling.
- [ ] Rate limiting/validation middlewares (mentioned in README vs. current code).
- [ ] Long-term storage for OTP (Redis?) if multi-instance.

---

## Change Log (architecture/process)
- [init] Created CONTEXT.md for conversation/context persistence.
