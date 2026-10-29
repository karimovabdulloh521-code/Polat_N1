// Ochiq (login shart emas) endpoint — landing sahifadagi menyu bo'limi va QR
// (table-menu.html) sahifasi shu yerdan haqiqiy (admin/menu.html orqali
// kiritilgan) taomlar ro'yxatini oladi.
//
// Bitta SQL so'rovda (kategoriya + asosiy taom + variant — hammasi bir marta
// JOIN qilinib o'qiladi, JS tomonida guruhlanadi) — 2026-10-15'da "menyu +
// savat" qayta dizayni paytida N+1 (avval har kategoriya uchun bitta, har
// taom uchun bitta qo'shimcha so'rov) yo'q qilindi.
const express = require('express');
const { db } = require('../db');
const { asyncRoute } = require('../routeUtils');

const router = express.Router();

router.get('/', asyncRoute((req, res) => {
  const rows = db
    .prepare(
      `SELECT
         mi.id, mi.category_id, mi.parent_item_id, mi.name, mi.price,
         mi.description, mi.image_url, mi.volume, mi.is_available, mi.inventory_item_id,
         mi.sort_order AS item_sort,
         mc.name AS category_name, mc.sort_order AS category_sort, mc.require_inventory_link
       FROM menu_items mi
       JOIN menu_categories mc ON mc.id = mi.category_id
       WHERE mi.is_active = 1 AND mc.is_active = 1
       ORDER BY mc.sort_order, mc.id, mi.sort_order, mi.id`
    )
    .all();

  const toPublic = (it) => ({
    id: it.id,
    name: it.name,
    price: it.price,
    volume: it.volume || null,
    description: it.description || null,
    image: it.image_url || null,
    available: !!it.is_available,
  });

  // 1-pas: kategoriyalarni tartib bilan, 2-pas: har bir taomni ota/variant
  // guruhiga ajratib taqsimlaymiz — hammasi yuqoridagi bitta so'rov natijasidan.
  const categoriesById = new Map();
  const categoryOrder = [];
  const variantsByParent = new Map();
  const topItemsByCategory = new Map();

  for (const it of rows) {
    if (!categoriesById.has(it.category_id)) {
      categoriesById.set(it.category_id, {
        id: it.category_id,
        name: it.category_name,
        requireInventoryLink: !!it.require_inventory_link,
      });
      categoryOrder.push(it.category_id);
      topItemsByCategory.set(it.category_id, []);
    }
    if (it.parent_item_id) {
      if (!variantsByParent.has(it.parent_item_id)) variantsByParent.set(it.parent_item_id, []);
      variantsByParent.get(it.parent_item_id).push(it);
    } else {
      topItemsByCategory.get(it.category_id).push(it);
    }
  }

  const result = categoryOrder
    .map((catId) => {
      const cat = categoriesById.get(catId);
      let items = topItemsByCategory.get(catId) || [];
      if (cat.requireInventoryLink) items = items.filter((it) => it.inventory_item_id !== null);
      const mapped = items.map((it) => {
        let variants = variantsByParent.get(it.id) || [];
        if (cat.requireInventoryLink) variants = variants.filter((v) => v.inventory_item_id !== null);
        return { ...toPublic(it), variants: variants.map(toPublic) };
      });
      return { id: cat.id, name: cat.name, items: mapped };
    })
    .filter((cat) => cat.items.length > 0);

  // Menyu tez-tez o'zgarmaydi — qisqa kesh bilan sahifa tezroq ochilsin
  // (mijoz qurilmasi/tarmog'i sekin bo'lsa ham).
  res.set('Cache-Control', 'public, max-age=60');
  res.json({ categories: result });
}));

module.exports = router;
