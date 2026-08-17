// English, and the shape every other language file has to match.
//
// Keys are grouped by the surface they appear on rather than by page, because
// the same words show up on the activity page and in a reminder. Anything that
// interpolates a value is a function: word order moves between languages, and
// gluing strings together at the call site is how it gets frozen into English.

const en = {
	code: 'en',
	label: 'EN',

	common: {
		loading: 'Loading…',
		save: 'Save',
		saving: 'Saving…',
		cancel: 'Cancel',
		edit: 'Edit',
		done: 'Done',
		remove: 'Remove',
		add: 'Add',
		copy: 'Copy',
		copied: 'Copied',
		close: 'Close',
		you: 'you',
	},

	errors: {
		notFound: 'No activity with that code',
		notFoundHint: 'The link may have expired, or the code was mistyped',
		failed: 'That did not go through',
		offline: 'Could not reach Megu — try again',
		promptpay_missing: 'No PromptPay number saved yet',
		promptpay_unrecognised: 'That does not look like a PromptPay number',
		slip_duplicate: 'This slip has already been used for another payment',
		slip_too_large: 'That image is too big — try again from your photo library',
		slip_unreadable: 'Could not read that file as an image',
		participant_has_money: 'There is money attached to this person — remove their expenses first',
		participant_paid_out: 'This person fronted money for the group — delete that expense first',
		participant_not_in_activity: 'That person is not on this activity',
		not_on_this_activity: 'You are not on this activity',
		claim_your_name_first: 'Tap your own name first',
		nothing_outstanding: 'Nothing outstanding to pay',
		payment_not_found: 'No such payment',
		not_your_payment: 'That payment belongs to someone else',
		not_your_slip: 'Only the sender and the person being paid can open this',
		no_slip: 'No slip attached to this payment',
	},

	plan: {
		open: 'Waiting on answers',
		confirmed: 'Confirmed',
		done: 'Finished',
		cancelled: 'Cancelled',
	},

	money: {
		none: 'Nothing owed yet',
		open: 'Payment due',
		settled: 'Everyone has paid',
	},

	activity: {
		notScheduled: 'No time set yet',
		noPeriodYet: 'No month opened yet',
		dueOn: day => `due on the ${day}`,
		peopleGoing: (going, total) => `${going}/${total} going`,
		members: total => `${total} ${total === 1 ? 'member' : 'members'}`,
		membersPaid: (paid, total) => `${paid} of ${total} paid`,
		perMonth: amount => `${amount} / month`,
		eachPerMonth: amount => `${amount} each`,
	},

	headline: {
		youOwe: 'You owe',
		youGetBack: 'You get back',
		yourTotal: 'Your total',
		clear: 'All clear',
		pay: 'Pay this',
		claimed: 'Told them — waiting for confirmation',
	},

	claim: {
		title: 'Which one are you?',
		hint: 'Tap your own name. No signup, no app to install.',
		takenByThisDevice: name => `This device is already "${name}"`,
	},

	rsvp: {
		question: name => `${name}, are you coming?`,
		going: 'Going',
		notGoing: 'Not going',
	},

	roster: {
		titleEvent: 'Who is coming',
		titleRecurring: 'Members',
		going: 'Going',
		notGoing: 'Not going',
		noAnswer: 'Has not answered',
		notLinked: 'Has not opened the link',
		paidUp: 'Paid up',
		getsBack: amount => `Gets back ${amount}`,
		paidFor: period => `Paid for ${period}`,
		owesFor: (amount, period) => `Owes ${amount} for ${period}`,
		leftOn: period => `Left in ${period}`,
		addPerson: 'Add someone…',
		nameOf: name => `Name for ${name}`,
		returnName: 'Un-claim',
		confirmRemove: name => `Take ${name} off this activity?`,
	},

	expenses: {
		title: 'Costs',
		total: 'Total',
		frontedBy: name => `${name} paid up front`,
		labelField: 'What was it for',
		amountField: 'How much',
		payerField: 'Who paid up front',
		payerOption: name => `${name} paid up front`,
		confirmDelete: (label, amount) => `Delete "${label}" ${amount}?`,
	},

	pending: {
		title: 'Waiting for you to confirm',
		saidTheyPaid: 'Says they have paid',
		received: 'Got it',
		notYet: 'Not arrived',
		confirmedTitle: 'Already confirmed',
		undo: 'Undo confirmation',
		confirmDeletePayment: 'Delete this payment record?',
	},

	poll: {
		title: 'When are you free',
		allAnswered: 'Everyone has answered',
		waitingFor: n => `Waiting on ${n} more`,
		free: 'Free',
		maybe: 'Maybe',
		busy: 'Busy',
		freeCount: n => `Free ${n}`,
		maybeCount: n => `Maybe ${n}`,
		busyCount: n => `Busy ${n}`,
		meguSuggests: 'Megu says it should be',
		lockIt: 'Lock this one in',
		option: i => `Option ${i}`,
		anotherOption: '+ another option',
		askForMe: 'Have Megu ask everyone',
	},

	owner: {
		title: 'Organizer tools',
		findTime: 'Have Megu find a time that works',
		proposeAgain: 'Propose different times',
		confirmTime: 'Confirm the date and time',
		finish: 'Mark it finished',
		openMonth: 'Open this month',
		monthAlreadyOpen: period => `${period} is already open`,
		monthOpened: period => `${period} opened`,
		addExpense: 'Add a cost',
		addAndSplit: 'Add it and split it',
		cancelActivity: 'Cancel this activity',
		confirmCancel: 'Cancel this activity?',
	},

	invite: {
		title: 'Bring the others in',
		hint: 'Drop this link in the group chat. Nobody needs an account.',
		linkLabel: 'Activity link',
	},

	// ── paying ──────────────────────────────────────────────────────────────
	//
	// The one screen where a wrong word costs real money, so it says the
	// amount, the destination and the person out loud rather than relying on
	// the reader having understood the page above it.
	pay: {
		title: 'Pay',
		payTo: name => `Transfer to ${name}`,
		amountLabel: 'Amount',
		scanHint: 'Scan this with your banking app',
		// The participant is almost always on the same phone they would scan
		// with, so this is the primary path, not a fallback.
		sameDeviceHint: 'On your phone? Save the QR, then use "scan from gallery" in your banking app.',
		saveImage: 'Save QR image',
		saved: 'Saved',
		orTransferTo: 'Or transfer to this PromptPay',
		copyNumber: 'Copy number',
		copyAmount: 'Copy amount',
		numberCopied: 'Number copied',
		amountCopied: 'Amount copied',
		iHavePaid: 'I have transferred it',
		attachSlip: 'Attach the slip',
		attachSlipHint: 'Optional — it just saves them asking whether it arrived',
		slipAttached: 'Slip attached',
		replaceSlip: 'Use a different slip',
		viewSlip: 'View slip',
		reading: 'Reading the slip…',
		noPromptPay: name => `${name} has not added a PromptPay number yet`,
		noPromptPayOwner: 'Add your PromptPay number and everyone gets a QR with the exact amount already in it.',
		waitingConfirm: 'They have been told. Waiting for them to confirm it arrived.',
	},

	promptpay: {
		title: 'Where the money goes',
		field: 'Your PromptPay (phone number or ID)',
		nameField: 'Account name',
		nameHint: 'Shown so people can check they are paying the right person',
		hint: 'Money goes straight from them to your bank. Megu never holds it and never sees it.',
		saved: 'Saved',
		payee: 'Everyone pays',
		payeeField: 'Who collects the money',
		notSet: 'Not set yet',
		remove: 'Remove this number',
	},

	slip: {
		verdictUnread: 'Slip attached — could not read its reference',
		verdictMatched: 'Slip attached',
		verdictDuplicate: 'This slip was already used',
		expected: amount => `Asked for ${amount}`,
		uploaded: when => `Attached ${when}`,
		privacyNote: 'Only you and the person who sent it can open this.',
	},
};

module.exports = en;
