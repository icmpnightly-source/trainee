# NormativAI — normativ topshirishga tayyorgarlik

Sportchini jismoniy normativlarga tayyorlash uchun ilova:

- **Sportchi profili va normativlar.** Yoshi, jinsi, bo'yi, vazni, maqsad bahosi va topshirish sanasi; yosh guruhi avtomatik aniqlanadi. Har bir mashq bo'yicha oxirgi natija, baho (5/4/3) va maqsadgacha qolgan farq ko'rsatiladi.
- **AI murabbiy (DeepSeek).** Sportchining hozirgi holati, yosh guruhining normativi va natijalardagi farqdan kelib chiqib, haftama-hafta mashg'ulot rejasini, oraliq maqsadlarni, ovqatlanish va tiklanish tavsiyalarini tuzadi. Murabbiyga erkin savol berish ham mumkin. AI ishlamasa, ilova qoidalarga asoslangan rejani beradi va buni ochiq aytadi.
- **Turnikda tortilish — AI hisoblagich.** Telefon yoki noutbuk kamerasi orqali takrorlarni sanaydi: to'liq osilishdan boshlanib, iyak turnikdan oshib, yana to'liq tushgan takrorgina hisoblanadi. Model (MediaPipe Pose Landmarker) brauzerning o'zida, shu serverdan olingan fayllar bilan ishlaydi; video hech qayerga yuborilmaydi.
- **Yugurish — GPS treking va lokal OSRM.** Telefon GPS'i bilan yugurishni yozadi, masofani lokal OSRM'da xaritaga moslab (map matching) tekshiradi, normativ masofani bosib o'tgan vaqtni hisoblaydi. Shu yerdan boshlanib shu yerda tugaydigan kerakli uzunlikdagi marshrutni ham tuzib beradi.

Hammasi lokal ishlaydi: server, ma'lumotlar bazasi (SQLite), pose-model va OSRM shu kompyuterda. Tashqariga faqat AI so'rovi chiqadi (DeepSeek) — uni ham lokal model (Ollama va h.k.) bilan almashtirish mumkin.

```
 Telefon / brauzer (React, PWA)            Server (Node.js, server/)                 Lokal xizmatlar
 ┌───────────────────────────────┐        ┌─────────────────────────────────┐      ┌──────────────────────┐
 │ Turnik: kamera → MediaPipe    │        │ /api  sportchilar, natijalar    │      │ OSRM (docker)        │
 │   (model: /models/*.task)     │──────▶ │       normativlar, baholash     │────▶ │  match / route       │
 │ Yugurish: GPS → treker        │        │ yugurish tahlili  ──────────────┼────▶ │  foot profili        │
 │ AI reja, savol-javob          │        │ AI murabbiy ────────────────────┼────▶ │ DeepSeek API yoki    │
 └───────────────────────────────┘        │ SQLite (server/var/trainee.db)  │      │ lokal LLM (Ollama)   │
                                          └─────────────────────────────────┘      └──────────────────────┘
```

## Tez boshlash

Kerak: **Node.js 22.13+** (SQLite Node'ning o'zida), **Docker** (OSRM uchun).

```bash
npm run setup
```

```bash
cp server/.env.example server/.env
```

`server/.env` faylida `AI_API_KEY=` qatoriga DeepSeek kalitini yozing. Bu fayl git'ga tushmaydi.

Xarita ma'lumotini tayyorlang (O'zbekiston, Geofabrik'dan; bir marta, bir necha daqiqa) va OSRM'ni ishga tushiring:

```bash
./osrm/prepare.sh
```

```bash
docker compose up -d osrm
```

Ilovani quring va ishga tushiring:

```bash
npm run build
```

```bash
npm start
```

So'ng brauzerda: <http://localhost:8080>. **Sozlamalar** sahifasida AI va OSRM holatini ko'rasiz.

### Telefondan foydalanish (HTTPS)

Brauzerlar kamera va GPS'ni faqat HTTPS (yoki `localhost`) sahifalarga beradi. Lokal tarmoq uchun o'z sertifikatingizni yarating (IP — serverning lokal manzili):

```bash
./scripts/make-cert.sh 192.168.1.20
```

`server/.env` ga qo'shing: `HTTPS_CERT=var/cert.pem` va `HTTPS_KEY=var/key.pem`, serverni qayta ishga tushiring va telefonda `https://192.168.1.20:8080` ni oching (birinchi marta sertifikat ogohlantirishini qabul qiling). Ilovani "Bosh ekranga qo'shish" orqali o'rnatish mumkin.

### Ishlab chiqish rejimi

Ikki terminalda:

```bash
npm run dev:server
```

```bash
npm run dev:web
```

Vite <http://localhost:5173> da ochiladi, `/api` ni serverga yo'naltiradi. Telefondan sinash uchun: `HTTPS=1 npm run dev:web`.

## AI murabbiy

- Standart: DeepSeek API (`AI_BASE_URL=https://api.deepseek.com`), model `deepseek-v4-pro`. **Sozlamalar → Mavjud modellarni olish** tugmasi API'dan modellar ro'yxatini oladi va boshqasini tanlash mumkin (masalan `deepseek-v4-flash` — tezroq va arzonroq). Tanlov ma'lumotlar bazasida saqlanadi.
- Server AI'ga sportchining tayyor tahlilini yuboradi: yosh guruhi, TVI, har bir mashq bo'yicha talab (5/4/3), oxirgi va eng yaxshi natija, maqsadgacha farq, yugurish uchun maqsad sur'ati (min/km), qolgan haftalar, haftalik mashg'ulot kunlari. Javob JSON tuzilmada so'raladi va tekshiriladi.
- **Lokal model:** OpenAI'ga mos har qanday server ishlaydi. Masalan Ollama:

  ```bash
  ollama pull qwen3:8b
  ```

  `server/.env`: `AI_BASE_URL=http://127.0.0.1:11434/v1`, `AI_MODEL=qwen3:8b`, `AI_API_KEY=` (bo'sh). Model `response_format` ni qo'llamasa, server o'zi usiz qayta so'raydi (yoki `AI_JSON_MODE=false`).
- AI ishlamasa (kalit yo'q, tarmoq yo'q, javob buzuq) reja qoidalar asosida tuziladi, sahifada sababi yoziladi.

## Turnik hisoblagichi

Kamerani turnikdan 2–4 m uzoqlikka, old tomondan qo'ying: qo'llar, bosh va yelkalar kadrda bo'lsin. Video faylni ham tahlil qilish mumkin.

Takror qachon hisoblanadi (`web/src/pose/pullup.ts`):

1. Sportchi to'liq osilgan: tirsak burchagi ≥ 150°, qo'llar yelkadan yuqorida.
2. Tortilish: iyak (og'iz va burun nuqtalaridan hisoblanadi) qo'llar chizig'idan — ya'ni turnikdan — yuqoriga chiqadi.
3. Yana to'liq osilishgacha tushadi → **takror hisoblandi** (ovozli signal).

Iyak turnikdan oshmasa — "iyak turnikdan oshmadi", to'liq tushmasdan qayta tortilsa — "pastga to'liq tushmadi" deb **hisoblanmaydi** va alohida sanaladi. Gavdani tebratish (kipping) ogohlantiriladi. Model: `lite` (tez, telefonlar uchun) yoki `full` (aniqroq). Model fayllari `npm run setup` paytida `web/public/models/` ga bir marta yuklanadi, keyin internet kerak emas.

## Yugurish va OSRM

1. Sahifa ochilishi bilan GPS ishlay boshlaydi; aniqlik ±30 m dan yaxshi bo'lgach **Start**.
2. Yugurish davomida har 20 soniyada server trekni lokal OSRM'da xaritaga moslaydi va telefondagi masofani tuzatadi (GPS shovqini masofani uzaytiradi).
3. Telefon masofa yetdi deb hisoblaganda server tasdiqlaydi; tasdiqlanmasa yugurish davom etadi va qolgan masofa ko'rsatiladi. Marra — ovoz va tebranish.
4. Natija vaqti OSRM moslagan yo'l bo'ylab normativ masofani bosib o'tgan aniq paytdan olinadi. OSRM moslay olmagan joylarda (U-burilish, xaritada yo'q yo'lak) GPS masofasi shovqin koeffitsienti bilan qo'shiladi. Moslik ishonchsiz bo'lsa natija GPS bo'yicha hisoblanadi va bu yoziladi.

Aniqlik (simulyatsiya, `server/scripts/osrm-accuracy.mjs`, 20 holat: aylana va borib-qaytish marshrutlari, 1–10 m GPS shovqini): xom GPS masofasi +5…+72% uzun chiqdi; OSRM bilan 1 km vaqtidagi xato −2.7…+6.2%, aksariyati ±3%. O'z xaritangizda tekshirish:

```bash
cd server && START=41.3111,69.2797 node scripts/osrm-accuracy.mjs
```

Cheklovlar: stadion yo'lkasi yoki xaritada yo'q yo'laklarda yugurilsa OSRM moslay olmaydi (natija GPS bo'yicha). Rasmiy topshiriqda o'lchangan yo'lka va sekundomer ishonchliroq; ilova tayyorgarlik va o'z-o'zini nazorat uchun.

Boshqa hudud: `./osrm/prepare.sh https://download.geofabrik.de/asia/kazakhstan-latest.osm.pbf` yoki o'zingizdagi `.osm.pbf` fayl yo'li.

### Xarita fonini lokal qilish

Marshrut va tahlil OSRM bilan to'liq lokal. Xarita **foni** (tile) standart holatda openstreetmap.org'dan olinadi. Butunlay oflayn ishlash uchun lokal tile serverni (masalan `maptiler/tileserver-gl` va `.mbtiles` fayl) ishga tushirib, `server/.env` da `TILE_URL` ni unga yo'naltiring. Fon bo'lmasa ham trek va marshrut chiziqlari ko'rinadi.

## Normativlar

`server/data/normatives.json` — **namunaviy** jadval (7 mashq, 7 yosh guruhi, erkak/ayol). Bu rasmiy jadval emas: o'zingiz topshiradigan normativ qiymatlarini **Normativlar** sahifasida kiriting yoki JSON faylni yuklang. Tahrirlangan jadval `server/var/normatives.json` ga yoziladi; "Namunaga qaytarish" uni o'chiradi.

```json
{
  "exercises": [{ "id": "pullup", "name": "Turnikda tortilish", "unit": "marta", "better": "higher", "tracking": "pose" }],
  "ageGroups": [{ "id": "18-24", "min": 18, "max": 24 }],
  "standards": [{ "exercise": "pullup", "gender": "male", "ageGroup": "18-24", "grades": { "5": 15, "4": 12, "3": 9 } }]
}
```

`better`: `higher` (ko'proq yaxshi) yoki `lower` (vaqt — kamroq yaxshi); `tracking`: `pose` (AI kamera), `gps` (yugurish, `distance` metrda kerak) yoki `manual`. Vaqt soniyalarda.

## Fayllar

| Joy | Nima |
| --- | --- |
| `server/src/app.mjs` | API marshrutlari |
| `server/src/normatives.mjs` | Yosh guruhi, baho, farq hisoblash |
| `server/src/ai.mjs`, `coach-context.mjs` | AI murabbiy: so'rov, javobni tekshirish |
| `server/src/plan-rules.mjs` | AI'siz (qoidalar asosidagi) reja |
| `server/src/osrm.mjs`, `runs.mjs` | OSRM mijoz, yugurish tahlili |
| `shared/geo.js` | GPS hisob-kitoblari (server va web uchun umumiy) |
| `web/src/pose/` | Turnik hisoblagichi va model yuklash |
| `web/src/run/tracker.ts` | Jonli GPS treker |
| `web/src/pages/` | Sahifalar |
| `osrm/prepare.sh`, `docker-compose.yml` | Lokal OSRM |

## Testlar

```bash
npm test
```

Haqiqiy OSRM bilan (masalan Monaco test xaritasi bilan) ham:

```bash
cd server && OSRM_TEST_URL=http://127.0.0.1:5000 OSRM_TEST_LAT=43.7384 OSRM_TEST_LON=7.4246 npm test
```

## API (qisqacha)

| So'rov | Vazifa |
| --- | --- |
| `GET/POST /api/athletes`, `GET/PUT/DELETE /api/athletes/:id` | Sportchilar |
| `GET /api/athletes/:id/assessment` | Normativlar bo'yicha holat |
| `GET/POST /api/athletes/:id/results`, `DELETE /api/results/:id` | Natijalar |
| `POST /api/athletes/:id/runs` | GPS yugurishni tekshirib saqlash |
| `POST /api/runs/analyze` | Trekni tahlil qilish (saqlamasdan) |
| `POST /api/osrm/route`, `POST /api/osrm/loop` | Marshrut, aylana marshrut |
| `POST /api/athletes/:id/plan` | Reja (`{"mode":"rules"}` — AI'siz) |
| `POST /api/athletes/:id/ask` | Murabbiyga savol |
| `GET/PUT/DELETE /api/normatives` | Normativ jadvali |
| `GET /api/health`, `GET /api/ai/models`, `PUT /api/ai/model` | Holat va AI model |
