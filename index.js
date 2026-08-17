require('dotenv').config();

const express = require('express');
const db = require('./db');
const { matchesTriggerKeyword } = require('./utils');
const { handleIncomingComment, startQueueWorker, getRateLimitStatus } = require('./queue');

const app = express();
const PORT = process.env.PORT || 3000;

const config = {
  verifyToken: process.env.VERIFY_TOKEN,
  pageAccessToken: process.env.PAGE_ACCESS_TOKEN,
  instagramAccountId: process.env.INSTAGRAM_ACCOUNT_ID,
  testLink: process.env.TEST_LINK || 'https://www.vizmo.lv/labbutiibas-tests',
};

function validateConfig() {
  const missing = [];
  if (!config.verifyToken) missing.push('VERIFY_TOKEN');
  if (!config.pageAccessToken) missing.push('PAGE_ACCESS_TOKEN');
  if (!config.instagramAccountId) missing.push('INSTAGRAM_ACCOUNT_ID');
  if (missing.length > 0) {
    console.warn(`[Config] Missing env vars: ${missing.join(', ')}`);
  }
}

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// --- Webhook verification (Meta Graph API) ---

app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === config.verifyToken) {
    console.log('[Webhook] Verification successful');
    return res.status(200).send(challenge);
  }

  console.warn('[Webhook] Verification failed — invalid token or mode');
  return res.sendStatus(403);
});

// --- Webhook listener ---

function parseInstagramComment(body) {
  if (body.object !== 'instagram') return null;

  const comments = [];

  for (const entry of body.entry || []) {
    for (const change of entry.changes || []) {
      if (change.field !== 'comments') continue;

      const value = change.value || {};
      const from = value.from || {};

      comments.push({
        commentId: value.id,
        userId: from.id,
        username: from.username,
        text: value.text || '',
        mediaId: value.media?.id,
      });
    }
  }

  return comments;
}

app.post('/webhook', async (req, res) => {
  res.sendStatus(200);

  try {
    const comments = parseInstagramComment(req.body);

    if (!comments || comments.length === 0) {
      return;
    }

    for (const comment of comments) {
      if (!comment.commentId || !comment.userId) continue;

      console.log(
        `[Webhook] Comment from @${comment.username || comment.userId}: "${comment.text}"`
      );

      if (!matchesTriggerKeyword(comment.text)) {
        console.log('[Webhook] No keyword match — skipping');
        continue;
      }

      console.log('[Webhook] Keyword match — processing');

      const result = await handleIncomingComment(comment, config);

      console.log('[Webhook] Result:', JSON.stringify(result));
    }
  } catch (error) {
    console.error('[Webhook] Processing error:', error.message);
    db.logError({
      username: null,
      errorMessage: error.message,
      statusCode: null,
      context: { source: 'webhook_handler' },
    });
  }
});

// --- Stats API ---

app.get('/stats', (req, res) => {
  const stats = db.getStats();
  const limits = getRateLimitStatus();

  res.json({
    ...stats,
    rateLimits: {
      hourly: {
        sent: limits.hourlyCount,
        limit: db.HOURLY_LIMIT,
        remaining: Math.max(0, db.HOURLY_LIMIT - limits.hourlyCount),
        reached: limits.hourlyLimitReached,
      },
      daily: {
        sent: limits.dailyCount,
        limit: db.DAILY_LIMIT,
        remaining: Math.max(0, db.DAILY_LIMIT - limits.dailyCount),
        reached: limits.dailyLimitReached,
      },
    },
    timestamp: new Date().toISOString(),
  });
});

// --- Error logs API ---

app.get('/logs', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
  const offset = parseInt(req.query.offset, 10) || 0;
  const format = req.query.format;

  const logs = db.getErrorLogs(limit, offset);
  const total = db.getErrorLogsCount();

  if (format === 'json') {
    return res.json({ total, limit, offset, logs });
  }

  res.send(renderLogsPage(logs, total, limit, offset));
});

// --- Dashboard UI ---

app.get('/dashboard', (req, res) => {
  const stats = db.getStats();
  const limits = getRateLimitStatus();

  res.send(renderDashboard(stats, limits));
});

app.get('/', (req, res) => {
  res.redirect('/dashboard');
});

// --- Health check ---

app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

// --- HTML templates ---

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderDashboard(stats, limits) {
  const errorRows = (stats.latestErrors || [])
    .map(
      (err) => `
      <tr class="error-row">
        <td>${escapeHtml(err.timestamp)}</td>
        <td>${escapeHtml(err.username || '—')}</td>
        <td>${escapeHtml(err.status_code || '—')}</td>
        <td>${escapeHtml(err.error_message)}</td>
      </tr>`
    )
    .join('');

  const hourlyPct = Math.round((limits.hourlyCount / db.HOURLY_LIMIT) * 100);
  const dailyPct = Math.round((limits.dailyCount / db.DAILY_LIMIT) * 100);

  return `<!DOCTYPE html>
<html lang="lv">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>VIZMO Instagram Automation — Dashboard</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #f4f7f5;
      color: #1a2e1a;
      line-height: 1.5;
      padding: 2rem;
    }
    .container { max-width: 960px; margin: 0 auto; }
    h1 { font-size: 1.5rem; margin-bottom: 0.25rem; }
    .subtitle { color: #5a6b5a; margin-bottom: 2rem; }
    .nav { margin-bottom: 2rem; }
    .nav a { color: #2d6a4f; margin-right: 1rem; }
    .cards {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 1rem;
      margin-bottom: 2rem;
    }
    .card {
      background: #fff;
      border-radius: 12px;
      padding: 1.25rem;
      box-shadow: 0 1px 3px rgba(0,0,0,0.08);
    }
    .card-label { font-size: 0.85rem; color: #5a6b5a; }
    .card-value { font-size: 2rem; font-weight: 700; color: #2d6a4f; }
    .progress-bar {
      height: 8px;
      background: #e8f0ea;
      border-radius: 4px;
      margin-top: 0.5rem;
      overflow: hidden;
    }
    .progress-fill {
      height: 100%;
      background: #40916c;
      border-radius: 4px;
      transition: width 0.3s;
    }
    .progress-fill.warning { background: #e9c46a; }
    .progress-fill.danger { background: #e76f51; }
    section {
      background: #fff;
      border-radius: 12px;
      padding: 1.5rem;
      box-shadow: 0 1px 3px rgba(0,0,0,0.08);
      margin-bottom: 1.5rem;
    }
    section h2 { font-size: 1.1rem; margin-bottom: 1rem; }
    table { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
    th, td { text-align: left; padding: 0.6rem 0.75rem; border-bottom: 1px solid #e8f0ea; }
    th { color: #5a6b5a; font-weight: 600; }
    .error-row td:last-child { color: #c1121f; }
    .empty { color: #5a6b5a; font-style: italic; }
    .refresh { font-size: 0.85rem; color: #5a6b5a; margin-top: 1rem; }
  </style>
  <meta http-equiv="refresh" content="60">
</head>
<body>
  <div class="container">
    <h1>🌿 VIZMO Instagram Automation</h1>
    <p class="subtitle">Webhook DM automation — monitoring dashboard</p>

    <div class="nav">
      <a href="/dashboard">Dashboard</a>
      <a href="/logs">Error Logs</a>
      <a href="/stats">JSON Stats</a>
      <a href="/health">Health</a>
    </div>

    <div class="cards">
      <div class="card">
        <div class="card-label">Sent Today</div>
        <div class="card-value">${stats.sentToday}</div>
      </div>
      <div class="card">
        <div class="card-label">Sent (Lifetime)</div>
        <div class="card-value">${stats.sentLifetime}</div>
      </div>
      <div class="card">
        <div class="card-label">Pending Queue</div>
        <div class="card-value">${stats.pendingQueue}</div>
      </div>
      <div class="card">
        <div class="card-label">Hourly Rate (${limits.hourlyCount}/${db.HOURLY_LIMIT})</div>
        <div class="card-value">${Math.max(0, db.HOURLY_LIMIT - limits.hourlyCount)}</div>
        <div class="progress-bar">
          <div class="progress-fill ${hourlyPct >= 90 ? 'danger' : hourlyPct >= 70 ? 'warning' : ''}" style="width: ${hourlyPct}%"></div>
        </div>
      </div>
      <div class="card">
        <div class="card-label">Daily Rate (${limits.dailyCount}/${db.DAILY_LIMIT})</div>
        <div class="card-value">${Math.max(0, db.DAILY_LIMIT - limits.dailyCount)}</div>
        <div class="progress-bar">
          <div class="progress-fill ${dailyPct >= 90 ? 'danger' : dailyPct >= 70 ? 'warning' : ''}" style="width: ${dailyPct}%"></div>
        </div>
      </div>
    </div>

    <section>
      <h2>⚠️ Latest Errors</h2>
      ${
        errorRows
          ? `<table>
              <thead>
                <tr><th>Time</th><th>Username</th><th>Status</th><th>Message</th></tr>
              </thead>
              <tbody>${errorRows}</tbody>
            </table>`
          : '<p class="empty">No errors recorded.</p>'
      }
    </section>

    <p class="refresh">Auto-refreshes every 60 seconds · <a href="/dashboard">Refresh now</a></p>
  </div>
</body>
</html>`;
}

function renderLogsPage(logs, total, limit, offset) {
  const rows = logs
    .map(
      (err) => `
      <tr>
        <td>${escapeHtml(err.timestamp)}</td>
        <td>${escapeHtml(err.username || '—')}</td>
        <td>${escapeHtml(err.status_code || '—')}</td>
        <td>${escapeHtml(err.error_message)}</td>
        <td><code>${escapeHtml(err.context || '')}</code></td>
      </tr>`
    )
    .join('');

  const prevOffset = Math.max(0, offset - limit);
  const nextOffset = offset + limit;
  const hasPrev = offset > 0;
  const hasNext = nextOffset < total;

  return `<!DOCTYPE html>
<html lang="lv">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>VIZMO — Error Logs</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #f4f7f5;
      color: #1a2e1a;
      padding: 2rem;
    }
    .container { max-width: 1100px; margin: 0 auto; }
    h1 { font-size: 1.5rem; margin-bottom: 0.5rem; }
    .nav { margin-bottom: 2rem; }
    .nav a { color: #2d6a4f; margin-right: 1rem; }
    section {
      background: #fff;
      border-radius: 12px;
      padding: 1.5rem;
      box-shadow: 0 1px 3px rgba(0,0,0,0.08);
    }
    table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
    th, td { text-align: left; padding: 0.6rem 0.75rem; border-bottom: 1px solid #e8f0ea; vertical-align: top; }
    th { color: #5a6b5a; font-weight: 600; }
    td:last-child { max-width: 300px; word-break: break-all; font-size: 0.8rem; }
    .pagination { margin-top: 1rem; }
    .pagination a {
      color: #2d6a4f;
      margin-right: 1rem;
      text-decoration: none;
    }
    .pagination a.disabled { color: #aaa; pointer-events: none; }
    code { background: #f0f4f1; padding: 0.15rem 0.4rem; border-radius: 4px; }
  </style>
</head>
<body>
  <div class="container">
    <h1>🌿 Error Logs History</h1>
    <div class="nav">
      <a href="/dashboard">Dashboard</a>
      <a href="/logs">Error Logs</a>
      <a href="/logs?format=json">JSON Export</a>
    </div>

    <section>
      <p style="margin-bottom: 1rem; color: #5a6b5a;">Total: ${total} errors</p>
      <table>
        <thead>
          <tr><th>Time</th><th>Username</th><th>Status</th><th>Message</th><th>Context</th></tr>
        </thead>
        <tbody>
          ${rows || '<tr><td colspan="5" style="color:#5a6b5a;font-style:italic">No errors recorded.</td></tr>'}
        </tbody>
      </table>

      <div class="pagination">
        <a href="/logs?limit=${limit}&offset=${prevOffset}" class="${hasPrev ? '' : 'disabled'}">← Previous</a>
        <a href="/logs?limit=${limit}&offset=${nextOffset}" class="${hasNext ? '' : 'disabled'}">Next →</a>
      </div>
    </section>
  </div>
</body>
</html>`;
}

// --- Start server ---

validateConfig();
startQueueWorker(config);

const server = app.listen(PORT, () => {
  console.log(`[Server] VIZMO Instagram Automation running on port ${PORT}`);
  console.log(`[Server] Dashboard: http://localhost:${PORT}/dashboard`);
});

process.on('SIGINT', () => {
  console.log('[Server] Shutting down...');
  server.close();
  db.closeDb();
  process.exit(0);
});

process.on('SIGTERM', () => {
  server.close();
  db.closeDb();
  process.exit(0);
});

module.exports = app;
