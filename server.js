const express = require('express');
const { getDb } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static('public'));

// ==================== 汇率缓存 ====================

let ratesCache = { CNY: 1 };
let ratesUpdated = 0;
const RATES_TTL = 3600000; // 1小时

// 旅行常用货币
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
    // Frankfurter API: 免费，无需 API key，基于欧洲央行汇率
    const resp = await fetch('https://api.frankfurter.app/latest?from=CNY');
    if (!resp.ok) throw new Error('汇率接口异常');
    const data = await resp.json();
    if (data.rates) {
      // data.rates 是 1 CNY = X 外币，我们反转为 1 外币 = Y CNY
      ratesCache = { CNY: 1 };
      for (const [code, rate] of Object.entries(data.rates)) {
        if (rate > 0) ratesCache[code] = 1 / rate;
      }
      ratesUpdated = now;
      console.log('💱 汇率已更新');
    }
  } catch (e) {
    console.warn('⚠️ 汇率更新失败，使用缓存:', e.message);
  }
}

// 启动时获取汇率
refreshRates();

// ==================== 行程 ====================

// 获取汇率列表
app.get('/api/rates', async (_req, res) => {
  await refreshRates();
  const list = CURRENCIES.map(c => ({
    ...c,
    rate: ratesCache[c.code] || null,
  })).filter(c => c.rate !== null);
  res.json({ currencies: list, updated: new Date(ratesUpdated).toISOString() });
});

// 创建行程
app.post('/api/trips', (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ error: '行程名称不能为空' });
  }
  const db = getDb();
  const result = db.prepare('INSERT INTO trips (name) VALUES (?)').run(name.trim());
  res.json({ id: result.lastInsertRowid, name: name.trim() });
});

// 获取所有行程
app.get('/api/trips', (_req, res) => {
  const db = getDb();
  const trips = db.prepare(`
    SELECT t.*,
      (SELECT COUNT(*) FROM participants WHERE trip_id = t.id) as participant_count,
      (SELECT COUNT(*) FROM expenses WHERE trip_id = t.id) as expense_count
    FROM trips t
    ORDER BY t.created_at DESC
  `).all();
  res.json(trips);
});

// 获取行程详情
app.get('/api/trips/:id', (req, res) => {
  const db = getDb();
  const trip = db.prepare('SELECT * FROM trips WHERE id = ?').get(req.params.id);
  if (!trip) return res.status(404).json({ error: '行程不存在' });

  const participants = db.prepare('SELECT * FROM participants WHERE trip_id = ? ORDER BY id').all(req.params.id);
  const expenses = db.prepare(`
    SELECT e.*, p.name as payer_name
    FROM expenses e
    LEFT JOIN participants p ON e.payer_id = p.id
    WHERE e.trip_id = ?
    ORDER BY e.created_at DESC
  `).all(req.params.id);

  // 把 split_with 从 JSON 字符串转成数组，并附上名字
  const enriched = expenses.map(e => {
    let splitIds = [];
    try { splitIds = JSON.parse(e.split_with); } catch (_) {}
    const splitNames = splitIds.map(sid => {
      const p = participants.find(pp => pp.id === sid);
      return p ? p.name : '?';
    });
    return { ...e, split_with: splitIds, split_names: splitNames };
  });

  res.json({ ...trip, participants, expenses: enriched });
});

// 加入行程
app.post('/api/trips/:id/join', (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ error: '名字不能为空' });
  }
  const db = getDb();
  const trip = db.prepare('SELECT * FROM trips WHERE id = ?').get(req.params.id);
  if (!trip) return res.status(404).json({ error: '行程不存在' });

  const trimmed = name.trim();
  const existing = db.prepare('SELECT * FROM participants WHERE trip_id = ? AND name = ?').get(req.params.id, trimmed);
  if (existing) {
    return res.json(existing); // 同名直接返回已有记录
  }
  const result = db.prepare('INSERT INTO participants (trip_id, name) VALUES (?, ?)').run(req.params.id, trimmed);
  res.json({ id: result.lastInsertRowid, trip_id: Number(req.params.id), name: trimmed });
});

// ==================== 花费 ====================

// 添加花费
app.post('/api/trips/:id/expenses', (req, res) => {
  const { description, amount, original_amount, currency, exchange_rate, category, payer_id, split_with, creator_name } = req.body;
  const db = getDb();
  const trip = db.prepare('SELECT * FROM trips WHERE id = ?').get(req.params.id);
  if (!trip) return res.status(404).json({ error: '行程不存在' });

  // 处理货币转换：amount 始终存人民币等值
  const curr = currency || 'CNY';
  const rate = exchange_rate || 1;
  const origAmt = original_amount || amount;
  const rmbAmount = curr === 'CNY' ? (amount || 0) : (origAmt * rate);

  if (!rmbAmount || rmbAmount <= 0) {
    return res.status(400).json({ error: '金额必须大于0' });
  }
  if (!payer_id) {
    return res.status(400).json({ error: '请选择付款人' });
  }
  if (!split_with || !Array.isArray(split_with) || split_with.length === 0) {
    return res.status(400).json({ error: '请选择参与分摊的人' });
  }

  const result = db.prepare(`
    INSERT INTO expenses (trip_id, description, amount, original_amount, currency, exchange_rate, category, payer_id, split_with, creator_name)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    req.params.id,
    (description || '').trim(),
    Math.round(rmbAmount * 100) / 100,
    Math.round(origAmt * 100) / 100,
    curr,
    rate,
    category || 'other',
    payer_id,
    JSON.stringify(split_with),
    (creator_name || '').trim()
  );

  const expense = db.prepare(`
    SELECT e.*, p.name as payer_name
    FROM expenses e
    LEFT JOIN participants p ON e.payer_id = p.id
    WHERE e.id = ?
  `).get(result.lastInsertRowid);

  let splitIds = [];
  try { splitIds = JSON.parse(expense.split_with); } catch (_) {}
  const participants = db.prepare('SELECT * FROM participants WHERE trip_id = ?').all(req.params.id);
  const splitNames = splitIds.map(sid => {
    const p = participants.find(pp => pp.id === sid);
    return p ? p.name : '?';
  });

  res.json({ ...expense, split_with: splitIds, split_names: splitNames });
});

// 删除花费
app.delete('/api/trips/:id/expenses/:eid', (req, res) => {
  const db = getDb();
  const expense = db.prepare('SELECT * FROM expenses WHERE id = ? AND trip_id = ?').get(req.params.eid, req.params.id);
  if (!expense) return res.status(404).json({ error: '记录不存在' });
  db.prepare('DELETE FROM expenses WHERE id = ?').run(req.params.eid);
  res.json({ ok: true, deleted_id: Number(req.params.eid) });
});

// ==================== 轮询同步 ====================

app.get('/api/trips/:id/poll', (req, res) => {
  const db = getDb();
  const since = req.query.since || '';
  const tripId = req.params.id;

  const expenses = db.prepare(`
    SELECT e.*, p.name as payer_name
    FROM expenses e
    LEFT JOIN participants p ON e.payer_id = p.id
    WHERE e.trip_id = ? AND e.created_at > ?
    ORDER BY e.created_at ASC
  `).all(tripId, since);

  const participants = db.prepare(`
    SELECT * FROM participants WHERE trip_id = ? AND created_at > ?
    ORDER BY id ASC
  `).all(tripId, since);

  // Deleted expense IDs since timestamp (simple approach: check what was deleted)
  const deletedSince = db.prepare(`
    SELECT id FROM expenses WHERE trip_id = ?
  `).all(tripId).map(e => e.id);

  // Enrich expenses with split names
  const allParticipants = db.prepare('SELECT * FROM participants WHERE trip_id = ?').all(tripId);
  const enriched = expenses.map(e => {
    let splitIds = [];
    try { splitIds = JSON.parse(e.split_with); } catch (_) {}
    const splitNames = splitIds.map(sid => {
      const p = allParticipants.find(pp => pp.id === sid);
      return p ? p.name : '?';
    });
    return { ...e, split_with: splitIds, split_names: splitNames };
  });

  // 获取最新时间戳，用于下次轮询
  const latest = expenses.length > 0 ? expenses[expenses.length - 1].created_at : since;
  const latestParticipant = participants.length > 0 ? participants[participants.length - 1].created_at : '';
  const newSince = [latest, latestParticipant].sort().pop() || since;

  res.json({
    since: newSince,
    expenses: enriched,
    participants,
    deleted_ids: [], // 简化处理：轮询时不跟踪删除
  });
});

// ==================== 结算 ====================

app.get('/api/trips/:id/settle', (req, res) => {
  const db = getDb();
  const trip = db.prepare('SELECT * FROM trips WHERE id = ?').get(req.params.id);
  if (!trip) return res.status(404).json({ error: '行程不存在' });

  const participants = db.prepare('SELECT * FROM participants WHERE trip_id = ?').all(req.params.id);
  const expenses = db.prepare('SELECT * FROM expenses WHERE trip_id = ?').all(req.params.id);

  if (participants.length === 0) {
    return res.json({ transactions: [], summary: { total: 0, byCategory: {} } });
  }

  // 构建债务矩阵 (from -> to -> amount)
  const debts = {};
  for (const p of participants) {
    debts[p.id] = {};
    for (const q of participants) {
      debts[p.id][q.id] = 0;
    }
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

    for (const sid of splitIds) {
      if (sid === exp.payer_id) continue; // 付款人不用付给自己
      debts[sid][exp.payer_id] += perPerson;
    }
  }

  // 抵消双向债务
  for (const a of participants) {
    for (const b of participants) {
      if (a.id >= b.id) continue;
      const ab = debts[a.id][b.id];
      const ba = debts[b.id][a.id];
      if (ab > ba) {
        debts[a.id][b.id] = ab - ba;
        debts[b.id][a.id] = 0;
      } else {
        debts[b.id][a.id] = ba - ab;
        debts[a.id][b.id] = 0;
      }
    }
  }

  // 生成最终转账清单
  const transactions = [];
  const nameMap = {};
  for (const p of participants) nameMap[p.id] = p.name;

  for (const fromId in debts) {
    for (const toId in debts[fromId]) {
      const amt = Math.round(debts[fromId][toId] * 100) / 100;
      if (amt > 0.01) {
        transactions.push({
          from: nameMap[fromId],
          from_id: Number(fromId),
          to: nameMap[toId],
          to_id: Number(toId),
          amount: amt,
        });
      }
    }
  }

  res.json({
    transactions,
    summary: {
      total: Math.round(totalSpent * 100) / 100,
      byCategory,
    },
  });
});

// ==================== 启动 ====================

app.listen(PORT, () => {
  console.log(`🧳 AA旅行记账 已启动 → http://localhost:${PORT}`);
});
