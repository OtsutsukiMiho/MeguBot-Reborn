// A PromptPay QR is not a payment. It is a string.
//
// Nothing here talks to a bank, and nothing here can tell you whether money
// arrived — this file only encodes "send ฿60 to this PromptPay id" in the
// format Thai banking apps read. That is the whole reason it can exist without
// a merchant account, a gateway, or a fee: the QR is data, and the transfer
// happens between two people's banks where Megu cannot see it.
//
// The format is EMVCo's, which Thailand's standard sits on top of. Every field
// is `ID(2) + LENGTH(2) + VALUE`, fields run in ascending ID order, and the
// last one is a checksum over everything before it.

const AID_PROMPTPAY = 'A000000677010111';

// The other PromptPay application: a shop's bill-payment code, addressed to a
// biller id rather than to a person. It is recognised here only so that
// uploading one can be refused with the reason, instead of being read as an
// e-wallet — both are fifteen digits and only the tag tells them apart.
const AID_BILL_PAYMENT = 'A000000677010112';

const TAG = {
	format: '00',
	initiation: '01',
	merchant: '29',
	billPayment: '30',
	currency: '53',
	amount: '54',
	country: '58',
	merchantName: '59',
	crc: '63',
};

// Sub-tags inside field 29. Which one a target uses is decided by its shape,
// which is why `normaliseTarget` returns the tag along with the digits.
const MERCHANT = {
	aid: '00',
	mobile: '01',
	nationalId: '02',
	eWallet: '03',
	// Not something this file can build a QR for — a bank account proxy needs
	// the bank as well as the number. Named so that reading one can say so.
	bankAccount: '04',
};

const KIND_BY_SUBTAG = {
	[MERCHANT.mobile]: 'mobile',
	[MERCHANT.nationalId]: 'nationalId',
	[MERCHANT.eWallet]: 'eWallet',
	[MERCHANT.bankAccount]: 'bankAccount',
};

const CURRENCY_THB = '764';
const COUNTRY_TH = 'TH';

// "11" means the QR can be scanned repeatedly; "12" means it carries one
// specific amount and is meant to be used once. We emit 12 whenever an amount
// is baked in, because that is what it is — a request for exactly ฿60, not a
// standing tip jar.
const INITIATION_STATIC = '11';
const INITIATION_DYNAMIC = '12';

function field(id, value) {
	const str = String(value);
	if (str.length > 99) throw new RangeError(`field ${id} is too long to encode`);
	return `${id}${String(str.length).padStart(2, '0')}${str}`;
}

/**
 * CRC-16/CCITT-FALSE — poly 0x1021, init 0xFFFF, no reflection, no final xor.
 *
 * Written bitwise rather than with a lookup table because it runs over a
 * ~70 character string a handful of times a day, and a table is one more thing
 * that can be transcribed wrong with nothing to check it against.
 */
function crc16(input) {
	let crc = 0xFFFF;
	for (let i = 0; i < input.length; i++) {
		crc ^= input.charCodeAt(i) << 8;
		for (let bit = 0; bit < 8; bit++) {
			crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) : (crc << 1);
			crc &= 0xFFFF;
		}
	}
	return crc.toString(16).toUpperCase().padStart(4, '0');
}

/**
 * Work out what kind of PromptPay id someone typed, and put it in the shape
 * the payload wants.
 *
 * People write their own phone number a dozen ways — 081-234-5678, +66 81 234
 * 5678, 0812345678 — and all of them mean the same account. Everything that is
 * not a digit is dropped first, then the shape decides:
 *
 *   10 digits starting 0    a Thai mobile      → 0066 + the number sans its 0
 *   11 digits starting 66   already in country form
 *   13 digits               a national or tax id, used as-is
 *   15 digits               an e-wallet id, used as-is
 *
 * A mobile is zero-padded to 13 characters because the sub-field is fixed
 * width; without the padding some banking apps read the account and some do
 * not, which is the worst possible failure mode for this feature.
 */
function normaliseTarget(raw) {
	const typed = String(raw == null ? '' : raw).trim();

	// "nothing was entered" and "what was entered is not a number" are different
	// problems and get different sentences. Stripping non-digits first collapsed
	// them: someone who typed a word saw "no PromptPay number saved yet", which
	// is not true and gives them nothing to act on.
	if (!typed) throw new Error('promptpay_missing');

	const digits = typed.replace(/\D/g, '');
	if (!digits) throw new Error('promptpay_unrecognised');

	if (digits.length === 10 && digits.startsWith('0')) {
		return { tag: MERCHANT.mobile, value: `0066${digits.slice(1)}`, kind: 'mobile' };
	}
	if (digits.length === 11 && digits.startsWith('66')) {
		return { tag: MERCHANT.mobile, value: `0066${digits.slice(2)}`, kind: 'mobile' };
	}
	if (digits.length === 9) {
		// A mobile with the leading zero already trimmed, which is how a number
		// pasted out of a contact card sometimes arrives.
		return { tag: MERCHANT.mobile, value: `0066${digits}`, kind: 'mobile' };
	}
	if (digits.length === 13) {
		return { tag: MERCHANT.nationalId, value: digits, kind: 'nationalId' };
	}
	if (digits.length === 15) {
		return { tag: MERCHANT.eWallet, value: digits, kind: 'eWallet' };
	}

	throw new Error('promptpay_unrecognised');
}

/**
 * How the target is shown back to a human.
 *
 * The number is a real person's phone number or national id, so it is masked
 * everywhere it is displayed — enough digits to recognise your own, not enough
 * to be worth harvesting from a link that gets forwarded around a group chat.
 */
function maskTarget(raw) {
	const { value, kind } = normaliseTarget(raw);
	if (kind === 'mobile') {
		const local = `0${value.slice(4)}`;
		return `${local.slice(0, 3)}-xxx-${local.slice(-4)}`;
	}
	return `${value.slice(0, 1)}-xxxx-xxxxx-${value.slice(-2)}-x`;
}

function isValidTarget(raw) {
	try {
		normaliseTarget(raw);
		return true;
	}
	catch {
		return false;
	}
}

/**
 * Build the payload a banking app reads out of the QR.
 *
 * `amountSatang` is optional: leave it out and the result is a plain "this is
 * my PromptPay" code, pass it and the amount is fixed, which is the whole
 * point here — nobody should be retyping ฿60 into their banking app and
 * getting it wrong.
 */
function buildPayload(target, amountSatang = null) {
	const { tag, value } = normaliseTarget(target);
	const hasAmount = amountSatang != null;

	if (hasAmount) {
		if (!Number.isInteger(amountSatang) || amountSatang <= 0) {
			throw new RangeError('amountSatang must be a positive integer');
		}
	}

	const merchant = field(MERCHANT.aid, AID_PROMPTPAY) + field(tag, value);

	const body = [
		field(TAG.format, '01'),
		field(TAG.initiation, hasAmount ? INITIATION_DYNAMIC : INITIATION_STATIC),
		field(TAG.merchant, merchant),
		field(TAG.currency, CURRENCY_THB),
		// Satang are integers everywhere else in core; the payload wants baht
		// with two decimals, and this is the only place the conversion happens.
		...(hasAmount ? [field(TAG.amount, (amountSatang / 100).toFixed(2))] : []),
		field(TAG.country, COUNTRY_TH),
	].join('');

	// The checksum covers its own id and length as well, so "6304" goes in
	// before the digits it protects are known.
	const withCrcHeader = `${body}${TAG.crc}04`;
	return `${withCrcHeader}${crc16(withCrcHeader)}`;
}

/**
 * Read a payload back apart. Used by the tests, and by anything that wants to
 * check a QR says what it was meant to say rather than trusting the builder.
 *
 * Strict on purpose: a field claiming more characters than remain, or a few
 * characters left over at the end, means this is not a TLV payload at all. It
 * used to stop quietly at the last whole field and hand back whatever it had
 * managed to read, which turns "this QR is a website link" into a half-parsed
 * object that looks almost real.
 */
function parsePayload(payload) {
	const text = String(payload == null ? '' : payload);
	const out = {};
	let i = 0;
	while (i < text.length) {
		if (i + 4 > text.length) throw new Error('malformed_payload');
		const id = text.slice(i, i + 2);
		const rawLength = text.slice(i + 2, i + 4);
		if (!/^\d{2}$/.test(rawLength)) throw new Error('malformed_payload');
		const len = Number(rawLength);
		if (i + 4 + len > text.length) throw new Error('malformed_payload');
		out[id] = text.slice(i + 4, i + 4 + len);
		i += 4 + len;
	}
	return out;
}

function verifyPayload(payload) {
	const text = String(payload == null ? '' : payload);
	if (text.length < 8) return false;
	const body = text.slice(0, -4);
	const given = text.slice(-4);
	return crc16(body) === given.toUpperCase();
}

/**
 * The amount as the payload writes it — baht with a decimal point — back into
 * the integer satang everything else in core counts in.
 *
 * Done with string arithmetic rather than `parseFloat` because `66.50 * 100` is
 * 6649.999999999999 and this is the one number nobody may round by accident.
 */
function amountToSatang(raw) {
	if (raw == null) return null;
	const text = String(raw).trim();
	if (!/^\d+(\.\d{1,2})?$/.test(text)) return null;
	const [baht, fraction = ''] = text.split('.');
	const satang = Number(baht) * 100 + Number(fraction.padEnd(2, '0'));
	return Number.isSafeInteger(satang) && satang > 0 ? satang : null;
}

// Bank apps put something in field 59 whether or not they have a name to put
// there. These are the placeholders, and they must not become somebody's
// account name on the pay screen.
const NAME_PLACEHOLDERS = new Set(['NA', 'N/A', 'NULL', 'NONE', '-']);

/**
 * Read a QR that somebody scanned, and work out whose account it pays into.
 *
 * This is `buildPayload` run backwards, and it exists because the number is
 * already in the picture. Asking a person to read thirteen digits off their own
 * banking app and retype them is asking for the one typo that sends a group's
 * money to a stranger — the QR they were told to save is a better source than
 * their eyes.
 *
 * What comes back is an account, never a payment: the amount, if the QR carried
 * one, is reported so the screen can say it is being ignored. A saved account
 * has no amount, because Megu puts the amount in herself.
 *
 * Throws with a code rather than returning null, because every failure here has
 * a different sentence attached to it — "that is a shop's code", "that is not a
 * PromptPay code at all" and "that is a bank account, which needs the bank too"
 * are three different things for the person holding the phone to do next.
 */
function readQr(payload) {
	const text = String(payload == null ? '' : payload).trim();
	if (!text) throw new Error('qr_unreadable');

	// The checksum first. Anything that fails it — a website link, a Wi-Fi
	// code, a slip's own QR — is not a payment code, and there is no point
	// reading fields out of it.
	if (!verifyPayload(text)) throw new Error('qr_not_promptpay');

	let fields;
	try {
		fields = parsePayload(text);
	}
	catch {
		throw new Error('qr_not_promptpay');
	}

	if (fields[TAG.format] !== '01') throw new Error('qr_not_promptpay');

	// A shop's bill-payment code. Refused with its own reason: its biller id is
	// fifteen digits, exactly like an e-wallet, so silence here would encode a
	// shop's account as a person's and the QR would look perfectly fine.
	if (fields[TAG.billPayment] != null) {
		const biller = safeSubFields(fields[TAG.billPayment]);
		if (biller[MERCHANT.aid] === AID_BILL_PAYMENT) throw new Error('qr_bill_payment');
	}

	const merchant = safeSubFields(fields[TAG.merchant]);
	if (merchant[MERCHANT.aid] !== AID_PROMPTPAY) throw new Error('qr_not_promptpay');

	const subTag = Object.keys(KIND_BY_SUBTAG).find(id => merchant[id] != null);
	if (!subTag) throw new Error('qr_not_promptpay');
	if (KIND_BY_SUBTAG[subTag] === 'bankAccount') throw new Error('qr_bank_account');

	// A mobile travels in the payload as 0066 + nine digits. It goes back out
	// as the ten-digit number its owner would recognise, so that what gets
	// saved and shown is the number they know rather than the wire form.
	const stored = merchant[subTag];
	const target = KIND_BY_SUBTAG[subTag] === 'mobile' && /^0066\d{9}$/.test(stored)
		? `0${stored.slice(-9)}`
		: stored;

	// Back through the same door a typed number comes in by. If the QR carries
	// a shape this file cannot re-encode, better to find out here than at the
	// moment somebody is trying to pay.
	const { kind } = normaliseTarget(target);

	const rawName = String(fields[TAG.merchantName] || '').trim();
	const accountName = rawName && !NAME_PLACEHOLDERS.has(rawName.toUpperCase()) ? rawName : null;

	return {
		target,
		kind,
		accountName,
		masked: maskTarget(target),
		amountSatang: amountToSatang(fields[TAG.amount]),
	};
}

// A field that should hold nested TLV but does not is not a crash — it is a
// field that fails whichever AID check the caller was about to make anyway.
function safeSubFields(value) {
	if (value == null) return {};
	try {
		return parsePayload(value);
	}
	catch {
		return {};
	}
}

module.exports = {
	buildPayload,
	parsePayload,
	verifyPayload,
	readQr,
	amountToSatang,
	normaliseTarget,
	maskTarget,
	isValidTarget,
	crc16,
	AID_PROMPTPAY,
	AID_BILL_PAYMENT,
};
