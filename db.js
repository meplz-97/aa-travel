const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data.db');

let db;

function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    initTables();
  }
  return db;
}

function initTables() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS trips (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS participants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      trip_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (trip_id) REFERENCES trips(id)
    );

    CREATE TABLE IF NOT EXISTS expenses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      trip_id INTEGER NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      amount REAL NOT NULL,
      original_amount REAL NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'CNY',
      exchange_rate REAL NOT NULL DEFAULT 1.0,
      category TEXT NOT NULL DEFAULT 'other',
      payer_id INTEGER NOT NULL,
      split_with TEXT NOT NULL DEFAULT '[]',
      creator_name TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (trip_id) REFERENCES trips(id),
      FOREIGN KEY (payer_id) REFERENCES participants(id)
    );
  `);

  // 兼容旧表升级：尝试添加新列
  try { db.exec('ALTER TABLE expenses ADD COLUMN original_amount REAL NOT NULL DEFAULT 0'); } catch (_) {}
  try { db.exec("ALTER TABLE expenses ADD COLUMN currency TEXT NOT NULL DEFAULT 'CNY'"); } catch (_) {}
  try { db.exec('ALTER TABLE expenses ADD COLUMN exchange_rate REAL NOT NULL DEFAULT 1.0'); } catch (_) {}
  // 修正已有数据的默认值
  db.prepare("UPDATE expenses SET currency = 'CNY' WHERE currency = '' OR currency IS NULL").run();
  db.prepare("UPDATE expenses SET exchange_rate = 1.0 WHERE exchange_rate = 0 OR exchange_rate IS NULL").run();
  db.prepare("UPDATE expenses SET original_amount = amount WHERE original_amount = 0 OR original_amount IS NULL").run();
}

module.exports = { getDb };
