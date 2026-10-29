// Admin "Audit" sahifasi — faqat o'qish. "Audit izi" auditi (2026-10-10).
// escapeHtml()/fmtMoney()/fmtDateTime() — ../app.js'dan global.

function renderCancelList(rows) {
  const box = document.getElementById('cancelList');
  if (rows.length === 0) {
    box.innerHTML = '<p class="dim">Oxirgi 30 kunda bekor qilingan taom yo\'q.</p>';
    return;
  }
  box.innerHTML = rows.map((r) => `
    <div class="card card-row">
      <div class="card-title">${escapeHtml(r.employee_name || "Noma'lum")}</div>
      <div class="text-right">${r.cancelled_count} ta · ${fmtMoney(r.cancelled_amount)}</div>
    </div>
  `).join('');
}

function renderManualList(rows) {
  const box = document.getElementById('manualList');
  if (rows.length === 0) {
    box.innerHTML = '<p class="dim">Oxirgi 30 kunda qo\'lda chek yo\'q.</p>';
    return;
  }
  box.innerHTML = rows.map((r) => `
    <div class="card card-row">
      <div class="card-title">${escapeHtml(r.employee_name)}</div>
      <div class="text-right">${r.bill_count} ta · ${fmtMoney(r.bill_amount)}</div>
    </div>
  `).join('');
}

function renderLoginList(rows) {
  const box = document.getElementById('loginList');
  if (rows.length === 0) {
    box.innerHTML = '<p class="dim">Oxirgi 30 kunda muvaffaqiyatsiz urinish yo\'q.</p>';
    return;
  }
  box.innerHTML = rows.map((r) => `
    <div class="card card-row">
      <div>
        <div class="card-title">${escapeHtml(r.username)}</div>
        <div class="card-sub">Oxirgi urinish: ${fmtDateTime(r.last_attempt)}</div>
      </div>
      <div class="text-right badge badge-dim">${r.attempt_count} marta</div>
    </div>
  `).join('');
}

const AUDIT_ACTION_LABELS = {
  'menu_item.price_change': "Taom narxi o'zgardi",
  'user.role_change': "Xodim roli o'zgardi",
  'user.active_change': 'Xodim faollik holati',
  'user.create': 'Yangi xodim yaratildi',
  'user.deactivate': 'Xodim faolsizlantirildi',
  'user.delete': "Xodim o'chirildi",
};

function formatAuditValue(raw) {
  if (!raw) return '';
  try {
    const obj = JSON.parse(raw);
    return Object.entries(obj).map(([k, v]) => `${k}: ${v}`).join(', ');
  } catch (e) {
    return escapeHtml(raw);
  }
}

function renderAuditLogList(rows) {
  const box = document.getElementById('auditLogList');
  if (rows.length === 0) {
    box.innerHTML = '<p class="dim">Hali hech qanday yozuv yo\'q.</p>';
    return;
  }
  box.innerHTML = rows.map((r) => {
    const label = AUDIT_ACTION_LABELS[r.action] || r.action;
    const oldTxt = formatAuditValue(r.old_value);
    const newTxt = formatAuditValue(r.new_value);
    const diff = oldTxt ? `${escapeHtml(oldTxt)} → ${escapeHtml(newTxt)}` : escapeHtml(newTxt);
    return `
    <div class="card card-row">
      <div>
        <div class="card-title">${escapeHtml(label)}</div>
        <div class="card-sub">${diff}</div>
        <div class="card-sub">${fmtDateTime(r.created_at)} · ${escapeHtml(r.performed_by_name || "Noma'lum")}</div>
      </div>
    </div>
  `;
  }).join('');
}

async function loadAudit() {
  try {
    const data = await api('/admin/audit/summary');
    renderCancelList(data.cancellations);
    renderManualList(data.manualBills);
    renderLoginList(data.failedLogins);
    renderAuditLogList(data.auditLog);
  } catch (err) {
    toast(err.message, 'error');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  initLayout('audit');
  loadAudit();
});
