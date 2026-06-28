const express = require('express');
const { getDb, initTables, createUser, findUserByNickname, findUserByToken, createInvite, findInvite } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static('public'));

// ==================== 权限中间件 ====================

async function auth(req, res, next) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: '请先登录' });
  const user = await findUserByToken(token);
  if (!user) return res.status(401).json({ error: '登录已过期，请重新登录' });
  req.user = user;
  next();
}

// ==================== 汇率缓存 ====================

let ratesCache = { CNY: 1 };
let ratesUpdated = 0;
const RATES_TTL = 3600000;

const CURRENCIES = [
  { code: 'CNY', symbol: '¥', name: '人民币' },
  { code: 'USD', symbol: '$', name: '美元' },
  { code: 'EUR', symbol: '€', name: '欧元' },
  { code: 'JPY', symbol: '¥', name: '日元' },
  { code: 'KRW', symbol: '₩', name: '韩元' },
  { code: 'THB', symbol: '฿', name: '泰铢' },
  { code: 'HKD', symbol: 'HK$', name: '港币' },
  { code: 'TWD', symbol: 'NT$', name: '新台币' },
  { code: 'SGD', symbol: 'S$', name: '新加坡元' },
  { code: 'MYR', symbol: 'RM', name: '马来西亚令吉' },
  { code: 'VND', symbol: '₫', name: '越南盾' },
  { code: 'IDR', symbol: 'Rp', name: '印尼盾' },
  { code: 'PHP', symbol: '₱', name: '菲律宾比索' },
  { code: 'GBP', symbol: '£', name: '英镑' },
  { code: 'AUD', symbol: 'A$', name: '澳元' },
  { code: 'CAD', symbol: 'C$', name: '加元' },
];

async function refreshRates() {
  const now = Date.now();
  if (now - ratesUpdated < RATES_TTL) return;
  try {
    const resp = await fetch('https://api.frankfurter.app/latest?from=CNY');
    if (!resp.ok) throw new Error('汇率接口异常');
    const data = await resp.json();
    if (data.rates) {
      ratesCache = { CNY: 1 };
      for (const [code, rate] of Object.entries(data.rates)) {
        if (rate > 0) ratesCache[code] = 1 / rate;
      }
      ratesUpdated = now;
      console.log('💱 汇率已更新');
    }
  } catch (e) { console.warn('⚠️ 汇率更新失败:', e.message); }
}

// ==================== 认证 ====================

app.post('/api/auth/register', async (req, res) => {
  const { nickname, password } = req.body;
  if (!nickname || !nickname.trim()) return res.status(400).json({ error: '昵称不能为空' });
  if (!password || !password.trim()) return res.status(400).json({ error: '密码不能为空' });
  const trimmed = nickname.trim();
  const existing = await findUserByNickname(trimmed);
  if (existing) return res.status(400).json({ error: '这个名字已被使用，换一个吧' });
  const user = await createUser(trimmed, password.trim());
  res.json({ token: user.token, user: { id: user.id, nickname: user.nickname }, isNew: true });
});

app.post('/api/auth/login', async (req, res) => {
  const { nickname, password } = req.body;
  if (!nickname || !password) return res.status(400).json({ error: '请输入昵称和密码' });
  const user = await findUserByNickname(nickname.trim());
  if (!user || user.password !== password.trim()) return res.status(400).json({ error: '昵称或密码错误' });
  res.json({ token: user.token, user: { id: user.id, nickname: user.nickname }, isNew: false });
});

app.get('/api/auth/me', auth, (req, res) => {
  res.json({ id: req.user.id, nickname: req.user.nickname });
});

// ==================== 管理 ====================

app.get('/api/admin/users', auth, async (req, res) => {
  const db = getDb();
  const users = await db.prepare('SELECT id, nickname, created_at FROM users ORDER BY id').all();
  res.json({ count: users.length, users });
});

// ==================== 汇率 ====================

app.get('/api/rates', async (_req, res) => {
  await refreshRates();
  const list = CURRENCIES.map(c => ({ ...c, rate: ratesCache[c.code] || null })).filter(c => c.rate !== null);
  res.json({ currencies: list, updated: new Date(ratesUpdated).toISOString() });
});

// ==================== 行程 ====================

app.post('/api/trips', auth, async (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: '行程名称不能为空' });
  const db = getDb();
  const r = await db.prepare('INSERT INTO trips (name, owner_id) VALUES (?, ?)').run(name.trim(), req.user.id);
  await db.prepare('INSERT INTO participants (trip_id, user_id, name) VALUES (?, ?, ?)').run(r.lastInsertRowid, req.user.id, req.user.nickname);
  res.json({ id: r.lastInsertRowid, name: name.trim() });
});

app.get('/api/trips', auth, async (req, res) => {
  const db = getDb();
  const trips = await db.prepare(`
    SELECT DISTINCT t.*,
      (SELECT COUNT(*) FROM participants WHERE trip_id = t.id) as participant_count,
      (SELECT COUNT(*) FROM expenses WHERE trip_id = t.id) as expense_count
    FROM trips t
    LEFT JOIN participants p ON p.trip_id = t.id
    WHERE t.owner_id = ? OR p.user_id = ?
    ORDER BY t.created_at DESC
  `).all(req.user.id, req.user.id);
  res.json(trips);
});

app.get('/api/trips/:id', auth, async (req, res) => {
  const db = getDb();
  const trip = await db.prepare('SELECT * FROM trips WHERE id = ?').get(req.params.id);
  if (!trip) return res.status(404).json({ error: '行程不存在' });

  const participant = await db.prepare('SELECT * FROM participants WHERE trip_id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (trip.owner_id !== req.user.id && !participant) {
    return res.status(403).json({ error: '你没有权限查看这个行程' });
  }

  const participants = await db.prepare('SELECT * FROM participants WHERE trip_id = ? ORDER BY id').all(req.params.id);
  const expenses = await db.prepare(`
    SELECT e.*, p.name as payer_name FROM expenses e
    LEFT JOIN participants p ON e.payer_id = p.id
    WHERE e.trip_id = ? ORDER BY e.created_at DESC
  `).all(req.params.id);

  const enriched = expenses.map(e => {
    let splitIds = [];
    try { splitIds = JSON.parse(e.split_with); } catch (_) {}
    const splitNames = splitIds.map(sid => { const p = participants.find(pp => pp.id === sid); return p ? p.name : '?'; });
    return { ...e, split_with: splitIds, split_names: splitNames };
  });

  res.json({ ...trip, participants, expenses: enriched, isOwner: trip.owner_id === req.user.id });
});

// ==================== 邀请 ====================

app.post('/api/trips/:id/invite', auth, async (req, res) => {
  const db = getDb();
  const trip = await db.prepare('SELECT * FROM trips WHERE id = ?').get(req.params.id);
  if (!trip) return res.status(404).json({ error: '行程不存在' });
  if (trip.owner_id !== req.user.id) return res.status(403).json({ error: '只有创建者可以邀请' });

  const code = await createInvite(req.params.id, req.user.id);
  const host = req.get('host') || `localhost:${PORT}`;
  const proto = req.get('x-forwarded-proto') || 'http';
  const baseUrl = process.env.BASE_URL || `${proto}://${host}`;
  res.json({ invite_code: code, url: `${baseUrl}/invite/${code}` });
});

app.get('/api/invite/:code', auth, async (req, res) => {
  const db = getDb();
  const invite = await findInvite(req.params.code);
  if (!invite) return res.status(404).json({ error: '邀请链接无效' });
  const trip = await db.prepare('SELECT * FROM trips WHERE id = ?').get(invite.trip_id);
  if (!trip) return res.status(404).json({ error: '行程已不存在' });
  const existing = await db.prepare('SELECT * FROM participants WHERE trip_id = ? AND user_id = ?').get(invite.trip_id, req.user.id);
  if (!existing) {
    await db.prepare('INSERT INTO participants (trip_id, user_id, name) VALUES (?, ?, ?)').run(invite.trip_id, req.user.id, req.user.nickname);
  }
  res.json({ trip_id: invite.trip_id, name: trip.name });
});

// ==================== 花费 ====================

app.post('/api/trips/:id/expenses', auth, async (req, res) => {
  const { description, amount, original_amount, currency, exchange_rate, category, payer_id, split_with, creator_name } = req.body;
  const db = getDb();
  const trip = await db.prepare('SELECT * FROM trips WHERE id = ?').get(req.params.id);
  if (!trip) return res.status(404).json({ error: '行程不存在' });

  const participant = await db.prepare('SELECT * FROM participants WHERE trip_id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (trip.owner_id !== req.user.id && !participant) return res.status(403).json({ error: '你没有权限' });

  const curr = currency || 'CNY';
  const rate = exchange_rate || 1;
  const origAmt = original_amount || amount;
  const rmbAmount = curr === 'CNY' ? (amount || 0) : (origAmt * rate);

  if (!rmbAmount || rmbAmount <= 0) return res.status(400).json({ error: '金额必须大于0' });
  if (!payer_id) return res.status(400).json({ error: '请选择付款人' });
  if (!split_with || !Array.isArray(split_with) || split_with.length === 0) return res.status(400).json({ error: '请选择参与分摊的人' });

  const r = await db.prepare(`
    INSERT INTO expenses (trip_id, description, amount, original_amount, currency, exchange_rate, category, payer_id, split_with, creator_name)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(req.params.id, (description || '').trim(), Math.round(rmbAmount * 100) / 100,
    Math.round(origAmt * 100) / 100, curr, rate, category || 'other', payer_id,
    JSON.stringify(split_with), (creator_name || req.user.nickname).trim());

  const expense = await db.prepare(`
    SELECT e.*, p.name as payer_name FROM expenses e LEFT JOIN participants p ON e.payer_id = p.id WHERE e.id = ?
  `).get(r.lastInsertRowid);

  let splitIds = [];
  try { splitIds = JSON.parse(expense.split_with); } catch (_) {}
  const participants = await db.prepare('SELECT * FROM participants WHERE trip_id = ?').all(req.params.id);
  const splitNames = splitIds.map(sid => { const p = participants.find(pp => pp.id === sid); return p ? p.name : '?'; });

  res.json({ ...expense, split_with: splitIds, split_names: splitNames });
});

app.delete('/api/trips/:id/expenses/:eid', auth, async (req, res) => {
  const db = getDb();
  const expense = await db.prepare('SELECT * FROM expenses WHERE id = ? AND trip_id = ?').get(req.params.eid, req.params.id);
  if (!expense) return res.status(404).json({ error: '记录不存在' });
  await db.prepare('DELETE FROM expenses WHERE id = ?').run(req.params.eid);
  res.json({ ok: true });
});

// ==================== 轮询 ====================

app.get('/api/trips/:id/poll', auth, async (req, res) => {
  const db = getDb();
  const since = req.query.since || '';
  const tripId = req.params.id;

  const expenses = await db.prepare(`
    SELECT e.*, p.name as payer_name FROM expenses e
    LEFT JOIN participants p ON e.payer_id = p.id
    WHERE e.trip_id = ? AND e.created_at > ? ORDER BY e.created_at ASC
  `).all(tripId, since);

  const participants = await db.prepare(`
    SELECT * FROM participants WHERE trip_id = ? AND created_at > ? ORDER BY id ASC
  `).all(tripId, since);

  const allParticipants = await db.prepare('SELECT * FROM participants WHERE trip_id = ?').all(tripId);
  const enriched = expenses.map(e => {
    let splitIds = [];
    try { splitIds = JSON.parse(e.split_with); } catch (_) {}
    const splitNames = splitIds.map(sid => { const p = allParticipants.find(pp => pp.id === sid); return p ? p.name : '?'; });
    return { ...e, split_with: splitIds, split_names: splitNames };
  });

  const latest = expenses.length > 0 ? expenses[expenses.length - 1].created_at : since;
  const latestP = participants.length > 0 ? participants[participants.length - 1].created_at : '';
  const newSince = [latest, latestP].sort().pop() || since;

  res.json({ since: newSince, expenses: enriched, participants, deleted_ids: [] });
});

// ==================== 清算时间 ====================

app.get('/api/trips/:id/settle', auth, async (req, res) => {
  const db = getDb();
  const trip = await db.prepare('SELECT * FROM trips WHERE id = ?').get(req.params.id);
  if (!trip) return res.status(404).json({ error: '行程不存在' });

  const participants = await db.prepare('SELECT * FROM participants WHERE trip_id = ?').all(req.params.id);
  const expenses = await db.prepare('SELECT * FROM expenses WHERE trip_id = ?').all(req.params.id);

  if (participants.length === 0) {
    return res.json({ transactions: [], summary: { total: 0, byCategory: {} }, details: {} });
  }

  const debts = {};
  const nameMap = {};
  const details = {};

  for (const p of participants) {
    debts[p.id] = {};
    nameMap[p.id] = p.name;
    for (const q of participants) debts[p.id][q.id] = 0;
  }

  let totalSpent = 0;
  const byCategory = {};

  for (const exp of expenses) {
    totalSpent += exp.amount;
    byCategory[exp.category] = (byCategory[exp.category] || 0) + exp.amount;

    let splitIds = [];
    try { splitIds = JSON.parse(exp.split_with); } catch (_) { continue; }
    if (splitIds.length === 0) continue;

    const perPerson = exp.amount / splitIds.length;
    const payerName = nameMap[exp.payer_id] || '?';

    for (const sid of splitIds) {
      if (sid === exp.payer_id) continue;
      debts[sid][exp.payer_id] += perPerson;

      const key = `${sid}→${exp.payer_id}`;
      if (!details[key]) details[key] = [];
      details[key].push({
        description: exp.description || '未命名', category: exp.category,
        amount: exp.amount, payer: payerName, splitCount: splitIds.length,
        myShare: Math.round(perPerson * 100) / 100,
        creator_name: exp.creator_name, created_at: exp.created_at,
        currency: exp.currency, original_amount: exp.original_amount, exchange_rate: exp.exchange_rate,
      });
    }
  }

  for (const a of participants) {
    for (const b of participants) {
      if (a.id >= b.id) continue;
      const ab = debts[a.id][b.id];
      const ba = debts[b.id][a.id];
      if (ab > ba) {
        debts[a.id][b.id] = ab - ba;
        debts[b.id][a.id] = 0;
        const abKey = `${a.id}→${b.id}`;
        const baKey = `${b.id}→${a.id}`;
        if (details[abKey] && details[baKey]) {
          details[abKey] = [...details[abKey], { _offset: true, description: '抵消', amount: Math.round(ba * 100) / 100, from: nameMap[b.id] }];
          delete details[baKey];
        }
      } else {
        debts[b.id][a.id] = ba - ab;
        debts[a.id][b.id] = 0;
        const abKey = `${a.id}→${b.id}`;
        const baKey = `${b.id}→${a.id}`;
        if (details[abKey] && details[baKey]) {
          details[baKey] = [...details[baKey], { _offset: true, description: '抵消', amount: Math.round(ab * 100) / 100, from: nameMap[a.id] }];
          delete details[abKey];
        }
      }
    }
  }

  const transactions = [];
  for (const fromId in debts) {
    for (const toId in debts[fromId]) {
      const amt = Math.round(debts[fromId][toId] * 100) / 100;
      if (amt > 0.01) {
        const key = `${fromId}→${toId}`;
        transactions.push({
          from: nameMap[fromId], from_id: Number(fromId),
          to: nameMap[toId], to_id: Number(toId),
          amount: amt, items: details[key] || [],
        });
      }
    }
  }

  res.json({ transactions, summary: { total: Math.round(totalSpent * 100) / 100, byCategory } });
});

// ==================== 启动 ====================

app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found' });
  res.sendFile(require('path').join(__dirname, 'public', 'index.html'));
});

(async () => {
  await initTables();
  await refreshRates();
  app.listen(PORT, () => {
    console.log(`💰 与友同行明算账 已启动 → http://localhost:${PORT}`);
  });
})();
