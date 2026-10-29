// Umumiy yordamchi funksiyalar — barcha sahifalarda ulanadi (public/landing/
// bundan mustaqin — login shart bo'lmagan mijoz sahifasi, o'zining alohida
// script.js'ini ishlatadi, app.js'ni ulamaydi).
//
// API_BASE: nisbiy yo'l ishlatiladi (mutlaq "/api/..." emas) — admin/ va
// waiter/ papkalaridagi sahifalar ildizdan bir bosqich pastda bo'lgani
// uchun ular <script src="../app.js" data-api-base="../"></script>
// orqali "../" prefiksini uzatadi; ildizdagi sahifalar (login.html)
// prefikssiz ("") ishlaydi. ESKATMA (2026-09-09'da tuzatildi): bu izohda
// ilgari "asosiy saytning /polat/ ostki yo'lida proksi qilingan holda ham
// ishlashi kerak" deyilgan edi — bu ESKIRGAN edi, o'sha proksi allaqachon
// olib tashlangan, polat endi mustaqil polatuz.duckdns.org subdomenida
// ishlaydi (root CLAUDE.md'ga qarang). Nisbiy yo'l yondashuvi baribir
// to'g'ri/kerakli (admin/waiter sahifalari ildizdan pastda joylashgani
// sababli), shu sabab kodning o'zi o'zgarishsiz qoldi — faqat izohdagi
// noto'g'ri sabab tuzatildi.
const API_BASE = (document.currentScript && document.currentScript.getAttribute('data-api-base')) || '';

// Barcha sahifalarda ishlatiladigan umumiy HTML-escape — ilgari 15 xil
// faylda (admin/waiter/chef/courier sahifalarining har birida) mustaqil,
// bayt-baytiga bir xil nusxada takrorlangan edi (2026-09-09'da shu yagona
// nusxaga birlashtirildi — har bir sahifa app.js'ni <script> orqali
// ulagani uchun bu funksiya global qilib qoladi, boshqa fayllar qayta
// e'lon qilishi shart emas). public/landing/script.js BUNDAN MUSTASNO —
// u app.js'ni ulamaydi (login shart emas mijoz sahifasi), shu sabab
// o'zining mustaqil nusxasini saqlab qoladi.
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function api(path, options = {}) {
  const opts = {
    method: options.method || 'GET',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
  };
  if (options.body !== undefined) opts.body = JSON.stringify(options.body);
  const res = await fetch(`${API_BASE}api${path}`, opts);
  if (res.status === 401) {
    window.location.href = `${API_BASE}login.html`;
    throw new Error('unauthorized');
  }
  let data = null;
  try { data = await res.json(); } catch (e) { /* body yo'q bo'lishi mumkin */ }
  if (!res.ok) {
    const message = (data && data.error) || `Xatolik (${res.status})`;
    throw new Error(message);
  }
  return data;
}

function fmtMoney(n) {
  const v = Math.round(Number(n) || 0);
  return v.toLocaleString('uz-UZ') + " so'm";
}

function fmtDateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('uz-UZ', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function todayStr() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

let toastTimer = null;
function toast(message, type = 'ok', durationMs = 3000) {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    document.body.appendChild(el);
  }
  el.className = `toast ${type === 'error' ? 'error' : ''}`;
  el.textContent = message;
  el.style.display = 'block';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.style.display = 'none'; }, durationMs);
}

// Brauzerning standart (ekranga mos kelmaydigan, "<sayt> says" ko'rinishidagi)
// window.confirm() o'rniga ilova dizayniga mos custom oyna — mavjud
// .modal-backdrop/.modal/.modal-actions CSS naqshidan (admin/tables.html va
// h.k.dagi qo'lda yozilgan modallar bilan bir xil) DOM'ga dinamik qo'shiladi,
// shuning uchun har bir HTML sahifaga alohida qo'shish shart emas.
// Promise qaytaradi: OK bosilsa true, Bekor/orqa fon bosilsa false.
function ensureConfirmModal() {
  let el = document.getElementById('customConfirmModal');
  if (!el) {
    el = document.createElement('div');
    el.id = 'customConfirmModal';
    el.className = 'modal-backdrop hidden';
    el.innerHTML = `
      <div class="modal">
        <h2>Tasdiqlash</h2>
        <p id="customConfirmMsg" class="dim"></p>
        <div class="modal-actions">
          <button class="btn" id="customConfirmCancel">Bekor</button>
          <button class="btn primary" id="customConfirmOk">OK</button>
        </div>
      </div>
    `;
    document.body.appendChild(el);
  }
  return el;
}

function customConfirm(message) {
  return new Promise((resolve) => {
    const el = ensureConfirmModal();
    el.querySelector('#customConfirmMsg').textContent = message;
    el.classList.remove('hidden');
    const okBtn = el.querySelector('#customConfirmOk');
    const cancelBtn = el.querySelector('#customConfirmCancel');
    const finish = (result) => {
      el.classList.add('hidden');
      okBtn.removeEventListener('click', onOk);
      cancelBtn.removeEventListener('click', onCancel);
      el.removeEventListener('click', onBackdrop);
      resolve(result);
    };
    const onOk = () => finish(true);
    const onCancel = () => finish(false);
    const onBackdrop = (e) => { if (e.target === el) finish(false); };
    okBtn.addEventListener('click', onOk);
    cancelBtn.addEventListener('click', onCancel);
    el.addEventListener('click', onBackdrop);
  });
}

// Bitta tugmali ("Yopish") umumiy ma'lumot oynasi — customConfirm bilan bir xil
// .modal-backdrop naqshidan foydalanadi. Afitsiant menyusida taom ustiga
// (+ tugmasi emas) bosilganda shu taom haqidagi tavsifni ko'rsatish uchun
// ishlatiladi (public/waiter/order.js, showItemInfo()).
function ensureInfoModal() {
  let el = document.getElementById('customInfoModal');
  if (!el) {
    el = document.createElement('div');
    el.id = 'customInfoModal';
    el.className = 'modal-backdrop hidden';
    el.innerHTML = `
      <div class="modal">
        <h2 id="customInfoTitle"></h2>
        <p id="customInfoBody" class="dim" style="white-space:pre-wrap;"></p>
        <div class="modal-actions">
          <button class="btn primary" id="customInfoClose">Yopish</button>
        </div>
      </div>
    `;
    document.body.appendChild(el);
  }
  return el;
}

function showInfoModal(title, body) {
  const el = ensureInfoModal();
  el.querySelector('#customInfoTitle').textContent = title;
  el.querySelector('#customInfoBody').textContent = body;
  el.classList.remove('hidden');
  const closeBtn = el.querySelector('#customInfoClose');
  const finish = () => {
    el.classList.add('hidden');
    closeBtn.removeEventListener('click', finish);
    el.removeEventListener('click', onBackdrop);
  };
  const onBackdrop = (e) => { if (e.target === el) finish(); };
  closeBtn.addEventListener('click', finish);
  el.addEventListener('click', onBackdrop);
}


function initNav(activePage) {
  const nav = document.getElementById('bottomNav');
  if (!nav) return;
  nav.querySelectorAll('a').forEach((a) => {
    if (a.dataset.page === activePage) a.classList.add('active');
  });
  initNavToggle(nav);
}

// Sidebar rejimida (>=720px, style.css'dagi shu breakpointdagi .bottom-nav
// qoidalariga qarang) menyu standart holatda yopiq turadi — topbar'dagi
// "☰ Menyu" tugmasi bosilsa ochiladi, bo'lim tugmasi yoki orqa fon (backdrop)
// bosilsa yopiladi. Mobil pastki tab-bar rejimida (720px'dan kichik) tugma
// CSS orqali yashirin, shuning uchun bu yerdagi ochish/yopish hech narsaga
// ta'sir qilmaydi. Tugma/backdrop har sahifada bir marta, dinamik yaratiladi
// (ensureNotifList() bilan bir xil naqsh) — 9 ta admin HTML faylini alohida
// tahrirlamaslik uchun.
function initNavToggle(nav) {
  let backdrop = document.getElementById('navBackdrop');
  if (!backdrop) {
    backdrop = document.createElement('div');
    backdrop.id = 'navBackdrop';
    backdrop.className = 'nav-backdrop';
    document.body.appendChild(backdrop);
  }
  const close = () => {
    nav.classList.remove('open');
    backdrop.classList.remove('open');
  };
  const topbar = document.querySelector('.topbar');
  if (topbar && !document.getElementById('navToggleBtn')) {
    const btn = document.createElement('button');
    btn.id = 'navToggleBtn';
    btn.className = 'nav-toggle-btn';
    btn.type = 'button';
    btn.setAttribute('aria-label', 'Menyu');
    btn.textContent = '☰ Menyu';
    topbar.insertBefore(btn, topbar.firstChild);
    btn.addEventListener('click', () => {
      nav.classList.toggle('open');
      backdrop.classList.toggle('open');
    });
  }
  backdrop.addEventListener('click', close);
  nav.querySelectorAll('a').forEach((a) => a.addEventListener('click', close));
}

function initLogout() {
  // `#logoutBtn` — eski, yagona tugma (statik HTML, sahifa yuklanganda bor).
  // `.js-logout` — admin desktop yon menyusidagi qo'shimcha "Chiqish" tugmasi,
  // `layout.js`dagi `initLayout()` orqali DINAMIK yaratiladi, ko'pincha shu
  // funksiya ishga tushgandan KEYIN — shu sabab oddiy querySelectorAll+addEventListener
  // uni hali topa olmay, bosilganda hech narsa qilmay qolardi. Delegatsiya
  // (document darajasida bitta tinglovchi) bu muammoni butunlay yo'q qiladi —
  // tugma qachon yaratilishidan qat'iy nazar ishlaydi.
  document.addEventListener('click', async (e) => {
    const btn = e.target.closest('#logoutBtn, .js-logout');
    if (!btn) return;
    try { await api('/logout', { method: 'POST' }); } catch (e2) { /* baribir yo'naltiramiz */ }
    // login.html emas — mijozlar uchun ochiq landing sahifasiga qaytariladi
    // (xodim sifatida qayta kirish landing header'idagi "Xodim kirishi" orqali).
    window.location.href = `${API_BASE}landing/`;
  });
}

// 2026-10-24: chop etish (app-print.js) va bildirishnoma (app-notify.js)
// qismlari alohida faylga ajratildi. `typeof` tekshiruvi — agar biror sahifa
// ularni ulamasa ham, app.js xato bermasin.
document.addEventListener('DOMContentLoaded', () => {
  initLogout();
  if (typeof initWaiterNotifications === 'function') initWaiterNotifications();
  if (typeof initAdminPrintRequests === 'function') initAdminPrintRequests();
  if (typeof initDeliveryAlerts === 'function') initDeliveryAlerts();
  if (typeof initChefKitchenTicketPrinting === 'function') initChefKitchenTicketPrinting();
});
