const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'vizmo.db');

function ensureDataDir() {
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

let db;

function getDb() {
  if (!db) {
    ensureDataDir();
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    initSchema(db);
  }
  return db;
}

function initSchema(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS message_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      comment_id TEXT NOT NULL UNIQUE,
      user_id TEXT NOT NULL,
      username TEXT,
      comment_text TEXT,
      status TEXT NOT NULL DEFAULT 'PENDING',
      error_message TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      processed_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_queue_status ON message_queue(status);
    CREATE INDEX IF NOT EXISTS idx_queue_created ON message_queue(created_at);

    CREATE TABLE IF NOT EXISTS sent_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      comment_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      username TEXT,
      sent_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_sent_at ON sent_messages(sent_at);

    CREATE TABLE IF NOT EXISTS error_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL DEFAULT (datetime('now')),
      username TEXT,
      error_message TEXT NOT NULL,
      status_code INTEGER,
      context TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_error_timestamp ON error_logs(timestamp DESC);
  `);
}

// --- Queue operations ---

function enqueueMessage({ commentId, userId, username, commentText }) {
  const stmt = getDb().prepare(`
    INSERT INTO message_queue (comment_id, user_id, username, comment_text, status)
    VALUES (?, ?, ?, ?, 'PENDING')
    ON CONFLICT(comment_id) DO NOTHING
  `);
  const result = stmt.run(commentId, userId, username || null, commentText || null);
  return result.changes > 0;
}

function getPendingQueueItems(limit = 50) {
  return getDb()
    .prepare(`
      SELECT id, comment_id, user_id, username, comment_text, created_at
      FROM message_queue
      WHERE status = 'PENDING'
      ORDER BY created_at ASC
      LIMIT ?
    `)
    .all(limit);
}

function markQueueProcessing(id) {
  getDb()
    .prepare(`UPDATE message_queue SET status = 'PROCESSING' WHERE id = ? AND status = 'PENDING'`)
    .run(id);
}

function markQueueSent(id) {
  getDb()
    .prepare(`
      UPDATE message_queue
      SET status = 'SENT', processed_at = datetime('now'), error_message = NULL
      WHERE id = ?
    `)
    .run(id);
}

function markQueueFailed(id, errorMessage) {
  getDb()
    .prepare(`
      UPDATE message_queue
      SET status = 'FAILED', processed_at = datetime('now'), error_message = ?
      WHERE id = ?
    `)
    .run(errorMessage, id);
}

function requeueFailedToPending(id) {
  getDb()
    .prepare(`
      UPDATE message_queue
      SET status = 'PENDING', processed_at = NULL, error_message = NULL
      WHERE id = ? AND status = 'FAILED'
    `)
    .run(id);
}

function getPendingQueueCount() {
  const row = getDb()
    .prepare(`SELECT COUNT(*) AS count FROM message_queue WHERE status = 'PENDING'`)
    .get();
  return row.count;
}

function getQueueItemByCommentId(commentId) {
  return getDb()
    .prepare(`
      SELECT id, comment_id, user_id, username, comment_text, status, created_at
      FROM message_queue
      WHERE comment_id = ?
    `)
    .get(commentId);
}

// --- Sent message tracking ---

function recordSentMessage({ commentId, userId, username }) {
  getDb()
    .prepare(`
      INSERT INTO sent_messages (comment_id, user_id, username)
      VALUES (?, ?, ?)
    `)
    .run(commentId, userId, username || null);
}

function getSentCountLastHour() {
  const row = getDb()
    .prepare(`
      SELECT COUNT(*) AS count
      FROM sent_messages
      WHERE sent_at >= datetime('now', '-1 hour')
    `)
    .get();
  return row.count;
}

function getSentCountToday() {
  const row = getDb()
    .prepare(`
      SELECT COUNT(*) AS count
      FROM sent_messages
      WHERE date(sent_at) = date('now', 'localtime')
    `)
    .get();
  return row.count;
}

function getSentCountLifetime() {
  const row = getDb()
    .prepare(`SELECT COUNT(*) AS count FROM sent_messages`)
    .get();
  return row.count;
}

// --- Error logs ---

function logError({ username, errorMessage, statusCode, context }) {
  getDb()
    .prepare(`
      INSERT INTO error_logs (username, error_message, status_code, context)
      VALUES (?, ?, ?, ?)
    `)
    .run(
      username || null,
      errorMessage,
      statusCode || null,
      context ? JSON.stringify(context) : null
    );
}

function getLatestErrors(limit = 10) {
  return getDb()
    .prepare(`
      SELECT id, timestamp, username, error_message, status_code, context
      FROM error_logs
      ORDER BY timestamp DESC
      LIMIT ?
    `)
    .all(limit);
}

function getErrorLogs(limit = 100, offset = 0) {
  return getDb()
    .prepare(`
      SELECT id, timestamp, username, error_message, status_code, context
      FROM error_logs
      ORDER BY timestamp DESC
      LIMIT ? OFFSET ?
    `)
    .all(limit, offset);
}

function getErrorLogsCount() {
  const row = getDb().prepare(`SELECT COUNT(*) AS count FROM error_logs`).get();
  return row.count;
}

// --- Stats ---

function getStats() {
  return {
    sentToday: getSentCountToday(),
    sentLifetime: getSentCountLifetime(),
    sentLastHour: getSentCountLastHour(),
    pendingQueue: getPendingQueueCount(),
    hourlyLimit: 30,
    dailyLimit: 100,
    hourlyRemaining: Math.max(0, 30 - getSentCountLastHour()),
    dailyRemaining: Math.max(0, 100 - getSentCountToday()),
    latestErrors: getLatestErrors(10),
  };
}

function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}

module.exports = {
  getDb,
  enqueueMessage,
  getPendingQueueItems,
  markQueueProcessing,
  markQueueSent,
  markQueueFailed,
  requeueFailedToPending,
  getPendingQueueCount,
  getQueueItemByCommentId,
  recordSentMessage,
  getSentCountLastHour,
  getSentCountToday,
  getSentCountLifetime,
  logError,
  getLatestErrors,
  getErrorLogs,
  getErrorLogsCount,
  getStats,
  closeDb,
  HOURLY_LIMIT: 30,
  DAILY_LIMIT: 100,
};
