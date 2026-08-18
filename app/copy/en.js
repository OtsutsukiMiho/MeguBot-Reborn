// English, and the shape every other language file has to match.
//
// Keys are grouped by the surface they appear on rather than by page, because
// the same words show up on the activity page and in a reminder. Anything that
// interpolates a value is a function: word order moves between languages, and
// gluing strings together at the call site is how it gets frozen into English.

const en = {
	code: 'en',
	label: 'EN',
	nav: {
		home: 'Home',
		activities: 'Activities',
		servers: 'Servers',
		signOut: 'Sign out',
		signIn: 'Sign in with Discord',
	},

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
		poll_not_ready: 'Wait until everyone has answered before locking a time',
		time_not_set: 'Choose a date and time before confirming this activity',
		split_people_required: 'Choose who shares this expense',
		attendance_not_ready: 'Finish the activity before recording attendance',
		attendance_invalid: 'Attendance must be came, did not come, or not marked',
		session_expired: 'Your sign-in expired. Sign in again to continue.',
		data_conflict: 'The data changed while saving. Reload and try again.',
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

	// The organizer's own list, at /activities. Everything an organizer reads
	// before they have created anything lives here, which makes this section
	// the product's first description of itself — the examples are load-bearing
	// and not filler. A single example ("badminton") taught readers that Megu
	// was a court-booking tool, so the range is stated deliberately and in more
	// than one place.
	activities: {
		title: 'Your activities',
		liveCount: n => `${n} still running`,
		pastCount: n => `${n} finished`,
		newActivity: 'New activity',
		liveTitle: 'Running now',
		pastTitle: 'Earlier',
		monthly: 'Monthly',
		openMenu: 'Open',
		standing: {
			awaitingConfirmation: (n, amount) => amount
				? `${n} to confirm · ${amount} due`
				: `${n} to confirm`,
			outstanding: (n, amount) => `${amount} due · ${n} ${n === 1 ? 'person' : 'people'}`,
			answered: (answered, total) => `${answered}/${total} answered`,
			allAnswered: total => `${total}/${total} answered`,
			settled: 'Paid in full',
		},

		empty: {
			says: 'Nothing here yet. Shall we start one?',
			lede: 'Anything with more than one person and some money in it. Megu can hold all of these:',
			examples: [
				'Dinner, split when the bill lands',
				'A trip somebody books and pays for up front',
				'A grocery run for the house',
				'Rent and wifi, collected every month',
				'A group gift everyone chips in on',
			],
		},

		kind: {
			legend: 'What kind',
			event: 'One time',
			eventHint: 'Dinner, a trip, a shopping run, badminton — happens once, gets split, done.',
			recurring: 'Every month',
			recurringHint: 'Wifi, Netflix, rent — the same amount each month, and Megu opens the round herself.',
		},

		saysEvent: 'What are we doing, and who with? I will go and ask them.',
		saysRecurring: 'Something to collect every month. Tell me how much, and from whom.',

		titleField: 'What should we call it',
		titlePlaceholderEvent: 'Hotpot on Saturday',
		titlePlaceholderRecurring: 'Home wifi',
		examplesLabel: 'For example',
		exampleTitlesEvent: ['Dinner', 'Weekend trip', 'Badminton', 'House groceries', 'Birthday gift'],
		exampleTitlesRecurring: ['Wifi', 'Netflix', 'Rent', 'Electricity'],

		whenField: 'When',
		whenAsk: 'Let Megu ask',
		whenKnown: 'I know the time',
		whenAskHint: 'Megu collects everyone’s free days first, then calls it.',

		whereField: 'Where',
		wherePlaceholder: 'Place or address',

		peopleField: 'Who is in',
		peoplePlaceholder: 'Alex, Sam, Mint',
		peopleHint: 'Commas or new lines. Nobody has to sign up for anything — you just send them the link.',

		amountField: 'How much a month (baht)',
		dueDayField: 'Collect on day',
		dueDayHint: 'of every month (1–28)',

		serverField: 'Discord server',
		serverNone: 'Not linked to a server',

		optional: 'optional',
		create: 'Create it and give me the link',
		creating: 'Creating…',

		signedOutTitle: 'Hello, I’m Megu',
		signedOutLede: 'I run your group’s plans, from asking who is coming to making sure everyone has paid.',
		signIn: 'Sign in with Discord',
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

	schedule: {
		title: 'Choose a time first',
		ownerHint: 'Add a few options. Megu will ask everyone when they are free before anyone commits to coming.',
		waitingHint: 'The organizer is still choosing times. You can answer as soon as the options arrive.',
	},

	roster: {
		titleEvent: 'Who is coming',
		titleRecurring: 'Members',
		going: 'Going',
		notGoing: 'Not going',
		noAnswer: 'Has not answered',
		notLinked: 'Has not claimed their name',
		paidUp: 'Paid up',
		clear: 'Clear',
		getsBack: amount => `Gets back ${amount}`,
		paidFor: period => `Paid for ${period}`,
		owesFor: (amount, period) => `Owes ${amount} for ${period}`,
		leftOn: period => `Left in ${period}`,
		addPerson: 'Add someone…',
		nameOf: name => `Name for ${name}`,
		returnName: 'Un-claim',
		confirmRemove: name => `Take ${name} off this activity?`,
	},

	attendance: {
		title: 'Who actually came',
		hint: 'Mark attendance after the activity so the record reflects what happened, not only what people planned.',
		came: 'Came',
		absent: 'Did not come',
		marked: (done, total) => `${done}/${total} marked`,
	},

	expenses: {
		title: 'Costs',
		total: 'Total',
		frontedBy: name => `${name} paid up front`,
		labelField: 'What was it for',
		amountField: 'How much',
		payerField: 'Who paid up front',
		payerOption: name => `${name} paid up front`,
		splitField: 'Split between',
		splitHint: 'These names will owe a share. Check them before adding the cost.',
		forPerson: name => `For ${name}`,
		splitBetween: names => `Split between ${names}`,
		viewSplit: 'view each share',
		confirmDelete: (label, amount) => `Delete "${label}" ${amount}?`,
	},

	pending: {
		title: 'Waiting for you to confirm',
		saidTheyPaid: 'Says they have paid',
		received: 'Got it',
		notYet: 'Not arrived',
		confirmedTitle: 'Already confirmed',
		historyTitle: 'Reversed and rejected payment history',
		undo: 'Undo confirmation',
		reversalReason: 'Why are you reversing this payment? The payer will see this note.',
		rejectionReason: 'Why are you rejecting this payment? The payer will see this note.',
		rejectedNotice: reason => `Payment rejected: ${reason}`,
		reversedNotice: reason => `Payment confirmation reversed: ${reason}`,
		allocatedFromTransfer: (allocated, total) => `${allocated} allocated to this period from a ${total} transfer`,
		autoMatched: 'Slip matched automatically',
		ownerConfirmed: 'Checked and confirmed by owner',
		cashConfirmed: 'Owner confirmed an offline payment',
		confirmDeletePayment: 'Void this record while keeping its history?',
	},

	cash: {
		title: 'Received outside Megu',
		hint: 'Use this for cash or a transfer you checked yourself. It has no slip and is confirmed under your name.',
		person: 'Received from',
		amount: 'Amount (baht)',
		received: 'Record as received',
		reason: 'Owner confirmed receiving payment outside Megu',
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
		networkOnly: 'Test mode: this link works for devices on the same Wi-Fi or local network.',
		deviceOnly: 'This link still works only on this device. Set FRONTEND_URL to an address other people can reach before sharing.',
		copyFailed: 'Automatic copy was blocked. The link is selected—long-press it or press Ctrl+C to copy.',
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
		choosePeriods: 'Choose periods and amounts',
		selectAllOutstanding: 'Select everything outstanding',
		amountFor: period => `Amount for ${period}`,
		allocationHint: 'Partial payments and several months on one transfer are supported.',
		baht: 'baht',
		iHavePaid: 'I have transferred it',
		attachSlip: 'Attach the slip',
		attachSlipHint: 'A slip is required before this counts as paid. Only the minimum dispute evidence is retained.',
		slipAttached: 'Slip attached',
		replaceSlip: 'Use a different slip',
		viewSlip: 'View slip',
		reading: 'Reading the slip…',
		noPromptPay: name => `${name} has not added a PromptPay number yet`,
		noPromptPayOwner: 'Add your PromptPay number and everyone gets a QR with the exact amount already in it.',
		waitingConfirm: 'Attach the slip so Megu can check and record this payment.',
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
		fromQr: 'Read it from my QR',
		fromQrHint: 'Pick the PromptPay QR your banking app saved. It is read on this device and never uploaded.',
		reading: 'Reading the code…',
		qrRead: masked => `Read from the code: ${masked}`,
		qrAmountIgnored: amount => `That code also carried ${amount}. Only the account is kept — Megu puts the right amount in each time.`,
	},

	slip: {
		verdictUnread: 'Slip attached — could not read its reference',
		verdictReview: 'Slip attached — waiting for owner review',
		verdictMatched: 'Slip attached',
		verdictDuplicate: 'This slip was already used',
		expected: amount => `Asked for ${amount}`,
		uploaded: when => `Attached ${when}`,
		privacyNote: 'Only you and the person who sent it can open this.',
		readingImage: 'Reading the slip…',
		sentFrom: bank => `Sent from ${bank}`,
		readAmount: amount => `The slip reads ${amount}`,
		readDiffers: (read, expected) => `The slip reads ${read}, but ${expected} was asked for`,
		readNote: 'Read from the picture, not from a bank. Worth a look before you confirm.',
	},

	receipt: {
		scan: 'Scan a receipt',
		hint: 'Photograph the bill and Megu will read the lines off it. You check them before anything is added.',
		reading: 'Reading the bill…',
		found: count => (count === 1 ? 'Read 1 line' : `Read ${count} lines`),
		checkNote: 'This is read off a photograph, so check it. Edit anything, untick what should not be here.',
		selected: count => (count === 1 ? '1 line selected' : `${count} lines selected`),
		matchesPrinted: total => `Adds up to the ${total} printed on the bill`,
		differsFromPrinted: (total, gap) => `The bill says ${total} — that is ${gap} apart`,
		addAll: (count, total) => (count === 1 ? `Add 1 expense · ${total}` : `Add ${count} expenses · ${total}`),
		asOneLine: total => `Add the whole bill as one expense instead (${total})`,
		wholeBill: 'Whole bill',
		untitled: 'Item',
		serviceLine: 'Service charge',
		taxLine: 'VAT',
		addService: amount => `Add service charge ${amount}`,
		addTax: amount => `Add VAT ${amount}`,
		includeLine: label => `Include ${label}`,
		nothingFound: 'Nothing readable in that photo. Try again with the bill flat and the whole of it in frame.',
		failed: 'Could not read that picture',
		partial: (added, total) => `Added ${added} of ${total} and then stopped — the rest are not in`,
		unavailable: 'The reader is not installed on this server yet',
	},
};

module.exports = en;
