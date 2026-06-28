// ==================== 全局状态 ====================
let token = localStorage.getItem('aa_token') || '';
let myUser = null;
let currentTripId = null;
let currentTrip = null;
let currentView = 'login';
let pollTimer = null;
let lastSince = '';

const CATEGORIES = [
  { id: 'food', emoji: '🍔', label: '餐饮' },
  { id: 'transport', emoji: '🚌', label: '交通' },
  { id: 'hotel', emoji: '🏨', label: '住宿' },
  { id: 'ticket', emoji: '🎫', label: '门票' },
  { id: 'shopping', emoji: '🛍', label: '购物' },
  { id: 'other', emoji: '📦', label: '其他' },
];

let selectedCategory = 'other';
let selectedPayer = null;
let selectedSplitIds = [];
let selectedCurrency = 'CNY';
let exchangeRates = { CNY: 1 };
let currencies = [];

// ==================== 工具 ====================

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
  el.textContent = msg; el.style.display = 'block';
  el.style.animation = 'none'; el.offsetHeight;
  el.style.animation = 'fadeInOut 2s ease';
  setTimeout(() => { el.style.display = 'none'; }, 2000);
}

async function api(url, opts = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = 'Bearer ' + token;
  const res = await fetch(url, { headers, ...opts, body: opts.body ? JSON.stringify(opts.body) : undefined });
  if (res.status === 401) { logout(); throw new Error('请重新登录'); }
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    throw new Error(d.error || '请求失败');
  }
  return res.json();
}

function escHtml(s) {
  if (!s) return '';
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

// ==================== 视图 ====================

function showView(view) {
  currentView = view;
  $('#page-login').style.display = view === 'login' ? 'flex' : 'none';
  $('#page-home').style.display = view === 'home' ? 'block' : 'none';
  $('#page-trip').style.display = view === 'trip' ? 'block' : 'none';
}

// ==================== 认证 ====================

async function doRegister() {
  const nickname = $('#login-nickname').value.trim();
  const password = $('#login-password').value.trim();
  if (!nickname) { $('#login-error').textContent = '请输入昵称'; return; }
  if (!password) { $('#login-error').textContent = '请输入密码'; return; }
  try {
    const data = await api('/api/auth/register', { method: 'POST', body: { nickname, password } });
    onLoginSuccess(data);
  } catch (e) {
    $('#login-error').textContent = e.message;
  }
}

async function doLogin() {
  const nickname = $('#login-nickname').value.trim();
  const password = $('#login-password').value.trim();
  if (!nickname || !password) { $('#login-error').textContent = '请输入昵称和密码'; return; }
  try {
    const data = await api('/api/auth/login', { method: 'POST', body: { nickname, password } });
    onLoginSuccess(data);
  } catch (e) {
    $('#login-error').textContent = e.message;
  }
}

function onLoginSuccess(data) {
  token = data.token;
  myUser = data.user;
  localStorage.setItem('aa_token', token);
  $('#login-error').textContent = '';
  $('#my-nickname').textContent = myUser.nickname;
  showView('home');
  loadRates();
  loadTrips();

  // 登录后处理待加入的邀请
  const pendingInvite = localStorage.getItem('aa_pending_invite');
  if (pendingInvite) {
    localStorage.removeItem('aa_pending_invite');
    handleInvite(pendingInvite);
  }
}

function logout() {
  token = '';
  myUser = null;
  localStorage.removeItem('aa_token');
  stopPolling();
  $('#login-nickname').value = '';
  $('#login-password').value = '';
  showView('login');
}

// ==================== 汇率 ====================

async function loadRates() {
  try {
    const data = await api('/api/rates');
    currencies = data.currencies;
    for (const c of data.currencies) exchangeRates[c.code] = c.rate;
    const saved = localStorage.getItem('aa_currency');
    if (saved && exchangeRates[saved]) selectedCurrency = saved;
  } catch (_) {
    currencies = [{ code: 'CNY', symbol: '¥', name: '人民币', rate: 1 }];
  }
}

function renderCurrencySelector() {
  if (currencies.length === 0) currencies = [{ code: 'CNY', symbol: '¥', name: '人民币', rate: 1 }];
  $('#currency-selector').innerHTML = currencies.map(c => `
    <div class="cur-option ${selectedCurrency === c.code ? 'selected' : ''}"
         onclick="selectCurrency('${c.code}')">
      <span class="cur-symbol">${c.symbol}</span> ${c.code}
      ${c.code !== 'CNY' ? `<span class="cur-rate">≈${c.rate.toFixed(4)}</span>` : ''}
    </div>
  `).join('');
  const cur = currencies.find(c => c.code === selectedCurrency);
  $('#currency-hint').textContent = (cur && cur.code !== 'CNY') ? `1 ${cur.code} ≈ ¥${cur.rate.toFixed(4)}` : '';
}

function selectCurrency(code) {
  selectedCurrency = code;
  localStorage.setItem('aa_currency', code);
  renderCurrencySelector();
}

// ==================== 行程列表 ====================

async function loadTrips() {
  try {
    const trips = await api('/api/trips');
    const container = $('#trip-list');
    if (trips.length === 0) {
      container.innerHTML = `<div class="empty"><div class="icon">🧳</div><p>还没有行程<br>点右下角 ＋ 创建一个吧~</p></div>`;
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
  } catch (e) { toast(e.message); }
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
    openTrip(trip.id);
  } catch (e) { toast(e.message); }
}

// ==================== 邀请 ====================

async function showInvite() {
  openModal('modal-invite');
  $('#invite-url').textContent = '生成中…';
  try {
    const data = await api('/api/trips/' + currentTripId + '/invite', { method: 'POST' });
    $('#invite-url').textContent = data.url;
  } catch (e) {
    $('#invite-url').textContent = '生成失败：' + e.message;
  }
}

function copyInvite() {
  const url = $('#invite-url').textContent;
  if (!url || url.startsWith('生成')) return;
  if (navigator.clipboard) {
    navigator.clipboard.writeText(url).then(() => toast('链接已复制！发给朋友吧'));
  } else {
    const ta = document.createElement('textarea'); ta.value = url;
    document.body.appendChild(ta); ta.select();
    document.execCommand('copy'); document.body.removeChild(ta);
    toast('链接已复制！');
  }
}

// ==================== 行程详情 ====================

const TRIP_SKELETON = `
  <div class="header">
    <button class="back-btn" onclick="goHome()">←</button>
    <h1 id="trip-title">行程</h1>
    <button class="btn btn-sm" style="background:rgba(255,255,255,0.2);color:#fff" onclick="showInvite()">📤 邀请</button>
  </div>
  <div class="scroll-area" id="expense-list"></div>
  <div class="bottom-bar">
    <button class="btn btn-primary" onclick="showAddExpense()" style="flex:1">💸 记一笔</button>
    <button class="btn" onclick="showSettle()" style="flex:1;background:var(--primary-dark);color:#fff">🧮 来A钱</button>
  </div>`;

function goHome() {
  stopPolling();
  currentTripId = null;
  currentTrip = null;
  showView('home');
  loadTrips();
}

async function openTrip(id) {
  currentTripId = id;
  showView('trip');
  if (!$('#trip-title')) $('#page-trip').innerHTML = TRIP_SKELETON;
  await loadTripDetail();
  startPolling();
}

async function loadTripDetail(silent) {
  try {
    const trip = await api('/api/trips/' + currentTripId);
    currentTrip = trip;

    const titleEl = $('#trip-title');
    const listEl = $('#expense-list');
    if (!titleEl || !listEl) return;

    titleEl.textContent = trip.name;

    if (trip.participants.length === 0) {
      listEl.innerHTML = `<div class="empty"><div class="icon">👥</div><p>还没有参与者<br>点击右上角「邀请」分享给朋友</p></div>`;
    } else if (trip.expenses.length === 0) {
      listEl.innerHTML = `<div class="empty"><div class="icon">💸</div><p>还没有花费记录<br>点击下方「记一笔」开始记账吧</p></div>`;
    } else {
      listEl.innerHTML = trip.expenses.map(e => {
        const cat = CATEGORIES.find(c => c.id === e.category) || CATEGORIES[5];
        const perPerson = e.split_with.length > 0 ? (e.amount / e.split_with.length).toFixed(2) : '0';
        const showOriginal = e.currency && e.currency !== 'CNY';
        const curInfo = showOriginal
          ? `<span style="font-size:11px;color:var(--text-secondary)">${e.currency} ${e.original_amount?.toFixed(2)||''} · 汇率 ${e.exchange_rate?.toFixed(4)||''}</span>`
          : '';
        return `
        <div class="expense-item">
          <div class="cat-icon ${e.category}">${cat.emoji}</div>
          <div class="expense-info">
            <div class="desc">${escHtml(e.description || cat.label)}</div>
            <div class="detail">${e.payer_name} 付 · ${e.split_names?.join('、')||'?'} 分摊</div>
          </div>
          <div class="expense-amount">
            ¥${e.amount.toFixed(2)}
            <div class="per">${curInfo ? curInfo+'<br>' : ''}人均 ¥${perPerson}</div>
          </div>
          <button class="del-btn" onclick="deleteExpense(${e.id})" title="删除">×</button>
        </div>`;
      }).join('');
    }
  } catch (e) { if (!silent) toast(e.message); }
}

// ==================== 记一笔 ====================

function showAddExpense() {
  if (!currentTrip || currentTrip.participants.length === 0) return toast('请先邀请朋友加入！');

  $('#input-amount').value = '';
  $('#input-desc').value = '';
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

  const origAmount = Math.round(inputAmount * 100) / 100;
  const rate = exchangeRates[selectedCurrency] || 1;
  const rmbAmount = selectedCurrency === 'CNY' ? origAmount : Math.round(origAmount * rate * 100) / 100;

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
      },
    });
    closeModal('modal-expense');
    toast('记账成功！');
    loadTripDetail();
  } catch (e) { toast(e.message); }
}

async function deleteExpense(eid) {
  if (!confirm('确定删除这笔记录吗？')) return;
  try {
    await api('/api/trips/' + currentTripId + '/expenses/' + eid, { method: 'DELETE' });
    toast('已删除');
    loadTripDetail();
  } catch (e) { toast(e.message); }
}

// ==================== 来A钱（结算） ====================

async function showSettle() {
  if (!currentTrip) return;
  try {
    const data = await api('/api/trips/' + currentTripId + '/settle');

    // 重置页面
    $('#page-trip').innerHTML = `
      <div class="header">
        <button class="back-btn" onclick="openTrip(${currentTripId})">←</button>
        <h1>🧮 来A钱</h1>
        <span></span>
      </div>
      <div class="scroll-area" id="settle-content" style="padding-bottom:20px"></div>`;

    let html = '';

    // -- 汇总 --
    html += `<div style="padding:12px 16px">
      <div class="summary-grid">
        <div class="summary-item"><div class="s-amount">¥${data.summary.total.toFixed(2)}</div><div class="s-label">总花费</div></div>
        <div class="summary-item"><div class="s-amount">${data.transactions.length}</div><div class="s-label">需转账笔数</div></div>
      </div>
    </div>`;

    // 分类
    if (Object.keys(data.summary.byCategory).length > 0) {
      html += `<div style="padding:0 16px 8px;display:flex;flex-wrap:wrap;gap:8px">`;
      for (const [catId, amt] of Object.entries(data.summary.byCategory)) {
        const cat = CATEGORIES.find(c => c.id === catId) || CATEGORIES[5];
        html += `<span style="background:${cat.color || '#9CA3AF'}15;color:${cat.color||'#9CA3AF'};padding:4px 10px;border-radius:12px;font-size:12px;font-weight:600">${cat.emoji} ${cat.label} ¥${amt.toFixed(2)}</span>`;
      }
      html += `</div>`;
    }

    // -- 转账清单 --
    if (data.transactions.length === 0) {
      html += `<div class="empty"><div class="icon">🎉</div><p>大家都平了！</p></div>`;
    } else {
      html += data.transactions.map(t => `
        <div class="settle-card">
          <div class="settle-info"><strong>${escHtml(t.from)}</strong> → <strong>${escHtml(t.to)}</strong></div>
          <div class="settle-amount">¥${t.amount.toFixed(2)}</div>
        </div>
      `).join('');

      const copyText = data.transactions.map(t => `${t.from} → ${t.to}：¥${t.amount.toFixed(2)}`).join('\n');
      html += `<div style="padding:0 16px;margin-top:8px">
        <button class="btn btn-outline btn-block" onclick="copyText(\`${copyText.replace(/`/g,'\\`')}\`)">📋 复制转账清单</button>
      </div>`;
    }

    // -- 计算逻辑（可折叠） --
    if (data.logic && data.logic.steps && data.logic.steps.length > 0) {
      html += `<div class="logic-section">
        <button class="logic-toggle" onclick="toggleLogic()">
          📐 计算逻辑 <span style="font-size:12px">▾</span>
        </button>
        <div class="logic-body" id="logic-body">`;

      // 每笔分摊
      html += `<h4 style="margin:12px 0 8px;font-size:14px;color:var(--text-secondary)">📋 每笔花费分摊</h4>`;
      for (const step of data.logic.steps) {
        html += `<div class="step-item">
          <strong>${escHtml(step.description)}</strong> · <span class="step-amount">¥${step.amount.toFixed(2)}</span><br>
          <span class="step-payer">${escHtml(step.payer)}</span> 付款，
          ${step.splitCount} 人分摊（${escHtml(step.splitPeople)}），
          人均 <strong>¥${step.perPerson.toFixed(2)}</strong>
        </div>`;
      }

      // 债务矩阵
      html += `<h4 style="margin:12px 0 8px;font-size:14px;color:var(--text-secondary)">📊 债务矩阵（抵消前）</h4>`;
      html += renderMatrix(data.logic.matrixBefore);

      html += `<h4 style="margin:12px 0 8px;font-size:14px;color:var(--text-secondary)">📊 债务矩阵（抵消后）</h4>`;
      html += renderMatrix(data.logic.matrixAfter);

      html += `<p style="font-size:12px;color:var(--text-secondary);margin-top:8px">💡 抵消规则：如果 A 欠 B 100，B 也欠 A 30，则相抵后 A 只需给 B 70，减少不必要转账。</p>`;

      html += `</div></div>`;
    }

    $('#settle-content').innerHTML = html;
  } catch (e) { toast(e.message); }
}

function renderMatrix(matrix) {
  if (!matrix) return '<p style="color:var(--text-secondary);font-size:13px">无数据</p>';
  const names = Object.keys(matrix);
  if (names.length === 0) return '';
  let h = '<div style="overflow-x:auto"><table class="matrix-table"><tr><th>欠 ↓ / 被欠 →</th>';
  for (const n of names) h += `<th>${escHtml(n)}</th>`;
  h += '</tr>';
  for (const a of names) {
    h += `<tr><td><strong>${escHtml(a)}</strong></td>`;
    for (const b of names) {
      const v = matrix[a]?.[b] || 0;
      h += `<td class="${v === 0 ? 'zero' : ''}">${v > 0 ? '¥' + v.toFixed(2) : '0'}</td>`;
    }
    h += '</tr>';
  }
  h += '</table></div>';
  return h;
}

function toggleLogic() {
  const body = $('#logic-body');
  if (body) body.classList.toggle('open');
}

function copyText(text) {
  if (navigator.clipboard) {
    navigator.clipboard.writeText(text).then(() => toast('已复制！'));
  } else {
    const ta = document.createElement('textarea'); ta.value = text;
    document.body.appendChild(ta); ta.select();
    document.execCommand('copy'); document.body.removeChild(ta);
    toast('已复制！');
  }
}

// ==================== 轮询 ====================

function startPolling() {
  stopPolling();
  lastSince = new Date().toISOString().replace('T', ' ').replace('Z', '');
  pollTimer = setInterval(pollUpdates, 5000);
}

function stopPolling() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}

async function pollUpdates() {
  if (!currentTripId || currentView !== 'trip') return;
  try {
    const data = await api('/api/trips/' + currentTripId + '/poll?since=' + encodeURIComponent(lastSince));
    if ((data.expenses && data.expenses.length > 0) || (data.participants && data.participants.length > 0)) {
      loadTripDetail(true);
    }
    if (data.since) lastSince = data.since;
  } catch (_) {}
}

// ==================== 弹窗 ====================

function openModal(id) { $('#' + id).style.display = 'flex'; }
function closeModal(id) { $('#' + id).style.display = 'none'; }

document.addEventListener('click', (e) => {
  if (e.target.classList.contains('modal-overlay')) e.target.style.display = 'none';
});

// ==================== 邀请落地 ====================

async function handleInvite(code) {
  try {
    const data = await api('/api/invite/' + code);
    toast(`已加入「${data.name}」！`);
    openTrip(data.trip_id);
    // 清除 URL 中的 invite 路径
    window.history.replaceState({}, '', '/');
  } catch (e) { toast(e.message); }
}

// ==================== 初始化 ====================

(async function init() {
  // 检查邀请链接
  const match = location.pathname.match(/^\/invite\/(\w+)/);
  if (match) {
    if (token) {
      showView('home');
      await loadRates();
      await handleInvite(match[1]);
      return;
    }
    // 未登录，先登录再处理邀请
    showView('login');
    const origDoLogin = doLogin;
    // 登录成功后自动处理邀请
    const origSuccess = onLoginSuccess;
    window._inviteCode = match[1];
    // 简单方案：存储在 localStorage，登录后检测
    localStorage.setItem('aa_pending_invite', match[1]);
    history.replaceState({}, '', '/');
  }

  if (token) {
    showView('home');
    try {
      myUser = await api('/api/auth/me');
      $('#my-nickname').textContent = myUser.nickname;
      await loadRates();
      await loadTrips();

      // 处理待加入的邀请
      const pendingInvite = localStorage.getItem('aa_pending_invite');
      if (pendingInvite) {
        localStorage.removeItem('aa_pending_invite');
        await handleInvite(pendingInvite);
      }
    } catch (e) {
      logout();
    }
  } else {
    showView('login');
  }
})();
