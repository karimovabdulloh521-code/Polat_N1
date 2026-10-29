// escapeHtml() — endi ../app.js'dan global (2026-09-09'da 15 xil fayldagi
// nusxa birlashtirildi).
async function loadExpenses() {
  const box = document.getElementById('expenseList');
  const from = document.getElementById('filterFrom').value;
  const to = document.getElementById('filterTo').value;
  const qs = new URLSearchParams();
  if (from) qs.set('from', from);
  if (to) qs.set('to', to);
  try {
    const rows = await api(`/admin/expenses${qs.toString() ? '?' + qs.toString() : ''}`);
    if (rows.length === 0) {
      box.innerHTML = '<p class="dim">Xarajat topilmadi.</p>';
      return;
    }
    const total = rows.reduce((s, r) => s + r.amount, 0);
    box.innerHTML = `
      <div class="total-chip mt-16">Jami: ${fmtMoney(total)}</div>
    ` + rows.map((r) => `
      <div class="card card-row">
        <div>
          <div class="card-title">${fmtMoney(r.amount)} ${r.category ? `<span class="badge badge-gold">${escapeHtml(r.category)}</span>` : ''}</div>
          <div class="card-sub">${escapeHtml(r.expense_date)} ${r.note ? '· ' + escapeHtml(r.note) : ''}</div>
        </div>
        <button class="btn small danger" data-del="${r.id}">O'chirish</button>
      </div>
    `).join('');
    box.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => delExpense(Number(b.dataset.del))));
  } catch (err) {
    box.innerHTML = `<p class="dim">${escapeHtml(err.message)}</p>`;
  }
}

document.getElementById('addBtn').addEventListener('click', async () => {
  const amount = Number(document.getElementById('fAmount').value);
  const expense_date = document.getElementById('fDate').value || todayStr();
  const category = document.getElementById('fCategory').value.trim();
  const note = document.getElementById('fNote').value.trim();
  if (!Number.isFinite(amount) || amount <= 0) return toast("Summani to'g'ri kiriting", 'error');
  try {
    await api('/admin/expenses', { method: 'POST', body: { amount, expense_date, category, note } });
    document.getElementById('fAmount').value = '';
    document.getElementById('fCategory').value = '';
    document.getElementById('fNote').value = '';
    toast("Qo'shildi");
    loadExpenses();
  } catch (err) {
    toast(err.message, 'error');
  }
});

document.getElementById('filterBtn').addEventListener('click', loadExpenses);

async function delExpense(id) {
  if (!confirm("Xarajatni o'chirasizmi?")) return;
  try {
    await api(`/admin/expenses/${id}`, { method: 'DELETE' });
    toast("O'chirildi");
    loadExpenses();
  } catch (err) {
    toast(err.message, 'error');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  initLayout('expenses');
  document.getElementById('fDate').value = todayStr();
  loadExpenses();
});
