# VIZMO Instagram DM Automation Service

Production-ready Node.js (Express) webhook service that listens for Instagram comment events, detects trigger keywords, and sends automated DMs with strict rate limiting and a resilient queue system.

## Features

- **Webhook integration** — Meta Graph API verification and Instagram comment events
- **Keyword detection** — Case-insensitive partial match for `PAUZE` and `AUTOMATIZĀCIJA` (Latvian Unicode supported)
- **Rate limiting** — 30 DMs/hour, 100 DMs/day with automatic queuing when limits are reached
- **Background queue worker** — Processes pending messages every 5 minutes via `node-cron`
- **Human-like delays** — Random 3–10 second pauses between API calls
- **Persistent storage** — SQLite (`better-sqlite3`) survives server restarts
- **Monitoring dashboard** — HTML UI at `/dashboard`, JSON stats at `/stats`, error history at `/logs`

---

## Project Structure

```
vizmo-automatizacija/
├── index.js          # Express app, webhook routes, dashboard
├── db.js             # SQLite schema and data access
├── queue.js          # Rate limiting and queue processor
├── utils.js          # Keyword matching and message templates
├── package.json
├── .env.example
├── .gitignore
└── README.md
```

---

## Quick Start (Local)

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

Copy the example env file and fill in your Meta credentials:

```bash
cp .env.example .env
```

| Variable | Description |
|----------|-------------|
| `VERIFY_TOKEN` | Custom string for webhook verification (e.g. `vizmo2026secret`) |
| `PAGE_ACCESS_TOKEN` | Meta Graph API Page Access Token |
| `INSTAGRAM_ACCOUNT_ID` | Instagram Business Account ID |
| `TEST_LINK` | URL sent in DM responses |
| `PORT` | Server port (default `3000`) |

### 3. Run the server

```bash
npm start
```

Open the dashboard: [http://localhost:3000/dashboard](http://localhost:3000/dashboard)

---

## Meta App Setup

1. Create a [Meta Developer App](https://developers.facebook.com/) with **Instagram** product enabled.
2. Connect your Instagram Business/Creator account to a Facebook Page.
3. Generate a **Page Access Token** with these permissions:
   - `instagram_manage_comments`
   - `instagram_manage_messages`
   - `pages_manage_metadata`
   - `pages_read_engagement`
4. Subscribe your app to the Instagram account webhook with field: **`comments`**.
5. Set the webhook callback URL to:
   ```
   https://your-domain.com/webhook
   ```
6. Use the same `VERIFY_TOKEN` value in both `.env` and the Meta App Dashboard.

---

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/webhook` | Meta webhook verification |
| `POST` | `/webhook` | Receives Instagram comment events |
| `GET` | `/dashboard` | HTML monitoring dashboard |
| `GET` | `/stats` | JSON statistics and rate limit status |
| `GET` | `/logs` | Error log history (HTML) |
| `GET` | `/logs?format=json` | Error log history (JSON) |
| `GET` | `/health` | Health check |

---

## Trigger Keywords

Comments containing any of these (partial, case-insensitive match):

- `PAUZE`, `pauze`, `Pauze`
- `AUTOMATIZĀCIJA`, `automatizācija`

Examples that trigger:
- `"Paldies Agnese par saturu. PAUZE."`
- `"Lūdzu aizsūti man arī! pauze 🌿"`
- `"PAUZE!"`

---

## Rate Limiting & Queue

| Limit | Value |
|-------|-------|
| Hourly | 30 sent DMs |
| Daily | 100 sent DMs (calendar day) |

When a limit is reached, incoming keyword matches are **queued** (status `PENDING`) — never dropped. A cron job runs every **5 minutes** and sends queued messages as soon as capacity is available.

---

## Deployment

### Render (Recommended)

1. Push this repo to GitHub.
2. Create a new **Web Service** on [Render](https://render.com).
3. Set build command: `npm install`
4. Set start command: `npm start`
5. Add environment variables from `.env.example`.
6. Use the Render URL as your Meta webhook callback: `https://your-app.onrender.com/webhook`

> **Note:** Render free tier spins down after inactivity. For reliable webhook delivery, use a paid plan or an external uptime pinger.

### Replit

1. Import the GitHub repo into [Replit](https://replit.com).
2. Add secrets (environment variables) in the Replit Secrets panel.
3. Run `npm start`.
4. Use the Replit-provided URL for the Meta webhook.

### Vercel

Vercel is **not recommended** for this service because:
- The queue worker requires a persistent background process (`node-cron`).
- SQLite file storage is ephemeral on serverless functions.

Use Render, Railway, Fly.io, or a VPS instead for production.

### Railway / Fly.io

Same pattern as Render:
- Build: `npm install`
- Start: `npm start`
- Set all env vars
- Point Meta webhook to `/webhook`

---

## Local Development with ngrok

To test webhooks locally:

```bash
# Terminal 1
npm start

# Terminal 2
npx ngrok http 3000
```

Use the ngrok HTTPS URL + `/webhook` in the Meta App Dashboard.

---

## Database

SQLite database is stored at `./data/vizmo.db` by default. Override with:

```
DB_PATH=/path/to/vizmo.db
```

Tables:
- `message_queue` — Pending/sent/failed DM jobs
- `sent_messages` — Rate limit counter source
- `error_logs` — API and processing errors

---

## License

MIT — VIZMO Studija
