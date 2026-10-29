// login.html'dagi inline <script> bloki bu yerga ko'chirildi (2026-10-10,
// "Oldingi audit tuzatishlari" tekshiruvi — Content-Security-Policy'ning
// 'unsafe-inline' (script-src) ishlatmasligi uchun, mantiqqa tegilmadi).
const EYE_OPEN_ICON = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"></path><circle cx="12" cy="12" r="3"></circle></svg>';
const EYE_CLOSED_ICON = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.94 10.94 0 0 1 12 19c-7 0-11-7-11-7a21.8 21.8 0 0 1 5.06-5.94M9.9 4.24A10.94 10.94 0 0 1 12 4c7 0 11 7 11 7a21.8 21.8 0 0 1-3.22 4.44M14.12 14.12a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>';
const togglePasswordBtn = document.getElementById('togglePassword');
togglePasswordBtn.innerHTML = EYE_OPEN_ICON;
togglePasswordBtn.addEventListener('click', () => {
  const input = document.getElementById('password');
  const showing = input.type === 'text';
  input.type = showing ? 'password' : 'text';
  togglePasswordBtn.innerHTML = showing ? EYE_OPEN_ICON : EYE_CLOSED_ICON;
  togglePasswordBtn.setAttribute('aria-label', showing ? "Parolni ko'rsatish" : "Parolni yashirish");
});
document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value;
  const errorEl = document.getElementById('errorMsg');
  errorEl.textContent = '';
  try {
    const data = await api('/login', { method: 'POST', body: { username, password } });
    if (data.role === 'admin') {
      window.location.href = 'admin/index.html';
    } else if (data.role === 'chef') {
      window.location.href = 'chef/kitchen.html';
    } else if (data.role === 'courier') {
      window.location.href = 'courier/orders.html';
    } else if (data.role === 'kassir') {
      window.location.href = 'kassir/tables.html';
    } else {
      window.location.href = 'waiter/tables.html';
    }
  } catch (err) {
    errorEl.textContent = err.message || "Kirishda xatolik";
  }
});
