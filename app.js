// ===== STATE =====
const DB_KEY = 'cashflow_v1';
let state = loadState();

function defaultState() {
  return {
    fixedItems: [],   // { id, type:'expense'|'income'|'transfer', name, amount, day, emoji, recurrence:'monthly'|'onetime'|'annual', paid:false }
    transactions: [], // { id, source:'leumi'|'max', date, description, debit, credit, isFixed:false }
    settings: { savingsTarget: 0, salaryDay: 1 }
  };
}

function loadState() {
  try {
    const s = localStorage.getItem(DB_KEY);
    if (s) {
      const parsed = JSON.parse(s);
      return { ...defaultState(), ...parsed };
    }
  } catch(e) {}
  return defaultState();
}

function saveState() {
  localStorage.setItem(DB_KEY, JSON.stringify(state));
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
function fmt(n) {
  return '₪' + Math.round(n).toLocaleString('he-IL');
}
function fmtDate(d) {
  if (!d) return '';
  if (typeof d === 'string') return d;
  const dt = new Date(d);
  if (isNaN(dt)) return d;
  return dt.toLocaleDateString('he-IL', { day:'numeric', month:'numeric', year:'2-digit' });
}

// ===== HOME =====
function renderHome() {
  const now = new Date();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const monthPct = Math.round((now.getDate() / daysInMonth) * 100);

  // Income from fixed items
  const totalIncome = state.fixedItems
    .filter(i => i.type === 'income')
    .reduce((s, i) => s + Number(i.amount), 0);

  // Fixed expenses
  const totalFixedExp = state.fixedItems
    .filter(i => i.type === 'expense')
    .reduce((s, i) => s + Number(i.amount), 0);

  // Transaction expenses (this month, debits only)
  const thisMonth = now.getMonth();
  const thisYear = now.getFullYear();
  const txDebit = state.transactions
    .filter(t => {
      const d = new Date(t.date);
      return d.getMonth() === thisMonth && d.getFullYear() === thisYear && t.debit > 0;
    })
    .reduce((s, t) => s + t.debit, 0);

  const totalExp = totalFixedExp + txDebit;
  const cashflow = totalIncome - totalExp - (state.settings.savingsTarget || 0);
  const expensePct = totalIncome > 0 ? Math.min(Math.round((totalExp / totalIncome) * 100), 100) : 0;

  // Update hero
  const cfEl = document.getElementById('home-cashflow');
  cfEl.textContent = fmt(cashflow);
  cfEl.className = 'hero-amount ' + (cashflow >= 0 ? 'positive' : 'negative');
  document.getElementById('home-income').textContent = fmt(totalIncome);
  document.getElementById('home-fixed-exp').textContent = fmt(totalFixedExp);
  document.getElementById('home-tx-exp').textContent = fmt(txDebit);

  // Progress
  document.getElementById('expense-pct').textContent = expensePct + '%';
  document.getElementById('expense-bar').style.width = expensePct + '%';
  document.getElementById('month-pct').textContent = monthPct + '%';
  document.getElementById('month-bar').style.width = monthPct + '%';

  // Savings
  document.getElementById('savings-amount').textContent = fmt(state.settings.savingsTarget || 0);

  // Upcoming fixed (unpaid, by day this month)
  const today = now.getDate();
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

  if (items.length === 0) {
    container.innerHTML = `
      <div class="empty-state" style="padding:40px 24px;">
        <div class="empty-icon">${fixedSegment === 'income' ? '💰' : fixedSegment === 'transfer' ? '🔄' : '📋'}</div>
        <h3>${fixedSegment === 'income' ? 'אין הכנסות קבועות' : fixedSegment === 'transfer' ? 'אין העברות' : 'אין הוצאות קבועות'}</h3>
        <p>לחצי על "+ הוסף" להוספה</p>
      </div>
    `;
    return;
  }

  const recLabel = { monthly: 'חודשי', onetime: 'חד פעמי', annual: 'שנתי' };

  container.innerHTML = `
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

function togglePaid(id) {
  const item = state.fixedItems.find(i => i.id === id);
  if (item) {
    item.paid = !item.paid;
    saveState();
    renderFixed();
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
  let txs = [...state.transactions];

  // Apply filter
  if (txFilter === 'leumi') txs = txs.filter(t => t.source === 'leumi');
  else if (txFilter === 'max') txs = txs.filter(t => t.source === 'max');
  else if (txFilter === 'credit') txs = txs.filter(t => t.credit > 0);
  else if (txFilter === 'debit') txs = txs.filter(t => t.debit > 0);
  else if (txFilter === 'fixed') txs = txs.filter(t => t.isFixed);
  else if (txFilter === 'onetime') txs = txs.filter(t => !t.isFixed);

  // Sort by date desc
  txs.sort((a, b) => new Date(b.date) - new Date(a.date));

  // Summary
  const totalCredit = state.transactions.reduce((s, t) => s + t.credit, 0);
  const totalDebit = state.transactions.reduce((s, t) => s + t.debit, 0);
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

  container.innerHTML = sortedKeys.map(key => {
    const g = groups[key];
    return `
      <div class="tx-month-header">${g.label}</div>
      ${g.items.map(t => {
        const isCredit = t.credit > 0;
        const sourceLabel = t.source === 'leumi' ? '🏦' : '💳';
        return `
          <div class="tx-item">
            <div class="tx-left">
              <div class="tx-icon ${isCredit ? 'credit' : 'debit'}">${isCredit ? '⬆️' : '⬇️'}</div>
              <div class="tx-details">
                <div class="tx-name">${t.description}</div>
                <div class="tx-date">${sourceLabel} ${fmtDate(t.date)}</div>
              </div>
            </div>
            <div class="tx-right">
              <div class="tx-amount ${isCredit ? 'credit' : 'debit'}">${isCredit ? '+' : '-'}${fmt(isCredit ? t.credit : t.debit)}</div>
              <span class="tx-type-badge ${t.isFixed ? 'fixed' : 'onetime'}" onclick="toggleTxFixed('${t.id}',this)" style="cursor:pointer;">
                ${t.isFixed ? 'קבוע' : 'חד פעמי'}
              </span>
            </div>
          </div>
        `;
      }).join('')}
    `;
  }).join('');
}

function toggleTxFixed(id, badge) {
  const tx = state.transactions.find(t => t.id === id);
  if (!tx) return;
  tx.isFixed = !tx.isFixed;
  badge.className = `tx-type-badge ${tx.isFixed ? 'fixed' : 'onetime'}`;
  badge.textContent = tx.isFixed ? 'קבוע' : 'חד פעמי';
  saveState();
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

    // Deduplicate by id
    const existingIds = new Set(state.transactions.map(t => t.id));
    const newTxs = parsed.filter(t => !existingIds.has(t.id));

    state.transactions.push(...newTxs);
    saveState();
    renderTransactions();
    showToast(`✓ נטענו ${parsed.length} עסקאות (${newTxs.length} חדשות)`);

  } catch (err) {
    console.error(err);
    showToast('שגיאה בקריאת הקובץ');
  }
}

// ===== LEUMI PARSER =====
// Bank Leumi Excel format:
// Typical columns: תאריך | תיאור | זכות | חובה | יתרה
// First rows are header/metadata, data starts when we find a date pattern
function parseLeumiRows(rows) {
  const results = [];
  let dataStarted = false;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length < 3) continue;

    // Detect data rows: first cell looks like a date (DD/MM/YYYY or YYYY-MM-DD)
    const firstCell = String(row[0] || '').trim();
    const dateMatch = firstCell.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})$/) ||
                      firstCell.match(/^(\d{4})-(\d{2})-(\d{2})$/);

    if (!dateMatch && !dataStarted) continue;
    if (!dateMatch) continue;

    dataStarted = true;

    // Parse date
    let date;
    if (firstCell.includes('-') && firstCell.length === 10 && firstCell[4] === '-') {
      date = firstCell; // already YYYY-MM-DD
    } else {
      const parts = firstCell.split(/[\/\-\.]/);
      if (parts.length === 3) {
        let y = parts[2];
        if (y.length === 2) y = '20' + y;
        if (parseInt(parts[0]) > 31) { // starts with year (YYYY/MM/DD)
          date = `${parts[0]}-${parts[1].padStart(2,'0')}-${parts[2].padStart(2,'0')}`;
        } else {
          // Leumi exports M/D/YYYY (e.g. 3/1/2026 = March 1st)
          const month = parts[0], day = parts[1];
          date = `${y}-${month.padStart(2,'0')}-${day.padStart(2,'0')}`;
        }
      } else {
        continue;
      }
    }

    // Detect format: does row[1] look like a date? (תאריך ערך column)
    // 7-col format: תאריך | תאריך ערך | תיאור | אסמכתא | חובה | זכות | יתרה
    // 5-col format: תאריך | תיאור | זכות | חובה | יתרה
    const secondCell = String(row[1] || '').trim();
    const hasValueDate = !!secondCell.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})$/);

    let descCol, debitCol, creditCol;
    if (hasValueDate) {
      descCol = 2; debitCol = 4; creditCol = 5;
    } else {
      descCol = 1; debitCol = 3; creditCol = 2;
    }

    const description = String(row[descCol] || '').trim();
    if (!description) continue;

    let credit = 0, debit = 0;
    const vCredit = parseFloat(String(row[creditCol] || '').replace(/,/g, ''));
    const vDebit  = parseFloat(String(row[debitCol]  || '').replace(/,/g, ''));
    if (!isNaN(vCredit) && vCredit > 0) credit = vCredit;
    if (!isNaN(vDebit)  && vDebit  > 0) debit  = vDebit;

    // Fallback: single numeric value in row
    if (credit === 0 && debit === 0) {
      for (let c = descCol + 1; c < row.length; c++) {
        const v = parseFloat(String(row[c] || '').replace(/,/g, ''));
        if (!isNaN(v) && v !== 0) {
          if (v > 0) credit = v; else debit = Math.abs(v);
          break;
        }
      }
    }

    if (credit === 0 && debit === 0) continue;

    const id = `leumi_${date}_${description}_${credit}_${debit}`.replace(/\s/g, '_');
    results.push({ id, source: 'leumi', date, description, credit, debit, isFixed: false });
  }

  return results;
}

// ===== MAX PARSER =====
// Max (מקס) Excel format:
// Columns (Hebrew): תאריך עסקה | שם בית עסק | סכום עסקה | סכום חיוב | מטבע | ארבע ספרות אחרונות
// All rows are debits (credit card charges)
function parseMaxRows(rows) {
  const results = [];
  let headerRowIndex = -1;
  let colDate = -1, colName = -1, colAmount = -1;

  // Find header row
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const row = rows[i];
    if (!row) continue;
    const rowStr = row.map(c => String(c || '').trim());

    // Look for key column names
    for (let c = 0; c < rowStr.length; c++) {
      const cell = rowStr[c];
      if (cell.includes('תאריך') && !cell.includes('חיוב')) colDate = c;
      if (cell.includes('שם בית עסק') || cell.includes('תיאור') || cell.includes('פירוט')) colName = c;
      if (cell.includes('סכום חיוב') || cell.includes('סכום עסקה')) colAmount = Math.max(colAmount, c);
    }

    if (colDate >= 0 && colName >= 0) {
      headerRowIndex = i;
      break;
    }
  }

  // If no header found, try generic approach
  if (headerRowIndex < 0) {
    colDate = 0; colName = 1; colAmount = 3; // Common Max format
    // Find first data row (has a date)
    for (let i = 0; i < rows.length; i++) {
      const cell = String(rows[i]?.[0] || '').trim();
      if (cell.match(/\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}/)) {
        headerRowIndex = i - 1;
        break;
      }
    }
  }

  const startRow = headerRowIndex + 1;

  for (let i = startRow; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length < 2) continue;

    const firstCell = String(row[colDate] || '').trim();
    if (!firstCell.match(/\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}/)) continue;

    // Parse date
    const parts = firstCell.split(/[\/\-\.]/);
    if (parts.length < 3) continue;
    let d = parts[0], m = parts[1], y = parts[2];
    if (y.length === 2) y = '20' + y;
    const date = `${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;

    const description = String(row[colName] || '').trim();
    if (!description) continue;

    // Amount - try colAmount, then scan for first number
    let amount = 0;
    const amountCell = String(row[colAmount] || '').replace(/,/g, '').trim();
    amount = parseFloat(amountCell);
    if (isNaN(amount) || amount === 0) {
      for (let c = 2; c < row.length; c++) {
        const v = parseFloat(String(row[c] || '').replace(/,/g, ''));
        if (!isNaN(v) && v > 0) { amount = v; break; }
      }
    }

    if (isNaN(amount) || amount <= 0) continue;

    // Max = credit card = debit (money out)
    const id = `max_${date}_${description}_${amount}`.replace(/\s/g, '_');
    results.push({ id, source: 'max', date, description, credit: 0, debit: Math.abs(amount), isFixed: false });
  }

  return results;
}

// ===== SETTINGS =====
function renderSettings() {
  document.getElementById('setting-savings').value = state.settings.savingsTarget || '';
  document.getElementById('setting-salary-day').value = state.settings.salaryDay || '';
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
  renderHome();
});
