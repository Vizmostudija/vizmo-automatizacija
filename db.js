// db.js - Simple JSON-based/In-Memory store for VIZMO
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
  logError: (err) => {
    const data = loadData();
    data.logs.unshift({ time: new Date().toISOString(), error: String(err) });
    if (data.logs.length > 100) data.logs.pop();
    saveData(data);
  }
};
