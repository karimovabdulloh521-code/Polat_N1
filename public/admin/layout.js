// Admin panel uchun YAGONA navigatsiya manbasi — 2026-10-03 (desktop qo'shilishi
// bilan qayta qurildi, avvalgi shell.js o'rnida). Har bir admin HTML fayli endi
// nav/sidebar/sheet markupini o'zida saqlamaydi — initLayout(activePage) ularni
// DOM'ga dinamik qo'shadi:
//   - Mobil (<1024px): pastki 5-tugmali nav + "Ko'proq" paneli (ESKI ko'rinish
//     bilan bir xil — 4 asosiy bo'lim + qolgan 5 bo'lim panelda).
//   - Desktop (>=1024px, theme.css shu kenglikda mobil nav'ni yashiradi): 240px
//     qotirilgan yon menyu, barcha 9 bo'lim to'g'ridan-to'g'ri ko'rinadi.
// Ikkalasi ham BITTA ro'yxatdan (NAV_ITEMS) o'qiydi — bo'lim qo'shilsa/o'zgarsa
// faqat shu yerda tahrirlanadi, 9 ta HTML fayl qo'lda yangilanmaydi.

const UZ_DAYS_SHELL = ['Yakshanba', 'Dushanba', 'Seshanba', 'Chorshanba', 'Payshanba', 'Juma', 'Shanba'];
const UZ_MONTHS_SHELL = ['yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun', 'iyul', 'avgust', 'sentyabr', 'oktabr', 'noyabr', 'dekabr'];

const NAV_ITEMS = [
  { key: 'index', href: 'index.html', label: 'Bosh sahifa', icon: '<path d="M4 11.5L12 4l8 7.5"/><path d="M6 10v9a1 1 0 0 0 1 1h3v-6h4v6h3a1 1 0 0 0 1-1v-9"/>' },
  { key: 'menu', href: 'menu.html', label: 'Menyu', icon: '<path d="M5 3v18"/><path d="M5 3c-1.2 1.6-1.2 4.4 0 6"/><path d="M19 3v18"/><path d="M19 10V3"/><path d="M15 3v7a2 2 0 0 0 2 2 2 2 0 0 0 2-2V3"/>' },
  { key: 'tables', href: 'tables.html', label: 'Stollar', icon: '<rect x="3" y="8" width="18" height="4" rx="1.2"/><path d="M5 12v7"/><path d="M19 12v7"/>' },
  { key: 'waiters', href: 'waiters.html', label: 'Xodimlar', icon: '<circle cx="9" cy="8" r="3.2"/><path d="M2.5 19c0-3.3 2.9-5.5 6.5-5.5s6.5 2.2 6.5 5.5"/><path d="M16.5 7.3a3 3 0 1 1 0 5.9"/><path d="M21.5 19c0-2.6-1.9-4.6-4.5-5.3"/>' },
  { key: 'expenses', href: 'expenses.html', label: 'Xarajat', icon: '<rect x="3" y="6" width="18" height="13" rx="2.5"/><path d="M3 10h18"/><circle cx="16.5" cy="14.2" r="1.1" fill="currentColor" stroke="none"/>' },
  { key: 'reservations', href: 'reservations.html', label: 'Bronlar', icon: '<rect x="3" y="5" width="18" height="16" rx="2.5"/><path d="M3 10h18"/><path d="M8 3v4"/><path d="M16 3v4"/>' },
  { key: 'customer-orders', href: 'customer-orders.html', label: 'Buyurtmalar', icon: '<path d="M3 5h2l1.6 10.2a2 2 0 0 0 2 1.8h8.1a2 2 0 0 0 2-1.6L20 9H6"/><circle cx="9" cy="20" r="1.3"/><circle cx="17" cy="20" r="1.3"/>' },
  { key: 'inventory', href: 'inventory.html', label: 'Ombor', icon: '<path d="M3.5 7.5L12 3l8.5 4.5V16.5L12 21l-8.5-4.5z"/><path d="M3.5 7.5L12 12l8.5-4.5"/><path d="M12 12v9"/>' },
  { key: 'reports', href: 'reports.html', label: 'Hisobot', icon: '<path d="M4 20V10"/><path d="M12 20V4"/><path d="M20 20v-7"/><path d="M3 20h18"/>' },
  { key: 'cash-shifts', href: 'cash-shifts.html', label: 'Kassa smenalari', icon: '<rect x="2" y="6" width="20" height="13" rx="2.5"/><circle cx="12" cy="12.5" r="3"/><path d="M6 6V4.5A1.5 1.5 0 0 1 7.5 3h9A1.5 1.5 0 0 1 18 4.5V6"/>' },
  { key: 'audit', href: 'audit.html', label: 'Audit', icon: '<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>' },
  { key: 'delivery-zone', href: 'delivery-zone.html', label: 'Yetkazish hududi', icon: '<circle cx="12" cy="10" r="3"/><path d="M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11z"/>' },
];

// Mobil pastki bar — faqat shu 4 ta asosiy, qolgani "Ko'proq" panelida
// (telefon ko'rinishi o'zgarmasin degan talab — avvalgi tartib saqlanadi).
const MOBILE_MAIN_KEYS = ['index', 'customer-orders', 'tables', 'menu'];
const MOBILE_MORE_KEYS = ['waiters', 'expenses', 'reservations', 'inventory', 'reports', 'cash-shifts', 'audit', 'delivery-zone'];

const ICON_MORE = '<circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/>';
const ICON_LOGOUT = '<path d="M15 17l5-5-5-5"/><path d="M20 12H9"/><path d="M12 19H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h6"/>';

function svgIcon(pathsHtml, extraAttrs) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" ${extraAttrs || ''}>${pathsHtml}</svg>`;
}

function findNavItem(key) {
  return NAV_ITEMS.find((n) => n.key === key);
}

function renderShellDate() {
  const el = document.getElementById('pageDate');
  if (!el) return;
  const d = new Date();
  el.textContent = `${UZ_DAYS_SHELL[d.getDay()]}, ${d.getDate()}-${UZ_MONTHS_SHELL[d.getMonth()]}`;
}

function buildMobileNav(activePage) {
  const nav = document.createElement('nav');
  nav.className = 'mobile-nav';
  nav.id = 'mobileNav';
  MOBILE_MAIN_KEYS.forEach((key) => {
    const item = findNavItem(key);
    const a = document.createElement('a');
    a.href = item.href;
    a.className = 'mobile-nav-item' + (key === activePage ? ' active' : '');
    a.innerHTML = `<span class="mobile-nav-icon">${svgIcon(item.icon)}</span>${item.label}`;
    nav.appendChild(a);
  });
  const moreBtn = document.createElement('button');
  moreBtn.type = 'button';
  moreBtn.id = 'mobileMoreBtn';
  moreBtn.className = 'mobile-nav-item' + (MOBILE_MORE_KEYS.includes(activePage) ? ' active' : '');
  moreBtn.setAttribute('aria-haspopup', 'true');
  moreBtn.setAttribute('aria-expanded', 'false');
  moreBtn.innerHTML = `<span class="mobile-nav-icon">${svgIcon(ICON_MORE)}</span>Ko'proq`;
  nav.appendChild(moreBtn);
  return nav;
}

function buildMobileSheet() {
  const sheet = document.createElement('div');
  sheet.className = 'mobile-sheet';
  sheet.id = 'mobileSheet';
  sheet.setAttribute('role', 'menu');
  const handle = document.createElement('div');
  handle.className = 'mobile-sheet-handle';
  sheet.appendChild(handle);
  MOBILE_MORE_KEYS.forEach((key) => {
    const item = findNavItem(key);
    const a = document.createElement('a');
    a.href = item.href;
    a.innerHTML = `${svgIcon(item.icon)}${item.label}`;
    sheet.appendChild(a);
  });
  return sheet;
}

function buildSidebar(activePage) {
  const aside = document.createElement('aside');
  aside.className = 'admin-sidebar';
  aside.innerHTML = `
    <div class="admin-sidebar-brand">
      <div class="brand-mark" aria-hidden="true">P</div>
      <div class="admin-sidebar-brand-text">
        <div class="admin-sidebar-brand-name">Po'lat</div>
        <div class="admin-sidebar-brand-sub">Boshqaruv paneli</div>
      </div>
    </div>
    <nav class="admin-sidebar-nav">
      ${NAV_ITEMS.map((item) => `<a href="${item.href}" class="admin-sidebar-link${item.key === activePage ? ' active' : ''}">${svgIcon(item.icon)}${item.label}</a>`).join('')}
    </nav>
    <div class="admin-sidebar-foot">
      <button type="button" class="admin-sidebar-logout js-logout">${svgIcon(ICON_LOGOUT)}Chiqish</button>
    </div>
  `;
  return aside;
}

function initLayout(activePage) {
  renderShellDate();

  document.body.insertBefore(buildSidebar(activePage), document.body.firstChild);

  const mobileNav = buildMobileNav(activePage);
  const sheetBackdrop = document.createElement('div');
  sheetBackdrop.className = 'mobile-sheet-backdrop';
  sheetBackdrop.id = 'mobileSheetBackdrop';
  const sheet = buildMobileSheet();
  document.body.appendChild(mobileNav);
  document.body.appendChild(sheetBackdrop);
  document.body.appendChild(sheet);

  const moreBtn = document.getElementById('mobileMoreBtn');
  const open = () => { sheet.classList.add('open'); sheetBackdrop.classList.add('open'); moreBtn.setAttribute('aria-expanded', 'true'); };
  const close = () => { sheet.classList.remove('open'); sheetBackdrop.classList.remove('open'); moreBtn.setAttribute('aria-expanded', 'false'); };
  moreBtn.addEventListener('click', () => { sheet.classList.contains('open') ? close() : open(); });
  sheetBackdrop.addEventListener('click', close);
  sheet.querySelectorAll('a').forEach((a) => a.addEventListener('click', close));
}
