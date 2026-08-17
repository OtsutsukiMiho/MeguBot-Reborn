'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import MeguMark from '../components/MeguMark';

const PLAN_LABEL = {
	open: 'รอคำตอบ',
	confirmed: 'ยืนยันแล้ว',
	done: 'เสร็จสิ้น',
	cancelled: 'ยกเลิก',
};

export default function ActivitiesPage() {
	const [me, setMe] = useState(null);
	const [activities, setActivities] = useState([]);
	const [guilds, setGuilds] = useState([]);
	const [loading, setLoading] = useState(true);
	const [creating, setCreating] = useState(null);

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

	if (loading) {
		return (
			<div className="center-screen">
				<MeguMark size={72} mood="asleep" />
				<p className="quiet-note">กำลังโหลด…</p>
			</div>
		);
	}

	if (!me?.loggedIn) {
		return (
			<div className="center-screen">
				<MeguMark size={110} />
				<h1 style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(1.9rem, 5vw, 2.8rem)', letterSpacing: '-.03em' }}>
					สวัสดี เราชื่อ Megu
				</h1>
				<p className="quiet-note" style={{ maxWidth: '42ch' }}>
					เราจะช่วยจัดกิจกรรมให้กลุ่มคุณ ตั้งแต่ถามว่าใครไป จนถึงตามเงินให้ครบ
				</p>
				<a href="/api/auth/login" className="btn btn-primary btn-lg">เข้าสู่ระบบด้วย Discord</a>
			</div>
		);
	}

	const live = activities.filter(a => !['done', 'cancelled'].includes(a.planState) || a.kind === 'recurring');
	const past = activities.filter(a => ['done', 'cancelled'].includes(a.planState) && a.kind !== 'recurring');

	return (
		<div className="stack-lg">
			<header className="page-head rise">
				<h1>กิจกรรมทั้งหมด</h1>
				<div className="page-meta">
					<span>{live.length} รายการที่ยังเดินอยู่</span>
					{past.length > 0 && <span>{past.length} รายการที่จบแล้ว</span>}
				</div>
			</header>

			<div className="chips rise rise-2">
				<button type="button" className="btn btn-primary" onClick={() => setCreating(creating === 'event' ? null : 'event')}>
					+ กิจกรรมครั้งเดียว
				</button>
				<button type="button" className="btn btn-secondary" onClick={() => setCreating(creating === 'recurring' ? null : 'recurring')}>
					+ เก็บรายเดือน
				</button>
			</div>

			{creating && (
				<CreateActivity
					kind={creating}
					guilds={guilds}
					onCancel={() => setCreating(null)}
					onCreated={a => (window.location.href = `/a/${a.code}`)}
				/>
			)}

			{/* The server list used to live here as a sidebar. It is a different
			    product for a different reader, so it has its own page now. */}
			<div className="rise rise-3">
				<section className="panel">
					<div className="panel-head"><span className="panel-title">กำลังเดินอยู่</span><span className="panel-count">{live.length}</span></div>
					{live.length === 0
						? <p className="quiet-note">ยังไม่มีอะไรค้างอยู่ — เปิดอันใหม่ได้เลย</p>
						: live.map(a => <ActivityRow key={a.id} a={a} />)}
				</section>

				{past.length > 0 && (
					<section className="panel">
						<div className="panel-head"><span className="panel-title">ที่ผ่านมา</span><span className="panel-count">{past.length}</span></div>
						{past.map(a => <ActivityRow key={a.id} a={a} quiet />)}
					</section>
				)}
			</div>
		</div>
	);
}

function ActivityRow({ a, quiet }) {
	const when = a.startsAt
		? new Date(a.startsAt).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' })
		: null;
	const label = a.kind === 'recurring' ? 'รายเดือน' : PLAN_LABEL[a.planState];

	return (
		<Link href={`/a/${a.code}`} className="row" style={{ opacity: quiet ? .55 : 1, textDecoration: 'none', color: 'inherit' }}>
			<span className="row-name" style={{ maxWidth: '20ch' }}>{a.title}</span>
			<span style={{flex:1}} />
			<span className="row-sub">
				{[when, a.location, label].filter(Boolean).join(' · ')}
			</span>
		</Link>
	);
}

function CreateActivity({ kind, guilds, onCreated, onCancel }) {
	const recurring = kind === 'recurring';
	const [title, setTitle] = useState('');
	const [startsAt, setStartsAt] = useState('');
	const [location, setLocation] = useState('');
	const [amount, setAmount] = useState('');
	const [dueDay, setDueDay] = useState('1');
	const [names, setNames] = useState('');
	const [guildId, setGuildId] = useState('');
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState('');

	const activeGuilds = guilds.filter(g => g.isBotInGuild);

	async function submit(e) {
		e.preventDefault();
		setBusy(true);
		setError('');
		try {
			const participants = names.split(/[,\n]/).map(s => s.trim()).filter(Boolean).map(displayName => ({ displayName }));
			const res = await fetch('/api/megu/activities', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				credentials: 'same-origin',
				body: JSON.stringify({
					title,
					kind,
					location: recurring ? null : location || null,
					startsAt: recurring ? null : startsAt || null,
					amountBaht: recurring ? Number(amount) || undefined : undefined,
					dueDay: recurring ? Number(dueDay) || 1 : undefined,
					guildId: guildId || null,
					participants,
				}),
			});
			const data = await res.json();
			if (!res.ok) {
				setError(data.error || 'สร้างไม่สำเร็จ');
				return;
			}
			onCreated(data.activity);
		}
		catch {
			setError('เชื่อมต่อไม่ได้');
		}
		finally {
			setBusy(false);
		}
	}

	return (
		<form onSubmit={submit} className="panel">
			<div className="megu-says" style={{ marginBottom: '1.1rem' }}>
				<MeguMark size={38} />
				<div>
					<span className="who">Megu</span>
					<p>{recurring
						? 'ของที่ต้องเก็บทุกเดือน บอกมาว่าเท่าไหร่ กับใครบ้าง'
						: 'จะทำอะไร กับใครบ้าง เดี๋ยวเราไปถามให้เอง'}</p>
				</div>
			</div>

			{error && <div className="error-note">{error}</div>}

			<div style={{ display: 'grid', gap: '.8rem', maxWidth: '540px' }}>
				<input
					className="form-control"
					required
					placeholder={recurring ? 'YouTube Premium' : 'ตีแบด'}
					value={title}
					onChange={e => setTitle(e.target.value)}
					aria-label={recurring ? 'เก็บค่าอะไร' : 'ทำอะไรกัน'}
				/>

				{recurring ? (
					<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '.8rem' }}>
						<div>
							<label className="field-label" htmlFor="megu-amount">ค่าบริการต่อเดือน (บาท)</label>
							<input
								id="megu-amount"
								className="form-control"
								type="number"
								min="1"
								step="0.01"
								placeholder="169"
								value={amount}
								onChange={e => setAmount(e.target.value)}
							/>
						</div>
						{/* This field ships with a default, so its placeholder never shows —
						    without a label the box just reads as a bare "1". */}
						<div>
							<label className="field-label" htmlFor="megu-due-day">เก็บเงินทุกวันที่</label>
							<input
								id="megu-due-day"
								className="form-control"
								type="number"
								min="1"
								max="28"
								value={dueDay}
								onChange={e => setDueDay(e.target.value)}
							/>
							<small style={{ color: 'var(--faint)', fontSize: '.8rem' }}>ของทุกเดือน (1–28)</small>
						</div>
					</div>
				) : (
					<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '.8rem' }}>
						<div>
							<label className="field-label" htmlFor="megu-starts-at">เมื่อไหร่</label>
							<input id="megu-starts-at" className="form-control" type="datetime-local" value={startsAt} onChange={e => setStartsAt(e.target.value)} />
						</div>
						<div>
							<label className="field-label" htmlFor="megu-location">ที่ไหน</label>
							<input id="megu-location" className="form-control" placeholder="คอร์ทเจริญศรี" value={location} onChange={e => setLocation(e.target.value)} />
						</div>
					</div>
				)}

				<textarea
					className="form-control"
					placeholder="โอม, นัท, A"
					value={names}
					onChange={e => setNames(e.target.value)}
					aria-label="รายชื่อ"
				/>
				<small style={{ color: 'var(--faint)', fontSize: '.8rem', marginTop: '-.4rem' }}>
					คั่นด้วยลูกน้ำหรือขึ้นบรรทัดใหม่ — เพื่อนไม่ต้องสมัครอะไรทั้งนั้น แค่ส่งลิงก์ให้
				</small>

				{activeGuilds.length > 0 && (
					<select className="form-control" value={guildId} onChange={e => setGuildId(e.target.value)} aria-label="เซิร์ฟเวอร์">
						<option value="">ไม่ผูกกับเซิร์ฟเวอร์</option>
						{activeGuilds.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
					</select>
				)}

				<div style={{ display: 'flex', gap: '.6rem' }}>
					<button type="submit" className="btn btn-primary btn-lg" disabled={busy || !title.trim()}>
						{busy ? 'กำลังสร้าง…' : 'สร้างแล้วเอาลิงก์ไปแปะ'}
					</button>
					<button type="button" className="btn btn-ghost" onClick={onCancel}>ยกเลิก</button>
				</div>
			</div>
		</form>
	);
}
