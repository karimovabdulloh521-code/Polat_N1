// Statik fayl versiyasini yangilaydi (2026-10-24, "Tezlik"). Barcha
// public/**/*.html ichidagi MAHALLIY .js/.css havolalariga `?v=<versiya>`
// qo'yadi (eski ?v=... almashtiriladi). Server versiyalangan fayllarni
// brauzerga 7 kun keshlashni aytadi — shu sabab JS/CSS o'zgartirilgach,
// har safar shu skriptni ishga tushiring, aks holda mijozda eski fayl qoladi:
//   node scripts/versiya.js            -> versiya = joriy sana-vaqt (YYYYMMDDHHmm)
//   node scripts/versiya.js 20261024a  -> qo'lda berilgan versiya
const fs = require('fs');
const path = require('path');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const now = new Date();
const pad = (n) => String(n).padStart(2, '0');
const version = process.argv[2] ||
  `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}`;
if (!/^[A-Za-z0-9._-]+$/.test(version)) {
  console.error("Versiya faqat harf/raqam/.-_ dan iborat bo'lishi kerak");
  process.exit(1);
}

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'uploads' || e.name.startsWith('_')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.html')) out.push(p);
  }
  return out;
}

// src="x.js" / href="../y.css?v=1" — tashqi (http/https, //) manzillarga tegilmaydi.
const RE = /\b(src|href)="(?!https?:|\/\/|data:)([^"?#]+\.(?:js|css))(?:\?v=[^"#]*)?"/g;
let files = 0;
let refs = 0;
for (const file of walk(PUBLIC_DIR)) {
  const src = fs.readFileSync(file, 'utf8');
  let n = 0;
  const out = src.replace(RE, (m, attr, url) => { n += 1; return `${attr}="${url}?v=${version}"`; });
  if (out !== src) { fs.writeFileSync(file, out); files += 1; refs += n; }
}
console.log(`Versiya ${version}: ${files} ta HTML faylda ${refs} ta havola yangilandi.`);
