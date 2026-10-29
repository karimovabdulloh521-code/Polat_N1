#!/bin/sh
# Eski zaxira (.bak) fayllarni va ishlatilmaydigan public/landing/menu.js'ni
# loyihadan _arxiv/2026-10-24/ papkasiga ko'chiradi (2026-10-24, "Kod sifati").
# Hech narsa O'CHIRILMAYDI — kerak bo'lsa qaytarib olish mumkin.
# Loyiha papkasida ishga tushiring:  sh scripts/arxivla-eski-fayllar.sh
set -e
cd "$(dirname "$0")/.."
DEST="_arxiv/2026-10-24"
n=0
for f in $(find server public -type f \( -name '*.bak' -o -name '*.bak[0-9]*' -o -name '*.bak-*' \) | sort) public/landing/menu.js; do
  [ -f "$f" ] || continue
  mkdir -p "$DEST/$(dirname "$f")"
  if [ -e "$DEST/$f" ]; then echo "O'tkazib yuborildi (arxivda bor): $f"; continue; fi
  mv "$f" "$DEST/$f"
  echo "Ko'chirildi: $f"
  n=$((n + 1))
done
echo "Jami: $n ta fayl $DEST/ ga ko'chirildi."
