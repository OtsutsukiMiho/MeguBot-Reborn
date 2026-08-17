// Thai. Same keys as en.js, in the same order, so a missing one is visible by
// reading the two side by side.
//
// Most of these were already in the pages and are kept word for word — they
// were written in Megu's register, and a translation round-trip through
// English would have flattened them into something politer and colder than
// she is.

const th = {
	code: 'th',
	label: 'ไทย',

	common: {
		loading: 'กำลังโหลด…',
		save: 'บันทึก',
		saving: 'กำลังบันทึก…',
		cancel: 'ยกเลิก',
		edit: 'แก้ไข',
		done: 'เสร็จแล้ว',
		remove: 'เอาออก',
		add: 'เพิ่ม',
		copy: 'คัดลอก',
		copied: 'คัดลอกแล้ว',
		close: 'ปิด',
		you: 'คุณ',
	},

	errors: {
		notFound: 'ไม่พบกิจกรรมนี้',
		notFoundHint: 'ลิงก์อาจหมดอายุ หรือรหัสพิมพ์ผิด',
		failed: 'ทำรายการไม่สำเร็จ',
		offline: 'เชื่อมต่อไม่ได้ ลองใหม่อีกครั้ง',
		promptpay_missing: 'ยังไม่ได้ใส่เลขพร้อมเพย์',
		promptpay_unrecognised: 'เลขนี้ไม่เหมือนพร้อมเพย์',
		slip_duplicate: 'สลิปนี้ถูกใช้ไปกับรายการอื่นแล้ว',
		slip_too_large: 'รูปใหญ่เกินไป ลองเลือกจากคลังภาพอีกที',
		slip_unreadable: 'อ่านไฟล์นี้เป็นรูปไม่ได้',
		participant_has_money: 'คนนี้มีรายการเงินอยู่ ลบค่าใช้จ่ายที่เกี่ยวข้องก่อน',
		participant_paid_out: 'คนนี้ออกเงินให้กลุ่มอยู่ ลบรายการค่าใช้จ่ายก่อน',
		participant_not_in_activity: 'ไม่พบคนนี้ในกิจกรรม',
		not_on_this_activity: 'คุณไม่ได้อยู่ในกิจกรรมนี้',
		claim_your_name_first: 'เลือกชื่อตัวเองก่อน',
		nothing_outstanding: 'ไม่มียอดค้างที่ต้องจ่าย',
		payment_not_found: 'ไม่พบรายการจ่ายนี้',
		not_your_payment: 'รายการจ่ายนี้เป็นของคนอื่น',
		not_your_slip: 'เปิดดูได้เฉพาะคนที่ส่งกับคนที่รับเงิน',
		no_slip: 'รายการนี้ไม่ได้แนบสลิป',
	},

	plan: {
		open: 'รอคำตอบ',
		confirmed: 'ยืนยันแล้ว',
		done: 'เสร็จสิ้น',
		cancelled: 'ยกเลิก',
	},

	money: {
		none: 'ยังไม่มีค่าใช้จ่าย',
		open: 'รอชำระ',
		settled: 'จ่ายครบแล้ว',
	},

	activity: {
		notScheduled: 'ยังไม่กำหนดเวลา',
		noPeriodYet: 'ยังไม่เริ่มรอบ',
		dueOn: day => `ครบกำหนดวันที่ ${day}`,
		peopleGoing: (going, total) => `ไป ${going}/${total} คน`,
		members: total => `${total} คน`,
		membersPaid: (paid, total) => `จ่ายแล้ว ${paid} จาก ${total} คน`,
		perMonth: amount => `${amount} ต่อเดือน`,
		eachPerMonth: amount => `คนละ ${amount}`,
	},

	headline: {
		youOwe: 'คุณต้องจ่าย',
		youGetBack: 'คุณจะได้คืน',
		yourTotal: 'ยอดของคุณ',
		clear: 'เคลียร์แล้ว',
		pay: 'จ่ายเลย',
		claimed: 'แจ้งจ่ายแล้ว รอยืนยัน',
	},

	claim: {
		title: 'คุณคือใครในกิจกรรมนี้',
		hint: 'กดชื่อตัวเองได้เลย ไม่ต้องสมัคร ไม่ต้องโหลดแอป',
		takenByThisDevice: name => `เครื่องนี้ถูกใช้เป็น "${name}" ไปแล้ว`,
	},

	rsvp: {
		question: name => `${name} ไปไหม`,
		going: 'ไป',
		notGoing: 'ไม่ไป',
	},

	roster: {
		titleEvent: 'ใครไปบ้าง',
		titleRecurring: 'สมาชิก',
		going: 'ไป',
		notGoing: 'ไม่ไป',
		noAnswer: 'ยังไม่ตอบ',
		notLinked: 'ยังไม่ได้กดลิงก์',
		paidUp: 'ครบแล้ว',
		getsBack: amount => `ได้คืน ${amount}`,
		paidFor: period => `จ่าย${period}แล้ว`,
		owesFor: (amount, period) => `ค้าง ${amount} ของ${period}`,
		leftOn: period => `ออกไปตอน${period}`,
		addPerson: 'เพิ่มคน…',
		nameOf: name => `ชื่อของ ${name}`,
		returnName: 'คืนชื่อ',
		confirmRemove: name => `เอา ${name} ออกจากกิจกรรม?`,
	},

	expenses: {
		title: 'ค่าใช้จ่าย',
		total: 'รวม',
		frontedBy: name => `${name} ออกให้ก่อน`,
		labelField: 'ค่าอะไร',
		amountField: 'กี่บาท',
		payerField: 'ใครออกให้ก่อน',
		payerOption: name => `${name} ออกให้ก่อน`,
		confirmDelete: (label, amount) => `ลบ "${label}" ${amount}?`,
	},

	pending: {
		title: 'รอคุณยืนยัน',
		saidTheyPaid: 'แจ้งว่าจ่ายแล้ว',
		received: 'ได้รับแล้ว',
		notYet: 'ยังไม่เข้า',
		confirmedTitle: 'ที่ยืนยันไปแล้ว',
		undo: 'ยกเลิกการยืนยัน',
		confirmDeletePayment: 'ลบรายการจ่ายนี้ทิ้ง?',
	},

	poll: {
		title: 'ว่างช่วงไหน',
		allAnswered: 'ตอบครบแล้ว',
		waitingFor: n => `รออีก ${n} คน`,
		free: 'ว่าง',
		maybe: 'อาจจะ',
		busy: 'ไม่ว่าง',
		freeCount: n => `ว่าง ${n}`,
		maybeCount: n => `อาจจะ ${n}`,
		busyCount: n => `ไม่ว่าง ${n}`,
		meguSuggests: 'Megu ว่าควรเป็น',
		lockIt: 'ฟันธงเวลานี้',
		option: i => `ตัวเลือกที่ ${i}`,
		anotherOption: '+ อีกตัวเลือก',
		askForMe: 'ให้ Megu ไปถามให้',
	},

	owner: {
		title: 'ตัวจัดการ',
		findTime: 'ให้ Megu หาเวลาที่ตรงกัน',
		proposeAgain: 'เสนอเวลาใหม่',
		confirmTime: 'ยืนยันวันเวลา',
		finish: 'จบกิจกรรมแล้ว',
		openMonth: 'เปิดรอบเดือนนี้',
		monthAlreadyOpen: period => `เปิดรอบ${period}ไปแล้ว`,
		monthOpened: period => `เปิดรอบ${period}แล้ว`,
		addExpense: 'เพิ่มค่าใช้จ่าย',
		addAndSplit: 'เพิ่มแล้วหารให้เลย',
		cancelActivity: 'ยกเลิกกิจกรรม',
		confirmCancel: 'ยกเลิกกิจกรรมนี้?',
	},

	invite: {
		title: 'ชวนคนอื่น',
		hint: 'ส่งลิงก์นี้ในกลุ่มได้เลย เพื่อนไม่ต้องสมัครอะไร',
		linkLabel: 'ลิงก์กิจกรรม',
	},

	pay: {
		title: 'จ่ายเงิน',
		payTo: name => `โอนให้ ${name}`,
		amountLabel: 'ยอดที่ต้องโอน',
		scanHint: 'สแกนด้วยแอปธนาคาร',
		sameDeviceHint: 'อยู่บนมือถือใช่ไหม กดบันทึกรูป QR แล้วใช้ “สแกนจากคลังภาพ” ในแอปธนาคารได้เลย',
		saveImage: 'บันทึกรูป QR',
		saved: 'บันทึกแล้ว',
		orTransferTo: 'หรือโอนไปที่พร้อมเพย์',
		copyNumber: 'คัดลอกเลข',
		copyAmount: 'คัดลอกยอด',
		numberCopied: 'คัดลอกเลขแล้ว',
		amountCopied: 'คัดลอกยอดแล้ว',
		iHavePaid: 'โอนแล้ว',
		attachSlip: 'แนบสลิป',
		attachSlipHint: 'ไม่บังคับ — แนบไว้จะได้ไม่ต้องถามกันว่าเงินเข้าหรือยัง',
		slipAttached: 'แนบสลิปแล้ว',
		replaceSlip: 'เปลี่ยนสลิป',
		viewSlip: 'ดูสลิป',
		reading: 'กำลังอ่านสลิป…',
		noPromptPay: name => `${name} ยังไม่ได้ใส่เลขพร้อมเพย์`,
		noPromptPayOwner: 'ใส่เลขพร้อมเพย์ไว้ เพื่อนจะได้ QR ที่ใส่ยอดมาให้แล้ว ไม่ต้องพิมพ์เอง',
		waitingConfirm: 'แจ้งให้แล้ว รอเจ้าของยืนยันว่าเงินเข้า',
	},

	promptpay: {
		title: 'เงินเข้าที่ไหน',
		field: 'พร้อมเพย์ของคุณ (เบอร์โทร หรือเลขบัตร)',
		nameField: 'ชื่อบัญชี',
		nameHint: 'โชว์ให้คนโอนเช็คว่าโอนถูกคน',
		hint: 'เงินโอนจากเขาเข้าบัญชีคุณโดยตรง Megu ไม่ถือเงินและไม่เห็นเงิน',
		saved: 'บันทึกแล้ว',
		payee: 'ทุกคนโอนให้',
		payeeField: 'ใครเป็นคนรับเงิน',
		notSet: 'ยังไม่ได้ตั้ง',
		remove: 'เอาเลขนี้ออก',
	},

	slip: {
		verdictUnread: 'แนบสลิปแล้ว — อ่านรหัสอ้างอิงไม่ออก',
		verdictMatched: 'แนบสลิปแล้ว',
		verdictDuplicate: 'สลิปนี้เคยใช้ไปแล้ว',
		expected: amount => `ยอดที่ขอไป ${amount}`,
		uploaded: when => `แนบเมื่อ ${when}`,
		privacyNote: 'เปิดดูได้เฉพาะคุณกับคนที่ส่งมา',
	},
};

module.exports = th;
