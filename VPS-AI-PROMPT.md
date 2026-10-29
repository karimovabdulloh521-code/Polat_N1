# Vazifa: `polat` loyihasiga 2026-10-24 yangilanishini XAVFSIZ qo'shish

Sen VPS'dagi `polat` loyihasi (Po'lat restorani sayti, PM2'da `polat` nomi bilan ishlaydi) ustida ishlaysan. Loyiha papkasi va qoidalari `polat/CLAUDE.md`da yozilgan — **avval uni to'liq o'qi**.

Men senga `polat-yangilash-2026-10-24.zip` faylini yukladim (`polat/_yangilash/` papkasida; topilmasa, qayerdaligini mendan so'ra). Uni o'sha papkada och — ichida shu ko'rsatma va 2 ta zip bor:

- `polat-kod.zip` — **ASOS**: men yangilash uchun boshqa joyga yuborgan, 2026-10-23 holatidagi loyiha nusxasi.
- `polat-kod-2026-10-24.zip` — **YANGI**: shu asos ustiga qilingan tuzatishlar.

Maqsad: YANGI versiyadagi o'zgarishlarni production'ga qo'shish. Sayt ishlashda davom etsin va **hech qanday ma'lumot yo'qolmasin yoki buzilmasin**.

---

## QAT'IY TAQIQLAR (hech qanday holatda)

1. `data/` papkasiga (baza, zaxiralar) tegma. Bazaga qo'lda INSERT/UPDATE/DELETE qilma. Faqat server ishga tushganda kod o'zi bajaradigan avtomatik migratsiya ruxsat etiladi.
2. `.env`, `server/qz-keys/` (ayniqsa `private-key.pem`), `public/uploads/`, `node_modules/` — **ustidan yozma, o'chirma**. YANGI zipda bular yo'q, ataylab shunday.
3. `rm`, `git reset --hard`, `git checkout -- .`, `git clean` ishlatma. Fayl ko'chirishda faqat `mv -n` yoki zaxira nusxadan keyin `cp`.
4. `npm install`/`npm update` qilma: `package.json` o'zgarmagan.
5. nginx, SSH, firewall va boshqa tizim sozlamalariga tegma.
6. Test buyurtma, test xodim yoki test chek yaratma. Oshxona printeriga haqiqiy chek chiqib ketishi mumkin.
7. Mendan so'ramasdan `git commit`/`git push` qilma.
8. Biror narsa rejadagidek ketmasa — **to'xta, holatni tushuntir, mendan so'ra**. Taxmin qilib davom etma.

---

## 1-QADAM — Tayyorgarlik (hech narsa o'zgartirilmaydi)

1. `CLAUDE.md`ni o'qi. `git status` va `git log --oneline -5` natijasini menga ko'rsat. Commit qilinmagan o'zgarishlar bo'lishi mumkin (masalan `server/printer.js`).
2. `pm2 status polat` va oxirgi 50 qator logni ko'r. Hozir `online` ekanini va restart sonini yozib qo'y.
3. Ikkala zipni loyihadan TASHQARIDAGI vaqtinchalik papkaga och, masalan `/tmp/polat-asos/` va `/tmp/polat-yangi/`.
4. **Ma'lumotlar soni (oldin)** — bazani FAQAT O'QISH rejimida ochib, quyidagi jadvallarda nechtadan qator borligini yozib qo'y: `users`, `menu_items`, `menu_categories`, `tables`, `orders`, `order_items`, `customer_orders`, `customer_order_items`, `manual_bills`, `cash_shifts`, `inventory_items`, `inventory_movements`, `reservations`, `expenses`, `audit_log`, `print_jobs`. Shunda `PRAGMA integrity_check` ham bajar.
   ```
   node -e "const D=require('better-sqlite3');const db=new D('data/polat.db',{readonly:true});for(const t of ['users','menu_items','menu_categories','tables','orders','order_items','customer_orders','customer_order_items','manual_bills','cash_shifts','inventory_items','inventory_movements','reservations','expenses','audit_log','print_jobs']){try{console.log(t,db.prepare('SELECT COUNT(*) c FROM '+t).get().c)}catch(e){console.log(t,'YOQ')}};console.log('integrity',db.pragma('integrity_check',{simple:true}))"
   ```

## 2-QADAM — Zaxira nusxalar (MAJBURIY, bularsiz davom etma)

1. **Baza**: better-sqlite3 `db.backup()` bilan `data/backups_manual/polat-pre-update-20261024.db` faylini yarat. Bu WAL rejimida ham xavfsiz. Yaratilgan nusxada `integrity_check` = `ok` ekanini va `orders` soni asl bazadagi bilan teng ekanini tekshir.
2. **Kod**: butun loyihaning nusxasini `node_modules` va `data`siz, loyihadan TASHQARIGA arxivla:
   `tar --exclude=node_modules --exclude=data -czf ~/polat-kod-zaxira-20261024.tar.gz -C <polat ota papkasi> polat`
   Arxiv hajmini va ichidagi fayllar sonini ko'rsat.

## 3-QADAM — 3 tomonlama solishtirish (hali hech narsa yozilmaydi)

YANGI zipdagi HAR BIR fayl uchun serverdagi (JORIY) nusxani ASOS va YANGI bilan solishtir (`cmp`/`diff`):

| Holat | Ma'nosi | Nima qilinadi |
|---|---|---|
| JORIY = ASOS | Serverda bu fayl zip olingandan beri o'zgarmagan | YANGI bilan almashtiriladi |
| JORIY = YANGI | Allaqachon yangilangan | Tegilmaydi |
| ASOSda yo'q, serverda ham yo'q | Yangi fayl | Qo'shiladi |
| JORIY ≠ ASOS va JORIY ≠ YANGI | **ZIDDIYAT**: serverda keyinroq boshqa o'zgarish qilingan | **Almashtirilmaydi.** `diff ASOS JORIY` va `diff ASOS YANGI`ni menga ko'rsat. Ikkala o'zgarishni qo'lda birlashtirish rejasini taklif qil va mening ruxsatimni kut |

Natijani jadval qilib ko'rsat: qaysi fayllar almashtiriladi, qaysilari yangi, qaysilari ziddiyatli. **Ziddiyat bo'lsa shu yerda to'xta.**

Kutilayotgan o'zgarishlar ro'yxati (bundan tashqari farq chiqsa ham menga ayt):

- **Server:** `server/printer.js`, `server/index.js`, `server/routes/waiterOrders.js`, `server/routes/adminReports.js`
- **Frontend (yangi fayllar):** `public/app-print.js`, `public/app-notify.js`, `public/landing/menu-v2-utils.js`
- **Frontend (o'zgargan fayllar):** `public/app.js`, `public/style.css`, `public/admin/index.js`, `public/admin/reports.js`, `public/kassir/shift-ui.js`, `public/landing/menu-v2.js`
- **HTML:** deyarli barcha `public/**/*.html` (`?v=20261024` versiya va yangi `<script>` teglari)
- **Skriptlar (yangi):** `scripts/versiya.js`, `scripts/tolanmagan-hisoblar.js`, `scripts/arxivla-eski-fayllar.sh`
- **Hujjat va sozlama:** `CLAUDE.md` (qisqartirilgan), `TARIX.md` (yangi, to'liq tarix), `.gitignore`, `.env.example`

## 4-QADAM — Migratsiyani bazaning NUSXASIDA sinash

Yagona baza o'zgarishi: `print_jobs` jadvaliga `sent_count` va `last_sent_at` ustunlari qo'shiladi. Bundan tashqari 2 soatdan eski, chop etilmagan cheklar `printed=2` (muddati o'tgan) deb belgilanadi. Buni avval NUSXADA sina:

```
cp data/backups_manual/polat-pre-update-20261024.db /tmp/polat-test.db
node -e "const D=require('better-sqlite3');const http=require('http');const {setupKitchenPrinter}=require('/tmp/polat-yangi/server/printer.js');const db=new D('/tmp/polat-test.db');setupKitchenPrinter(http.createServer(),db,'test');console.log(db.pragma('table_info(print_jobs)').map(c=>c.name));console.log(db.prepare('SELECT printed, COUNT(*) c FROM print_jobs GROUP BY printed').all());console.log('integrity',db.pragma('integrity_check',{simple:true}));process.exit(0)"
```

Ustunlar qo'shilganini va `integrity_check: ok` ekanini ko'rsat. Keyin `/tmp/polat-test.db`ni o'chir (u `/tmp`da, loyihaga aloqasi yo'q).

## 5-QADAM — O'rnatish

Restoran eng kam band bo'lgan paytda bajarilgani ma'qul. Hozir faol stol bor-yo'qligini (`orders WHERE status='open'`, faqat o'qish) tekshirib, menga ayt.

1. Faqat 3-qadamda "almashtiriladi" yoki "yangi" deb belgilangan fayllarni YANGI zipdan `cp` bilan ko'chir. Ziddiyatli fayllarga tegma.
2. `.bak` zaxira fayllarni va ishlatilmaydigan `public/landing/menu.js`ni arxivla. Ular o'chirilmaydi, `_arxiv/2026-10-24/`ga ko'chadi:
   `sh scripts/arxivla-eski-fayllar.sh`
   Avval `grep -rn "landing/menu.js\|src=\"menu.js" public` bilan `menu.js` hech qayerda ulanmaganini tasdiqla.
3. Barcha o'zgargan JS fayllar uchun `node -c <fayl>` (yoki `node --check`) — xatosiz bo'lishi shart.
4. `.env`da `PRINT_TOKEN` borligini tekshir. Qiymatini ekranga CHIQARMA, faqat "bor/yo'q" deb ayt. O'zgartirma.
5. `pm2 restart polat --update-env`

## 6-QADAM — Tekshirish

1. `pm2 status polat` — `online`, restart soni faqat +1 oshgan (crash-loop yo'q). Restartdan 30 soniya keyin yana bir bor tekshir.
2. Log: `Oshxona agenti ulandi` (agent ulangan bo'lsa), xato yo'q. "muddati o'tgan deb belgilandi" degan yozuv chiqsa — bu normal.
3. **Ma'lumotlar soni (keyin)**: 1-qadam 4-banddagi buyruqni qayta bajar. Barcha jadvallardagi son AVVALGI BILAN BIR XIL bo'lishi shart. Faqat restart paytida yangi haqiqiy buyurtma kelgan bo'lsa ko'payishi mumkin, kamayishi MUMKIN EMAS. `integrity_check: ok`.
4. HTTP tekshiruvlari (`curl`, login qilmasdan):
   - `GET /api/ping` → 200
   - `GET /landing/` → 200, `GET /landing/menu.html` → 200
   - `GET /app-print.js?v=20261024` → login'siz 302 bo'lishi normal (faqat xodimlar uchun)
   - `curl -sI "https://polatuz.duckdns.org/landing/menu-v2.js?v=20261024"` → `Cache-Control: public, max-age=604800`
   - `curl -sI https://polatuz.duckdns.org/landing/menu.html` → `Cache-Control: no-cache`
   - `GET /api/public/menu` → 200, menyu bo'sh emas
5. To'lanmagan hisoblar (faqat o'qiydi): `node scripts/tolanmagan-hisoblar.js` — natijasini menga ko'rsat.

## 7-QADAM — Muammo chiqsa: ORTGA QAYTARISH

- **Kod buzilsa:** `~/polat-kod-zaxira-20261024.tar.gz`dan faqat kod fayllarini tikla (`data/`ga tegmasdan), so'ng `pm2 restart polat --update-env`. Yangi `print_jobs` ustunlari eski kodga xalaqit bermaydi, bazani tiklash shart emas.
- **Bazani tiklash** (`data/backups_manual/polat-pre-update-20261024.db`dan) — **faqat mening aniq ruxsatim bilan**. Zaxiradan keyin kelgan haqiqiy buyurtmalar yo'qolishi mumkin.

## 8-QADAM — Hisobot (o'zbek tilida)

Menga qisqacha yoz:

1. Qaysi fayllar almashtirildi, qaysilari yangi, qaysilari ziddiyat sabab o'tkazib yuborildi.
2. Zaxira fayllar qayerda.
3. Ma'lumotlar soni: oldin va keyin, jadval ko'rinishida.
4. `pm2` holati va logdagi muhim yozuvlar.
5. To'lanmagan hisoblar natijasi.
6. Root huquqi kerak bo'lgan, men o'zim qiladigan ishlar: nginx'da gzip yoqish. Buyruq `TARIX.md`ning oxirgi bo'limida bor. Uni o'zing bajarma, faqat eslatib qo'y.
7. Oxirida `CLAUDE.md`ga hech narsa qo'shma (YANGI versiyada yozilgan). Faqat o'rnatish natijasini `TARIX.md` oxiriga qisqa "Holat — 2026-10-24 (3): production'ga o'rnatildi" bo'limi qilib qo'sh.

Commit qilishni mendan so'ra.
