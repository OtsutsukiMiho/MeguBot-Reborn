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

พอร์ตสำหรับเครื่องพัฒนามาจาก `.env`: `NEXT_PORT=3100`, `EXPRESS_PORT=3001`.
ใน production ให้ลงทะเบียน OAuth redirect ของ Discord ให้ตรงกับ
`${FRONTEND_URL}/api/auth/callback` (หรือ `DISCORD_REDIRECT_URI` หากกำหนดเอง)
บน public origin เดียวกับเว็บ; `next.config.js` proxy `/api/*` ต่อไปที่ Express.

### Deployment request origin

Set `FRONTEND_URL` to the single public application origin (for example,
`https://app.example.test`), matching the browser URL and OAuth registration.
Express compares mutation requests against this configured origin, never the
private API host or forwarded Host headers. Same-origin form and JSON requests
continue to work. Cross-origin/sibling-origin requests, malformed origin evidence
and cookie-authenticated requests with neither Origin nor Referer are rejected.
An exact-origin Referer is accepted when Origin is absent. Conflicting evidence
is rejected. Console/account mutations, signed-in API mutations, and activity
mutations (including anonymous device-cookie actions) share this boundary.
Public read-only activity routes and unsigned ping retain their existing contracts.
Normal route authentication and permissions still apply. OAuth login/callback
GET routes and existing SameSite cookie settings are unchanged.

There is no machine-auth exemption for console APIs. Cookie-based clients must
authenticate normally and provide the trusted Origin/Referer evidence; a dummy
Authorization header does not bypass browser protection. Deploy the correct
public origin before testing mutations behind the Next-to-Express proxy. See
[database TLS configuration](DATABASE.md#2-set-the-environment) for remote
database trust requirements.

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

### โปรเจกต์และทีม

ฟีเจอร์โปรเจกต์และทีมเปิดอยู่โดยค่าเริ่มต้น หากต้องการทยอยเปิดใช้งานให้กำหนด flag
ฝั่งเซิร์ฟเวอร์และ browser ให้ตรงกันก่อน build:

```dotenv
MEGU_PROJECTS_ENABLED=1
NEXT_PUBLIC_MEGU_PROJECTS_ENABLED=1
MEGU_PROJECT_TEAMS_ENABLED=1
NEXT_PUBLIC_MEGU_PROJECT_TEAMS_ENABLED=1
MEGU_PROJECT_TEAMS_DISCORD_ENABLED=1
NEXT_PUBLIC_MEGU_PROJECT_TEAMS_DISCORD_ENABLED=1
```

Goals ใช้ opt-in ฝั่งเซิร์ฟเวอร์ `MEGU_TEAM_GOALS_ENABLED=1` และ automatic Discord
role sync ใช้ opt-in แยกต่างหาก `MEGU_TEAM_ROLE_SYNC_ENABLED=1` หลังตรวจสิทธิ์และ
ความยินยอมที่เกี่ยวข้อง; ทั้งสองค่าไม่ได้เปิดตาม flags ของทีมโดยอัตโนมัติ.
กำหนด flags ที่ต้องการให้ตรงกันระหว่างเว็บ บอท และ frontend build ก่อน rollout.
การสร้างทีม/โปรเจกต์ต้องมีตาราง `workspace_creations` เพิ่มโดย schema initializer
พร้อมสิทธิ์ DDL ที่จำเป็น และต้องเก็บ receipt นี้ไว้ในการสำรอง/กู้คืนฐานข้อมูล.
ระหว่าง rollout ห้ามให้ worker รุ่นเก่าที่ยังรับ create แบบไม่มี request key
ทำงานร่วมกับรุ่นใหม่. See [database TLS configuration](DATABASE.md#2-set-the-environment)
for remote PostgreSQL trust and `MEGU_PG_CA_FILE`.

ตั้ง `MEGU_PROJECT_TEAMS_ENABLED=0` เพื่อปิด API ของทีม และตั้งค่า `NEXT_PUBLIC_...`
เป็น `0` ใน build เดียวกันเพื่อซ่อนทางเข้า UI ระหว่าง rollback โดยโปรเจกต์แบบเดี่ยวยังคงทำงานได้

`MEGU_PROJECT_TEAMS_DISCORD_ENABLED=0` ปิดเฉพาะการเชื่อมทีมกับเซิร์ฟเวอร์ การค้นหา
สมาชิก/ยศ Discord และมุมมองทีมในคอนโซลเซิร์ฟเวอร์ โดยไม่ปิดทีมอิสระ โปรเจกต์เดี่ยว
หรือสิทธิ์สมาชิกที่มีอยู่ ค่า `NEXT_PUBLIC_...` คู่กันต้องถูกกำหนดก่อน build เพื่อซ่อน
ตัวเลือกฝั่ง browser ด้วย การเชื่อมต่อเป็นตัวช่วยจัดกลุ่มและค้นหาสมาชิกเท่านั้น การเปลี่ยนยศ
Discord จะไม่เพิ่มหรือลบสิทธิ์ Megu อัตโนมัติ

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
