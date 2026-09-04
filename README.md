# Megu

โดย **Megux Corp**

Megu เป็นทั้งบอท Discord และตัวจัดการกิจกรรมของกลุ่ม สองส่วนนี้ใช้บอทตัวเดียวกัน
แต่คนละกลุ่มผู้ใช้ และเข้าถึงกันคนละทาง:

| ส่วน | คนใช้ | เข้าที่ |
|---|---|---|
| **คอนโซลเซิร์ฟเวอร์** — automod, welcome, autorole, reaction role, TTS, honeypot, audit log | แอดมินเซิร์ฟเวอร์ | `/servers` |
| **กิจกรรมของกลุ่ม** — นัดเวลา, หารเงิน, PromptPay, ตรวจสลิป, ทวงให้ | เพื่อนในกลุ่ม ไม่ต้องเป็นแอดมิน | `/activities` |

หน้ากิจกรรมสาธารณะ `/a/<CODE>` เปิดได้โดยไม่ต้องล็อกอินและไม่ต้องมี Discord

การจ่ายเงินใช้ QR PromptPay ที่สร้างในเครื่องโดยไม่มี gateway/ค่าธรรมเนียม
รองรับจ่ายบางส่วนหรือหลายงวดในครั้งเดียว สลิปที่ตรงเงื่อนไขจะลงยอดแบบ
optimistic และเจ้าของย้อนผลพร้อมเหตุผลได้ ภาพต้นฉบับเป็นข้อมูลชั่วคราว;
ระบบเก็บเฉพาะ evidence card ที่สร้างใหม่และ field ที่จำเป็นต่อข้อพิพาท
โดย backend อ่านภาพสลิปซ้ำเองและไม่เชื่อค่าที่ browser ส่งมา
Discord รับสลิปผ่านคำสั่ง `/จ่าย` เท่านั้น ไม่สแกนห้องสนทนาทั่วไป

## เริ่มใช้งาน

```bash
docker compose up -d     # Postgres สำหรับพัฒนา (พอร์ต 55432)
npm install
npm run dev              # เปิด bot + Express API + Next พร้อมกัน
```

เวลา deploy หรือ instance ตื่นจาก hibernate ให้ใช้ `npm start` หรือ `npm run boot`
ซึ่งจะเริ่ม service โดยไม่ register slash commands ซ้ำทุกครั้ง ใช้ `npm run deploy`
เฉพาะเมื่อไฟล์ใน `commands/` เปลี่ยนเท่านั้น

พอร์ตมาจาก `.env` และห้ามเปลี่ยนตามใจ: `NEXT_PORT=3100`, `EXPRESS_PORT=3001`
เพราะ `DISCORD_REDIRECT_URI` ชี้ที่ 3100 ซึ่ง `next.config.js` proxy `/api/*`
ต่อไปที่ Express อีกที

### Discord login และอีเมลแจ้งเตือน

การเข้าสู่ระบบใช้ Discord เท่านั้น Google OAuth ไม่ได้เปิดเป็นช่องทางเข้าสู่ระบบหรือ
เชื่อมบัญชีใหม่แล้ว บัญชีเดิมที่เคยมีอีเมลยืนยันยังรับอีเมล transactional จาก Megu
ผ่าน Resend ได้ตามการตั้งค่าเดิม:

```dotenv
# สร้างด้วย: node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
MEGU_OAUTH_CREDENTIAL_KEY=...

RESEND_API_KEY=...
MEGU_EMAIL_FROM=Megu <notifications@example.com>
```

`MEGU_OAUTH_CREDENTIAL_KEY` ใช้เข้ารหัส Discord refresh token แบบ AES-256-GCM
เพื่อให้ผู้ใช้เดิมกลับมาเปิดคอนโซลเซิร์ฟเวอร์ได้โดยไม่ต้องอนุญาต Discord ใหม่ทุกครั้ง

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
npm run build
```
