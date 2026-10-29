// escapeHtml() — endi ../app.js'dan global (2026-09-09'da 15 xil fayldagi
// nusxa birlashtirildi).
async function loadReport() {
  const from = document.getElementById('filterFrom').value;
  const to = document.getElementById('filterTo').value;
  const qs = new URLSearchParams();
  if (from) qs.set('from', from);
  if (to) qs.set('to', to);
  const query = qs.toString() ? '?' + qs.toString() : '';

  try {
    const summary = await api(`/admin/reports/summary${query}`);
    document.getElementById('statRevenue').textContent = fmtMoney(summary.revenue);
    document.getElementById('statExpenses').textContent = fmtMoney(summary.expenses_total);
    document.getElementById('statNet').textContent = fmtMoney(summary.net);
    document.getElementById('statOrders').textContent = summary.orders_count;
    const unpaidBox = document.getElementById('reportUnpaid');
    if (unpaidBox) {
      if (summary.unpaid_count > 0) {
        unpaidBox.innerHTML = `
          <div class="unpaid-alert-title">⚠️ To'lov kutilmoqda: ${summary.unpaid_count} ta — ${fmtMoney(summary.unpaid_amount)}</div>
          <p class="unpaid-alert-sub">Tushumdan haqiqatan to'langani: <b>${fmtMoney(summary.paid_revenue)}</b>. Qolgani kassaga yuborilgan, lekin kassir hali to'lov turini kiritmagan.</p>`;
        unpaidBox.classList.remove('hidden');
      } else {
        unpaidBox.classList.add('hidden');
        unpaidBox.innerHTML = '';
      }
    }
    const manualBox = document.getElementById('reportManualCogsNote');
    if (manualBox) {
      if (summary.manual_bills_revenue > 0) {
        manualBox.innerHTML = `<p class="dim">ℹ️ Shu davrdagi qo'lda chek ("Hisoblash") summasi — <b>${fmtMoney(summary.manual_bills_revenue)}</b> — "Sof foyda"ga tan narxsiz (100% foyda sifatida) qo'shilgan, chunki qo'lda chek taomlari menyuga bog'lanmagan va haqiqiy tan narxi tizimga noma'lum. Agar bu cheklarda real ingredient xarajati bo'lgan taomlar bo'lsa, haqiqiy sof foyda ko'rsatilgandan biroz kamroq bo'ladi.</p>`;
        manualBox.classList.remove('hidden');
      } else {
        manualBox.classList.add('hidden');
        manualBox.innerHTML = '';
      }
    }
  } catch (err) {
    toast(err.message, 'error');
  }

  const box = document.getElementById('orderList');
  try {
    const qs2 = new URLSearchParams(qs);
    qs2.set('status', 'closed');
    const orders = await api(`/admin/reports/orders?${qs2.toString()}`);
    if (orders.length === 0) {
      box.innerHTML = '<p class="dim">Yopilgan buyurtma topilmadi.</p>';
      return;
    }
    box.innerHTML = orders.map((o) => `
      <div class="card card-row">
        <div>
          <div class="card-title">${escapeHtml(o.table_name)} — ${fmtMoney(o.total_amount)}</div>
          <div class="card-sub">${fmtDateTime(o.closed_at)} · ${escapeHtml(o.closed_by_name || '')}</div>
        </div>
        <button class="btn small" data-order-id="${o.id}">Chek</button>
      </div>
    `).join('');
    box.querySelectorAll('[data-order-id]').forEach((btn) => {
      btn.addEventListener('click', () => openReceiptByOrderId(Number(btn.dataset.orderId)));
    });
  } catch (err) {
    box.innerHTML = `<p class="dim">${escapeHtml(err.message)}</p>`;
  }
}

document.getElementById('filterBtn').addEventListener('click', loadReport);

document.addEventListener('DOMContentLoaded', () => {
  initLayout('reports');
  const today = todayStr();
  document.getElementById('filterFrom').value = today;
  document.getElementById('filterTo').value = today;
  loadReport();
});
