// db.js - JSON storage matching all index.js and queue.js expectations
const fs = require('fs');
const path = require('path');

const DB_FILE = path.join(__dirname, 'data.json');

function loadData() {
  if (!fs.existsSync(DB_FILE)) {
    const initial = { logs: [], queue: [], stats: { sentToday: 0, sentHour: 0, lastReset: Date.now() } };
    fs.writeFileSync(DB_FILE, JSON.stringify(initial, null, 2));
    return initial;
  }
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } catch (e) {
    return { logs: [], queue: [], stats: { sentToday: 0, sentHour: 0, lastReset: Date.now() } };
  }
}

function saveData(data) {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error('Failed to save DB:', e);
  }
}

module.exports = {
  getDb: loadData,
  saveDb: saveData,
  getStats: () => {
    const data = loadData();
    return {
      sentToday: data.stats.sentToday || 0,
      sentHour: data.stats.sentHour || 0,
      pendingQueue: (data.queue || []).filter(q => q.status === 'PENDING').length
    };
  },
  getSentCountLastHour: () => {
    const data = loadData();
    return data.stats.sentHour || 0;
  },
  getSentCountToday: () => {
    const data = loadData();
    return data.stats.sentToday || 0;
  },
  incrementSentCount: () => {
    const data = loadData();
    data.stats.sentToday = (data.stats.sentToday || 0) + 1;
    data.stats.sentHour = (data.stats.sentHour || 0) + 1;
    saveData(data);
  },
  addToQueue: (item) => {
    const data = loadData();
    data.queue = data.queue || [];
    data.queue.push({ ...item, id: Date.now(), status: 'PENDING', createdAt: new Date().toISOString() });
    saveData(data);
  },
  getPendingQueue: () => {
    const data = loadData();
    return (data.queue || []).filter(q => q.status === 'PENDING');
  },
  updateQueueStatus: (id, status) => {
    const data = loadData();
    const item = (data.queue || []).find(q => q.id === id);
    if (item) item.status = status;
    saveData(data);
  },
  logError: (err) => {
    const data = loadData();
    data.logs = data.logs || [];
    data.logs.unshift({ time: new Date().toISOString(), error: String(err) });
    if (data.logs.length > 100) data.logs.pop();
    saveData(data);
  },
  getRecentErrors: (limit = 10) => {
    const data = loadData();
    return (data.logs || []).slice(0, limit);
  },
  getAllErrors: () => {
    const data = loadData();
    return data.logs || [];
  }
};
