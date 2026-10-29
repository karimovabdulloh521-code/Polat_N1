# 0-QADAM — Tayyorgarlik (buni o'zing qil)
- Bu fayl `polat-yangilash.zip` arxivi ichida keldi. Arxiv polat loyihasi ildizida ochilgan bo'lishi kerak (ichida `polat-yangilash/` papkasi bo'ladi). Ochilmagan bo'lsa: `unzip -o polat-yangilash.zip`.
- Loyiha ildizini aniqla (u yerda `package.json`, `server/`, `public/landing/menu.html`, `CLAUDE.md` bor). Topolmasang, to'xta va mendan so'ra.
- `polat-yangilash/_mockups/ziyo-buyurtma-maket.html` ni loyiha ildizidagi `_mockups/` papkasiga ko'chir (papka yo'q bo'lsa yarat). Bu fayl faqat namuna, sayt uni ishlatmaydi.
- Ishni boshlashdan oldin `git status` ni tekshir (agar git bo'lsa) va menga qaysi fayllarni o'zgartirmoqchi ekaningni qisqa reja qilib yoz, keyin darhol ishni davom ettir.

Sen Po'lat / Ziyo Famliy loyihasida ishlayapsan (Node.js + Express + SQLite, PM2'da "polat" nomi bilan ishlab turgan JONLI sayt). Avval loyiha ildizidagi CLAUDE.md va OXIRGI-ISH.md fayllarini o'qib chiq.

## Vazifa
Mijozlar menyusi sahifasidagi (public/landing/menu.html + menu-v2.css + menu-v2.js) savat va buyurtma berish qismini yangi maket asosida qayta dizayn qil. Maket fayli: `_mockups/ziyo-buyurtma-maket.html` (men uni shu papkaga yukladim). Maketni brauzerda ochib (Playwright) ko'rib chiq va uni NAMUNA sifatida ishlat. Maketdagi menyu ma'lumotlari va rasmlar ichiga joylab qo'yilgan (base64). Ularni ko'chirma: haqiqiy sahifa avvalgidek `GET ../api/public/menu` dan o'qisin.

## Maketdan olinadigan narsalar
1. Savat/checkout ko'rinishi. Kompyuter va planshetda ikki ustun: chapda savat va forma, o'ngda sticky "Hisob" kartasi va "Buyurtma berish" tugmasi. Telefonda bitta ustun va pastda qotib turadigan "Buyurtma berish" paneli.
2. "Yetkazib berish / Olib ketish" tanlovi ikkita katta kartochka ko'rinishida. Olib ketishda restoran manzili qutisi chiqadi.
3. Hisob kartasi: "Taomlar", "Yetkazib berish — Operator aytadi" (olib ketishda "Bepul"), "Jami". Tagida "To'lov: naqd yoki karta — buyurtmani qabul qilganda".
4. Buyurtma muvaffaqiyatli yuborilgandan keyingi ekran: buyurtma raqami (serverdan qaytgan haqiqiy raqam), tarkib, jami summa va "operator qo'ng'iroq qiladi" matni.
5. Menyu kartochkalari, chiplar, qidiruv va "Savatni ko'rish" paneli saytda allaqachon bor. Ularni faqat maketdagi ko'rinishga yaqinlashtir, mantiqini buzma.

## QAT'IY QOIDALAR (ma'lumotlarni buzmaslik uchun)
- Ishni boshlashdan OLDIN zaxira nusxa ol: `data/polat.db` (WAL bilan birga, sqlite `.backup` buyrug'i orqali), hamda o'zgartiradigan har bir faylning `.bak-YYYYMMDD` nusxasi.
- `.env`, `server/qz-keys/`, `data/` papkasiga, `server/schema.sql` ga va `server/db.js` dagi migratsiyalarga TEGMA.
- Bu bosqichda backend'ni (server/ papkasini) O'ZGARTIRMA. API o'zgarishsiz qoladi: `POST ../api/public/orders` avvalgi maydonlar bilan yuboriladi (full_name, phone, fulfillment, address, location lat/lng, note, items, honeypot "website"). Narxni server hisoblaydi.
- Mavjud funksiyalar saqlansin: localStorage savati, variantlar ("tur" tugmalari), GPS "Lokatsiyamni yuborish", maydon ostidagi xato matnlari, honeypot, rate-limit xabarlari, avtomatik light/dark rejim.
- Maketdagi promokod, chegirma, "Olib ketish kodi", "Vaqtini tanlash" va "Buyurtma holati" sahifasini QO'SHMA. Ularning backend'i yo'q (alohida 2-bosqich).
- `table-menu.html`, `menu.css`, `menu.js` (QR-menyu) ga TEGMA.
- Faqat statik fayllar o'zgaradi, shuning uchun `pm2 restart` shart emas.

## Tekshiruv (majburiy)
1. Playwright bilan 360, 390, 768, 1024, 1280 va 1920px kengliklarda tekshir: gorizontal scroll bo'lmasin, konsolda xato chiqmasin.
2. To'liq oqimni sina: menyudan qo'shish, variant tanlash, savatda +/−, yetkazib berish va olib ketish, xato matnlari (bo'sh ism, 9 xonadan kam telefon, qisqa manzil).
3. Bitta HAQIQIY test buyurtma yuborib, bazada paydo bo'lganini tekshir. Shuni bil: bu buyurtma oshxona printeriga chek chiqarishi va admin/oshpaz/kuryerga bildirishnoma yuborishi mumkin. Test ismini aniq "TEST — o'chiriladi" deb yoz. Keyin test buyurtmani, unga bog'liq kitchen_tickets yozuvlarini va bildirishnomalarni o'chir, ombor qoldig'ini tikla, so'ng `PRAGMA integrity_check` ishlat.
4. QR-menyu (`table-menu.html`) va bosh sahifa (`index.html`) avvalgidek ishlashini tekshir.

## Yakunda
- OXIRGI-ISH.md ga yangi yozuv qo'sh: nima o'zgardi, qaysi fayllar, qanday tekshirildi, zaxira nusxalar qayerda.
- Menga qisqa hisobot ber va qaytarish (rollback) buyrug'ini yoz: `.bak` fayllarni joyiga qaytarish.
- Biror narsa noaniq bo'lsa yoki backend'ni o'zgartirish kerak bo'lib qolsa, TO'XTA va mendan so'ra.

---

# 2-BOSQICH — Yetkazish hududi (10/20 km) va avtomatik yetkazish narxi

1-bosqich to'liq tugab, tekshirilgandan KEYIN boshla. Bu bosqichda backend ham o'zgaradi, shuning uchun yana zaxira nusxa ol (`data/polat.db` sqlite `.backup` orqali, o'zgaradigan har bir fayl uchun `.bak-YYYYMMDD`).

## Qoida (biznes)
- Masofa = oshxonadan mijoz nuqtasigacha (km). Narx formulasi:
  - **0–10 km: 5 000 so'm** (qat'iy).
  - **10–20 km: 5 000 + (10 km dan oshgan har BOSHLANGAN km × 500 so'm)**, ya'ni `5000 + ceil(masofa − 10) × 500`.
    Misol: 10,0 → 5 000 · 10,01 → 5 500 · 11 → 5 500 · 12 → 6 000 · 14,3 → 7 500 · 15 → 7 500 · 19,99 → 10 000 · 20,0 → 10 000.
  - **20 km dan uzoq: saytdan yetkazish buyurtmasi berilmaydi.** Buning o'rniga operator telefon raqami chiqadi (bosilsa qo'ng'iroq qiladigan `tel:` havola) va "Bu manzilga yetkazish narxini operator bilan kelishing" matni ko'rsatiladi. "Olib ketish" tanlovi ishlayveradi.
- Mijoz lokatsiya bermasa (faqat manzilni yozsa), buyurtma avvalgidek qabul qilinadi va narx "Operator aytadi" bo'ladi (`delivery_fee = NULL`).
- Masofa ikki nuqta orasidagi to'g'ri chiziq bo'yicha (haversine formulasi) hisoblanadi, tashqi API ishlatilmaydi.
- Namuna: maketdagi xarita, zona kartochkasi va Hisob qismi (`_mockups/ziyo-buyurtma-maket.html`). Maketdagi "Sinash uchun" tugmalari faqat demo uchun, saytga QO'SHMA.

## Sozlamalar
- Oshxona koordinatasi (lat/lng), radius (km) va narx (so'm) `settings` jadvalida saqlansin, masalan `delivery_origin_lat`, `delivery_origin_lng`, `delivery_base_km` = 10, `delivery_base_fee` = 5000, `delivery_per_km` = 500, `delivery_max_km` = 20, `delivery_operator_phone` (operator raqami). Faqat YANGI kalit qo'sh, mavjud kalitlarga tegma.
- Admin panelga (mavjud admin dizayni va `layout.js` bilan) kichik "Yetkazish hududi" sozlamasini qo'sh: shu 7 qiymatni ko'rish va o'zgartirish. Xaritadan nuqta tanlash bo'lsa yaxshi.
- **Oshxonaning aniq koordinatasini va operator telefon raqamini bilmaysan (`settings.restaurant_phone` bo'sh). Ikkalasini mendan so'ra** (Google/Yandex xaritadagi havola yoki lat,lng). Javob kelguncha sozlamani bo'sh qoldir. Sozlama bo'sh bo'lsa, tizim avvalgidek "Operator aytadi" rejimida ishlasin.

## Backend
- `customer_orders` jadvaliga faqat `ALTER TABLE ... ADD COLUMN` bilan nullable ustunlar qo'sh: `delivery_distance_km REAL`, `delivery_fee INTEGER`. Migratsiya `server/db.js` dagi mavjud naqshdagidek idempotent bo'lsin (ustun bor-yo'qligini tekshirsin). Jadvalni qayta qurma, eski ma'lumotlarni o'zgartirma.
- `GET /api/public/delivery-zone` endpointini qo'sh: oshxona nuqtasi va tarif qiymatlarini qaytaradi (login shart emas).
- `POST /api/public/orders`: agar `fulfillment = 'delivery'` va lokatsiya bo'lsa, masofa va narxni **SERVERDA qayta hisobla**. Mijoz yuborgan narxga ishonma. 20 km dan uzoq bo'lsa, `400 { field: 'location', error: '...', operator_phone: '...' }` qaytar. Natijani yangi ustunlarga yoz.
- Mavjud namuna: `manual_bills` da `delivery_price` alohida ustunda saqlanadi va `total_amount` ga qo'shiladi — shu naqshga amal qil.
- Diqqat: `customer_orders` hozir kassa smenasiga (`cash_shifts`) umuman kirmaydi va hisobotda oshpaz "Tayyor" degan paytda tushum sifatida yoziladi. Buni menga ko'rsatib o't, lekin men so'ramagunimcha o'zgartirma.
- `total_amount` ga yetkazish narxini qo'shish yoki qo'shmaslikni hal qilishdan oldin hisobot, kassa smenasi, chek va statistika kodini tekshir. Daromad hisobi buzilmasligi kerak. Agar aniq bo'lmasa, menga 2 variantni tushuntirib so'ra.
- Yetkazish narxi va masofa oshxona chekida (`print-agent.js` yetkazib berish shabloni, orqaga mos holda), kuryer ekranida, admin va kassir "Buyurtmalar" ro'yxatida ko'rinsin.

## Frontend (menu.html / menu-v2.js / menu-v2.css)
- Yetkazib berish tanlanganda xarita chiqsin. Leaflet 1.9.4 (cdnjs) va OpenStreetMap ishlatiladi. Xaritada oshxona markeri, 10 km (5 000 so'm) doirasi va 20 km (chegara) doirasi bo'ladi, mijoz bosib uyini belgilaydi. "Lokatsiyamni yuborish" ham nuqtani qo'yadi.
- Zona kartochkasi: ✅ hudud ichida (masofa + narx, 10 km dan oshsa formulasi ham, masalan "5 000 + 2 km × 500") / 📞 20 km dan uzoq — operator raqami tugmasi bilan / 📍 hali belgilanmagan.
- Hisobda: "Yetkazib berish (3,2 km) — 5 000 so'm" va Jami summa yangilanadi. 20 km dan uzoq bo'lsa, Hisobda "Operator orqali" yoziladi va "Buyurtma berish" tugmasi o'chiq bo'ladi.
- Xarita yuklanmasa (CDN yoki internet yo'q), sahifa buzilmasin: lokatsiya tugmasi ishlayversin va xabar chiqsin.

## Tekshiruv
- Server funksiyasini test qil: 3 → 5000, 10 → 5000, 10,01 → 5500, 11 → 5500, 12 → 6000, 14,3 → 7500, 20 → 10000, 20,01 → 400 xato (xabarda operator raqami), lokatsiyasiz → NULL. Frontend va server bir xil natija berishi kerak.
- Playwright bilan to'liq oqimni tekshir (6 xil kenglikda, konsolda xato chiqmasin). Bitta test buyurtma yubor (ismi "TEST — o'chiriladi"), keyin uni 1-bosqichdagidek to'liq tozala va `PRAGMA integrity_check` ishlat.
- `pm2 restart polat --update-env`, so'ng jarayon `online` ekanini va xato logini tekshir.
- OXIRGI-ISH.md ga yozuv qo'sh va menga hisobot hamda rollback yo'lini ber.
