// QZ Tray "Action Required" (imzosiz/anonim ulanish) oynasini butunlay
// yo'qotish uchun — QZ Tray har bir ulanish/chop etish so'rovini shu API orqali
// olingan ochiq sertifikat bilan tekshiradi va shu server imzolagan
// (server/qz-keys/private-key.pem) imzo bilan tasdiqlaydi. Sertifikat ochiq
// matn (maxfiy emas), lekin faqat shu server chop etish uchun kimga tegishli
// ekanini isbotlay olishi kerak, shu sabab imzolash endpoint'i chek chop
// etadigan rollar (admin, kassir, chef) bilan cheklangan, '/api/qz' ostida —
// '/api/admin/*' EMAS (server/index.js'dagi izohga qarang: requireAuth()
// har qanday '/api/admin/*'ni avtomatik faqat 'admin'ga yopib qo'yardi).
//
// Bu ishlashi uchun admin kompyuteridagi QZ Tray'ga
// server/qz-keys/digital-certificate.txt matni "override.crt" nomi bilan QZ
// Tray o'rnatilgan papkaga qo'yilishi kerak (batafsil: polat/CLAUDE.md).
const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { asyncRoute } = require('../routeUtils');

const router = express.Router();

const KEYS_DIR = path.join(__dirname, '..', 'qz-keys');
const CERT_PATH = path.join(KEYS_DIR, 'digital-certificate.txt');
const KEY_PATH = path.join(KEYS_DIR, 'private-key.pem');

const publicCertificate = fs.readFileSync(CERT_PATH, 'utf8');
const privateKey = fs.readFileSync(KEY_PATH, 'utf8');

router.get('/certificate', asyncRoute((req, res) => {
  res.json({ certificate: publicCertificate });
}));

// QZ Tray klient tomondan (qz.security.setSignaturePromise) shu yerga
// imzolanishi kerak bo'lgan xom matnni ("toSign") yuboradi, biz uni xususiy
// kalit bilan RSA-SHA512 orqali imzolab, base64 ko'rinishda qaytaramiz.
// Klient tomonda ham `qz.security.setSignatureAlgorithm('SHA512')` bilan
// aynan shu algoritm o'rnatilgan bo'lishi shart (public/waiter/receipt.js).
// Xavfsizlik auditi (2026-10-10): ilgari bu yerga kelgan ISTALGAN matn
// (uzunlik/shakl cheklovisiz) imzolanardi — 3 rolga (admin, kassir, chef)
// ochiq bo'lgani uchun, agar shu hisoblardan biri buzilsa, xususiy kalit
// "imzolash xizmati" (signing oracle) sifatida suiiste'mol qilinishi mumkin
// edi.
//
// 2026-10-10 TUZATILDI — HAQIQIY PRODUCTION BUG: avvalgi tuzatish "QZ Tray
// klienti har doim JSON yuboradi" deb noto'g'ri faraz qilib, bu yerga
// JSON.parse() talabi qo'ygan edi. Haqiqatda `qz-tray.js` (qz.security.
// setSignaturePromise) imzolashdan OLDIN o'zi SHA-256 bilan xeshlab, shu
// yerga 64 ta hex belgidan iborat XESH qatorini yuboradi — JSON EMAS. Shu
// sabab avvalgi tekshiruv HAR BIR haqiqiy chop etish so'rovini 400 bilan rad
// etib, kassada "Printerga chop etib bo'lmadi: Failed to sign request"
// xatosi bilan chop etishni butunlay ishlamay qo'ygan edi (jismoniy
// printerda birinchi marta sinalganda topildi). Endi hex-format + uzunlik
// cheklovi bilan tekshiriladi — signing-oracle himoyasi saqlanadi, lekin
// haqiqiy QZ Tray so'rovi endi o'tadi.
router.post('/sign', asyncRoute((req, res) => {
  const toSign = req.body && req.body.request;
  if (typeof toSign !== 'string' || !toSign) {
    return res.status(400).json({ error: "'request' maydoni kerak" });
  }
  if (!/^[0-9a-f]{1,128}$/i.test(toSign)) {
    return res.status(400).json({ error: "'request' noto'g'ri formatda" });
  }
  const signature = crypto.sign('sha512', Buffer.from(toSign, 'utf8'), privateKey);
  res.json({ signature: signature.toString('base64') });
}));

module.exports = router;
