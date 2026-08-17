# Megu

โดย **Megux Corp**

Megu เป็นทั้งบอท Discord และตัวจัดการกิจกรรมของกลุ่ม สองส่วนนี้ใช้บอทตัวเดียวกัน
แต่คนละกลุ่มผู้ใช้ และเข้าถึงกันคนละทาง:

| ส่วน | คนใช้ | เข้าที่ |
|---|---|---|
| **คอนโซลเซิร์ฟเวอร์** — automod, welcome, autorole, reaction role, TTS, honeypot, audit log | แอดมินเซิร์ฟเวอร์ | `/servers` |
| **กิจกรรมของกลุ่ม** — นัดเวลา, หารเงิน, ทวงให้ | เพื่อนในกลุ่ม ไม่ต้องเป็นแอดมิน | `/activities` |

หน้ากิจกรรมสาธารณะ `/a/<CODE>` เปิดได้โดยไม่ต้องล็อกอินและไม่ต้องมี Discord

## เริ่มใช้งาน

```bash
docker compose up -d     # Postgres สำหรับพัฒนา (พอร์ต 55432)
npm install
npm run dev              # เปิด bot + Express API + Next พร้อมกัน
```

พอร์ตมาจาก `.env` และห้ามเปลี่ยนตามใจ: `NEXT_PORT=3100`, `EXPRESS_PORT=3001`
เพราะ `DISCORD_REDIRECT_URI` ชี้ที่ 3100 ซึ่ง `next.config.js` proxy `/api/*`
ต่อไปที่ Express อีกที

## โครงสร้าง

```
index.js               ตัวคุมโพรเซส — fork bot, web, next
backend/bot/           ตัวบอท Discord, คิวเสียง, ฟังก์ชันร่วม
backend/web/           Express API
backend/database/      ชั้นเชื่อมฐานข้อมูลของบอท
commands/              slash commands
core/                  โดเมนล้วน ไม่รู้จัก Discord, HTTP หรือ React
adapters/              ตัวต่อ core เข้ากับ Discord และ HTTP
app/                   เว็บ (Next.js App Router)
tests/                 npm test
scripts/               seed-demo, db-audit, contrast-audit
```

- [DATABASE.md](DATABASE.md) — ตั้งค่าฐานข้อมูลบน Supabase ตั้งแต่ศูนย์ ทำตามได้เลยโดยไม่ต้องอ่านไฟล์อื่น
- [HANDOFF.md](HANDOFF.md) — รายละเอียดการออกแบบและสิ่งที่ยังไม่ได้ทำ
- [DISCORD-RATE-LIMITS.md](DISCORD-RATE-LIMITS.md) — กฎที่ห้ามฝ่าฝืน ไม่งั้น Cloudflare จะบล็อก IP ของเซิร์ฟเวอร์จาก Discord ทั้งตัว อ่านก่อนเขียนอะไรที่คุยกับ Discord แบบวนซ้ำหรือตั้งเวลา
- [CHANGES.md](CHANGES.md) — สาขานี้เปลี่ยนอะไรเทียบกับ main สำหรับคนรีวิว PR

## ตรวจสอบ

```bash
npm test         # ชุดทดสอบ + ตรวจ contrast ของสี
npx next build
```
