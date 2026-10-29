// Admin "Kassa smenalari" — faqat o'qish, "Moliya va kassa" auditi
// (2026-10-10). escapeHtml()/fmtMoney()/fmtDateTime() — ../app.js'dan global.
function renderShifts(shifts) {
  const box = document.getElementById('shiftList');
  if (shifts.length === 0) {
    box.innerHTML = '<p class="dim">Hali hech qanday smena ochilmagan.</p>';
    return;
  }
  box.innerHTML = shifts.map((s) => {
    const isOpen = s.status === 'open';
    let varianceHtml = '<span class="dim">—</span>';
    if (!isOpen && s.variance !== null) {
      if (s.variance === 0) varianceHtml = '<span class="badge badge-green">Farq yo\'q</span>';
      else if (s.variance > 0) varianceHtml = `<span class="badge badge-green">Ortiqcha ${fmtMoney(s.variance)}</span>`;
      else varianceHtml = `<span class="badge badge-dim" style="color:#c0392b;">Kamomad ${fmtMoney(-s.variance)}</span>`;
    }
    return `
    <div class="card">
      <div class="card-row">
        <div>
          <div class="card-title">${escapeHtml(s.opened_by_name)} <span class="badge badge-${isOpen ? 'gold' : 'dim'}">${isOpen ? 'Ochiq' : 'Yopilgan'}</span></div>
          <div class="card-sub">Ochilgan: ${fmtDateTime(s.opened_at)} · Boshlang'ich: ${fmtMoney(s.opening_cash)}</div>
          ${!isOpen ? `<div class="card-sub">Yopilgan: ${fmtDateTime(s.closed_at)} (${escapeHtml(s.closed_by_name || '')})</div>` : ''}
          ${!isOpen ? `<div class="card-sub">Kutilgan: ${fmtMoney(s.expected_cash)} · Haqiqiy: ${fmtMoney(s.actual_cash)}</div>` : ''}
        </div>
        <div class="card-title text-right">${varianceHtml}</div>
      </div>
    </div>
  `;
  }).join('');
}

async function loadShifts() {
  const box = document.getElementById('shiftList');
  try {
    const shifts = await api('/admin/cash-shifts');
    renderShifts(shifts);
  } catch (err) {
    box.innerHTML = `<p class="dim">${escapeHtml(err.message)}</p>`;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  initLayout('cash-shifts');
  loadShifts();
});
