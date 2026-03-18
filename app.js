const APP_VERSION = '2026-03-18a';

// ===== CREDIT CARD PAYMENT DETECTION =====
// Detects monthly credit card settlement rows in bank (Leumi) data.
// Defined here (before loadState) because loadState calls it on startup.
const CREDIT_CARD_PATTERNS = [
  'חיוב כרטיס', 'כרטיס אשראי', 'מקס', 'max', 'ויזה כאל', 'visa cal',
  'ישראכרט', 'isracard', 'לאומי קארד', 'leumi card', 'כאל', 'cal ',
  'דיינרס', 'diners', 'אמריקן אקספרס', 'amex'
];
function isCreditCardPayment(description) {
  const lower = (description || '').toLowerCase();
  return CREDIT_CARD_PATTERNS.some(p => lower.includes(p.toLowerCase()));
}

// ===== STATE =====
const DB_KEY = 'cashflow_v1';
let state = loadState();

function defaultState() {
  return {
    fixedItems: [],   // { id, type:'expense'|'income'|'transfer', name, amount, day, emoji, recurrence:'monthly'|'onetime'|'annual', paid:false }
    transactions: [], // { id, source:'leumi'|'max', date, description, debit, credit, isFixed:false, isTransfer:false, installmentCurrent:0, installmentTotal:0 }
    settings: { savingsTarget: 0, salaryDay: 1, lastResetMonth: '' }
  };
}

function loadState() {
  try {
    const s = localStorage.getItem(DB_KEY);
    if (s) {
      const parsed = JSON.parse(s);
      const loaded = { ...defaultState(), ...parsed };
      // Fix duplicate IDs from old imports
      const seenIds = new Set();
      loaded.transactions = loaded.transactions.map(t => {
        // IMPORTANT: preserve user's explicit isTransfer changes.
        // Only auto-detect if isTransfer was never set (undefined = old data before feature was added).
        const isTransfer = t.isTransfer !== undefined
          ? t.isTransfer
          : (t.source === 'leumi' && isCreditCardPayment(t.description));
        if (!seenIds.has(t.id)) { seenIds.add(t.id); return { ...t, isTransfer }; }
        let i = 1;
        while (seenIds.has(`${t.id}_${i}`)) i++;
        const newId = `${t.id}_${i}`;
        seenIds.add(newId);
        return { ...t, id: newId, isTransfer };
      });
      // Auto-reset "paid" flags at the start of each new month
      const currentMonthKey = `${new Date().getFullYear()}-${String(new Date().getMonth()+1).padStart(2,'0')}`;
      if (loaded.settings.lastResetMonth !== currentMonthKey) {
        loaded.fixedItems = loaded.fixedItems.map(i => ({ ...i, paid: false }));
        loaded.settings.lastResetMonth = currentMonthKey;
      }

      return loaded;
    }
  } catch(e) {}
  return defaultState();
}

function saveState() {
  localStorage.setItem(DB_KEY, JSON.stringify(state));
}

// ===== MONTH VIEW =====
const _today = new Date();
let viewMonth = { year: _today.getFullYear(), month: _today.getMonth() };

function changeViewMonth(delta) {
  let m = viewMonth.month + delta;
  let y = viewMonth.year;
  if (m > 11) { m = 0; y++; }
  if (m < 0)  { m = 11; y--; }
  viewMonth = { year: y, month: m };
  renderHome();
  if (currentScreen === 'tx') renderTransactions();
}

// ===== NAVIGATION =====
let currentScreen = 'home';

function navigate(screen, btn) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
  document.getElementById('screen-' + screen).classList.add('active');
  if (btn) btn.classList.add('active');
  currentScreen = screen;
  if (screen === 'home') renderHome();
  if (screen === 'fixed') renderFixed();
  if (screen === 'tx') renderTransactions();
  if (screen === 'settings') renderSettings();
}

// ===== TOAST =====
function showToast(msg, duration = 2500) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), duration);
}

// ===== FORMAT =====
// Show decimal places only when there are cents (e.g. ₪6,244.48 not ₪6,244.00)
function fmt(n) {
  const num = Number(n) || 0;
  const rounded2 = Math.round(num * 100) / 100;
  if (rounded2 === Math.floor(rounded2)) {
    // Whole number - no decimals
    return '₪' + rounded2.toLocaleString('he-IL');
  }
  return '₪' + rounded2.toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(d) {
  if (!d) return '';
  if (typeof d === 'string') return d;
  const dt = new Date(d);
  if (isNaN(dt)) return d;
  return dt.toLocaleDateString('he-IL', { day:'numeric', month:'numeric', year:'2-digit' });
}

// ===== HTML ESCAPING (for safe inline attributes) =====
function escapeAttr(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ===== PROJECTED FUTURE EXPENSES =====
// Returns { installments: [...], recurring: [...], total }
// installments = future installment payments not yet in uploaded data
// recurring    = isFixed transactions from prev month not yet seen this month
function getProjectedExpenses(year, month) {
  const targetIdx = year * 12 + month;
  const result = { installments: [], recurring: [], total: 0 };

  // 1. Project remaining installments from known series
  // For each unique series (description + installmentTotal + amount), find the latest tx
  const seriesMap = new Map();
  for (const tx of state.transactions) {
    if (!tx.installmentTotal || tx.installmentTotal <= 1) continue;
    const key = `${tx.description}__${tx.installmentTotal}__${tx.debit}`;
    const txIdx = new Date(tx.date).getFullYear() * 12 + new Date(tx.date).getMonth();
    const existing = seriesMap.get(key);
    if (!existing || txIdx > existing.idx) {
      seriesMap.set(key, { description: tx.description, amount: tx.debit,
        current: tx.installmentCurrent, total: tx.installmentTotal, idx: txIdx });
    }
  }
  for (const [, s] of seriesMap) {
    const remaining = s.total - s.current;
    if (remaining <= 0) continue;
    for (let n = 1; n <= remaining; n++) {
      const projIdx = s.idx + n;
      const projCurrent = s.current + n;
      if (projIdx === targetIdx) {
        // Only project if not already uploaded for this month
        const alreadyIn = state.transactions.some(t =>
          t.description === s.description &&
          t.installmentCurrent === projCurrent &&
          t.installmentTotal === s.total
        );
        if (!alreadyIn) {
          result.installments.push({ description: s.description, amount: s.amount,
            current: projCurrent, total: s.total });
          result.total += s.amount;
        }
        break;
      }
      if (projIdx > targetIdx) break;
    }
  }

  // 2. Project recurring (isFixed) transactions from previous month
  const prevYear = month === 0 ? year - 1 : year;
  const prevMonth = month === 0 ? 11 : month - 1;
  const prevFixed = state.transactions.filter(t => {
    const d = new Date(t.date);
    return d.getFullYear() === prevYear && d.getMonth() === prevMonth &&
           t.isFixed && !t.isTransfer && t.debit > 0;
  });
  for (const tx of prevFixed) {
    const alreadyIn = state.transactions.some(t => {
      const d = new Date(t.date);
      return d.getFullYear() === year && d.getMonth() === month &&
             t.description === tx.description;
    });
    if (!alreadyIn) {
      result.recurring.push({ description: tx.description, amount: tx.debit });
      result.total += tx.debit;
    }
  }

  return result;
}

// ===== HOME =====
function renderHome() {
  const now = new Date();
  const isCurrentMonth = viewMonth.year === now.getFullYear() && viewMonth.month === now.getMonth();
  const daysInMonth = new Date(viewMonth.year, viewMonth.month + 1, 0).getDate();
  const monthPct = isCurrentMonth ? Math.round((now.getDate() / daysInMonth) * 100) : 100;

  // Update month label and nav buttons
  const monthLabel = new Date(viewMonth.year, viewMonth.month, 1)
    .toLocaleDateString('he-IL', { month: 'long', year: 'numeric' });
  const labelEl = document.getElementById('home-month-label');
  if (labelEl) labelEl.textContent = monthLabel;
  const nextBtn = document.getElementById('month-nav-next');
  if (nextBtn) nextBtn.disabled = isCurrentMonth;

  // Fixed income items
  const fixedIncome = state.fixedItems
    .filter(i => i.type === 'income')
    .reduce((s, i) => s + Number(i.amount), 0);

  // FIXED: Use only UNPAID fixed expenses (paid ones are already in bank transactions)
  const upcomingFixedExp = state.fixedItems
    .filter(i => i.type === 'expense' && !i.paid)
    .reduce((s, i) => s + Number(i.amount), 0);

  // This month's transactions (excluding transfers)
  const thisMonth = viewMonth.month;
  const thisYear = viewMonth.year;
  const monthTx = state.transactions.filter(t => {
    const d = new Date(t.date);
    return d.getMonth() === thisMonth && d.getFullYear() === thisYear && !t.isTransfer;
  });

  const txDebit = monthTx.filter(t => t.debit > 0).reduce((s, t) => s + t.debit, 0);
  const txCredit = monthTx.filter(t => t.credit > 0).reduce((s, t) => s + t.credit, 0);

  // Projected future charges (installments + recurring not yet in data)
  const projected = getProjectedExpenses(thisYear, thisMonth);

  // Income = actual received + expected fixed income
  // Expenses = actual transactions + upcoming unpaid fixed + projected future
  const totalIncome = txCredit + fixedIncome;
  const totalExp = txDebit + upcomingFixedExp + projected.total;
  const cashflow = totalIncome - totalExp - (state.settings.savingsTarget || 0);
  const expensePct = totalIncome > 0 ? Math.min(Math.round((totalExp / totalIncome) * 100), 100) : 0;

  // Update hero
  const cfEl = document.getElementById('home-cashflow');
  cfEl.textContent = fmt(cashflow);
  cfEl.className = 'hero-amount ' + (cashflow >= 0 ? 'positive' : 'negative');
  const noteEl = document.getElementById('projected-note');
  if (noteEl) {
    if (projected.total > 0) {
      noteEl.textContent = `כולל ${fmt(projected.total)} הוצאות צפויות שטרם ירדו`;
      noteEl.style.display = 'block';
    } else {
      noteEl.style.display = 'none';
    }
  }
  document.getElementById('home-income').textContent = fmt(totalIncome);
  document.getElementById('home-fixed-exp').textContent = fmt(upcomingFixedExp);
  document.getElementById('home-tx-exp').textContent = fmt(txDebit);
  const projEl = document.getElementById('home-projected-exp');
  if (projEl) projEl.textContent = projected.total > 0 ? fmt(projected.total) : '—';

  // Progress
  document.getElementById('expense-pct').textContent = expensePct + '%';
  document.getElementById('expense-bar').style.width = expensePct + '%';
  document.getElementById('month-pct').textContent = monthPct + '%';
  document.getElementById('month-bar').style.width = monthPct + '%';

  // Savings
  document.getElementById('savings-amount').textContent = fmt(state.settings.savingsTarget || 0);

  // Upcoming fixed (unpaid, by day this month)
  const upcoming = state.fixedItems
    .filter(i => i.type === 'expense' && !i.paid)
    .sort((a, b) => Number(a.day) - Number(b.day));

  const ul = document.getElementById('upcoming-list');
  if (upcoming.length === 0) {
    ul.innerHTML = `<div style="text-align:center;padding:16px 0;color:#aaa;font-size:13px;">אין הוצאות ממתינות 🎉</div>`;
  } else {
    ul.innerHTML = upcoming.map(i => `
      <div class="upcoming-item">
        <div class="item-left">
          <div class="icon" style="background:#f0ebff;">${i.emoji || '📌'}</div>
          <div>
            <div class="name">${i.name}</div>
            <div class="date">ב-${i.day} לחודש</div>
          </div>
        </div>
        <div class="amount pending">${fmt(i.amount)}</div>
      </div>
    `).join('');
  }

  // Projected future charges card
  const projCard = document.getElementById('projected-card');
  const projList = document.getElementById('projected-list');
  if (projCard && projList) {
    const allProjected = [
      ...projected.installments.map(p => ({
        label: p.description,
        sub: `תשלום ${p.current} מתוך ${p.total}`,
        amount: p.amount,
        icon: '🔄'
      })),
      ...projected.recurring.map(p => ({
        label: p.description,
        sub: 'חוזר חודשי',
        amount: p.amount,
        icon: '📌'
      }))
    ];
    if (allProjected.length === 0) {
      projCard.style.display = 'none';
    } else {
      projCard.style.display = '';
      projList.innerHTML = allProjected.map(p => `
        <div class="upcoming-item">
          <div class="item-left">
            <div class="icon" style="background:#fff4e6;">${p.icon}</div>
            <div>
              <div class="name">${escapeAttr(p.label)}</div>
              <div class="date">${p.sub}</div>
            </div>
          </div>
          <div class="amount pending">${fmt(p.amount)}</div>
        </div>
      `).join('');
    }
  }

  // Recent transactions (last 5)
  const recent = [...state.transactions]
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, 5);

  const rtl = document.getElementById('recent-tx-list');
  if (recent.length === 0) {
    rtl.innerHTML = `<div style="text-align:center;padding:16px 0;color:#aaa;font-size:13px;">העלי קובץ בלשונית עסקאות</div>`;
  } else {
    rtl.innerHTML = recent.map(t => {
      const isCredit = t.credit > 0;
      return `
        <div class="upcoming-item">
          <div class="item-left">
            <div class="icon tx-icon ${isCredit ? 'credit' : 'debit'}" style="background:${isCredit ? '#e8f5e9' : '#fff0f0'};">${isCredit ? '⬆️' : '⬇️'}</div>
            <div>
              <div class="name" style="font-size:13px;">${t.description}</div>
              <div class="date">${fmtDate(t.date)}</div>
            </div>
          </div>
          <div class="amount ${isCredit ? 'paid' : 'pending'}">${isCredit ? '+' : '-'}${fmt(isCredit ? t.credit : t.debit)}</div>
        </div>
      `;
    }).join('');
  }
}

// ===== FIXED ITEMS =====
let fixedSegment = 'expense';

function switchFixedSegment(seg, btn) {
  fixedSegment = seg;
  document.querySelectorAll('.segment button').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderFixed();
}

const EMOJIS = ['🏠', '💡', '💧', '📱', '🚗', '🛒', '🎓', '💊', '🏥', '🐕', '🎮', '🍕', '☕', '✈️', '📚', '💰', '📌', '🏋️', '🎵', '🌐', '💳', '🏦', '👶', '🏢', '🔑'];

function renderFixed() {
  const items = state.fixedItems.filter(i => i.type === fixedSegment);
  const container = document.getElementById('fixed-list-container');

  const total = items.reduce((s, i) => s + Number(i.amount), 0);

  // Also gather transactions marked as fixed/recurring for this segment
  let fixedTxs = [];
  if (fixedSegment === 'expense') {
    fixedTxs = state.transactions.filter(t => t.isFixed && !t.isTransfer && t.debit > 0);
  } else if (fixedSegment === 'income') {
    fixedTxs = state.transactions.filter(t => t.isFixed && !t.isTransfer && t.credit > 0);
  }
  fixedTxs.sort((a, b) => new Date(b.date) - new Date(a.date));

  const recLabel = { monthly: 'חודשי', onetime: 'חד פעמי', annual: 'שנתי' };

  let html = '';

  if (items.length === 0 && fixedTxs.length === 0) {
    container.innerHTML = `
      <div class="empty-state" style="padding:40px 24px;">
        <div class="empty-icon">${fixedSegment === 'income' ? '💰' : fixedSegment === 'transfer' ? '🔄' : '📋'}</div>
        <h3>${fixedSegment === 'income' ? 'אין הכנסות קבועות' : fixedSegment === 'transfer' ? 'אין העברות' : 'אין הוצאות קבועות'}</h3>
        <p>לחצי על "+ הוסף" להוספה</p>
      </div>
    `;
    return;
  }

  // Manual fixed items
  if (items.length > 0) {
    html += `
      <div style="background:white;border-radius:16px;margin:0 16px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.06);">
        ${items.map(item => `
          <div class="fixed-item">
            <div class="item-info">
              <div class="icon" style="background:#f0ebff;">${item.emoji || '📌'}</div>
              <div class="details">
                <div class="name">${item.name}</div>
                <div class="meta">ב-${item.day} לחודש · ${recLabel[item.recurrence] || 'חודשי'}</div>
              </div>
            </div>
            <div class="status">
              ${fixedSegment === 'expense' ? `
                <span class="status-badge ${item.paid ? 'paid' : 'pending'}">${item.paid ? '✓ ירד' : 'ממתין'}</span>
              ` : `
                <span class="status-badge income-badge">קבועה</span>
              `}
              <div class="amount ${fixedSegment === 'income' ? 'income' : 'expense'}">${fmt(item.amount)}</div>
            </div>
            <div class="actions">
              ${fixedSegment === 'expense' ? `<button class="action-btn toggle-paid" onclick="togglePaid('${item.id}')">${item.paid ? 'בטל' : '✓ ירד'}</button>` : ''}
              <button class="action-btn edit" onclick="openEditFixed('${item.id}')">✏️</button>
              <button class="action-btn delete" onclick="deleteFixed('${item.id}')">🗑</button>
            </div>
          </div>
        `).join('')}
        <div class="section-total">
          <span>סה"כ ${fixedSegment === 'income' ? 'הכנסות' : fixedSegment === 'transfer' ? 'העברות' : 'הוצאות'}</span>
          <span>${fmt(total)}</span>
        </div>
      </div>
    `;
  }

  // Transactions tagged as fixed/recurring - shown as a secondary section
  if (fixedTxs.length > 0) {
    const txTotal = fixedTxs.reduce((s, t) => s + (fixedSegment === 'income' ? t.credit : t.debit), 0);
    html += `
      <div style="margin: 12px 16px 0;">
        <div style="font-size:12px;font-weight:600;color:#888;margin-bottom:6px;padding-right:4px;">עסקאות שסווגו כקבועות</div>
        <div style="background:white;border-radius:16px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.06);">
          ${fixedTxs.map(t => {
            const amt = fixedSegment === 'income' ? t.credit : t.debit;
            const installInfo = t.installmentTotal > 0
              ? `<span style="margin-right:6px;color:#7c5cbf;font-size:11px;">תשלום ${t.installmentCurrent} מתוך ${t.installmentTotal}</span>`
              : '';
            return `
              <div class="fixed-item">
                <div class="item-info">
                  <div class="icon" style="background:${fixedSegment === 'income' ? '#e8f5e9' : '#fff0f0'};">${fixedSegment === 'income' ? '⬆️' : '⬇️'}</div>
                  <div class="details">
                    <div class="name">${t.description}</div>
                    <div class="meta">${fmtDate(t.date)} · ${t.source === 'leumi' ? 'לאומי' : 'מקס'}${installInfo}</div>
                  </div>
                </div>
                <div class="status">
                  <div class="amount ${fixedSegment === 'income' ? 'income' : 'expense'}">${fmt(amt)}</div>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;
  }

  // Grand total footer
  if (fixedSegment === 'expense' || fixedSegment === 'income') {
    const txTotal = fixedTxs.reduce((s, t) => s + (fixedSegment === 'income' ? t.credit : t.debit), 0);
    const grandTotal = total + txTotal;
    const label = fixedSegment === 'income' ? 'סה"כ הכנסות קבועות' : 'סה"כ הוצאות קבועות';
    html += `
      <div style="margin:16px 16px 0;background:#7c5cbf;border-radius:14px;padding:14px 18px;display:flex;justify-content:space-between;align-items:center;">
        <span style="color:rgba(255,255,255,0.85);font-size:14px;font-weight:600;">${label}</span>
        <span style="color:white;font-size:20px;font-weight:700;">${fmt(grandTotal)}</span>
      </div>
    `;
  }

  container.innerHTML = html;
}

function togglePaid(id) {
  const item = state.fixedItems.find(i => i.id === id);
  if (item) {
    item.paid = !item.paid;
    saveState();
    renderFixed();
    renderHome();
    showToast(item.paid ? '✓ סומן כ"ירד"' : 'סומן כממתין');
  }
}

function deleteFixed(id) {
  if (!confirm('למחוק פריט זה?')) return;
  state.fixedItems = state.fixedItems.filter(i => i.id !== id);
  saveState();
  renderFixed();
  showToast('נמחק');
}

// ===== FIXED MODAL =====
let fixedModalType = 'expense';
let selectedEmoji = '📌';

function openAddFixed() {
  document.getElementById('fixed-modal-title').textContent = 'הוסף פריט קבוע';
  document.getElementById('fixed-edit-id').value = '';
  document.getElementById('fixed-name').value = '';
  document.getElementById('fixed-amount').value = '';
  document.getElementById('fixed-day').value = '';
  document.getElementById('fixed-recurrence').value = 'monthly';
  setFixedType(fixedSegment, document.getElementById('type-' + fixedSegment + '-btn'));
  selectedEmoji = '📌';
  renderEmojiPicker();
  document.getElementById('fixed-modal').classList.add('open');
}

function openEditFixed(id) {
  const item = state.fixedItems.find(i => i.id === id);
  if (!item) return;
  document.getElementById('fixed-modal-title').textContent = 'עריכת פריט';
  document.getElementById('fixed-edit-id').value = id;
  document.getElementById('fixed-name').value = item.name;
  document.getElementById('fixed-amount').value = item.amount;
  document.getElementById('fixed-day').value = item.day;
  document.getElementById('fixed-recurrence').value = item.recurrence || 'monthly';
  selectedEmoji = item.emoji || '📌';
  setFixedType(item.type, document.getElementById('type-' + item.type + '-btn'));
  renderEmojiPicker();
  document.getElementById('fixed-modal').classList.add('open');
}

function closeFixedModal() {
  document.getElementById('fixed-modal').classList.remove('open');
}

function setFixedType(type, btn) {
  fixedModalType = type;
  document.getElementById('fixed-type').value = type;
  ['expense','income','transfer'].forEach(t => {
    const b = document.getElementById('type-' + t + '-btn');
    if (b) b.className = (t === type) ? `active ${t}` : '';
  });
}

function renderEmojiPicker() {
  const picker = document.getElementById('emoji-picker');
  picker.innerHTML = EMOJIS.map(e => `
    <button onclick="selectEmoji('${e}',this)" style="font-size:22px;padding:4px;border:2px solid ${e === selectedEmoji ? '#7c5cbf' : 'transparent'};border-radius:8px;background:none;cursor:pointer;">
      ${e}
    </button>
  `).join('');
}

function selectEmoji(e, btn) {
  selectedEmoji = e;
  document.querySelectorAll('#emoji-picker button').forEach(b => b.style.borderColor = 'transparent');
  btn.style.borderColor = '#7c5cbf';
}

function saveFixed() {
  const name = document.getElementById('fixed-name').value.trim();
  const amount = parseFloat(document.getElementById('fixed-amount').value);
  const day = parseInt(document.getElementById('fixed-day').value) || 1;
  const recurrence = document.getElementById('fixed-recurrence').value;
  const editId = document.getElementById('fixed-edit-id').value;

  if (!name || isNaN(amount) || amount <= 0) {
    showToast('נא למלא שם וסכום');
    return;
  }

  if (editId) {
    const item = state.fixedItems.find(i => i.id === editId);
    if (item) {
      item.name = name;
      item.amount = amount;
      item.day = day;
      item.recurrence = recurrence;
      item.emoji = selectedEmoji;
      item.type = fixedModalType;
    }
  } else {
    state.fixedItems.push({
      id: Date.now().toString(),
      type: fixedModalType,
      name,
      amount,
      day,
      emoji: selectedEmoji,
      recurrence,
      paid: false
    });
  }

  saveState();
  closeFixedModal();
  renderFixed();
  showToast(editId ? 'עודכן בהצלחה' : 'נוסף בהצלחה');
}

// ===== TRANSACTIONS =====
let txFilter = 'all';

function filterTx(filter, btn) {
  txFilter = filter;
  document.querySelectorAll('.filter-chip').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderTransactions();
}

function renderTransactions() {
  // Update month label on tx screen
  const txMonthLabel = new Date(viewMonth.year, viewMonth.month, 1)
    .toLocaleDateString('he-IL', { month: 'long', year: 'numeric' });
  const txLabelEl = document.getElementById('tx-month-label');
  if (txLabelEl) txLabelEl.textContent = txMonthLabel;
  const txNextBtn = document.getElementById('tx-month-nav-next');
  const now = new Date();
  if (txNextBtn) txNextBtn.disabled = (viewMonth.year === now.getFullYear() && viewMonth.month === now.getMonth());

  const thisMonth = viewMonth.month;
  const thisYear = viewMonth.year;

  // Build list of transactions for the selected month only
  let txs = state.transactions.filter(t => {
    const d = new Date(t.date);
    return d.getFullYear() === thisYear && d.getMonth() === thisMonth;
  });

  // Apply source/type filter
  if (txFilter === 'leumi') txs = txs.filter(t => t.source === 'leumi');
  else if (txFilter === 'max') txs = txs.filter(t => t.source === 'max');
  else if (txFilter === 'credit') txs = txs.filter(t => t.credit > 0);
  else if (txFilter === 'debit') txs = txs.filter(t => t.debit > 0);
  else if (txFilter === 'fixed') txs = txs.filter(t => t.isFixed);
  else if (txFilter === 'onetime') txs = txs.filter(t => !t.isFixed && !t.isTransfer);

  // Sort by date desc
  txs.sort((a, b) => new Date(b.date) - new Date(a.date));

  // ===== SUMMARY: current viewMonth, excluding transfers =====
  const monthNonTransfer = state.transactions.filter(t => {
    const d = new Date(t.date);
    return d.getMonth() === thisMonth && d.getFullYear() === thisYear && !t.isTransfer;
  });
  const totalCredit = monthNonTransfer.reduce((s, t) => s + t.credit, 0);
  const totalDebit  = monthNonTransfer.reduce((s, t) => s + t.debit, 0);
  document.getElementById('tx-total-credit').textContent = fmt(totalCredit);
  document.getElementById('tx-total-debit').textContent = fmt(totalDebit);
  const balance = totalCredit - totalDebit;
  const balEl = document.getElementById('tx-total-balance');
  balEl.textContent = fmt(Math.abs(balance));
  balEl.className = 's-value ' + (balance >= 0 ? 'credit' : 'debit');

  const container = document.getElementById('tx-list');

  if (txs.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">📂</div>
        <h3>אין עסקאות</h3>
        <p>העלי קובץ Excel מבנק לאומי<br>או מחברת מקס</p>
      </div>
    `;
    return;
  }

  // Group by month
  const groups = {};
  txs.forEach(t => {
    const d = new Date(t.date);
    const key = isNaN(d) ? 'אחר' : `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
    const label = isNaN(d) ? 'אחר' : d.toLocaleDateString('he-IL', { month: 'long', year: 'numeric' });
    if (!groups[key]) groups[key] = { label, items: [] };
    groups[key].items.push(t);
  });

  const sortedKeys = Object.keys(groups).sort().reverse();

  // FIXED: Use data-tx-id attribute instead of inline onclick with raw ID
  // This prevents broken JS when ID contains quotes (e.g. בע"מ or בע'מ)
  container.innerHTML = sortedKeys.map(key => {
    const g = groups[key];
    const isCurrentViewMonth = key === `${thisYear}-${String(thisMonth+1).padStart(2,'0')}`;
    return `
      <div class="tx-month-header" style="${isCurrentViewMonth ? 'color:#7c5cbf;' : ''}">${g.label}</div>
      ${g.items.map(t => {
        const isCredit = t.credit > 0;
        const sourceLabel = t.source === 'leumi' ? '🏦' : '💳';
        const installmentHtml = t.installmentTotal > 0
          ? `<span class="tx-installment-badge">תשלום ${t.installmentCurrent} מתוך ${t.installmentTotal}</span>`
          : '';
        const badgeType = t.isTransfer ? 'transfer' : (t.isFixed ? 'fixed' : 'onetime');
        const badgeLabel = t.isTransfer ? 'העברה' : (t.isFixed ? 'קבוע' : 'חד פעמי');
        return `
          <div class="tx-item">
            <div class="tx-left">
              <div class="tx-icon ${isCredit ? 'credit' : 'debit'}">${isCredit ? '⬆️' : '⬇️'}</div>
              <div class="tx-details">
                <div class="tx-name">${t.description}</div>
                <div class="tx-date">${sourceLabel} ${fmtDate(t.date)}${installmentHtml}</div>
              </div>
            </div>
            <div class="tx-right">
              <div class="tx-amount ${t.isTransfer ? 'transfer-muted' : (isCredit ? 'credit' : 'debit')}">${t.isTransfer ? '↔' : (isCredit ? '+' : '-')}${fmt(isCredit ? t.credit : t.debit)}</div>
              <div style="display:flex;gap:4px;flex-wrap:wrap;justify-content:flex-end;">
                <span class="tx-type-badge ${badgeType}"
                      data-tx-id="${escapeAttr(t.id)}"
                      title="לחצי לשינוי סוג"
                      style="cursor:pointer;">
                  ${badgeLabel}
                </span>
              </div>
            </div>
          </div>
        `;
      }).join('')}
    `;
  }).join('');
}

// ===== EVENT DELEGATION for transaction type badges =====
// Using delegation avoids broken inline onclick when IDs contain quotes (e.g. בע"מ)
function setupTxListDelegation() {
  document.getElementById('tx-list').addEventListener('click', function(e) {
    const badge = e.target.closest('[data-tx-id]');
    if (badge) {
      cycleTxType(badge.dataset.txId);
    }
  });
}

// Cycles: onetime → fixed → transfer → onetime
function cycleTxType(id) {
  const tx = state.transactions.find(t => t.id === id);
  if (!tx) return;
  if (!tx.isFixed && !tx.isTransfer) { tx.isFixed = true; tx.isTransfer = false; }
  else if (tx.isFixed && !tx.isTransfer) { tx.isFixed = false; tx.isTransfer = true; }
  else { tx.isFixed = false; tx.isTransfer = false; }
  saveState();
  renderTransactions();
  renderHome();
}

// ===== FILE UPLOAD =====
async function handleFileUpload(event, source) {
  const file = event.target.files[0];
  if (!file) return;
  event.target.value = '';

  showToast('טוען קובץ...');

  try {
    const data = await file.arrayBuffer();
    const workbook = XLSX.read(data, { type: 'array', cellDates: true });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, dateNF: 'YYYY-MM-DD' });

    let parsed = [];
    if (source === 'leumi') {
      parsed = parseLeumiRows(rows);
    } else if (source === 'max') {
      parsed = parseMaxRows(rows);
    }

    if (parsed.length === 0) {
      showToast('לא נמצאו עסקאות בקובץ');
      return;
    }

    // Deduplicate by id - preserves all existing user classifications
    const existingIds = new Set(state.transactions.map(t => t.id));
    const newTxs = parsed.filter(t => !existingIds.has(t.id));

    state.transactions.push(...newTxs);
    saveState();
    renderTransactions();
    const autoTransfer = newTxs.filter(t => t.isTransfer).length;
    const suffix = autoTransfer > 0 ? ` — ${autoTransfer} חיובי אשראי הוחרגו אוטומטית` : '';
    showToast(`✓ נטענו ${parsed.length} עסקאות (${newTxs.length} חדשות)${suffix}`);

  } catch (err) {
    console.error(err);
    showToast('שגיאה בקריאת הקובץ');
  }
}

// ===== LEUMI PARSER =====
// Bank Leumi Excel format has two variants:
//   5-col: תאריך | תיאור | חובה | זכות | יתרה
//   7-col: תאריך | תאריך ערך | תיאור | אסמכתא | חובה | זכות | יתרה
// IMPORTANT: format is detected ONCE for the whole file, not per-row.
// Per-row detection caused wrong column reads when a reference number in col1
// happened to look like a date, resulting in amounts like 6,244.48 → 6442.
function parseLeumiRows(rows) {
  const results = [];

  // ── Step 1: detect format (5-col vs 7-col) from the file header or first data rows ──
  let descCol = 1, debitCol = 2, creditCol = 3; // default: 5-col
  let formatDetected = false;

  // First: look for a Leumi header row that names the columns (most reliable)
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const row = rows[i];
    if (!row) continue;
    const cells = row.map(c => String(c || '').trim());
    const rowText = cells.join(' ');
    // Header row typically contains both חובה and זכות
    if (rowText.includes('חובה') && rowText.includes('זכות')) {
      // Find exact column positions from header names
      let dCol = -1, cCol = -1, nCol = -1;
      cells.forEach((cell, c) => {
        if ((cell === 'חובה' || cell === 'בחובה' || cell === 'סכום חובה') && dCol < 0) dCol = c;
        if ((cell === 'זכות' || cell === 'בזכות' || cell === 'סכום זכות') && cCol < 0) cCol = c;
        if ((cell === 'תיאור' || cell === 'תיאור פעולה' || cell === 'פרטים') && nCol < 0) nCol = c;
      });
      if (dCol >= 0 && cCol >= 0) {
        debitCol  = dCol;
        creditCol = cCol;
        descCol   = nCol >= 0 ? nCol : (dCol > 2 ? 2 : 1);
        formatDetected = true;
        break;
      }
    }
  }

  // Second: if no header, detect from the first data rows — check CONSISTENTLY
  // whether col[1] is a date across the first several rows
  if (!formatDetected) {
    let sevenColVotes = 0, fiveColVotes = 0;
    let checked = 0;
    for (let i = 0; i < rows.length && checked < 5; i++) {
      const row = rows[i];
      if (!row || row.length < 3) continue;
      const first = String(row[0] || '').trim();
      if (!first.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})$/)) continue;
      checked++;
      const second = String(row[1] || '').trim();
      if (second.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})$/) && row.length >= 7) {
        sevenColVotes++;
      } else {
        fiveColVotes++;
      }
    }
    if (sevenColVotes > fiveColVotes) {
      // 7-col: תאריך | תאריך ערך | תיאור | אסמכתא | חובה | זכות | יתרה
      descCol = 2; debitCol = 4; creditCol = 5;
    }
    // else keep 5-col defaults: descCol=1, debitCol=2, creditCol=3
  }

  // ── Step 2: parse each data row using the detected format ──
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length < 3) continue;

    const firstCell = String(row[0] || '').trim();
    const isDate = firstCell.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})$/) ||
                   firstCell.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!isDate) continue;

    // Parse date
    let date;
    if (firstCell.includes('-') && firstCell.length === 10 && firstCell[4] === '-') {
      date = firstCell; // already YYYY-MM-DD
    } else {
      const parts = firstCell.split(/[\/\-\.]/);
      if (parts.length !== 3) continue;
      let y = parts[2];
      if (y.length === 2) y = '20' + y;
      if (parseInt(parts[0]) > 31) {
        // YYYY-MM-DD style
        date = `${parts[0]}-${parts[1].padStart(2,'0')}-${parts[2].padStart(2,'0')}`;
      } else {
        // Leumi exports D.M.YYYY (Israeli format: day first, then month)
        date = `${y}-${parts[1].padStart(2,'0')}-${parts[0].padStart(2,'0')}`;
      }
    }

    const description = String(row[descCol] || '').trim();
    if (!description) continue;

    // Skip balance/opening balance entries
    if (description.includes('יתרה') || description.includes('יתרת פתיחה')) continue;

    let credit = 0, debit = 0;
    const vDebit  = parseFloat(String(row[debitCol]  || '').replace(/,/g, ''));
    const vCredit = parseFloat(String(row[creditCol] || '').replace(/,/g, ''));
    if (!isNaN(vDebit)  && vDebit  > 0) debit  = vDebit;
    if (!isNaN(vCredit) && vCredit > 0) credit = vCredit;

    // If both still zero, scan only within the known debit/credit column range
    if (credit === 0 && debit === 0) {
      const lo = Math.min(debitCol, creditCol);
      const hi = Math.max(debitCol, creditCol);
      for (let c = lo; c <= hi; c++) {
        const v = parseFloat(String(row[c] || '').replace(/,/g, ''));
        if (!isNaN(v) && v > 0) { credit = v; break; }
        if (!isNaN(v) && v < 0) { debit = Math.abs(v); break; }
      }
    }

    if (credit === 0 && debit === 0) continue;

    const baseId = `leumi_${date}_${description}_${credit}_${debit}`.replace(/\s/g, '_');
    const dupCount = results.filter(r => r.id === baseId || r.id.startsWith(baseId + '_')).length;
    const id = dupCount === 0 ? baseId : `${baseId}_${dupCount}`;
    const isTransfer = isCreditCardPayment(description);
    results.push({ id, source: 'leumi', date, description, credit, debit, isFixed: false, isTransfer, installmentCurrent: 0, installmentTotal: 0 });
  }

  return results;
}

// ===== MAX PARSER =====
// Max (מקס) Excel format:
// תאריך עסקה | שם בית עסק | קטגוריה | סוג עסקה | סכום עסקה | סכום חיוב | מטבע | ארבע ספרות | תאריך חיוב | פירוט תשלום
// For installment transactions (סוג עסקה = תשלומים):
//   - תאריך עסקה = original PURCHASE date (e.g. May 2025) — NOT the billing month
//   - תאריך חיוב = BILLING date (e.g. April 2026) — this is what we must use
//   - סכום חיוב  = monthly installment amount charged this month
function parseMaxRows(rows) {
  const results = [];
  let headerRowIndex = -1;
  let colDate = -1, colBillingDate = -1, colName = -1;
  let colChargeAmount = -1, colTxAmount = -1, colType = -1;

  // Find header row and detect column positions by name
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const row = rows[i];
    if (!row) continue;
    const rowStr = row.map(c => String(c || '').trim());

    for (let c = 0; c < rowStr.length; c++) {
      const cell = rowStr[c];
      // Transaction date (original purchase date)
      if ((cell === 'תאריך עסקה' || cell === 'תאריך') && colDate < 0) colDate = c;
      // Billing/charge date — critical for installments
      if (cell === 'תאריך חיוב' || cell === 'תאריך לחיוב') colBillingDate = c;
      // Merchant name
      if (cell === 'שם בית עסק' || cell === 'שם בית העסק' || cell === 'פירוט' || cell === 'תיאור עסקה') colName = c;
      // Transaction type (רגיל / תשלומים / קרדיט)
      if (cell === 'סוג עסקה' || cell === 'סוג') colType = c;
      // Monthly charge (what's actually billed this month)
      if (cell === 'סכום חיוב' || cell === 'סכום לחיוב' || cell === 'סכום לחיוב בש"ח') colChargeAmount = c;
      // Original transaction amount
      if (cell === 'סכום עסקה' || cell === 'סכום מקורי' || cell === 'סכום עסקה מקורי') colTxAmount = c;
    }

    if (colDate >= 0 && colName >= 0) {
      headerRowIndex = i;
      break;
    }
  }

  // If no header found, fall back to generic column positions
  if (headerRowIndex < 0) {
    colDate = 0; colName = 1;
    colTxAmount = 4; colChargeAmount = 5;
    for (let i = 0; i < rows.length; i++) {
      const cell = String(rows[i]?.[0] || '').trim();
      if (cell.match(/\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}/)) {
        headerRowIndex = i - 1;
        break;
      }
    }
  }

  // If header was found but charge-amount column wasn't matched by name,
  // assume it's immediately after the tx-amount column (standard Max layout).
  if (headerRowIndex >= 0 && colChargeAmount < 0 && colTxAmount >= 0) {
    colChargeAmount = colTxAmount + 1;
  }

  // Helper: parse a DD-MM-YYYY or DD/MM/YYYY date string → YYYY-MM-DD
  function parseMaxDate(cellVal) {
    const s = String(cellVal || '').trim();
    if (!s.match(/\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}/)) return null;
    const parts = s.split(/[\/\-\.]/);
    if (parts.length < 3) return null;
    let d = parts[0], m = parts[1], y = parts[2];
    if (y.length === 2) y = '20' + y;
    return `${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;
  }

  const startRow = headerRowIndex + 1;

  for (let i = startRow; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length < 2) continue;

    const purchaseDateStr = String(row[colDate] || '').trim();
    if (!purchaseDateStr.match(/\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}/)) continue;

    const purchaseDate = parseMaxDate(purchaseDateStr);
    if (!purchaseDate) continue;

    const description = String(row[colName] || '').trim();
    if (!description) continue;

    // ===== INSTALLMENT DETECTION =====
    // First scan all cells for "תשלום X מתוך Y" so we can use it in isInstallment
    let installmentCurrent = 0, installmentTotal = 0;
    for (const cell of row) {
      const cellStr = String(cell || '').trim();
      const match = cellStr.match(/תשלום\s+(\d+)\s+מתוך\s+(\d+)/);
      if (match) {
        installmentCurrent = parseInt(match[1]);
        installmentTotal   = parseInt(match[2]);
        break;
      }
    }
    const txType = colType >= 0 ? String(row[colType] || '').trim() : '';
    // Treat as installment if type column says so OR if we found תשלום X מתוך Y
    const isInstallment = txType.includes('תשלומים') || installmentTotal > 0;

    // ===== DATE: billing-date-minus-1-month for ALL Max transactions =====
    // תאריך חיוב = when the bank deducts the credit card bill (e.g. April 3).
    // The expense BELONGS to the previous month (March) — shift back by 1 month.
    // This applies to both installments AND regular transactions, so a Feb 27
    // purchase billed in April is correctly attributed to March, not February.
    let date = purchaseDate;
    let billingDateStr = null;
    if (colBillingDate >= 0) {
      billingDateStr = parseMaxDate(row[colBillingDate]);
    } else {
      // No billing date column — scan row for a second date-like cell
      for (let c = 0; c < row.length; c++) {
        if (c === colDate) continue;
        const cellStr = String(row[c] || '').trim();
        if (cellStr.match(/\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}/)) {
          const alt = parseMaxDate(cellStr);
          if (alt && alt !== purchaseDate) { billingDateStr = alt; break; }
        }
      }
    }
    if (billingDateStr) {
      // Shift 1 month back: April billing → March display
      const bd = new Date(billingDateStr + 'T12:00:00');
      bd.setMonth(bd.getMonth() - 1);
      date = bd.toISOString().split('T')[0];
    }

    // ===== AMOUNT: prefer monthly charge (סכום חיוב) over original amount =====
    let amount = 0;
    // Try סכום חיוב first (monthly installment or total for regular tx)
    if (colChargeAmount >= 0) {
      amount = parseFloat(String(row[colChargeAmount] || '').replace(/,/g, ''));
    }
    // Fallback: try סכום עסקה (total transaction amount)
    let txTotalAmount = NaN;
    if ((isNaN(amount) || amount === 0) && colTxAmount >= 0) {
      txTotalAmount = parseFloat(String(row[colTxAmount] || '').replace(/,/g, ''));
      amount = txTotalAmount;
    }
    // For installments: ensure we have the per-installment amount, not the total
    if (isInstallment && installmentTotal > 1 && !isNaN(amount) && amount > 0) {
      const chargeVal = colChargeAmount >= 0 ? parseFloat(String(row[colChargeAmount] || '').replace(/,/g, '')) : NaN;
      const totalVal  = colTxAmount >= 0     ? parseFloat(String(row[colTxAmount]    || '').replace(/,/g, '')) : NaN;
      if (!isNaN(chargeVal) && chargeVal > 0 && !isNaN(totalVal) && chargeVal < totalVal) {
        // chargeVal is clearly per-installment (e.g. 660 < 7920)
        amount = chargeVal;
      } else if (!isNaN(chargeVal) && chargeVal > 0 && isNaN(totalVal)) {
        // Only one amount column and it seems reasonable — trust it as-is
        amount = chargeVal;
      } else {
        // chargeVal === totalVal or only total available → divide by installment count
        amount = amount / installmentTotal;
      }
    }
    // Last resort: scan cols from right to left for first positive number
    // (right side avoids picking up installment counts / category codes)
    if (isNaN(amount) || amount === 0) {
      for (let c = row.length - 1; c >= 2; c--) {
        const cellStr = String(row[c] || '').trim();
        if (cellStr.includes('תשלום') || cellStr.includes('/') || cellStr.includes('-')) continue;
        const v = parseFloat(cellStr.replace(/,/g, ''));
        if (!isNaN(v) && v > 0 && v < 1000000) { amount = v; break; }
      }
    }

    if (isNaN(amount) || amount <= 0) continue;

    // Max = credit card = debit (money out)
    const id = `max_${date}_${description}_${amount}`.replace(/\s/g, '_');
    results.push({
      id,
      source: 'max',
      date,
      description,
      credit: 0,
      debit: Math.abs(amount),
      isFixed: false,
      isTransfer: false,
      installmentCurrent,
      installmentTotal
    });
  }

  return results;
}

// ===== SETTINGS =====
function renderSettings() {
  document.getElementById('setting-savings').value = state.settings.savingsTarget || '';
  document.getElementById('setting-salary-day').value = state.settings.salaryDay || '';
  const verEl = document.getElementById('app-version');
  if (verEl) verEl.textContent = 'גרסה: ' + APP_VERSION;
}

async function forceUpdate() {
  if ('serviceWorker' in navigator) {
    const regs = await navigator.serviceWorker.getRegistrations();
    for (const reg of regs) await reg.unregister();
  }
  if ('caches' in window) {
    const keys = await caches.keys();
    for (const k of keys) await caches.delete(k);
  }
  window.location.reload(true);
}

function saveSettings() {
  const savings = parseFloat(document.getElementById('setting-savings').value) || 0;
  const salaryDay = parseInt(document.getElementById('setting-salary-day').value) || 1;
  state.settings.savingsTarget = savings;
  state.settings.salaryDay = salaryDay;
  saveState();
  showToast('✓ הגדרות נשמרו');
}

function confirmClearData() {
  if (confirm('האם למחוק את כל הנתונים? פעולה זו אינה ניתנת לביטול.')) {
    state = defaultState();
    saveState();
    renderHome();
    showToast('הנתונים נמחקו');
  }
}

// ===== SAVINGS MODAL =====
function openSavingsEdit() {
  document.getElementById('savings-input').value = state.settings.savingsTarget || '';
  document.getElementById('savings-modal').classList.add('open');
}

function closeSavingsModal() {
  document.getElementById('savings-modal').classList.remove('open');
}

function saveSavingsTarget() {
  const val = parseFloat(document.getElementById('savings-input').value) || 0;
  state.settings.savingsTarget = val;
  saveState();
  closeSavingsModal();
  renderHome();
  showToast('✓ יעד חיסכון עודכן');
}

// Close modals on overlay click
document.querySelectorAll('.modal-overlay').forEach(overlay => {
  overlay.addEventListener('click', e => {
    if (e.target === overlay) {
      overlay.classList.remove('open');
    }
  });
});

// ===== iOS INSTALL BANNER =====
function showInstallHint() {
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const isStandalone = window.navigator.standalone;
  if (isIOS && !isStandalone) {
    document.getElementById('install-banner').style.display = 'block';
  }
}

// ===== SERVICE WORKER =====
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}

// ===== INIT =====
window.addEventListener('DOMContentLoaded', () => {
  showInstallHint();
  setupTxListDelegation();
  renderHome();
});
