const { createClient } = require('@libsql/client');
const crypto = require('crypto');

const client = createClient({
  url: process.env.TURSO_URL || 'file:data.db',
  authToken: process.env.TURSO_TOKEN,
});

// --- 兼容层：把 Turso 的 rows[][] 转成 better-sqlite3 风格的对象 ---

async function execute(sql, ...params) {
  const rs = await client.execute({ sql, args: params });
  const rows = rs.rows.map(row => {
    const obj = {};
    rs.columns.forEach((col, i) => obj[col] = row[i]);
    return obj;
  });
  return { rows, lastInsertRowid: rs.lastInsertRowid ? Number(rs.lastInsertRowid) : undefined };
}

function getDb() {
  return {
    prepare(sql) {
      return {
        async get(...params) { const { rows } = await execute(sql, ...params); return rows[0] || null; },
        async all(...params) { const { rows } = await execute(sql, ...params); return rows; },
        async run(...params) { const r = await execute(sql, ...params); return { lastInsertRowid: r.lastInsertRowid }; },
      };
    },
    async exec(sql) { await execute(sql); },
  };
}

// --- 初始化表 ---

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nickname TEXT NOT NULL UNIQUE,
    password TEXT NOT NULL,
    token TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS trips (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    owner_id INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (owner_id) REFERENCES users(id)
  )`,
  `CREATE TABLE IF NOT EXISTS participants (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    trip_id INTEGER NOT NULL,
    user_id INTEGER,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (trip_id) REFERENCES trips(id),
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`,
  `CREATE TABLE IF NOT EXISTS expenses (
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
  )`,
  `CREATE TABLE IF NOT EXISTS trip_invites (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    trip_id INTEGER NOT NULL,
    invite_code TEXT NOT NULL UNIQUE,
    created_by INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (trip_id) REFERENCES trips(id)
  )`,
];

async function initTables() {
  const db = getDb();
  for (const sql of SCHEMA) {
    await db.exec(sql);
  }
}

// --- 用户 ---

async function createUser(nickname, password) {
  const token = crypto.randomBytes(32).toString('hex');
  const db = getDb();
  const r = await db.prepare('INSERT INTO users (nickname, password, token) VALUES (?, ?, ?)').run(nickname, password, token);
  return { id: r.lastInsertRowid, nickname, token };
}

async function findUserByNickname(nickname) {
  const db = getDb();
  return await db.prepare('SELECT * FROM users WHERE nickname = ?').get(nickname);
}

async function findUserByToken(token) {
  const db = getDb();
  return await db.prepare('SELECT * FROM users WHERE token = ?').get(token);
}

// --- 邀请 ---

async function createInvite(tripId, createdBy) {
  const code = crypto.randomBytes(4).toString('hex');
  const db = getDb();
  await db.prepare('INSERT INTO trip_invites (trip_id, invite_code, created_by) VALUES (?, ?, ?)').run(tripId, code, createdBy);
  return code;
}

async function findInvite(code) {
  const db = getDb();
  return await db.prepare('SELECT * FROM trip_invites WHERE invite_code = ?').get(code);
}

module.exports = { getDb, initTables, createUser, findUserByNickname, findUserByToken, createInvite, findInvite };
