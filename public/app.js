// ==================== 全局状态 ====================
let currentTripId = null;
let currentTrip = null;
let currentView = 'home';
let pollTimer = null;
let lastSince = '';

const CATEGORIES = [
  { id: 'food', emoji: '🍔', label: '餐饮', color: '#FF6B6B' },
  { id: 'transport', emoji: '🚌', label: '交通', color: '#4ECDC4' },
  { id: 'hotel', emoji: '🏨', label: '住宿', color: '#A78BFA' },
  { id: 'ticket', emoji: '🎫', label: '门票', color: '#FBBF24' },
  { id: 'shopping', emoji: '🛍', label: '购物', color: '#F472B6' },
  { id: 'other', emoji: '📦', label: '其他', color: '#9CA3AF' },
];

// 弹窗状态
let selectedCategory = 'other';
let selectedPayer = null;
let selectedSplitIds = [];
let selectedCurrency = 'CNY';
let exchangeRates = { CNY: 1 };
let currencies = [];

// ==================== 工具函数 ====================

function $(sel) { return document.querySelector(sel); }
function $$(sel) { return document.querySelectorAll(sel); }

function fmtTime(iso) {
  if (!iso) return '';
  const d = new Date(iso + 'Z');
  const now = new Date();
  const diff = now - d;
  if (diff < 60000) return '刚刚';
  if (diff < 3600000) return Math.floor(diff / 60000) + '分钟前';
  if (diff < 86400000) return Math.floor(diff / 3600000) + '小时前';
  const m = d.getMonth() + 1;
  const day = d.getDate();
  return `${m}/${day} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}

function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.style.display = 'block';
  el.style.animation = 'none';
  el.offsetHeight;
  el.style.animation = 'fadeInOut 2s ease';
  setTimeout(() => { el.style.display = 'none'; }, 2000);
}

async function loadRates() {
  try {
    const data = await api('/api/rates');
    currencies = data.currencies;
    for (const c of data.currencies) {
      exchangeRates[c.code] = c.rate;
    }
    // 记住上次选的货币
    const saved = localStorage.getItem('aa_currency');
    if (saved && exchangeRates[saved]) selectedCurrency = saved;
  } catch (_) {
    // 使用默认汇率
    currencies = [{ code: 'CNY', symbol: '¥', name: '人民币', rate: 1 }];
  }
}

function renderCurrencySelector() {
  if (currencies.length === 0) {
    currencies = [{ code: 'CNY', symbol: '¥', name: '人民币', rate: 1 }];
  }
  $('#currency-selector').innerHTML = currencies.map(c => `
    <div class="cur-option ${selectedCurrency === c.code ? 'selected' : ''}"
         onclick="selectCurrency('${c.code}')">
      <span class="cur-symbol">${c.symbol}</span> ${c.code}
      ${c.code !== 'CNY' ? `<span class="cur-rate">≈${c.rate.toFixed(4)}</span>` : ''}
    </div>
  `).join('');

  const cur = currencies.find(c => c.code === selectedCurrency);
  if (cur && cur.code !== 'CNY') {
    $('#currency-hint').textContent = `1 ${cur.code} ≈ ¥${cur.rate.toFixed(4)}`;
  } else {
    $('#currency-hint').textContent = '';
  }
}

function selectCurrency(code) {
  selectedCurrency = code;
  localStorage.setItem('aa_currency', code);
  renderCurrencySelector();
}

async function api(url, opts = {}) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || '请求失败');
  }
  return res.json();
}

// ==================== 视图切换 ====================

function showView(view) {
  currentView = view;
  $('#page-home').style.display = view === 'home' ? 'block' : 'none';
  $('#page-trip').style.display = view === 'trip' ? 'block' : 'none';
}

function goHome() {
  stopPolling();
  currentTripId = null;
  currentTrip = null;
  showView('home');
  loadTrips();
}

// ==================== 弹窗 ====================

function openModal(id) { $('#' + id).style.display = 'flex'; }
function closeModal(id) { $('#' + id).style.display = 'none'; }

// ==================== Toast ====================

// (toast function defined above)

// ==================== 行程列表 ====================

async function loadTrips() {
  try {
    const trips = await api('/api/trips');
    const container = $('#trip-list');
    if (trips.length === 0) {
      container.innerHTML = `
        <div class="empty">
          <div class="icon">🧳</div>
          <p>还没有行程<br>点击下方按钮创建一个吧~</p>
        </div>`;
      return;
    }
    container.innerHTML = trips.map(t => `
      <div class="card trip-card" onclick="openTrip(${t.id})">
        <div class="trip-name">✈️ ${escHtml(t.name)}</div>
        <div class="trip-meta">
          <span>👥 ${t.participant_count}人</span>
          <span>📝 ${t.expense_count}笔</span>
          <span>${fmtTime(t.created_at)}</span>
        </div>
      </div>
    `).join('');
  } catch (e) {
    toast('加载失败：' + e.message);
  }
}

function showNewTrip() {
  $('#input-trip-name').value = '';
  openModal('modal-new-trip');
  setTimeout(() => $('#input-trip-name').focus(), 300);
}

async function createTrip() {
  const name = $('#input-trip-name').value.trim();
  if (!name) return toast('请输入行程名称');
  try {
    const trip = await api('/api/trips', { method: 'POST', body: { name } });
    closeModal('modal-new-trip');
    toast('行程创建成功！');
    loadTrips();
    openTrip(trip.id);
  } catch (e) {
    toast('创建失败：' + e.message);
  }
}

// ==================== 行程详情 ====================

async function openTrip(id) {
  currentTripId = id;
  showView('trip');
  await loadTripDetail();
  startPolling();
}

async function loadTripDetail(silent) {
  try {
    const trip = await api('/api/trips/' + currentTripId);
    currentTrip = trip;
    $('#trip-title').textContent = trip.name;

    if (trip.expenses.length === 0) {
      $('#expense-list').innerHTML = `
        <div class="empty">
          <div class="icon">💸</div>
          <p>还没有花费记录<br>点击下方「记一笔」开始记账吧</p>
        </div>`;
    } else {
      $('#expense-list').innerHTML = trip.expenses.map(e => {
        const cat = CATEGORIES.find(c => c.id === e.category) || CATEGORIES[5];
        const perPerson = e.split_with.length > 0 ? (e.amount / e.split_with.length).toFixed(2) : '0';
        const showOriginal = e.currency && e.currency !== 'CNY';
        const curInfo = showOriginal
          ? `<span style="font-size:11px;color:var(--text-secondary)">${e.currency} ${e.original_amount?.toFixed(2) || ''} · 汇率 ${e.exchange_rate?.toFixed(4) || ''}</span>`
          : '';
        return `
        <div class="expense-item">
          <div class="cat-icon ${e.category}">${cat.emoji}</div>
          <div class="expense-info">
            <div class="desc">${escHtml(e.description || cat.label)}</div>
            <div class="detail">${e.payer_name} 付 · ${e.split_names?.join('、') || '?'} 分摊</div>
          </div>
          <div class="expense-amount">
            ¥${e.amount.toFixed(2)}
            <div class="per">${curInfo ? curInfo + '<br>' : ''}人均 ¥${perPerson}</div>
          </div>
          <button class="del-btn" onclick="deleteExpense(${e.id})" title="删除">×</button>
        </div>`;
      }).join('');
    }
  } catch (e) {
    if (!silent) toast('加载失败：' + e.message);
  }
}

// ==================== 加入行程 ====================

function showJoin() {
  if (!currentTrip) return;
  const names = currentTrip.participants.map(p => p.name).join('、') || '暂无';
  $('#join-existing').textContent = names;
  $('#input-join-name').value = localStorage.getItem('aa_creator_name') || '';
  openModal('modal-join');
  setTimeout(() => $('#input-join-name').focus(), 300);
}

async function joinTrip() {
  const name = $('#input-join-name').value.trim();
  if (!name) return toast('请输入名字');
  try {
    await api('/api/trips/' + currentTripId + '/join', { method: 'POST', body: { name } });
    closeModal('modal-join');
    toast('加入成功！');
    localStorage.setItem('aa_creator_name', name);
    loadTripDetail();
  } catch (e) {
    toast('加入失败：' + e.message);
  }
}

// ==================== 添加花费 ====================

function showAddExpense() {
  if (!currentTrip || currentTrip.participants.length === 0) {
    return toast('请先加入行程！');
  }

  $('#input-amount').value = '';
  $('#input-desc').value = '';
  $('#input-creator').value = localStorage.getItem('aa_creator_name') || '';
  selectedCategory = 'other';
  selectedPayer = currentTrip.participants[0]?.id || null;
  selectedSplitIds = currentTrip.participants.map(p => p.id);

  renderCatGrid();
  renderCurrencySelector();
  renderPayerList();
  renderSplitList();
  openModal('modal-expense');
  setTimeout(() => $('#input-amount').focus(), 300);
}

function renderCatGrid() {
  $('#cat-grid').innerHTML = CATEGORIES.map(c => `
    <div class="cat-option ${selectedCategory === c.id ? 'selected' : ''}"
         onclick="selectedCategory='${c.id}';renderCatGrid()">
      <span class="emoji">${c.emoji}</span>${c.label}
    </div>
  `).join('');
}

function renderPayerList() {
  if (!currentTrip) return;
  $('#payer-list').innerHTML = currentTrip.participants.map(p => `
    <div class="person-chip ${selectedPayer === p.id ? 'selected' : ''}"
         onclick="selectedPayer=${p.id};renderPayerList()">
      <div class="avatar">${p.name[0]}</div>
      <span>${escHtml(p.name)}</span>
      <div class="check">${selectedPayer === p.id ? '✓' : ''}</div>
    </div>
  `).join('');
}

function renderSplitList() {
  if (!currentTrip) return;
  $('#split-list').innerHTML = currentTrip.participants.map(p => `
    <div class="person-chip ${selectedSplitIds.includes(p.id) ? 'selected' : ''}"
         onclick="toggleSplit(${p.id})">
      <div class="avatar">${p.name[0]}</div>
      <span>${escHtml(p.name)}</span>
      <div class="check">${selectedSplitIds.includes(p.id) ? '✓' : ''}</div>
    </div>
  `).join('');
}

function toggleSplit(id) {
  if (selectedSplitIds.includes(id)) {
    if (selectedSplitIds.length <= 1) return toast('至少选一个人参与分摊哦');
    selectedSplitIds = selectedSplitIds.filter(x => x !== id);
  } else {
    selectedSplitIds = [...selectedSplitIds, id];
  }
  renderSplitList();
}

async function addExpense() {
  const inputAmount = parseFloat($('#input-amount').value);
  if (!inputAmount || inputAmount <= 0) return toast('请输入有效金额');

  const creatorName = $('#input-creator').value.trim();
  if (!creatorName) return toast('请输入记录人名字');

  // 计算货币转换
  const origAmount = Math.round(inputAmount * 100) / 100;
  const rate = exchangeRates[selectedCurrency] || 1;
  const rmbAmount = selectedCurrency === 'CNY' ? origAmount : Math.round(origAmount * rate * 100) / 100;

  // 确保记录人在参与者列表中
  let creatorInTrip = currentTrip.participants.find(p => p.name === creatorName);
  if (!creatorInTrip) {
    try {
      creatorInTrip = await api('/api/trips/' + currentTripId + '/join', { method: 'POST', body: { name: creatorName } });
      // 刷新本地缓存
      await loadTripDetail(true);
      // 更新选中状态
      if (!selectedSplitIds.includes(creatorInTrip.id)) {
        selectedSplitIds.push(creatorInTrip.id);
      }
    } catch (e) {
      return toast('加入失败：' + e.message);
    }
  }

  // 确保付款人在参与者列表中
  if (!currentTrip.participants.find(p => p.id === selectedPayer)) {
    return toast('付款人信息异常，请重新打开弹窗');
  }

  try {
    await api('/api/trips/' + currentTripId + '/expenses', {
      method: 'POST',
      body: {
        description: $('#input-desc').value.trim(),
        amount: rmbAmount,
        original_amount: origAmount,
        currency: selectedCurrency,
        exchange_rate: rate,
        category: selectedCategory,
        payer_id: selectedPayer,
        split_with: selectedSplitIds,
        creator_name: creatorName,
      },
    });
    closeModal('modal-expense');
    localStorage.setItem('aa_creator_name', creatorName);
    toast('记账成功！');
    loadTripDetail();
  } catch (e) {
    toast('记失败：' + e.message);
  }
}

// ==================== 删除花费 ====================

async function deleteExpense(eid) {
  if (!confirm('确定删除这笔记录吗？')) return;
  try {
    await api('/api/trips/' + currentTripId + '/expenses/' + eid, { method: 'DELETE' });
    toast('已删除');
    loadTripDetail();
  } catch (e) {
    toast('删除失败：' + e.message);
  }
}

// ==================== 结算 ====================

async function showSettle() {
  if (!currentTrip) return;
  try {
    const data = await api('/api/trips/' + currentTripId + '/settle');
    const name = currentTrip.name;

    let html = `<div class="header">
      <button class="back-btn" onclick="openTrip(${currentTripId})">←</button>
      <h1>🧮 结算</h1>
      <span></span>
    </div>`;

    // 汇总
    html += `<div style="padding:12px 16px">
      <div class="summary-grid">
        <div class="summary-item">
          <div class="s-amount">¥${data.summary.total.toFixed(2)}</div>
          <div class="s-label">总花费</div>
        </div>
        <div class="summary-item">
          <div class="s-amount">${data.transactions.length}</div>
          <div class="s-label">需转账笔数</div>
        </div>
      </div>
    </div>`;

    // 分类汇总
    if (Object.keys(data.summary.byCategory).length > 0) {
      html += `<div style="padding:0 16px 8px;display:flex;flex-wrap:wrap;gap:8px">`;
      for (const [catId, amt] of Object.entries(data.summary.byCategory)) {
        const cat = CATEGORIES.find(c => c.id === catId) || CATEGORIES[5];
        html += `<span style="background:${cat.color}15;color:${cat.color};padding:4px 10px;border-radius:12px;font-size:12px;font-weight:600">${cat.emoji} ${cat.label} ¥${amt.toFixed(2)}</span>`;
      }
      html += `</div>`;
    }

    html += `<div class="scroll-area" style="padding-bottom:20px">`;

    if (data.transactions.length === 0) {
      html += `<div class="empty"><div class="icon">🎉</div><p>大家都平了！没有需要转账的~</p></div>`;
    } else {
      html += data.transactions.map(t => `
        <div class="settle-card">
          <div class="settle-info">
            <strong>${escHtml(t.from)}</strong>
            <span style="color:var(--text-secondary);font-size:13px"> 转账给 </span>
            <strong>${escHtml(t.to)}</strong>
          </div>
          <div class="settle-amount">¥${t.amount.toFixed(2)}</div>
        </div>
      `).join('');
    }

    html += `</div>`;

    // 复制按钮
    if (data.transactions.length > 0) {
      const copyText = data.transactions.map(t => `${t.from} → ${t.to}：¥${t.amount.toFixed(2)}`).join('\n');
      html += `<div style="padding:12px 16px">
        <button class="btn btn-outline btn-block" onclick="copySettle(\`${escAttr(copyText)}\`)">📋 复制转账清单</button>
      </div>`;
    }

    $('#page-trip').innerHTML = html;
  } catch (e) {
    toast('结算失败：' + e.message);
  }
}

function copySettle(text) {
  if (navigator.clipboard) {
    navigator.clipboard.writeText(text).then(() => toast('已复制！'));
  } else {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    toast('已复制！');
  }
}

// ==================== 轮询同步 ====================

function startPolling() {
  stopPolling();
  lastSince = new Date().toISOString().replace('T', ' ').replace('Z', '');
  pollTimer = setInterval(pollUpdates, 5000);
}

function stopPolling() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}

async function pollUpdates() {
  if (!currentTripId) return;
  try {
    const data = await api('/api/trips/' + currentTripId + '/poll?since=' + encodeURIComponent(lastSince));
    if (data.expenses.length > 0 || data.participants.length > 0) {
      loadTripDetail(true);
      $('#sync-badge').textContent = '🔄已同步';
      setTimeout(() => { if (currentView === 'home') $('#sync-badge').textContent = ''; }, 2000);
    }
    if (data.since) lastSince = data.since;
  } catch (_) { /* 静默失败 */ }
}

// ==================== 辅助 ====================

function escHtml(s) {
  if (!s) return '';
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

function escAttr(s) {
  return s.replace(/`/g, '\\`').replace(/\\/g, '\\\\');
}

// ==================== 初始化 ====================

loadRates();
loadTrips();

// 点击弹窗遮罩关闭
document.addEventListener('click', (e) => {
  if (e.target.classList.contains('modal-overlay')) {
    e.target.style.display = 'none';
  }
});
