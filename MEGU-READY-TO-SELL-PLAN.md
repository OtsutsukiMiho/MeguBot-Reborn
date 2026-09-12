# Megu — แผนผลิตภัณฑ์และการพัฒนาจนพร้อมขาย

ฉบับอภิปราย v1 · 13 กันยายน 2026

ฐานโค้ดที่ตรวจ: remote main `c50f408` (Projects attention flows); working tree ในเครื่องยังเป็น `1eabf20` พร้อมการแก้ข้อความ Megu ที่ยังไม่ commit แผนนี้ไม่ได้อ้างว่าฟีเจอร์ใหม่สร้างหรือทดสอบแล้ว และไม่ได้เปลี่ยนระบบ production

## 1. ภาพปลายทางและขอบเขต

Megu เป็นเพื่อนที่ไม่กำหนดเพศและผู้ช่วยรอบด้านบน Discord ผู้ใช้ทั่วไปใช้เสียง เพลง TTS การเตือน ดูแลชุมชน กิจกรรม และโปรเจกต์ได้ องค์กรเพิ่มการบริหารสมาชิก งาน การประชุม และความรู้ร่วมกันบนฐานเดียวกัน เปิดเฉพาะโมดูลที่ต้องใช้ได้

คำสัญญาของส่วนองค์กร: “คุย ประชุม และตามงานต่อใน Discord โดยมีข้อมูลย้อนหลังที่ตรวจสอบได้บนเว็บ” ความสำเร็จวัดจากงานที่ต่อเนื่องและภาระที่ลดลง ไม่ใช่จำนวนข้อความที่บอทส่ง

วงจรหลัก: รับเป้าหมาย → สร้าง Project/มอบหมาย Topic → นัดและตอบรับ → ประชุม → ถอดเสียง → ตรวจข้อสรุป → ยืนยันงาน → ติดตาม → ประชุมครั้งต่อไปพร้อมบริบท

Meetings ใช้เดี่ยวได้: ประชุมทีม ประชุมข้าม Project ประชุมใหญ่ของ CEO และคุยงานทั่วไป ไม่บังคับสร้าง Project หรือ Organization ก่อนใช้ บันทึกเสียงและข้อความเป็นแกนที่ต้องส่งมอบ; live transcript และ Stage เป็นงานใน roadmap ที่ต้องพิสูจน์ความสามารถ ไม่ลบทิ้งเพียงเพราะทำยาก

เอกสาร DIRECTION เดิมเน้น voice companion ส่วนแผนนี้เป็นข้อเสนอขยายทิศทางตามการสนทนาล่าสุด เมื่อเริ่ม implementation ให้บันทึก direction ฉบับใหม่อย่างชัดเจนและคงฟีเจอร์ผู้ใช้ทั่วไป

## 2. สิ่งที่มีแล้ว / สิ่งที่ต้องเพิ่ม

| ส่วน | หลักฐานบน main ล่าสุด | แผนต่อยอด |
|---|---|---|
| Project/Topics | `core/projects.js`, `ProjectWorkspace.js`: timeline, assignments, reports, reviews, milestones, dependencies | ใช้เป็นแกนงานเดิม เพิ่มเป้าหมาย ผู้มอบหมาย ผู้รับผล และที่มาจากการประชุม |
| สมาชิก Project | Owner/Lead/Member/Viewer, join request, invitation, ownership transfer | เพิ่มองค์กรเหนือ Project โดยไม่ทำให้ guild admin ได้อ่านโปรเจกต์ส่วนตัวโดยอัตโนมัติ |
| Discord Projects | `commands/utility/projects.js`: สร้าง มอบหมาย รายงาน ตรวจงาน | เพิ่มทางเข้าผ่านปุ่มและบริบทช่อง ลดการพิมพ์รหัสซ้ำ |
| การแจ้งเตือน | project-reminders, channel delivery queue, retries/deduplication | reuse delivery layer สำหรับคำเชิญ นัดหมาย และสรุป พร้อมตรวจสิทธิ์ใหม่ก่อนส่ง |
| Activity | โหวตเวลา RSVP ผู้ร่วมและค่าใช้จ่าย | reuse หลักการ scheduling และ component ที่เหมาะสม; ไม่ reuse guest permission กับประชุมลับ |
| Bills | มุมมอง activity ที่มีเงิน/recurring | แยก Expenses ออกจากค่าบริการ Megu; เชื่อม Project ได้โดยไม่คัดลอก ledger |
| Voice/TTS | join, playback, voice automation | เพิ่มรับเสียง/session ownership และ meeting mode ไม่ให้ automation เดิมย้ายบอทหนี |
| Meetings/ASR | ยังไม่พบระบบประชุมบันทึกครบวงจรในส่วนที่ตรวจ | เพิ่มโดเมนและ pipeline ใหม่ |
| Enterprise/Billing | ยังไม่ใช่ระบบองค์กรและ subscription ครบวงจร | tenant, policies, entitlements, usage, support และ launch gates |

ก่อนเริ่ม feature ให้แก้ recovery ของ Projects ที่มีบันทึกไว้: join link หลัง refresh/หมดอายุ/ถูกปฏิเสธ, loading/error, date conventions, notification feedback และทดสอบสิทธิ์ล่าสุด อย่าใช้คำว่า pilot verified ในเอกสารเก่าแทนการทดสอบ build ใหม่

## 3. โครงสร้างผลิตภัณฑ์

บัญชี Megu → พื้นที่ส่วนตัว หรือ Organization → เชื่อม Discord guild ที่ได้รับอนุญาต

- Organization มีทีม สมาชิก บทบาท นโยบาย และหลาย Project/Meeting; เริ่มเปิดใช้หนึ่ง guild ได้ โดย schema รองรับหลาย guild
- Project มี Topics, people, timeline, updates และลิงก์ Meetings/Expenses ที่ได้รับสิทธิ์
- Meeting เป็น entity อิสระ มี organizer, participants, access policy, schedule, language profile และ sessions
- Meeting เชื่อมหลาย Project ผ่าน relation ได้ แต่การเข้าประชุมไม่ให้สิทธิ์อ่านทุก Project; action ที่ส่งเข้า Project ตรวจ role ของปลายทางอีกครั้ง
- บันทึก เสียง ข้อสรุป และข้อเสนอ เป็นของ Meeting เดียวกัน แสดงผ่านเว็บและ Discord ตามขอบเขตผู้ชม
- สมาชิกผู้ใช้ทั่วไปไม่ต้องกรอกโครงสร้างองค์กร; workspace selector แสดงเฉพาะพื้นที่ที่เข้าถึงได้
- การย้าย Project ส่วนตัวเข้าองค์กรต้องให้เจ้าของยืนยันผลต่อ ownership/access; ไม่ backfill ให้ทุก project เป็นของ guild ที่เชื่อมอยู่

## 4. ประสบการณ์ Discord ตั้งแต่นัดถึงตามงาน

### 4.1 สร้างและมอบหมายงาน

ผู้บริหาร/ผู้มอบหมายระบุเป้าหมาย ผลลัพธ์ที่ยอมรับ วันเป้าหมาย และ Lead ของ Project ได้ Lead แตก Topics และมอบหมายผ่านระบบเดิม ผู้รับมอบหมายเห็นที่มาและผู้ตรวจรับ คำว่า sponsor เป็นความสัมพันธ์กับ Project ไม่ใช่สิทธิ์อ่านทุกอย่างทั้งองค์กร

### 4.2 นัดประชุม

ใช้ `/meeting create` หรือปุ่ม “นัดประชุม” จาก Project → modal ชื่อ วาระ เวลา/โหวตเวลา ผู้ร่วม ห้องเสียง และภาษา → แสดงตัวอย่างผู้ได้รับเชิญและผู้ดูบันทึก → ยืนยันส่ง

เลือกสมาชิก Project, Discord role หรือรายคนได้ ผู้จำเป็น/ผู้เข้าฟังเป็นคนละสถานะ รายชื่อที่ส่งจริงบันทึกเป็น snapshot; การเพิ่มคนภายหลังให้ตรวจและส่งเฉพาะคนใหม่ ไม่ขยายสิทธิ์บันทึกย้อนหลังเงียบ ๆ เมื่อ role เปลี่ยน

การ์ดนัดมี [เข้าร่วม] [ไม่สะดวก] [อาจเข้าร่วม] [ดูวาระ] และเวลาตาม timezone ผู้ชม ส่ง DM เมื่อผู้ใช้อนุญาต หาก DM ปิดแสดง failed ให้ organizer และใช้ทางเลือกในช่องที่มีสิทธิ์ ไม่โพสต์รายละเอียดลับลงช่องสาธารณะ

โหวตเวลา: เสนอหลายช่วง ดู availability ไม่จำเป็นต้องแสดงเหตุผลส่วนตัว ให้ organizer เลือกเวลาสุดท้าย ถ้าไม่มีเวลาร่วมกันเสนอช่วงใหม่ ไม่ยืนยันเองโดยไม่แจ้งผู้จัด การแก้เวลายกเลิก reminder เก่าโดย revision/dedupe

### 4.3 เริ่มประชุมและบันทึก

ก่อนเริ่ม: ตรวจสิทธิ์ห้อง อุปกรณ์รับเสียง พื้นที่จัดเก็บ นาทีคงเหลือ ผู้ได้รับสิทธิ์ และการรับรู้/ยินยอมตามนโยบาย เปิด meeting mode เฉพาะ session นี้

การ์ดควบคุมแสดง “กำลังบันทึก · ไทยเป็นหลัก · ผู้เข้าร่วม 8 คน” มี [พักบันทึก] [บันทึกประเด็น] [ดูข้อความสด] [จบประชุม] ปุ่มเริ่ม/หยุดให้ host หรือ co-host ที่ได้รับสิทธิ์ ทุก action บันทึก audit

ผู้เข้าทีหลังต้องได้รับ notice ก่อนบันทึกเสียงของตน หากยังไม่ยืนยันให้ไม่ subscribe เสียงบัญชีนั้นและแจ้ง host; หากมีเสียงลอดไมค์คนอื่นหรือไม่สามารถแยกได้จริงให้พักทั้ง session แล้วเลือกวิธีประชุมที่เหมาะสม การถูกเชิญไม่เท่ากับยินยอมบันทึก

พักเพลง เสียงทักทาย และ TTS อัตโนมัติในห้องประชุม คืนค่าที่เคยใช้เมื่อจบ อย่าเปลี่ยนค่าถาวรทั้งเซิร์ฟเวอร์ การมีคนพูดทับกัน/เข้าออก/บอท reconnect ต้องไม่ทำให้เสียงหายแบบไม่มีข้อความเตือน

### 4.4 จบประชุม

เมื่อ host จบ: ปิดรับเสียง → flush/upload → ถอดเสียงฉบับสมบูรณ์ → สรุปพร้อมหลักฐาน → host ตรวจ → publish เฉพาะผู้มีสิทธิ์ Discord แสดงความคืบหน้าจริง เช่น “กำลังถอดเสียงช่วงท้าย” และเตือนถ้าบันทึกขาด ไม่ขึ้น “เสร็จแล้ว” ก่อนข้อมูลพร้อม

ส่งการ์ดหลักหนึ่งใบใน thread ของ Meeting: ข้อสรุป ข้อตกลง ประเด็นค้าง งานที่เสนอ พร้อม [ตรวจข้อสรุป] [ยืนยันงาน] [เปิดบันทึก] ไม่ส่งหนึ่งข้อความต่อหนึ่งประโยคจนห้องแชทใช้งานไม่ได้

### 4.5 นำไปทำงานต่อ

ทุก action item มี description, proposed owner, due date หรือ “ยังไม่กำหนด”, target Project/Topic และ timestamp อ้างอิง ผู้มีสิทธิ์แก้แล้วกดยืนยัน สร้าง Topic ใหม่หรืออัปเดตเดิม ไม่สร้างระบบ Tasks ซ้ำ

Meeting ไม่มี Project ให้เก็บ action checklist ของการประชุมพร้อม responsible person; เปลี่ยนเป็น Topic เมื่อเลือก Project ภายหลังผ่าน conversion ที่ idempotent ไม่ต้องบังคับสร้าง Project เพื่ออ่านสรุป

## 5. หน้าตาและระบบนำทาง

แนวภาพ: ใช้พื้นกระดาษ/เขียว celadon ของ Projects ล่าสุด ตัวอักษรไทยอ่านง่าย สถานะมีข้อความไม่พึ่งสี ใช้รายการงานเป็นเนื้อหาหลัก Megu เป็นเสียงช่วยเหลือที่ไม่กำหนดเพศ ทั้ง light/dark และมือถือ

| หน้าจอเสนอ | เนื้อหาแรกที่ต้องเห็น | Action หลัก |
|---|---|---|
| Home / งานของฉัน | นัดถัดไป งานฉันค้าง รายการรอฉันตรวจ | เข้า Meeting / รายงานงาน |
| Meetings `/meetings` | กำลังประชุม → นัดถัดไป → ประวัติ; ค้นชื่อ Project/วันที่ | นัดใหม่ / เริ่มทันที |
| Create meeting | ชื่อ ผู้ร่วม เวลา ภาษา บันทึกและผู้ดูย้อนหลัง | ตรวจคำเชิญแล้วส่ง |
| Meeting `/m/[code]` | ชื่อ สถานะ ภาษา ห้อง และ access audience | เข้าประชุม/ควบคุม ตาม role |
| Meeting: Summary | ข้อสรุปที่รับรองแล้ว แยกข้อเสนอ AI และฉบับร่าง | ตรวจ/เผยแพร่ |
| Meeting: Transcript | ผู้พูด เวลา ข้อความ ค้นหาและฟังช่วงนั้น | แก้ถอดเสียง/ถอดใหม่ |
| Meeting: Actions | งานที่เสนอ เจ้าของ กำหนดส่ง Project ปลายทาง | ยืนยันทีละงานหรือชุดที่ตรวจแล้ว |
| Meeting: People | ผู้เชิญ ผู้เข้าจริง recording notice สถานะสิทธิ์ | เชิญเพิ่ม/แก้สิทธิ์ |
| Project | Timeline/Topics/Updates เดิม + Meetings แบบเชื่อม | นัด progress meeting |
| Organization | ทีม สมาชิก โปรเจกต์ สิทธิ์ นโยบาย | จัดการองค์กร |
| Usage & Plan | นาทีที่ใช้/เหลือ ค่าใช้จ่ายที่อนุญาต อายุข้อมูล | ปรับแพ็กเกจ/วงเงิน |

เมนูผู้ใช้ทั่วไป: Home, Projects, Meetings, Activities, Bills, Servers ตามโมดูลที่เปิด; องค์กรใช้ workspace navigation กลุ่ม Work (Projects/Meetings), Expenses, People, Settings ไม่ยัดเมนูทั้งสองโหมดพร้อมกัน Activities เดิมยังเปิดลิงก์ได้ แต่หน้าตารางนัดขององค์กรเน้น Meetings

มือถือ: ซ่อน sidebar เป็นเมนู, transcript เต็มความกว้าง, ปุ่มฟัง/พักติดด้านล่าง, detail เป็นหน้า/แผงเดี่ยว; 390px และ 200% zoom ต้องไม่ชน ไม่ลาก timeline เป็นวิธีเดียว

ตัวอย่าง Discord หลังประชุม:

```text
Megu · ประชุม API readiness · รอตรวจข้อสรุป
ไทยเป็นหลัก | 45 นาที | เชื่อม Project Launch
ตกลงแล้ว: ใช้ sandbox ทดสอบก่อน production [12:08]
ยังมีเงื่อนไข: ทดสอบรวมพรุ่งนี้ หากสิทธิ์พร้อม [18:42]
เสนอ 2 งาน · ยังไม่ส่งมอบหมายจนกว่าจะยืนยัน
[ตรวจสรุป] [ตรวจงาน 2 รายการ] [ฟังและอ่านข้อความ]
```

## 6. ภาษาและคุณภาพการถอดเสียง

language profile: primary language, allowed languages, glossary และระดับ fallback ตั้งค่าเริ่มต้น guild/organization แล้ว override ต่อ Meeting ได้ ไทยเป็นหลัก, อังกฤษเป็นหลัก, ไทย–อังกฤษ, auto เฉพาะเมื่อเลือก

กำหนดภาษาที่ขั้น ASR จริง ใช้ capability matrix ของ provider: forced language, multilingual allowlist, streaming, timestamps, per-speaker input, retention และราคา ห้ามแสดง “จำกัดภาษาแล้ว” หาก provider รองรับแค่ hint; ถ้าไม่รองรับ allowlist ใช้โมเดลที่รองรับหรืออธิบายโหมด primary-language ตามจริง

- แยก audio stream ตาม Discord user ID + timestamp จึงไม่ต้องเดาผู้พูดจากน้ำเสียงอย่างเดียว บัญชีเดียวหลายคนแสดง “บัญชีนี้มีหลายผู้พูด” เมื่อผู้ใช้ระบุ ไม่สร้างชื่อคนเอง
- VAD และ chunk มีบริบท/overlap; stitch ข้อความไม่ซ้ำ รักษา clock เดียวรองรับเสียงทับ ไม่ตีความเสียงเงียบเป็นประโยค
- ไม่แทนจีน/เกาหลีที่ผิดด้วยการแปลไทย ทำ flag ภาษาผิดขอบเขตและ reprocess จากเสียง หากยังไม่แน่ชัดใช้ [ฟังไม่ชัด] ไม่แต่งคำ
- glossary ของ Project/องค์กร: ชื่อคน ผลิตภัณฑ์ ตัวย่อ เป็น hint ไม่ใช่ข้อความบังคับ
- live เป็น provisional; final อาจแก้คำ แสดง version และไม่ใช้ draft ที่เปลี่ยนได้สร้างงานอัตโนมัติ
- เปลี่ยนภาษา/แก้ transcript สร้าง revision ใหม่ เก็บต้นฉบับและผู้แก้; summary เก่าติดป้าย stale และให้ตรวจฉบับใหม่ งานที่ยืนยันแล้วไม่ถูกแก้เงียบ ๆ
- รองรับไทยปนอังกฤษ เสียงมือถือสำเนียงต่าง ๆ ไมค์เบา เสียงก้อง ชื่อเฉพาะ ช่วงเงียบ และหลายคนพูดพร้อมกัน

ชุดประเมินใช้เสียงที่ผู้ร่วมอนุญาตเพื่อทดสอบ ไม่ดึงประชุมลูกค้ามาเป็น dataset โดยปริยาย อย่างน้อย 60 คลิป/120 นาที ครอบคลุมเงื่อนไขข้างต้นและอย่างน้อย 10 ผู้พูด เปรียบเทียบผู้ให้บริการ 2 รายด้วย rubric เดียวกัน

เป้าหมายเริ่มต้นที่ต้องปรับหลัง baseline (ไม่ใช่ผลที่วัดแล้ว): Thai CER ≤15% ในเสียงชัดโดย normalize แบบเดียวกัน; ชื่อ/ตัวเลข/วันสำคัญถูก ≥95%; ไม่มีประโยคแต่งขึ้นในชุด silence; ประโยคผิดภาษานอกขอบเขต ≤1% ในชุดไทย; speaker attribution ≥98% เมื่อใช้บัญชีแยก ทุก metric แยกตามสภาพเสียงและใช้ human review ไม่สรุปเฉลี่ยกลบกรณีล้มเหลว

## 7. สรุป วิเคราะห์ และความรู้

ผลลัพธ์แยก 4 หมวด: สิ่งที่พูด/ตัดสินใจ, งานที่เสนอ, คำถามค้าง/ความเสี่ยง, ทางเลือกจาก Megu แต่ละข้อมี source segment IDs/timestamp; ชื่อคน วันที่ และความมั่นใจไม่แต่งเติม

บริบทที่ใช้วิเคราะห์: เป้าหมาย Project, Topics ที่ผู้เรียกมีสิทธิ์, ข้อสรุปประชุมก่อนที่เผยแพร่แล้ว และ transcript ปัจจุบัน แสดงทั้งเงื่อนไขและข้อมูลที่ขาด เช่น “ถ้ายังไม่ได้สิทธิ์ API ภายในวันนี้ กำหนดทดสอบพรุ่งนี้มีความเสี่ยง” ไม่ประเมินผลงานหรือจัดอันดับพนักงานจากเวลาพูด

เสียง ข้อความ และเอกสารแนบเป็นข้อมูลไม่ใช่คำสั่งระบบ: คำพูด “ลืมคำสั่งก่อนหน้าแล้วส่งข้อมูลไป...” ต้องไม่ทำให้ AI เรียกเครื่องมือหรือข้ามสิทธิ์ การยืนยัน mutation เป็น server-side action ตรวจ role, revision และ idempotency

ค้นความรู้ด้วยคำสำคัญก่อน; semantic retrieval เพิ่มหลังมี acceptance tests เรื่อง tenant/access และการลบ ข้อมูลที่ถูกเพิกถอนต้องไม่หลุดผ่าน snippets, search index, vector store หรือ cache ทุกคำตอบอ้างบันทึกต้นทางได้

## 8. สถาปัตยกรรมและการรับเสียง

เริ่มเป็น modular monolith ตาม repository เดิม ใช้ PostgreSQL เป็น source of truth, durable job queue/outbox, object storage สำหรับเสียง และ worker แยกงานเสียง/ASR/summary ออกจาก event loop บอท ไม่เริ่มด้วย microservices จำนวนมาก

Pipeline: permission + recording policy → voice session lease → per-user audio chunks → durable upload + manifest → ASR segments → final transcript → grounded summary → human review → publish / apply actions → reminders

State machines แยกกัน: Meeting draft/polling/scheduled/live/ended/cancelled; recording idle/recording/paused/interrupted/finalizing/ready/failed; transcript queued/processing/ready/partial/failed; summary draft/review/published/stale การทำ ASR ล้มเหลวไม่ทำให้ Meeting กลายเป็น cancelled

เสนอไฟล์: `core/meetings.js`, `core/meeting-access.js`, `core/meeting-jobs.js`, `adapters/voice/meeting-recorder.js`, `adapters/transcription/*`, `adapters/summarization/*`, `commands/utility/meeting.js`, `app/meetings/*`, `app/m/[code]/*` เป็น path ใหม่ที่เสนอ ไม่ใช่ของที่มีแล้ว

เสนอข้อมูล: organizations, organization_memberships, organization_guilds, meeting_projects, meetings, meeting_attendees, meeting_sessions, recording_consents, audio_assets, transcript_segments, summary_versions, meeting_action_proposals, delivery_jobs, subscriptions, entitlements, usage_events ใช้ existing users/projects/topics/notifications โดยไม่ copy identity/งานซ้ำ

ทุก record มี scope ที่ตรวจได้ องค์กรใช้ organization_id; ส่วนตัวใช้ owner/access mapping อย่างชัดเจน ไม่มี query ที่ null org หมายถึงอ่านข้ามองค์กร ทุก segment เก็บ speaker ID, start/end, provider/model version, language, source asset และ revision

เสียงเข้ารหัสระหว่างส่ง/จัดเก็บ, signed URL อายุสั้นที่ออกหลัง auth check, checksums, chunk sequence และ gap markers ก่อนรู้ว่า flush สำเร็จไม่ลบ buffer หาก worker ล้ม resume จาก manifest ได้ retry ไม่คิด usage ซ้ำและไม่สร้าง transcript ซ้ำ ลบ asset แล้วห้าม job เก่าทำให้ฟื้นกลับมา

ต้องมี voice lease ต่อ bot/guild เพื่อให้ music/join/auto-rejoin ไม่แย่ง session หลายการประชุมพร้อมกันต้องทดลอง capacity และแนวทางหลาย bot application ที่สอดคล้องกับ platform limits ห้ามใช้ token pool เพื่อหลบ rate limits ถ้า capacity เต็มแสดงก่อนนัด/เริ่ม ไม่เตะประชุมอื่นออก

Stage spike: ทดสอบเข้าฟัง, speaker เปลี่ยน, audience ขึ้นพูด, reconnect, channel permission, live stage จบ และการรับเสียงจริง แยกจาก voice channel/DAVE test รายงาน support matrix ตามผล ไม่โฆษณา Stage recording ก่อนผ่าน

## 9. สิทธิ์และนโยบายองค์กร

| Role/context | สิทธิ์ตั้งต้น |
|---|---|
| Org owner/admin | จัดสมาชิก แพ็กเกจ นโยบาย; ไม่ได้อ่านทุกประชุมส่วนตัวโดยอัตโนมัติ |
| Project owner/lead | ดูและจัดงานตามสิทธิ์ Project เดิม นัด Meeting ที่เกี่ยวข้อง |
| Meeting host/co-host | ตั้งค่าประชุม ควบคุมการบันทึก ตรวจ/เผยแพร่ตามสิทธิ์ |
| Invited participant | ตอบรับ เข้าประชุม; อ่านย้อนหลังเมื่อได้รับ recording access |
| Viewer/guest | ดูเฉพาะสิ่งที่แชร์อย่างชัดเจน ไม่แก้/อนุมัติ Topic |
| Billing admin | invoice/usage แบบรวม ไม่ได้ transcript/เสียง |

ข้อมูลคงอยู่กับองค์กรเมื่อคนออก; revoke membership ยกเลิก session/download authorization และ job recipient ที่รอส่ง ไม่ลบประวัติงานหรือบันทึกทางธุรกิจตามไปโดยอัตโนมัติ ใช้ audit สำหรับการโอน/เปลี่ยนสิทธิ์

ก่อน pilot มี notice ที่ชัด, recording controls, delete/export และ retention ตั้งต้นที่เสนอ: raw audio 30 วัน transcript/summary 90 วัน ปรับตามแพ็กเกจ/นโยบายและแสดงวันหมดอายุจริงก่อนเริ่ม ไม่ยึดตัวเลขนี้เป็นข้อกำหนดกฎหมาย

Discord attachment ที่ดาวน์โหลดแล้วเรียกคืนไม่ได้: เนื้อหาลับ default เป็นลิงก์เว็บตรวจสิทธิ์ ไม่ส่งไฟล์เสียงถาวรในช่อง ทุกองค์กรเลือก publish scope; bot permissions ในช่องไม่ใช่ข้อพิสูจน์ว่าทุกคนในช่องมีสิทธิ์อ่าน Meeting

ก่อนขายตรวจ privacy notice, terms, deletion/export request, subprocessors และข้อตกลงประมวลผลข้อมูลตามตลาดกับผู้เชี่ยวชาญที่เหมาะสม ตรวจ provider ว่าไม่ใช้ข้อมูลลูกค้าฝึกโมเดลและกำหนด retention ได้จริง ไม่อ้าง compliance certificate ที่ยังไม่มี

## 10. แพ็กเกจและรายได้ (ข้อเสนอสำหรับทดลอง)

| ระดับ | ใครใช้ | สิ่งที่ขาย |
|---|---|---|
| Normal Free | กลุ่มเพื่อน/ชุมชน | ฟีเจอร์ทั่วไปและทดลอง Projects/Meeting ในโควตาจำกัด |
| Plus | บุคคล/กลุ่มที่ใช้ประจำ | นาทีประชุมและพื้นที่เพิ่ม พร้อมความสามารถบอททั่วไปที่กำหนดไว้ |
| Team | องค์กรขนาดเล็ก | พื้นที่องค์กร บทบาท ทีม Shared meeting allowance การจัดการและส่งออก |
| Enterprise | หลายทีม/หลาย server | นโยบายส่วนกลาง SSO/SCIM เมื่อ scope ลูกค้าต้องการ audit export support และสัญญาบริการตามสิ่งที่วัดได้ |

ใช้ codebase เดียว feature flags + entitlements และ workspace scope สิทธิ์/การลบข้อมูลพื้นฐานต้องมีทุกแพ็กเกจ ความต่างเป็น capacity, administration และขอบเขต support

ไม่กำหนดราคาเป็นข้อเท็จจริงก่อน benchmark สูตรต่อองค์กร/เดือน: ASR billed audio + summary tokens + audio storage GB-month + egress + voice workers + retries reserve + payment fees + support allocation นาที meeting ที่แจ้งลูกค้าอาจต่างจาก summed speaker minutes ของ provider ต้องวัดทั้งสอง

ทดลองเชิงพาณิชย์: ค่าฐานต่อ workspace รวมโควตา + add-on minutes ที่กดยินยอม ไม่เริ่ม unlimited audio หรือคิดต่อสมาชิก Discord ทั้งหมดโดยอัตโนมัติ สมมติฐานเป้าหมาย gross margin ≥60% หลังต้นทุนบริการผันแปรและ support reserve ต้องทดสอบหนักแบบ p95 usage ก่อนตั้งราคา

metering ใช้ unique usage event, trial limits, notifications ก่อนหมด, hard cap/spend limit, grace/downgrade และไม่คิดเงินซ้ำจาก retry ช่วงโควตาหมดระหว่างประชุมต้องแจ้งและจบการบันทึกอย่างปลอดภัยตามนโยบายที่ตกลงก่อนเริ่ม เก็บเสียงที่บันทึกไปแล้วให้ครบ ห้ามเกิด surprise bill

Billing ต้องทดสอบ webhook ซ้ำ/ผิดลำดับ/ปลอม, upgrade/downgrade/refund/cancel และ reconciliation สิทธิ์จาก server เป็นหลัก หน้าค่าใช้จ่ายทีมแยกจาก Subscription ของ Megu

ตรวจ Discord Premium Apps eligibility ของนิติบุคคล/ประเทศจริงก่อนเลือกช่องรับเงิน ไม่สมมติว่าผู้พัฒนาในไทยเปิดใช้ได้ทันที และตรวจข้อกำหนด paid feature support ที่ใช้กับภูมิภาคนั้น [Discord monetization](https://docs.discord.com/developers/monetization/enabling-monetization), [required support](https://support-dev.discord.com/hc/en-us/articles/23810643331735-Premium-Apps-Required-Support-for-Monetizing-Apps)

## 11. Roadmap แบบส่งมอบเป็นช่วง

เวลาเป็นประมาณการเพื่อวางแผนของทีม 2 engineers + product/design/QA แบบ part-time ไม่ใช่วันรับปาก หากทำคนเดียวให้จัดใหม่ตาม velocity จริง กรอบ Team พร้อมขายประมาณ 16–24 สัปดาห์ Enterprise เพิ่มประมาณ 8–16 สัปดาห์ โดยมีงานซ้อนกันและมี buffer; หาก audio spike ไม่ผ่านห้ามประกาศ timeline เดิมว่าแน่นอน

| Phase | ช่วงประมาณ | งานและเจ้าของหลัก | เกณฑ์ออก |
|---|---|---|---|
| 0 Baseline | สัปดาห์ 1 | Engineering: รวม main ล่าสุดใน checkout แยก รักษางานค้าง รัน isolated suites; Product: inventory/flows | baseline build/test และ known issues ที่ทำซ้ำได้; approved scope v1 |
| 1 Voice & language proof | สัปดาห์ 2–3 | Audio engineer: voice/Stage capture, DAVE, 2 ASR candidates; QA: corpus | บันทึก 60–90 นาทีแล้วเทียบ source ได้ มี gap markers, language metrics/cost และ support matrix |
| 2 Meeting core | สัปดาห์ 4–6 | Full-stack: Meeting/access/invites/language/Discord cards/web list | นัด→ตอบรับ→แก้เวลา→ยกเลิกผ่าน role tests; DM fail recovery; standalone/Project ทั้งคู่ |
| 3 Recording & transcript | สัปดาห์ 7–9 | Audio + full-stack: mode/consent/storage/segments/player/worker recovery | start/pause/late join/end/restart, read/export/delete และ timestamps ผ่าน |
| 4 Summary → work | สัปดาห์ 10–12 | Full-stack + QA: summaries/citations/actions/revisions | ยืนยันงานลง Topics เดิมได้ครั้งเดียว; ambiguous owner/date ไม่เดา; summary edit/refetch ปลอดภัย |
| 5 Team administration | สัปดาห์ 11–14 | Backend/product: org/team/channel context/knowledge ACL/Expenses links | สอง tenant แยกครบ ออกจากทีมแล้วสิทธิ์หมด ย้าย ownership ไม่เสียข้อมูล |
| 6 Commercial hardening | สัปดาห์ 13–16 | Engineering/ops: billing, usage, backup restore, monitoring; product: docs/support | staging purchase→entitlement→cancel ผ่าน; restore drill และ load report |
| 7 Paid pilot → Team GA | สัปดาห์ 17–20 + buffer ถึง 24 | Product/QA/support: 3–5 ทีม 2–4 สัปดาห์ | usage repeat, quality/support/cost targets ผ่าน, blocker เป็นศูนย์, launch checklist |
| 8 Enterprise | หลัง Team evidence อีก 8–16 สัปดาห์ | Backend/ops/product: multi-server admin, SSO/SCIM ตามลูกค้า, audit export, enterprise contracts | enterprise acceptance ของลูกค้าทดลองและ security/operations review ผ่านก่อนขาย capability นั้น |

งาน Normal bot ทำต่อเป็น track รักษาคุณภาพเสียง/เพลง/TTS/server tools โดยทุก phase รัน regression ของฟีเจอร์เดิม Feature องค์กรปิดไว้ได้ ไม่เปลี่ยนค่าการใช้งานของเซิร์ฟเวอร์ทั่วไป

Phase 1 เป็น dependency ของการรับปาก recording; Phase 2 เป็น dependency ของ 3/4; Phase 3/4 เป็น dependency ของ paid pilot; 5/6 บางส่วนทำคู่กันได้ งาน Stage หากล้มเหลวต้องลง root cause และรอบทดสอบแก้ ไม่ปลอมว่ารองรับหรือเงียบตัดทิ้ง

## 12. Test plan และเกณฑ์พร้อมขาย

### Functional และ safety

ทดสอบ: standalone/project/cross-project, public schedule/private recording, RSVP/DM off, reschedule/timezone/DST, join late, pause, overlap, reconnect, Stage speaker changes, no speech, Thai-English, language change/retranscribe, summary revision, duplicate submit, removed member, expired signed URL, org boundary, quota exhausted, provider timeout และ worker crash

AI evaluation: annotated decisions/actions อย่างน้อย 100 ข้อจากหลายประชุม; ทุกข้อที่เผยแพร่มี citation ที่เปิดได้, critical invented commitments เป็นศูนย์ใน release corpus, action/decision precision เป้าหมาย ≥95% ที่ human reviewer ประเมิน คำแนะนำมี label และไม่แสดงเป็นคำพูดจริง ถ้าไม่ผ่านให้แก้ pipeline/review flow ก่อนเปิดอัตโนมัติ

### Reliability / load — เป้าหมายต้องวัดก่อนประกาศขาย

- Paid pilot envelope เสนอ: voice meeting ผู้เข้าร่วม 10 คน, 90 นาที, 3 sessions พร้อมกันในคนละ guild; Stage 3 speakers/50 audience เป็น test scenario ไม่ใช่ขีดจำกัด Discord
- จำลอง worker restart, network drop, ASR unavailable และ DB failover/restart ใน staging ให้แสดง partial/interrupted อย่างถูกต้อง ไม่มี silent success
- เป้าหมาย transcript/summary final p95 ≤5 นาทีหลังจบประชุม 60 นาทีภายใต้ envelope ที่รองรับ; live caption p95 ≤8 วินาทีหากเปิดใช้ รุ่นแรกสามารถระบุ live เป็น beta จนวัดผ่าน
- availability เป้าภายใน 99.5% สำหรับบริการแอปก่อนพิจารณา SLA; บันทึก downtime provider/Discord แยกและสื่อผลกระทบจริง
- restore targets เสนอ RPO ≤1 ชม. สำหรับ metadata และ RTO ≤4 ชม.; audio ที่ยังไม่ upload มีความเสี่ยงต่างกัน ต้องวัด gap และแสดง ห้ามอ้าง RPO นี้ครอบคลุม live buffer
- load CPU/RAM/storage/queue age/ASR spend ตามจำนวนผู้พูดจริง พร้อมจำกัด admission ก่อนทรัพยากรหมด

### Release checklist

พร้อมขาย Team เมื่อครบ: critical/high access issues=0; paid pilot ใช้ซ้ำอย่างน้อย 3 ทีมต่อเนื่อง 2 สัปดาห์; host ตรวจสรุปและยืนยันงานได้โดยไม่ช่วยอย่างน้อย 80% ของ sessions ที่สังเกต; quality metrics ผ่าน; cost ledger ตรวจเทียบ invoice ได้; restore/delete/export ผ่าน; billing/refund/support พร้อม; privacy/terms/provider review เสร็จ; feature support matrix ตรงหน้า pricing

Enterprise พร้อมขายเมื่อเพิ่ม organization lifecycle/หลายทีมที่ลูกค้าต้องการ, audit export, identity provisioning/deprovisioning ตามแพ็กเกจ, security review และ support/SLA ที่ทีมปฏิบัติได้จริง ไม่อ้างว่ามี SOC 2/ISO เพียงเพราะมี audit logs

## 13. Rollout, support และการขาย

ลำดับ: internal test → opt-in design partners → paid pilot ที่ระบุข้อจำกัด → Team GA → enterprise design partners → Enterprise GA เปิด feature flag ทีละ guild/organization ย้อนปิดการเริ่ม recording ได้โดยไม่ลบข้อมูลเดิม

เลือก pilot กลุ่มทีมที่มีประชุม Discord ประจำและมี Lead ตรวจงาน 3–5 ทีม สัมภาษณ์ก่อน/หลังเรื่องเวลาเตรียมประชุม จดสรุป งานตกหล่นและการตามงาน ไม่เอาจำนวนสมาชิกทั้งหมดมาแทนความต้องการซื้อ

แพ็กเกจส่งมอบ launch: landing สองเส้นทาง “สำหรับเซิร์ฟเวอร์ของคุณ” / “สำหรับทีมและองค์กร”, pricing ตามโควตาจริง, demo 5 นาที, onboarding 1st meeting, TH/EN help, support contact, status page, incident runbook, deletion/export guide และ changelog

Product metrics: invite→first successful meeting, repeat meetings/week, minutes to reviewed summary, accepted action proposals, correction rate, delivery failures, recording gaps, support tickets/meeting, cost/meeting, paid retention ไม่เก็บบทสนทนาใน analytics/logs และไม่สร้างคะแนนพนักงานจากเสียง

Rollbacks: migration additive ก่อน, backfill เป็น batch พร้อม audit, dual-read เฉพาะจำเป็น, schema destructive หลัง rollout มั่นคงและ backup ตรวจแล้ว ASR/summary model version pin พร้อม rollback และ reprocess ที่ host เห็น; rollback UI ไม่ทำให้ published data หาย

## 14. ความเสี่ยงและการตัดสินใจค้าง

| ความเสี่ยง | วิธีปิดความเสี่ยง | ใครตัดสินใจ/เมื่อไร |
|---|---|---|
| Audio receive ไม่ stable contract | spike/reconnect/version pin/canary | Engineering ก่อน Phase 2 รับปาก recording |
| ไทยเดาผิดภาษา | corpus/forced language/provider capability | Product+QA หลัง Phase 1 |
| Stage ยังไม่พิสูจน์ | Stage test matrix และบันทึกข้อจำกัด | Engineering ก่อนโฆษณา town hall recording |
| ข้อมูลลับลง Discord ช่องกว้าง | publish audience check/private link default | Product+security ก่อน pilot |
| ส่ง DM ไม่ได้หรือไม่ได้อนุญาต | delivery state/opt-in/authorized fallback | Product ก่อน Phase 2 จบ |
| องค์กรซื้อแต่ต้นทุนเสียงสูง | cost metering/quota/spend controls | Owner ก่อนตั้งราคาจริง |
| audio provider ใช้ข้อมูลเกินขอบเขต | provider terms/data handling review | Owner ก่อนรับเสียงลูกค้า |
| scope all-round โตไม่หยุด | module roadmap/แยก maintenance กับ launch slice | Product ทุก phase |

ตัดสินใจด้วยผลทดสอบภายหลัง: ASR/summary provider, billing route ตาม eligibility, ราคา/โควตา, retention ขั้นสุดท้าย, deployment region, first capacity envelope, SSO provider และ SLA ไม่ต้องถามผู้ใช้ทุก implementation detail แต่ต้องนำตัวเลือกพร้อมผลวัดมาให้เลือกก่อนเกิดค่าใช้จ่าย/สัญญาภายนอก

## 15. งานชุดแรกที่เริ่มได้หลังเห็นชอบแผน

1. สร้าง checkout จาก remote main ที่ตรวจล่าสุด รวมงาน persona ที่ค้างโดย review ไม่ทับ config.json
2. รัน Projects/voice tests กับ isolated DB และสร้าง baseline issue list
3. เขียน Meeting permission/language/recording contract และ acceptance fixtures
4. ทดลองรับเสียงห้องปกติ/Stage กับบัญชีทดสอบที่ยินยอม วัดเวลา/ไฟล์/ผู้พูด/reconnect
5. เปรียบเทียบ ASR 2 ทางด้วยเสียงไทยชุดเดียวกันและคำนวณต้นทุน
6. ทบทวน prototype หน้า Meeting และ Discord cards กับเจ้าของผลิตภัณฑ์
7. สรุปผล spike พร้อม recommendation, release envelope และ backlog Phase 2 ที่ประเมินใหม่

## แหล่งอ้างอิงและขอบเขตความมั่นใจ

โค้ดตรวจผ่าน git show ที่ `c50f408`; ยังไม่ได้ runtime test ฟีเจอร์ประชุมเพราะยังไม่สร้าง ตัวเลขคุณภาพ/เวลา/ราคาข้างบนเป็น proposed gates ไม่ใช่ผลทดลอง

- ไลบรารีรองรับรับเสียง แต่ระบุว่า Discord ไม่ได้ document audio receive และ stable support ไม่รับประกัน: [discord.js voice](https://discord.js.org/docs/packages/voice/0.19.2)
- ตรวจ DAVE ใน voice pipeline ปัจจุบัน: [Discord Voice](https://docs.discord.com/developers/topics/voice-connections)
- Stage มี speaker/audience และ permission ของตัวเอง เอกสารนี้ไม่ใช่ผลทดสอบ Megu recording: [Stage Instance](https://docs.discord.com/developers/resources/stage-instance)
- การอนุญาตใช้งาน/DM ขอบเขต API Data และข้อจำกัดการฝึกโมเดลต้องรวมใน design/provider review: [Discord Developer Policy](https://support-dev.discord.com/hc/en-us/articles/8563934450327-Discord-Developer-Policy)
- รองรับซื้อ subscription และ entitlement lifecycle ตามช่องทางที่เลือก: [App Subscriptions](https://docs.discord.com/developers/monetization/implementing-app-subscriptions)

ตรวจเอกสารออนไลน์ 13 กันยายน 2026; ตรวจซ้ำก่อนเปิดขายเพราะ policy และ platform capability เปลี่ยนได้
