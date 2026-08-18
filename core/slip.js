// The QR printed on a Thai transfer slip, and what it does and does not say.
//
// It says two things: which bank sent the money, and the reference that bank
// filed it under. It does not say the amount, it does not say who sent it, and
// it does not say it succeeded. Those live behind the bank's own API, which
// costs money and an account to reach, and which Megu deliberately does not
// have — the owner still confirms every payment by looking.
//
// So what is this worth? An identifier. A bank-issued reference is the one
// thing on a slip that cannot be re-photographed into a second payment: the
// unique index on `payments.slip_ref` turns "somebody sent the same slip twice"
// from a thing a person has to notice into a thing the database refuses. That
// is a small guarantee, and it is a real one, which is more than a screenshot
// of an amount can offer.
//
// Before this file, whatever string happened to be in any QR on the picture was
// stored as the reference. A restaurant slip photographed with the shop's LINE
// code in frame put a LINE URL into the index — and the second customer to do
// that was told their payment was a duplicate.

const { parsePayload, verifyPayload } = require('./promptpay.js');

// The slip payload wraps everything in one nested field, and puts its checksum
// under 91 rather than the 63 a PromptPay QR uses.
const TAG_ROOT = '00';
const TAG_CRC = '91';

const ROOT = {
	api: '00',
	sendingBank: '01',
	transRef: '02',
};

// The value that marks the nested block as a bank slip rather than one of the
// other things that also nest under 00.
const API_SLIP_VERIFY = '000001';

// TrueMoney writes a different shape into the same field, and enough people pay
// each other through the wallet that refusing it outright would be wrong.
const TRUEMONEY = {
	version: '00',
	channel: '01',
	eventType: '02',
	transactionId: '03',
	date: '04',
};

/**
 * Bank of Thailand three-digit institution codes, for the banks whose apps a
 * person actually sends a slip from.
 *
 * Only names worth printing are here. An unknown code is shown as the code
 * itself rather than guessed at: "sent from 099" is honest and useless, while
 * naming the wrong bank on a payment screen is worse than saying nothing.
 */
const BANKS = {
	'002': { en: 'Bangkok Bank', th: 'ธนาคารกรุงเทพ', short: 'BBL' },
	'004': { en: 'Kasikornbank', th: 'ธนาคารกสิกรไทย', short: 'KBANK' },
	'006': { en: 'Krungthai Bank', th: 'ธนาคารกรุงไทย', short: 'KTB' },
	'011': { en: 'TMBThanachart', th: 'ธนาคารทหารไทยธนชาต', short: 'TTB' },
	'014': { en: 'Siam Commercial Bank', th: 'ธนาคารไทยพาณิชย์', short: 'SCB' },
	'017': { en: 'Citibank', th: 'ซิตี้แบงก์', short: 'CITI' },
	'020': { en: 'Standard Chartered (Thai)', th: 'สแตนดาร์ดชาร์เตอร์ด', short: 'SCBT' },
	'022': { en: 'CIMB Thai', th: 'ธนาคารซีไอเอ็มบี ไทย', short: 'CIMBT' },
	'024': { en: 'UOB', th: 'ธนาคารยูโอบี', short: 'UOB' },
	'025': { en: 'Krungsri', th: 'ธนาคารกรุงศรีอยุธยา', short: 'BAY' },
	'030': { en: 'Government Savings Bank', th: 'ธนาคารออมสิน', short: 'GSB' },
	'033': { en: 'Government Housing Bank', th: 'ธนาคารอาคารสงเคราะห์', short: 'GHB' },
	'034': { en: 'BAAC', th: 'ธ.ก.ส.', short: 'BAAC' },
	'035': { en: 'EXIM Thailand', th: 'ธนาคารเพื่อการส่งออกและนำเข้า', short: 'EXIM' },
	'066': { en: 'Islamic Bank of Thailand', th: 'ธนาคารอิสลามแห่งประเทศไทย', short: 'IBANK' },
	'067': { en: 'TISCO', th: 'ธนาคารทิสโก้', short: 'TISCO' },
	'069': { en: 'Kiatnakin Phatra', th: 'ธนาคารเกียรตินาคินภัทร', short: 'KKP' },
	'070': { en: 'ICBC (Thai)', th: 'ธนาคารไอซีบีซี (ไทย)', short: 'ICBC' },
	'071': { en: 'Thai Credit Bank', th: 'ธนาคารไทยเครดิต', short: 'TCRB' },
	'073': { en: 'Land and Houses Bank', th: 'ธนาคารแลนด์ แอนด์ เฮ้าส์', short: 'LHBANK' },
	'098': { en: 'SME Development Bank', th: 'ธนาคารพัฒนาวิสาหกิจฯ', short: 'SME' },
};

// Not a bank, but it is where a great many slips come from, and the wallet's
// own QR carries no bank code at all.
const TRUEMONEY_ISSUER = { en: 'TrueMoney Wallet', th: 'ทรูมันนี่ วอลเล็ท', short: 'TMN' };

function bankFor(code) {
	const known = BANKS[code];
	return known ? { code, ...known } : { code, en: `Bank ${code}`, th: `ธนาคารรหัส ${code}`, short: code };
}

/**
 * Some banks strip the leading zeros off the checksum they print.
 *
 * A CRC of 0x0A3F comes out as "A3F" or even "3F", and a strict comparison then
 * rejects a perfectly genuine slip from one particular bank — which is the kind
 * of bug that looks like "the app hates SCB". Only the checksum field is padded
 * back, and only when it is short; a wrong checksum is still a wrong checksum.
 */
function repairCrc(payload) {
	const at = payload.lastIndexOf(`${TAG_CRC}04`);
	if (at === -1) return payload;
	const crc = payload.slice(at + 4);
	if (crc.length === 0 || crc.length >= 4) return payload;
	return payload.slice(0, at + 4) + crc.padStart(4, '0');
}

/**
 * Read the QR off a slip.
 *
 * Returns null for anything that is not one — a website, a PromptPay code, a
 * shop's LINE QR — because "this picture had some other QR in it" is not an
 * error worth interrupting somebody over. They still attached their slip, and
 * a human is still going to look at it.
 *
 * @returns {{issuer: string, bank: object, transRef: string, ref: string}|null}
 */
function readSlipQr(payload) {
	const text = repairCrc(String(payload == null ? '' : payload).trim());
	if (!text || !verifyPayload(text)) return null;

	let fields;
	try {
		fields = parsePayload(text);
	}
	catch {
		return null;
	}

	let root;
	try {
		root = parsePayload(fields[TAG_ROOT] || '');
	}
	catch {
		return null;
	}

	if (root[ROOT.api] === API_SLIP_VERIFY) {
		const sendingBank = root[ROOT.sendingBank];
		const transRef = root[ROOT.transRef];
		if (!sendingBank || !transRef) return null;
		return {
			issuer: 'bank',
			bank: bankFor(sendingBank),
			transRef,
			// Namespaced before it goes anywhere near the unique index. Two
			// banks are free to issue the same reference number, and a
			// collision between them would tell an innocent person their slip
			// had already been spent.
			ref: `th-bank:${sendingBank}:${transRef}`,
		};
	}

	// TrueMoney: version and channel both "01", and the reference is a
	// transaction id rather than a bank's.
	if (root[TRUEMONEY.version] === '01' && root[TRUEMONEY.channel] === '01') {
		const transactionId = root[TRUEMONEY.transactionId];
		if (!transactionId) return null;
		return {
			issuer: 'truemoney',
			bank: { code: 'tmn', ...TRUEMONEY_ISSUER },
			transRef: transactionId,
			ref: `truemoney:${transactionId}`,
			eventType: root[TRUEMONEY.eventType] || null,
			date: root[TRUEMONEY.date] || null,
		};
	}

	return null;
}

function isSlipQr(payload) {
	return readSlipQr(payload) != null;
}

module.exports = { readSlipQr, isSlipQr, bankFor, BANKS };
