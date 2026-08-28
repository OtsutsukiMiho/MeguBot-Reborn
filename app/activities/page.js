'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import MeguMark from '../components/MeguMark';
import LoginOptions from '../components/LoginOptions';
import { useCopy } from '../copy';

/**
 * The organizer's list, and the form that starts a new activity.
 *
 * This page is the product's first description of itself: an organizer who has
 * never created anything reads only what is written here. It used to describe a
 * much smaller product than the one that exists — one placeholder said "ตีแบด",
 * one said "คอร์ทเจริญศรี", and the two entry buttons named internal kinds
 * ("one-off", "monthly") rather than anything a person wants to do. Read
 * together they taught a court-booking tool. The range is now stated in three
 * places that a reader passes through in order: the empty state, the kind
 * choice, and the example titles under the name field.
 */

// One stroke weight and one viewBox, matching ThemeToggle — the only other
// place this app draws an icon.
function Icon({ children, size = 17 }) {
	return (
		<svg
			width={size} height={size} viewBox="0 0 24 24" fill="none"
			stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"
			aria-hidden="true"
		>
			{children}
		</svg>
	);
}

const PlusIcon = () => <Icon><path d="M12 5v14" /><path d="M5 12h14" /></Icon>;

export default function ActivitiesPage() {
	const { t, fmt } = useCopy();
	const [me, setMe] = useState(null);
	const [activities, setActivities] = useState([]);
	const [guilds, setGuilds] = useState([]);
	const [loading, setLoading] = useState(true);
	const [creating, setCreating] = useState(false);

	useEffect(() => {
		Promise.all([
			fetch('/api/megu/me', { credentials: 'same-origin' }).then(r => r.json()).catch(() => null),
			fetch('/api/megu/activities', { credentials: 'same-origin' }).then(r => (r.ok ? r.json() : null)).catch(() => null),
			fetch('/api/guilds', { credentials: 'same-origin' }).then(r => (r.ok ? r.json() : null)).catch(() => null),
		]).then(([meData, actData, guildData]) => {
			setMe(meData);
			if (actData?.activities) setActivities(actData.activities);
			if (guildData?.guilds) {
				setGuilds([...guildData.guilds].sort((a, b) => {
					if (a.isBotInGuild !== b.isBotInGuild) return a.isBotInGuild ? -1 : 1;
					return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
				}));
			}
			setLoading(false);
		});
	}, []);

	// A skeleton in the finished layout rather than a sleeping cat on a blank
	// screen. The page arrives at the size it will keep, so nothing jumps under
	// the reader's thumb when the data lands.
	if (loading) return <ActivitiesSkeleton title={t.activities.title} />;

	if (!me?.loggedIn) {
		return (
			<div className="center-screen">
				<MeguMark size={110} />
				<h1 style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(1.9rem, 5vw, 2.8rem)', letterSpacing: '-.03em' }}>
					{t.activities.signedOutTitle}
				</h1>
				<p className="quiet-note" style={{ maxWidth: '42ch' }}>{t.activities.signedOutLede}</p>
				<LoginOptions />
			</div>
		);
	}

	const live = activities.filter(a => !['done', 'cancelled'].includes(a.planState) || a.kind === 'recurring');
	const past = activities.filter(a => ['done', 'cancelled'].includes(a.planState) && a.kind !== 'recurring');
	const blank = activities.length === 0;

	return (
		<div className="stack-lg">
			<header className="page-head rise">
				<h1>{t.activities.title}</h1>
				{!blank && (
					<div className="page-meta">
						<span>{t.activities.liveCount(live.length)}</span>
						{past.length > 0 && <span>{t.activities.pastCount(past.length)}</span>}
					</div>
				)}
			</header>

			{creating ? (
				<CreateActivity
					guilds={guilds}
					user={me.user}
					onCancel={() => setCreating(false)}
					onCreated={a => (window.location.href = `/a/${a.code}`)}
				/>
			) : (
				<div className="rise rise-2">
					<button
						type="button"
						className="btn btn-primary btn-lg"
						aria-expanded={false}
						onClick={() => setCreating(true)}
					>
						<PlusIcon />{t.activities.newActivity}
					</button>
				</div>
			)}

			{/* The server list used to live here as a sidebar. It is a different
			    product for a different reader, so it has its own page now. */}
			{blank ? (
				!creating && <EmptyState />
			) : (
				<div className="rise rise-3 stack-panels">
					<section className="panel">
						<div className="panel-head">
							<span className="panel-title">{t.activities.liveTitle}</span>
							<span className="panel-count">{live.length}</span>
						</div>
						{live.length === 0
							? <p className="quiet-note">{t.activities.empty.says}</p>
							: live.map(a => <ActivityRow key={a.id} a={a} t={t} fmt={fmt} />)}
					</section>

					{past.length > 0 && (
						<section className="panel">
							<div className="panel-head">
								<span className="panel-title">{t.activities.pastTitle}</span>
								<span className="panel-count">{past.length}</span>
							</div>
							{past.map(a => <ActivityRow key={a.id} a={a} t={t} fmt={fmt} quiet />)}
						</section>
					)}
				</div>
			)}
		</div>
	);
}

/**
 * What the reader sees before they have made anything, which is the one moment
 * they are actually asking "what is this for". A single grey line saying
 * "nothing here" spent that moment on nothing.
 */
function EmptyState() {
	const { t } = useCopy();

	return (
		<section className="panel rise rise-3">
			<div className="megu-says" style={{ marginBottom: '1rem' }}>
				<MeguMark size={38} />
				<div>
					<span className="who">Megu</span>
					<p>{t.activities.empty.says}</p>
				</div>
			</div>
			<p className="quiet-note" style={{ maxWidth: '52ch', marginBottom: '.7rem' }}>{t.activities.empty.lede}</p>
			<ul className="example-list">
				{t.activities.empty.examples.map(line => <li key={line}>{line}</li>)}
			</ul>
		</section>
	);
}

function ActivitiesSkeleton({ title }) {
	return (
		<div className="stack-lg" aria-busy="true">
			<header className="page-head">
				<h1>{title}</h1>
				<div className="page-meta"><span className="skeleton-line" style={{ width: '11ch' }} /></div>
			</header>
			<div><span className="skeleton-line" style={{ width: '11rem', height: '2.6rem', borderRadius: 'var(--r-sm)' }} /></div>
			<section className="panel">
				{[0, 1, 2].map(i => (
					<div className="row" key={i}>
						<span className="row-main">
							<span className="skeleton-line" style={{ width: `${9 + i * 3}ch` }} />
							<span className="skeleton-line" style={{ width: `${14 + i * 2}ch`, height: '.7rem', marginTop: '.45rem' }} />
						</span>
					</div>
				))}
			</section>
		</div>
	);
}

function ActivityRow({ a, t, fmt, quiet }) {
	const recurring = a.kind === 'recurring';
	const summary = a.summary;

	// Two axes, two different sub-lines. A one-off is placed in time and space;
	// a monthly agreement has neither and is described by when it collects.
	const sub = recurring
		? fmt.dueDay(a.dueDay)
		: [fmt.when(a.startsAt, { time: false }) || t.activity.notScheduled, a.location].filter(Boolean).join(' · ');

	const tone = recurring ? 'chip-live'
		: a.planState === 'done' ? 'chip-clear'
			: a.planState === 'cancelled' ? '' : 'chip-live';

	// One compact answer to "what needs me next?". A payment claim is an
	// owner's task, so it outranks the balance it belongs to; an open balance
	// outranks attendance; green is reserved for something genuinely complete.
	let standing = null;
	if (summary?.awaitingConfirmation > 0) {
		standing = {
			text: t.activities.standing.awaitingConfirmation(
				summary.awaitingConfirmation,
				summary.outstandingSatang > 0 ? fmt.money(summary.outstandingSatang, a.currency) : null,
			),
			tone: 'fig-due',
		};
	}
	else if (summary?.moneyState === 'open') {
		standing = {
			text: t.activities.standing.outstanding(summary.unpaidCount, fmt.money(summary.outstandingSatang, a.currency)),
			tone: 'fig-due',
		};
	}
	else if (summary?.moneyState === 'settled') {
		standing = { text: t.activities.standing.settled, tone: 'fig-clear' };
	}
	else if (!recurring && a.planState === 'open' && summary?.people > 0) {
		standing = summary.awaitingAnswer > 0
			? { text: t.activities.standing.answered(summary.answered, summary.people), tone: '' }
			: { text: t.activities.standing.allAnswered(summary.people), tone: 'fig-clear' };
	}

	return (
		<Link href={`/a/${a.code}`} className={`row row-link${quiet ? ' is-quiet' : ''}`}>
			<span className="row-main">
				<span className="row-name">{a.title}</span>
				<span className="row-sub">{sub}</span>
			</span>
			<span className="row-tools activity-row-tools">
				{standing && <span className={`row-figure ${standing.tone}`}>{standing.text}</span>}
				<span className={`chip ${tone}`}>{recurring ? t.activities.monthly : t.plan[a.planState]}</span>
			</span>
		</Link>
	);
}

function CreateActivity({ guilds, user, onCreated, onCancel }) {
	const { t, error: readError } = useCopy();
	const [kind, setKind] = useState('event');
	const [title, setTitle] = useState('');
	const [knowsWhen, setKnowsWhen] = useState(false);
	const [startsAt, setStartsAt] = useState('');
	const [paymentDueAt, setPaymentDueAt] = useState('');
	const [location, setLocation] = useState('');
	const [amount, setAmount] = useState('');
	const [dueDay, setDueDay] = useState('1');
	const [currency, setCurrency] = useState('THB');
	const [ownerParticipation, setOwnerParticipation] = useState(true);
	const [ownerDisplayName, setOwnerDisplayName] = useState(user?.displayName || '');
	const [saveOwnerDisplayName, setSaveOwnerDisplayName] = useState(false);
	const [names, setNames] = useState('');
	const [initialPayerPosition, setInitialPayerPosition] = useState('0');
	const [guildId, setGuildId] = useState('');
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState('');
	const titleRef = useRef(null);

	const recurring = kind === 'recurring';
	const activeGuilds = guilds.filter(g => g.isBotInGuild);
	const c = t.activities;
	const guestNames = names.split(/[,\n]/).map(s => s.trim()).filter(Boolean);
	const rosterPreview = [
		...(ownerParticipation && ownerDisplayName.trim() ? [ownerDisplayName.trim()] : []),
		...guestNames,
	];
	const rosterReady = ownerParticipation ? Boolean(ownerDisplayName.trim()) : guestNames.length > 0;

	// The panel replaces a button the reader just pressed, so the caret belongs
	// in the first field rather than wherever the removed button used to be.
	useEffect(() => { titleRef.current?.focus(); }, []);

	async function submit(e) {
		e.preventDefault();
		setBusy(true);
		setError('');
		try {
			const participants = guestNames.map(displayName => ({ displayName }));
			const res = await fetch('/api/megu/activities', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				credentials: 'same-origin',
				body: JSON.stringify({
					title,
					kind,
					location: recurring ? null : location || null,
					// An unknown time is the ordinary case, not a missing value:
					// it is what puts Megu's poll in charge of finding one.
					startsAt: recurring || !knowsWhen ? null : startsAt || null,
					amount: recurring ? Number(amount) || undefined : undefined,
					dueDay: recurring ? Number(dueDay) || 1 : undefined,
					// A monthly agreement answers the same question through its
					// collection day, so this is for one-off activities only.
					paymentDueAt: recurring ? undefined : (paymentDueAt || null),
					currency,
					ownerParticipation,
					ownerDisplayName: ownerParticipation ? ownerDisplayName.trim() : undefined,
					saveOwnerDisplayName: ownerParticipation && saveOwnerDisplayName,
					initialPayerPosition: Number(initialPayerPosition) || 0,
					guildId: guildId || null,
					participants,
				}),
			});
			const data = await res.json();
			if (!res.ok) {
				setError(readError(data));
				return;
			}
			onCreated(data.activity);
		}
		catch {
			setError(t.errors.offline);
		}
		finally {
			setBusy(false);
		}
	}

	const examples = recurring ? c.exampleTitlesRecurring : c.exampleTitlesEvent;

	return (
		<form onSubmit={submit} className="panel form-panel rise rise-2">
			<div className="megu-says" style={{ marginBottom: '1.15rem' }}>
				<MeguMark size={38} />
				<div>
					<span className="who">Megu</span>
					<p>{recurring ? c.saysRecurring : c.saysEvent}</p>
				</div>
			</div>

			{error && <div className="error-note">{error}</div>}

			<div className="form-stack">
				{/* The fork that decides which fields exist below and how the
				    plan behaves afterwards. It used to be two buttons above the
				    form whose only difference was their words, so the way to
				    find out what they did was to press one. */}
				<fieldset className="field">
					<legend className="field-label">{c.kind.legend}</legend>
					<div className="segmented">
						<input type="radio" id="kind-event" name="kind" checked={!recurring} onChange={() => setKind('event')} />
						<label htmlFor="kind-event">{c.kind.event}</label>
						<input type="radio" id="kind-recurring" name="kind" checked={recurring} onChange={() => setKind('recurring')} />
						<label htmlFor="kind-recurring">{c.kind.recurring}</label>
					</div>
					<p className="field-hint">{recurring ? c.kind.recurringHint : c.kind.eventHint}</p>
				</fieldset>

				<div className="field">
					<label className="field-label" htmlFor="megu-title">{c.titleField}</label>
					<input
						id="megu-title"
						ref={titleRef}
						className="form-control"
						required
						placeholder={recurring ? c.titlePlaceholderRecurring : c.titlePlaceholderEvent}
						value={title}
						onChange={e => setTitle(e.target.value)}
					/>
					{/* They fill the field, and on the way they say what else
					    belongs here. Once the field has a value they have done
					    their job and would only compete with it. */}
					{!title && (
						<div className="examples">
							<span className="examples-label">{c.examplesLabel}</span>
							{examples.map(ex => (
								<button type="button" key={ex} className="example-btn" onClick={() => { setTitle(ex); titleRef.current?.focus(); }}>
									{ex}
								</button>
							))}
						</div>
					)}
				</div>

				<fieldset className="field">
					<legend className="field-label">{c.yourParticipation.legend}</legend>
					<div className="segmented">
						<input type="radio" id="owner-joins" name="owner-participation" checked={ownerParticipation} onChange={() => { setOwnerParticipation(true); setInitialPayerPosition('0'); }} />
						<label htmlFor="owner-joins">{c.yourParticipation.joins}</label>
						<input type="radio" id="owner-organizes" name="owner-participation" checked={!ownerParticipation} onChange={() => { setOwnerParticipation(false); setInitialPayerPosition('0'); }} />
						<label htmlFor="owner-organizes">{c.yourParticipation.organizes}</label>
					</div>
					<p className="field-hint">{ownerParticipation ? c.yourParticipation.joinsHint : c.yourParticipation.organizesHint}</p>
				</fieldset>

				{ownerParticipation && (
					<div className="field">
						<label className="field-label" htmlFor="megu-owner-name">{c.yourParticipation.nameField}</label>
						<input
							id="megu-owner-name"
							className="form-control"
							required
							maxLength={80}
							value={ownerDisplayName}
							onChange={e => setOwnerDisplayName(e.target.value)}
						/>
						<p className="field-hint">{c.yourParticipation.nameHint}</p>
						<label className="check-row">
							<input type="checkbox" checked={saveOwnerDisplayName} onChange={e => setSaveOwnerDisplayName(e.target.checked)} />
							<span>{c.yourParticipation.saveDefault}</span>
						</label>
					</div>
				)}

				<div className="field">
					<label className="field-label" htmlFor="megu-currency">{c.currencyField}</label>
					<select id="megu-currency" className="form-control" value={currency} onChange={e => setCurrency(e.target.value)}>
						{['THB', 'USD', 'EUR', 'GBP', 'SGD', 'AUD', 'CAD'].map(code => <option key={code} value={code}>{code}</option>)}
					</select>
					<p className="field-hint">{c.currencyHint}</p>
				</div>

				{recurring ? (
					<div className="field-pair">
						<div className="field">
							<label className="field-label" htmlFor="megu-amount">{c.amountField(currency)}</label>
							<input id="megu-amount" className="form-control" type="number" inputMode="decimal" min="0.01" step="0.01" placeholder="169" value={amount} onChange={e => setAmount(e.target.value)} />
						</div>
						{/* This field ships with a default, so its placeholder never shows —
						    without a label the box just reads as a bare "1". */}
						<div className="field">
							<label className="field-label" htmlFor="megu-due-day">{c.dueDayField}</label>
							<input id="megu-due-day" className="form-control" type="number" inputMode="numeric" min="1" max="28" value={dueDay} onChange={e => setDueDay(e.target.value)} />
							<p className="field-hint">{c.dueDayHint}</p>
						</div>
					</div>
				) : (
					<>
						{/* Not knowing yet is the ordinary case and the reason
						    Megu exists — she asks everyone and then calls it. A
						    bare datetime input asked for an answer the organizer
						    usually does not have, and hid the poll entirely. */}
						<fieldset className="field">
							<legend className="field-label">{c.whenField}</legend>
							<div className="segmented">
								<input type="radio" id="when-ask" name="when" checked={!knowsWhen} onChange={() => setKnowsWhen(false)} />
								<label htmlFor="when-ask">{c.whenAsk}</label>
								<input type="radio" id="when-known" name="when" checked={knowsWhen} onChange={() => setKnowsWhen(true)} />
								<label htmlFor="when-known">{c.whenKnown}</label>
							</div>
							{knowsWhen
								? <input className="form-control" style={{ marginTop: '.55rem' }} type="datetime-local" value={startsAt} onChange={e => setStartsAt(e.target.value)} aria-label={c.whenField} />
								: <p className="field-hint">{c.whenAskHint}</p>}
						</fieldset>

						<div className="field">
							<label className="field-label" htmlFor="megu-location">
								{c.whereField}{' '}<span className="field-optional">{c.optional}</span>
							</label>
							<input id="megu-location" className="form-control" placeholder={c.wherePlaceholder} value={location} onChange={e => setLocation(e.target.value)} />
						</div>

						{/* Deliberately its own field, below "when is it".
						    The court is played on the 20th and settled on the
						    21st; folding the two together would make one of
						    them wrong roughly half the time. */}
						<div className="field">
							<label className="field-label" htmlFor="megu-pay-by">
								{c.payByField}{' '}<span className="field-optional">{c.optional}</span>
							</label>
							<input id="megu-pay-by" className="form-control" type="date" value={paymentDueAt} onChange={e => setPaymentDueAt(e.target.value)} />
							<p className="field-hint">{c.payByHint}</p>
						</div>
					</>
				)}

				<div className="field">
					<label className="field-label" htmlFor="megu-names">
						{c.peopleField}{' '}<span className="field-optional">{c.optional}</span>
					</label>
					<textarea id="megu-names" className="form-control" placeholder={c.peoplePlaceholder} value={names} onChange={e => setNames(e.target.value)} />
					<p className="field-hint">{c.peopleHint}</p>
				</div>

				{recurring && Number(amount) > 0 && rosterPreview.length > 0 && (
					<div className="field">
						<label className="field-label" htmlFor="megu-initial-payer">{c.initialPayerField}</label>
						<select id="megu-initial-payer" className="form-control" value={initialPayerPosition} onChange={e => setInitialPayerPosition(e.target.value)}>
							{rosterPreview.map((name, index) => <option key={`${name}-${index}`} value={index}>{name}</option>)}
						</select>
						<p className="field-hint">{c.initialPayerHint}</p>
					</div>
				)}

				{activeGuilds.length > 0 && (
					<div className="field">
						<label className="field-label" htmlFor="megu-guild">
							{c.serverField}{' '}<span className="field-optional">{c.optional}</span>
						</label>
						<select id="megu-guild" className="form-control" value={guildId} onChange={e => setGuildId(e.target.value)}>
							<option value="">{c.serverNone}</option>
							{activeGuilds.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
						</select>
					</div>
				)}

				<div className="form-actions">
					<button type="submit" className="btn btn-primary btn-lg" disabled={busy || !title.trim() || !rosterReady}>
						{busy ? c.creating : c.create}
					</button>
					<button type="button" className="btn btn-ghost" onClick={onCancel}>{t.common.cancel}</button>
				</div>
			</div>
		</form>
	);
}
