const Database = require('better-sqlite3');
const path = require('path');
const crypto = require('crypto');

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
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nickname TEXT NOT NULL UNIQUE,
      password TEXT NOT NULL,
      token TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS trips (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      owner_id INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (owner_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS participants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      trip_id INTEGER NOT NULL,
      user_id INTEGER,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (trip_id) REFERENCES trips(id),
      FOREIGN KEY (user_id) REFERENCES users(id)
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

    CREATE TABLE IF NOT EXISTS trip_invites (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      trip_id INTEGER NOT NULL,
      invite_code TEXT NOT NULL UNIQUE,
      created_by INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (trip_id) REFERENCES trips(id)
    );
  `);

  // 兼容旧表升级
  try { db.exec('ALTER TABLE trips ADD COLUMN owner_id INTEGER'); } catch (_) {}
  try { db.exec('ALTER TABLE participants ADD COLUMN user_id INTEGER'); } catch (_) {}
  try { db.exec('ALTER TABLE expenses ADD COLUMN original_amount REAL NOT NULL DEFAULT 0'); } catch (_) {}
  try { db.exec("ALTER TABLE expenses ADD COLUMN currency TEXT NOT NULL DEFAULT 'CNY'"); } catch (_) {}
  try { db.exec('ALTER TABLE expenses ADD COLUMN exchange_rate REAL NOT NULL DEFAULT 1.0'); } catch (_) {}
}

// ==================== 用户 ====================

function createUser(nickname, password) {
  const token = crypto.randomBytes(32).toString('hex');
  const d = getDb();
  const result = d.prepare(
    'INSERT INTO users (nickname, password, token) VALUES (?, ?, ?)'
  ).run(nickname, password, token);
  return { id: result.lastInsertRowid, nickname, token };
}

function findUserByNickname(nickname) {
  const d = getDb();
  return d.prepare('SELECT * FROM users WHERE nickname = ?').get(nickname);
}

function findUserByToken(token) {
  const d = getDb();
  return d.prepare('SELECT * FROM users WHERE token = ?').get(token);
}

// ==================== 邀请 ====================

function createInvite(tripId, createdBy) {
  const code = crypto.randomBytes(4).toString('hex');
  const d = getDb();
  d.prepare(
    'INSERT INTO trip_invites (trip_id, invite_code, created_by) VALUES (?, ?, ?)'
  ).run(tripId, code, createdBy);
  return code;
}

function findInvite(code) {
  const d = getDb();
  return d.prepare('SELECT * FROM trip_invites WHERE invite_code = ?').get(code);
}

module.exports = { getDb, createUser, findUserByNickname, findUserByToken, createInvite, findInvite };
