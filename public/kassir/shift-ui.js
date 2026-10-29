// Kassir smenasi (ochish/yopish, naqd farqi) + to'lov turi tanlash — barcha
// kassir sahifalarida (tables.html/order.html/manual.html) umumiy, "Moliya
// va kassa" auditi (2026-10-10). ../app.js'dagi customConfirm/showInfoModal
// bilan bir xil .modal-backdrop/.modal naqshidan foydalanadi (dinamik DOM,
// HTML fayllarga qo'lda markup qo'shish shart emas).

let currentShiftCache = null;

async function loadCurrentShift() {
  try {
    currentShiftCache = await api('/kassir/shifts/current');
  } catch (e) {
    currentShiftCache = null;
  }
  renderShiftBanner();
}

function ensureShiftBanner() {
  let el = document.getElementById('shiftBanner');
  if (!el) {
    el = document.createElement('div');
    el.id = 'shiftBanner';
    el.className = 'shift-banner';
    const topbar = document.querySelector('.topbar');
    if (topbar) topbar.insertAdjacentElement('afterend', el);
    else document.body.insertBefore(el, document.body.firstChild);
  }
  return el;
}

function renderShiftBanner() {
  const el = ensureShiftBanner();
  if (currentShiftCache) {
    el.innerHTML = `
      <span>🟢 Smena ochiq — boshlang'ich ${fmtMoney(currentShiftCache.opening_cash)}</span>
      <button class="btn small" id="shiftActionBtn">Smenani yopish</button>
    `;
    el.querySelector('#shiftActionBtn').addEventListener('click', openCloseShiftModal);
  } else {
    el.innerHTML = `
      <span>⚪ Smena yopiq</span>
      <button class="btn small" id="shiftActionBtn">Smena ochish</button>
    `;
    el.querySelector('#shiftActionBtn').addEventListener('click', openOpenShiftModal);
  }
}

function ensureShiftModal() {
  let el = document.getElementById('shiftModal');
  if (!el) {
    el = document.createElement('div');
    el.id = 'shiftModal';
    el.className = 'modal-backdrop hidden';
    document.body.appendChild(el);
    el.addEventListener('click', (e) => { if (e.target === el) el.classList.add('hidden'); });
  }
  return el;
}

function openOpenShiftModal() {
  const el = ensureShiftModal();
  el.innerHTML = `
    <div class="modal">
      <h2>Smena ochish</h2>
      <div class="field">
        <label>Kassadagi boshlang'ich naqd summa (so'm)</label>
        <input type="number" id="shiftOpeningCash" min="0" step="1000" value="0" inputmode="numeric">
      </div>
      <div class="modal-actions">
        <button class="btn" id="shiftOpenCancel">Bekor</button>
        <button class="btn primary" id="shiftOpenConfirm">Ochish</button>
      </div>
    </div>
  `;
  el.classList.remove('hidden');
  el.querySelector('#shiftOpenCancel').addEventListener('click', () => el.classList.add('hidden'));
  el.querySelector('#shiftOpenConfirm').addEventListener('click', async () => {
    const opening_cash = Number(document.getElementById('shiftOpeningCash').value);
    try {
      await api('/kassir/shifts/open', { method: 'POST', body: { opening_cash } });
      el.classList.add('hidden');
      toast('Smena ochildi');
      loadCurrentShift();
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}

function openCloseShiftModal() {
  if (!currentShiftCache) return;
  const el = ensureShiftModal();
  el.innerHTML = `
    <div class="modal">
      <h2>Smenani yopish</h2>
      <div class="shift-unpaid-warn hidden" id="shiftUnpaidWarn" role="alert"></div>
      <p class="dim">Kassadagi naqd pulni sanab, shu yerga kiriting. Yopgandan keyin kutilgan summa bilan solishtirilgan farq ko'rsatiladi.</p>
      <div class="field">
        <label>Haqiqiy naqd summa (so'm)</label>
        <input type="number" id="shiftActualCash" min="0" step="1000" inputmode="numeric">
      </div>
      <div class="modal-actions">
        <button class="btn" id="shiftCloseCancel">Bekor</button>
        <button class="btn primary" id="shiftCloseConfirm">Yopish</button>
      </div>
    </div>
  `;
  el.classList.remove('hidden');
  // 2026-10-24, "Moliyaviy aniqlik": to'lanmagan (kassada kutayotgan) hisob
  // bo'lsa ogohlantiramiz — ular shu smenaning kutilgan naqd summasiga
  // kirmaydi. Yopishni TAQIQLAMAYDI, faqat eslatadi.
  api('/kassir/pending-bills').then((bills) => {
    const warn = document.getElementById('shiftUnpaidWarn');
    if (!warn || !Array.isArray(bills) || bills.length === 0) return;
    const sum = bills.reduce((s, b) => s + (Number(b.total) || 0), 0);
    warn.textContent = `⚠️ Kassada ${bills.length} ta to'lanmagan hisob bor (${fmtMoney(sum)}). Ular bu smena hisobiga kirmaydi — avval ularni to'lab oling.`;
    warn.classList.remove('hidden');
  }).catch(() => {});
  el.querySelector('#shiftCloseCancel').addEventListener('click', () => el.classList.add('hidden'));
  el.querySelector('#shiftCloseConfirm').addEventListener('click', async () => {
    const actual_cash = Number(document.getElementById('shiftActualCash').value);
    if (!Number.isFinite(actual_cash) || actual_cash < 0) return toast("Summani to'g'ri kiriting", 'error');
    try {
      const result = await api(`/kassir/shifts/${currentShiftCache.id}/close`, { method: 'POST', body: { actual_cash } });
      el.classList.add('hidden');
      const diffText = result.variance === 0
        ? "Farq yo'q ✅"
        : result.variance > 0
          ? `Ortiqcha: ${fmtMoney(result.variance)}`
          : `Kamomad: ${fmtMoney(-result.variance)}`;
      await showInfoModal('Smena yopildi', `Kutilgan naqd: ${fmtMoney(result.expected_cash)}\nHaqiqiy naqd: ${fmtMoney(result.actual_cash)}\n${diffText}`);
      loadCurrentShift();
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}

// To'lov turi so'raydi — {payment_method, cash_amount, card_amount} yoki
// `null` (bekor qilindi) bilan to'ladigan Promise qaytaradi. Stol yopish
// (kassir/order.js) va qo'lda chek (kassir/manual.js) ikkalasi ham ishlatadi.
function askPaymentInfo(total) {
  return new Promise((resolve) => {
    const el = ensureShiftModal();
    const finish = (value) => { el.classList.add('hidden'); resolve(value); };
    el.innerHTML = `
      <div class="modal">
        <h2>To'lov turi</h2>
        <p class="dim">Jami: ${fmtMoney(total)}</p>
        <div class="modal-actions" style="flex-wrap:wrap;">
          <button class="btn" data-pay="cash">💵 Naqd</button>
          <button class="btn" data-pay="card">💳 Karta</button>
          <button class="btn" data-pay="mixed">➗ Aralash</button>
        </div>
        <div id="mixedFields" class="hidden" style="margin-top:12px;">
          <div class="field"><label>Naqd qismi (so'm)</label><input type="number" id="payCash" min="0" step="1000" inputmode="numeric"></div>
          <div class="field"><label>Karta qismi (so'm)</label><input type="number" id="payCard" min="0" step="1000" inputmode="numeric"></div>
          <button class="btn primary" id="payConfirmMixed" style="width:100%;margin-top:4px;">Tasdiqlash</button>
        </div>
        <div class="modal-actions" style="margin-top:12px;">
          <button class="btn" id="payCancel">Bekor</button>
        </div>
      </div>
    `;
    el.classList.remove('hidden');
    el.querySelectorAll('[data-pay]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const method = btn.dataset.pay;
        if (method === 'mixed') {
          document.getElementById('mixedFields').classList.remove('hidden');
          const cashInput = document.getElementById('payCash');
          const cardInput = document.getElementById('payCard');
          cashInput.addEventListener('input', () => {
            cardInput.value = Math.max(0, total - Number(cashInput.value || 0));
          });
          cardInput.addEventListener('input', () => {
            cashInput.value = Math.max(0, total - Number(cardInput.value || 0));
          });
          return;
        }
        finish({
          payment_method: method,
          cash_amount: method === 'cash' ? total : 0,
          card_amount: method === 'card' ? total : 0,
        });
      });
    });
    el.querySelector('#payCancel').addEventListener('click', () => finish(null));
    el.querySelector('#payConfirmMixed').addEventListener('click', () => {
      const cash_amount = Number(document.getElementById('payCash').value);
      const card_amount = Number(document.getElementById('payCard').value);
      finish({ payment_method: 'mixed', cash_amount, card_amount });
    });
  });
}

document.addEventListener('DOMContentLoaded', loadCurrentShift);
