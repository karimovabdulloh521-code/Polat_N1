// Kassir "Statistika" ekrani — 2026-09-09'da qo'shildi. Ikkala yopilgan-hisob
// manbasini (dine-in stol hisob-kitobi + qo'lda "Hisoblash" cheki) birlashtirib
// ko'rsatadigan server/routes/kassirBilling.js'dagi GET /kassir/bills'dan
// o'qiydi. Har bir qatorga bosilsa, o'sha chek qayta ochiladi (showReceiptModal
// — ../app.js'dan global, "Chekni chop etish" tugmasi bilan qayta ham chop
// etish mumkin). escapeHtml()/fmtMoney()/fmtDateTime()/todayStr() — ../app.js'dan.
const KIND_ICON = { table: '🪑', manual: '🧮' };

async function openBillReceipt(kind, id) {
  try {
    const view = kind === 'manual'
      ? await api(`/kassir/manual-bills/${id}/receipt`)
      : await api(`/kassir/orders/${id}/receipt`);
    showReceiptModal(view);
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function loadBills() {
  const box = document.getElementById('billList');
  const from = document.getElementById('filterFrom').value;
  const to = document.getElementById('filterTo').value;
  const qs = new URLSearchParams();
  if (from) qs.set('from', from);
  if (to) qs.set('to', to);
  try {
    const data = await api(`/kassir/bills${qs.toString() ? '?' + qs.toString() : ''}`);
    document.getElementById('statCount').textContent = String(data.count);
    document.getElementById('statTotal').textContent = fmtMoney(data.total_amount);

    if (data.bills.length === 0) {
      box.innerHTML = '<p class="dim">Bu oraliqda yopilgan hisob topilmadi.</p>';
      return;
    }
    box.innerHTML = data.bills.map((b) => `
      <div class="card card-row" data-kind="${b.kind}" data-id="${b.id}" style="cursor:pointer;">
        <div>
          <div class="card-title">${KIND_ICON[b.kind] || ''} ${escapeHtml(b.label)}</div>
          <div class="card-sub">${fmtDateTime(b.at)}${b.by_name ? ' · ' + escapeHtml(b.by_name) : ''}${b.phone ? ' · 📞 ' + escapeHtml(b.phone) : ''}</div>
          ${b.reason ? `<div class="card-sub">📝 ${escapeHtml(b.reason)}</div>` : ''}
        </div>
        <div class="card-title">${fmtMoney(b.total_amount)}</div>
      </div>
    `).join('');
    box.querySelectorAll('[data-kind]').forEach((row) => {
      row.addEventListener('click', () => openBillReceipt(row.dataset.kind, Number(row.dataset.id)));
    });
  } catch (err) {
    box.innerHTML = `<p class="dim">${escapeHtml(err.message)}</p>`;
  }
}

document.getElementById('filterBtn').addEventListener('click', loadBills);

document.addEventListener('DOMContentLoaded', () => {
  initNav('stats');
  const today = todayStr();
  document.getElementById('filterFrom').value = today;
  document.getElementById('filterTo').value = today;
  loadBills();
});
