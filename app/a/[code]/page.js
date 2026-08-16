'use client';

import { use, useCallback, useEffect, useState } from 'react';
import MeguMark from '../../components/MeguMark';

const PLAN_LABEL = { open: 'รอคำตอบ', confirmed: 'ยืนยันแล้ว', done: 'เสร็จสิ้น', cancelled: 'ยกเลิก' };
const MONEY_LABEL = { none: 'ยังไม่มีค่าใช้จ่าย', open: 'รอชำระ', settled: 'จ่ายครบแล้ว' };
const VOTE_LABEL = { yes: 'ว่าง', maybe: 'อาจจะ', no: 'ไม่ว่าง' };

function baht(satang) {
	if (satang == null) return '—';
	const sign = satang < 0 ? '-' : '';
	const abs = Math.abs(satang);
	return `${sign}฿${Math.floor(abs / 100).toLocaleString('en-US')}.${String(abs % 100).padStart(2, '0')}`;
}

function whenText(iso, long = false) {
	if (!iso) return null;
	return new Date(iso).toLocaleString('th-TH', {
		weekday: long ? 'long' : 'short',
		day: 'numeric',
		month: long ? 'long' : 'short',
		hour: '2-digit',
		minute: '2-digit',
	});
}

export default function ActivityPage({ params }) {
	const { code } = use(params);
	const [activity, setActivity] = useState(null);
	const [error, setError] = useState('');
	const [loading, setLoading] = useState(true);
	const [busy, setBusy] = useState(false);
	const [copied, setCopied] = useState(false);
	const [viewPeriod, setViewPeriod] = useState(null);
	const [editing, setEditing] = useState(false);

	const load = useCallback(async (periodId) => {
		const res = await fetch(`/api/megu/a/${code}${periodId ? `?period=${periodId}` : ''}`, { credentials: 'same-origin' });
		const data = await res.json().catch(() => ({}));
		if (!res.ok) {
			setError(data.error || 'ไม่พบกิจกรรมนี้');
			return;
		}
		setActivity(data.activity);
	}, [code]);

	const call = useCallback(async (method, path, body) => {
		setBusy(true);
		setError('');
		try {
			const res = await fetch(`/api/megu/a/${code}${path}`, {
				method,
				headers: { 'Content-Type': 'application/json' },
				credentials: 'same-origin',
				body: body ? JSON.stringify(body) : undefined,
			});
			const data = await res.json().catch(() => ({}));
			if (!res.ok) {
				setError(data.error || 'ทำรายการไม่สำเร็จ');
				return null;
			}
			if (data.activity) setActivity(data.activity);
			return data;
		}
		catch {
			setError('เชื่อมต่อไม่ได้ ลองใหม่อีกครั้ง');
			return null;
		}
		finally {
			setBusy(false);
		}
	}, [code]);

	useEffect(() => {
		load(viewPeriod).finally(() => setLoading(false));
	}, [load, viewPeriod]);

	if (loading) {
		return (
			<div className="center-screen">
				<MeguMark size={72} mood="asleep" />
				<p className="quiet-note">กำลังโหลด…</p>
			</div>
		);
	}

	if (!activity) {
		return (
			<div className="center-screen">
				<MeguMark size={96} mood="asleep" />
				<h1>ไม่พบกิจกรรมนี้</h1>
				<p className="quiet-note">ลิงก์อาจหมดอายุ หรือรหัสพิมพ์ผิด</p>
			</div>
		);
	}

	const { role, me, participants, expenses, payments, totals, period, periods, kind, poll } = activity;
	const isOwner = role === 'owner';
	const canSeeMoney = role !== 'none';
	const myRow = me ? participants.find(p => p.id === me.id) : null;
	const shareUrl = typeof window !== 'undefined' ? window.location.href : '';
	const pending = payments.filter(p => p.status === 'pending');
	const confirmed = payments.filter(p => p.status === 'confirmed');
	const nameOf = id => participants.find(p => p.id === id)?.displayName || '—';
	const recurring = kind === 'recurring';
	const going = participants.filter(p => p.rsvp === 'yes').length;

	return (
		<div className="stack-lg">
			<header className="page-head rise">
				<h1>{activity.title}</h1>
				<div className="page-meta">
					{recurring
						? <span>{period ? period.label : 'ยังไม่เริ่มรอบ'}{activity.dueDay ? ` · ครบกำหนดวันที่ ${activity.dueDay}` : ''}</span>
						: <>
							<span>{whenText(activity.startsAt, true) || 'ยังไม่กำหนดเวลา'}</span>
							{activity.location && <span>{activity.location}</span>}
						</>}
					<span>{going}/{participants.length} คน</span>
					<span className="code">{activity.code}</span>
				</div>

				{myRow && canSeeMoney && totals?.total > 0 && (
					<div className="headline-figure">
						<div>
							<div className="label">
								{myRow.outstanding > 0 ? 'คุณต้องจ่าย' : myRow.net < 0 ? 'คุณจะได้คืน' : 'ยอดของคุณ'}
							</div>
							<div className={`amount ${myRow.outstanding > 0 ? '' : 'is-clear'}`}>
								{myRow.outstanding > 0 ? baht(myRow.outstanding) : myRow.net < 0 ? baht(-myRow.net) : 'เคลียร์แล้ว'}
							</div>
						</div>
						{myRow.outstanding > 0 && (
							myRow.pending > 0
								? <span className="chip">แจ้งจ่ายแล้ว รอยืนยัน</span>
								: (
									<button
										type="button"
										className="btn btn-pay btn-lg"
										disabled={busy}
										onClick={() => call('POST', '/pay', period ? { periodId: period.id } : undefined)}
									>
										จ่ายแล้ว แจ้งเลย
									</button>
								)
						)}
					</div>
				)}
			</header>

			<div className="megu-says rise rise-2">
				<MeguMark size={52} />
				<div>
					<span className="who">Megu</span>
					<p>{activity.megu}</p>
				</div>
			</div>

			{error && <div className="error-note">{error}</div>}

			<div className="chips rise rise-2">
				{!recurring && (
					<span className={`chip ${activity.planState === 'done' ? '' : 'chip-live'}`}>
						{PLAN_LABEL[activity.planState]}
					</span>
				)}
				{canSeeMoney && (
					<span className={`chip ${activity.moneyState === 'open' ? 'chip-due' : activity.moneyState === 'settled' ? 'chip-clear' : ''}`}>
						{MONEY_LABEL[activity.moneyState]}
					</span>
				)}
				{recurring && periods.map(p => (
					<button
						key={p.id}
						type="button"
						className={`month-btn ${p.id === period?.id ? 'current' : ''}`}
						onClick={() => setViewPeriod(p.id)}
					>
						{p.label}
					</button>
				))}
			</div>

			<div className="two-col rise rise-3">
				<div className="stack-lg" style={{ paddingBottom: 0 }}>
					{!me && (
						<section className="panel">
							<div className="panel-head">
								<span className="panel-title">คุณคือใครในกิจกรรมนี้</span>
							</div>
							<div>
								<p className="quiet-note" style={{ paddingTop: '.4rem' }}>
									กดชื่อตัวเองได้เลย ไม่ต้องสมัคร ไม่ต้องโหลดแอป
								</p>
								<div className="names">
									{participants.map(p => (
										<button
											key={p.id}
											type="button"
											className="name-btn"
											disabled={busy || p.claimed}
											onClick={() => call('POST', '/claim', { participantId: p.id })}
										>
											{p.displayName}
										</button>
									))}
								</div>
							</div>
						</section>
					)}

					{poll && activity.planState === 'open' && (
						<TimePoll poll={poll} me={me} isOwner={isOwner} busy={busy} call={call} total={participants.length} />
					)}

					{me && !recurring && !poll && activity.planState === 'open' && (
						<section className="panel">
							<div className="panel-head"><span className="panel-title">{me.displayName} ไปไหม</span></div>
							<div>
								<div className="names" style={{ paddingTop: '.6rem' }}>
									<button
										type="button"
										className={`vote-btn ${myRow?.rsvp === 'yes' ? 'on-yes' : ''}`}
										disabled={busy}
										onClick={() => call('POST', '/rsvp', { rsvp: 'yes' })}
									>
										ไป
									</button>
									<button
										type="button"
										className={`vote-btn ${myRow?.rsvp === 'no' ? 'on-no' : ''}`}
										disabled={busy}
										onClick={() => call('POST', '/rsvp', { rsvp: 'no' })}
									>
										ไม่ไป
									</button>
								</div>
							</div>
						</section>
					)}

					<section className="panel">
						<div className="panel-head">
							<span className="panel-title">{recurring ? 'สมาชิก' : 'ใครไปบ้าง'}</span>
							{isOwner
								? <button type="button" className="link-btn" onClick={() => setEditing(v => !v)}>{editing ? 'เสร็จแล้ว' : 'แก้ไข'}</button>
								: <span className="panel-count">{going}/{participants.length}</span>}
						</div>
						<div>
							{participants.map(p => (
								<PersonRow key={p.id} p={p} editing={editing && isOwner} canSeeMoney={canSeeMoney} busy={busy} call={call} />
							))}
							{editing && isOwner && <AddPerson busy={busy} call={call} />}
						</div>
					</section>

					{canSeeMoney && expenses.length > 0 && (
						<section className="panel">
							<div className="panel-head">
								<span className="panel-title">ค่าใช้จ่าย</span>
								{isOwner && (
									<button type="button" className="link-btn" onClick={() => setEditing(v => !v)}>{editing ? 'เสร็จแล้ว' : 'แก้ไข'}</button>
								)}
							</div>
							<div>
								{expenses.map(e => (
									<ExpenseRow key={e.id} e={e} editing={editing && isOwner} participants={participants} nameOf={nameOf} busy={busy} call={call} />
								))}
								<div className="total-row">
									<span className="label">รวม</span>
									<span className="amount">{baht(totals.total)}</span>
								</div>
							</div>
						</section>
					)}

					{isOwner && pending.length > 0 && (
						<section className="panel">
							<div className="panel-head">
								<span className="panel-title">รอคุณยืนยัน</span>
								<span className="panel-count">{pending.length}</span>
							</div>
							<div>
								{pending.map(p => (
									<div key={p.id} className="row">
										<div className="row-main">
											<div className="row-name">{nameOf(p.participantId)}</div>
											<div className="row-sub">แจ้งว่าจ่ายแล้ว</div>
										</div>
										<span className="row-figure">{baht(p.amountSatang)}</span>
										<span className="row-tools">
											<button type="button" className="btn btn-sm btn-primary" disabled={busy} onClick={() => call('POST', `/payments/${p.id}/confirm`)}>
												ได้รับแล้ว
											</button>
											<button type="button" className="link-btn" disabled={busy} onClick={() => call('POST', `/payments/${p.id}/reject`)}>
												ยังไม่เข้า
											</button>
										</span>
									</div>
								))}
							</div>
						</section>
					)}

					{isOwner && editing && confirmed.length > 0 && (
						<section className="panel">
							<div className="panel-head"><span className="panel-title">ที่ยืนยันไปแล้ว</span></div>
							<div>
								{confirmed.map(p => (
									<div key={p.id} className="row">
										<div className="row-main">
											<div className="row-name">{nameOf(p.participantId)}</div>
										</div>
										<span className="row-figure fig-clear">{baht(p.amountSatang)}</span>
										<span className="row-tools">
											<button type="button" className="link-btn" disabled={busy} onClick={() => call('POST', `/payments/${p.id}/undo`)}>
												ยกเลิกการยืนยัน
											</button>
											<button
												type="button"
												className="link-btn danger"
												disabled={busy}
												onClick={() => confirm('ลบรายการจ่ายนี้ทิ้ง?') && call('DELETE', `/payments/${p.id}`)}
											>
												ลบ
											</button>
										</span>
									</div>
								))}
							</div>
						</section>
					)}
				</div>

				<aside className="stack-lg" style={{ paddingBottom: 0 }}>
					{isOwner && (
						<section className="panel">
							<div className="panel-head"><span className="panel-title">ตัวจัดการ</span></div>
							<div>
								<OwnerControls activity={activity} busy={busy} call={call} participants={participants} />
							</div>
						</section>
					)}

					<section className="panel">
						<div className="panel-head"><span className="panel-title">ชวนคนอื่น</span></div>
						<div>
							<p className="quiet-note" style={{ paddingTop: '.3rem', paddingBottom: '.6rem' }}>
								ส่งลิงก์นี้ในกลุ่มได้เลย เพื่อนไม่ต้องสมัครอะไร
							</p>
							<div className="share-row">
								<input className="form-control" readOnly value={shareUrl} onFocus={e => e.target.select()} aria-label="ลิงก์กิจกรรม" />
								<button
									type="button"
									className="btn btn-secondary btn-sm"
									onClick={() => {
										navigator.clipboard?.writeText(shareUrl);
										setCopied(true);
										setTimeout(() => setCopied(false), 1800);
									}}
								>
									{copied ? 'คัดลอกแล้ว' : 'คัดลอก'}
								</button>
							</div>
						</div>
					</section>
				</aside>
			</div>
		</div>
	);
}

function PersonRow({ p, editing, canSeeMoney, busy, call }) {
	const [name, setName] = useState(p.displayName);

	if (editing) {
		return (
			<div className="row row-editing">
				<input
					className="form-control inline-input"
					value={name}
					onChange={e => setName(e.target.value)}
					onBlur={() => name.trim() && name !== p.displayName && call('PATCH', `/participants/${p.id}`, { displayName: name })}
					aria-label={`ชื่อของ ${p.displayName}`}
				/>
				<span className="row-tools">
					{p.claimed && (
						<button type="button" className="link-btn" disabled={busy} onClick={() => call('PATCH', `/participants/${p.id}`, { resetClaim: true })}>
							คืนชื่อ
						</button>
					)}
					<button
						type="button"
						className="link-btn danger"
						disabled={busy}
						onClick={() => confirm(`เอา ${p.displayName} ออกจากกิจกรรม?`) && call('DELETE', `/participants/${p.id}`)}
					>
						เอาออก
					</button>
				</span>
			</div>
		);
	}

	return (
		<div className={`row ${p.isMe ? 'is-me' : ''}`}>
			<div className="row-main">
				<div className="row-name">
					{p.displayName}
					{p.isMe && <span className="me-tag">คุณ</span>}
				</div>
				<div className="row-sub">
					{p.rsvp === 'yes' ? 'ไป' : p.rsvp === 'no' ? 'ไม่ไป' : 'ยังไม่ตอบ'}
					{!p.claimed && ' · ยังไม่ได้กดลิงก์'}
				</div>
			</div>
			{canSeeMoney && p.outstanding != null && (
				<span className={`row-figure ${p.outstanding > 0 ? 'fig-due' : p.net < 0 ? 'fig-credit' : 'fig-clear'}`}>
					{p.outstanding > 0 ? baht(p.outstanding) : p.net < 0 ? `ได้คืน ${baht(-p.net)}` : 'ครบแล้ว'}
				</span>
			)}
		</div>
	);
}

function AddPerson({ busy, call }) {
	const [name, setName] = useState('');
	return (
		<form
			className="row row-editing"
			onSubmit={(e) => {
				e.preventDefault();
				if (!name.trim()) return;
				call('POST', '/participants', { displayName: name }).then(() => setName(''));
			}}
		>
			<input
				className="form-control inline-input"
				placeholder="เพิ่มคน…"
				value={name}
				onChange={e => setName(e.target.value)}
				aria-label="เพิ่มคน"
			/>
			<span className="row-tools">
				<button type="submit" className="link-btn" disabled={busy || !name.trim()}>เพิ่ม</button>
			</span>
		</form>
	);
}

function ExpenseRow({ e, editing, participants, nameOf, busy, call }) {
	const [label, setLabel] = useState(e.label);
	const [amount, setAmount] = useState((e.amountSatang / 100).toString());

	if (!editing) {
		return (
			<div className="row">
				<div className="row-main">
					<div className="row-name">{e.label}</div>
					<div className="row-sub">{nameOf(e.paidBy)} ออกให้ก่อน</div>
				</div>
				<span className="row-figure">{baht(e.amountSatang)}</span>
			</div>
		);
	}

	const save = patch => call('PATCH', `/expenses/${e.id}`, patch);

	return (
		<div className="row row-editing">
			<input
				className="form-control inline-input"
				value={label}
				onChange={ev => setLabel(ev.target.value)}
				onBlur={() => label.trim() && label !== e.label && save({ label })}
				aria-label="ชื่อรายการ"
			/>
			<input
				className="form-control inline-input mono"
				type="number"
				min="1"
				step="0.01"
				value={amount}
				onChange={ev => setAmount(ev.target.value)}
				onBlur={() => Number(amount) > 0 && Number(amount) * 100 !== e.amountSatang && save({ amountBaht: Number(amount) })}
				aria-label="จำนวนเงิน"
			/>
			<span className="row-tools">
				<select className="form-control inline-input" value={e.paidBy} onChange={ev => save({ paidBy: ev.target.value })} aria-label="ใครออกให้ก่อน">
					{participants.map(p => <option key={p.id} value={p.id}>{p.displayName}</option>)}
				</select>
				<button
					type="button"
					className="link-btn danger"
					disabled={busy}
					onClick={() => confirm(`ลบ "${e.label}" ${baht(e.amountSatang)}?`) && call('DELETE', `/expenses/${e.id}`)}
				>
					ลบ
				</button>
			</span>
		</div>
	);
}

function TimePoll({ poll, me, isOwner, busy, call, total }) {
	const leading = poll.slots[0];
	const answered = Math.max(0, ...poll.slots.map(s => s.answered));
	const waiting = Math.max(total - answered, 0);

	return (
		<section className="panel">
			<div className="panel-head">
				<span className="panel-title">ว่างช่วงไหน</span>
				<span className="panel-count">{poll.ready ? 'ตอบครบแล้ว' : `รออีก ${waiting} คน`}</span>
			</div>
			<div>
				{poll.slots.map(slot => (
					<div key={slot.id} className={`slot ${slot.id === leading?.id ? 'leading' : ''}`}>
						<div className="slot-main">
							<div className="slot-when">{whenText(slot.startsAt, true)}</div>
							<div className="slot-tally">
								<span className="up">ว่าง {slot.yes}</span>
								{slot.maybe > 0 && <span>อาจจะ {slot.maybe}</span>}
								{slot.no > 0 && <span className="down">ไม่ว่าง {slot.no}</span>}
							</div>
						</div>
						{me && (
							<div className="slot-vote">
								{['yes', 'maybe', 'no'].map(answer => (
									<button
										key={answer}
										type="button"
										className={`vote-btn ${poll.myVotes[slot.id] === answer ? `on-${answer}` : ''}`}
										disabled={busy}
										onClick={() => call('POST', '/slots/vote', { votes: { [slot.id]: answer } })}
									>
										{VOTE_LABEL[answer]}
									</button>
								))}
							</div>
						)}
					</div>
				))}

				{leading && (
					<div className="verdict">
						<div>
							<div className="row-sub">Megu ว่าควรเป็น</div>
							<div className="verdict-when">{whenText(leading.startsAt, true)}</div>
						</div>
						{isOwner && (
							<button type="button" className="btn btn-pay" disabled={busy} onClick={() => call('POST', '/slots/lock')}>
								ฟันธงเวลานี้
							</button>
						)}
					</div>
				)}
			</div>
		</section>
	);
}

function ProposeSlots({ busy, call }) {
	const [times, setTimes] = useState(['', '', '']);

	return (
		<form
			onSubmit={(e) => {
				e.preventDefault();
				const startTimes = times.filter(Boolean);
				if (startTimes.length > 0) call('POST', '/slots', { startTimes });
			}}
			style={{ display: 'flex', flexDirection: 'column', gap: '.5rem' }}
		>
			{times.map((t, i) => (
				<input
					key={i}
					className="form-control"
					type="datetime-local"
					value={t}
					onChange={e => setTimes(prev => prev.map((v, idx) => (idx === i ? e.target.value : v)))}
					aria-label={`ตัวเลือกที่ ${i + 1}`}
				/>
			))}
			<button type="button" className="link-btn" style={{ alignSelf: 'flex-start' }} onClick={() => setTimes(prev => [...prev, ''])}>
				+ อีกตัวเลือก
			</button>
			<button type="submit" className="btn btn-primary btn-block" disabled={busy || times.filter(Boolean).length === 0}>
				ให้ Megu ไปถามให้
			</button>
		</form>
	);
}

function OwnerControls({ activity, busy, call, participants }) {
	const [label, setLabel] = useState('');
	const [amount, setAmount] = useState('');
	const [paidBy, setPaidBy] = useState(participants[0]?.id || '');
	const recurring = activity.kind === 'recurring';

	const nextPlan = {
		open: { planState: 'confirmed', label: 'ยืนยันวันเวลา' },
		confirmed: { planState: 'done', label: 'จบกิจกรรมแล้ว' },
		done: null,
		cancelled: null,
	}[activity.planState];

	return (
		<div style={{ display: 'flex', flexDirection: 'column', gap: '1.1rem', paddingTop: '.5rem' }}>
			{!recurring && activity.planState === 'open' && (
				<div>
					<span className="field-label">{activity.poll ? 'เสนอเวลาใหม่' : 'ให้ Megu หาเวลาที่ตรงกัน'}</span>
					<ProposeSlots busy={busy} call={call} />
				</div>
			)}

			{!recurring && nextPlan && (
				<button type="button" className="btn btn-primary btn-block" disabled={busy} onClick={() => call('POST', '/plan', { planState: nextPlan.planState })}>
					{nextPlan.label}
				</button>
			)}

			{recurring && (
				<button type="button" className="btn btn-secondary btn-block" disabled={busy} onClick={() => call('POST', '/periods', { amountBaht: Number(amount) || undefined })}>
					เปิดรอบเดือนนี้
				</button>
			)}

			<form
				onSubmit={(e) => {
					e.preventDefault();
					if (!amount) return;
					call('POST', '/expenses', { label: label || activity.title, amountBaht: Number(amount), paidBy })
						.then(() => {
							setLabel('');
							setAmount('');
						});
				}}
				style={{ display: 'flex', flexDirection: 'column', gap: '.5rem' }}
			>
				<span className="field-label">เพิ่มค่าใช้จ่าย</span>
				<input className="form-control" placeholder="ค่าอะไร" value={label} onChange={e => setLabel(e.target.value)} aria-label="ชื่อรายการ" />
				<input className="form-control" type="number" min="1" step="0.01" placeholder="กี่บาท" value={amount} onChange={e => setAmount(e.target.value)} aria-label="จำนวนเงิน" />
				<select className="form-control" value={paidBy} onChange={e => setPaidBy(e.target.value)} aria-label="ใครออกให้ก่อน">
					{participants.map(p => <option key={p.id} value={p.id}>{p.displayName} ออกให้ก่อน</option>)}
				</select>
				<button type="submit" className="btn btn-secondary btn-block" disabled={busy || !amount}>
					เพิ่มแล้วหารให้เลย
				</button>
			</form>

			{activity.planState !== 'cancelled' && !recurring && (
				<button
					type="button"
					className="link-btn danger"
					style={{ alignSelf: 'flex-start' }}
					disabled={busy}
					onClick={() => confirm('ยกเลิกกิจกรรมนี้?') && call('POST', '/plan', { planState: 'cancelled' })}
				>
					ยกเลิกกิจกรรม
				</button>
			)}
		</div>
	);
}
