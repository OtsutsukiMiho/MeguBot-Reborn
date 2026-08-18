const sharp = require('sharp');

function xml(value) {
	return String(value == null ? '' : value)
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&apos;');
}

function party(value) {
	if (!value?.name) return 'อ่านไม่ได้';
	return value.accountTail ? `${value.name}  •••• ${String(value.accountTail).replace(/\D/g, '').slice(-4)}` : value.name;
}

function stampWhen(when) {
	if (typeof when === 'string') return when || 'อ่านไม่ได้';
	if (!when?.year) return 'อ่านไม่ได้';
	const date = `${when.year}-${String(when.month).padStart(2, '0')}-${String(when.day).padStart(2, '0')}`;
	return when.hour == null ? date : `${date} ${String(when.hour).padStart(2, '0')}:${String(when.minute || 0).padStart(2, '0')}`;
}

/** Render from an allow-list of structured values. No source-image pixels are
 * accepted by this boundary, so callers cannot smuggle the original slip into
 * the long-term evidence column. */
async function renderEvidenceCard(slip, read, createdAt = new Date()) {
	const rows = [
		['ธนาคารผู้ส่ง', slip?.bank?.th || slip?.bank?.en || slip?.bank?.code || 'อ่านไม่ได้'],
		['เลขอ้างอิง', slip?.transRef || 'อ่านไม่ได้'],
		['จาก', party(read?.parties?.sender)],
		['ไปยัง', party(read?.parties?.receiver)],
		['จำนวนเงิน', read?.amountSatang ? `${(read.amountSatang / 100).toFixed(2)} บาท` : 'อ่านไม่ได้'],
		['วันเวลา', stampWhen(read?.when)],
	];
	const body = rows.map(([label, value], index) => {
		const y = 230 + index * 82;
		return `<text x="72" y="${y}" class="label">${xml(label)}</text><text x="330" y="${y}" class="value">${xml(value)}</text>`;
	}).join('');
	const svg = `<svg width="1200" height="820" viewBox="0 0 1200 820" xmlns="http://www.w3.org/2000/svg">
		<rect width="1200" height="820" fill="#f8fafc"/>
		<style>.title,.label,.value,.note{font-family:system-ui,'Noto Sans Thai','Tahoma',sans-serif}.title{font-size:52px;font-weight:800;fill:#0f172a}.label{font-size:28px;font-weight:500;fill:#64748b}.value{font-size:34px;font-weight:650;fill:#0f172a}.note{font-size:23px;font-weight:500;fill:#475569}</style>
		<text x="72" y="92" class="title">Megu · หลักฐานการโอน</text>
		<text x="72" y="135" class="note">สร้างใหม่จากข้อมูลที่อ่านได้ · ไม่เก็บภาพสลิปต้นฉบับ</text>
		<line x1="72" x2="1128" y1="172" y2="172" stroke="#cbd5e1" stroke-width="2"/>
		${body}
		<text x="72" y="744" class="note">ระดับการตรวจ: จับคู่ข้อมูลจากสลิป (ไม่ใช่การยืนยันจากธนาคาร)</text>
		<text x="72" y="784" class="note">สร้างเมื่อ ${xml(createdAt.toISOString())}</text>
	</svg>`;
	return sharp(Buffer.from(svg)).png().toBuffer();
}

module.exports = { renderEvidenceCard, stampWhen };
