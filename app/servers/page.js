'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import MeguMark from '../components/MeguMark';

function guildIconUrl(g) {
	if (!g?.icon) return null;
	if (g.icon.startsWith('http')) return g.icon;
	const ext = g.icon.startsWith('a_') ? 'gif' : 'png';
	return `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.${ext}?size=128`;
}

function guildBannerUrl(g) {
	const art = g?.banner || g?.splash;
	if (!art) return null;
	if (art.startsWith('http')) return art;
	const kind = g.banner ? 'banners' : 'splashes';
	const ext = art.startsWith('a_') ? 'gif' : 'png';
	return `https://cdn.discordapp.com/${kind}/${g.id}/${art}.${ext}?size=512`;
}

// A server with no artwork still needs its card to be distinguishable at a
// glance. The id picks the tint, so the same server keeps the same one.
function guildTint(guildId) {
	let sum = 0;
	for (let i = 0; i < guildId.length; i++) sum += guildId.charCodeAt(i);
	const hue = (sum * 47) % 360;
	return `linear-gradient(135deg, hsl(${hue} 32% 62%), hsl(${(hue + 40) % 360} 30% 46%))`;
}

function ServerCardAvatar({ guild }) {
	const [failed, setFailed] = useState(false);
	const url = guildIconUrl(guild);

	if (!failed && url) {
		return <img className="server-card-avatar" src={url} alt="" onError={() => setFailed(true)} />;
	}
	return (
		<div className="server-card-avatar" style={{ fontSize: '.85rem', fontWeight: 700 }}>
			{guild.name ? guild.name.substring(0, 2).toUpperCase() : '#'}
		</div>
	);
}

function ServerCard({ g }) {
	const banner = guildBannerUrl(g);

	return (
		<div className="server-card">
			<div
				className="server-card-banner"
				style={banner
					? { backgroundImage: `url(${banner})`, backgroundSize: 'cover', backgroundPosition: 'center' }
					: { background: guildTint(g.id) }}
			/>

			{/* Three states, not two: in the server, not in it, and — when the bot
			    process cannot be reached — genuinely unknown. Showing "ยังไม่มี Megu"
			    for the third one tells the admin something false about their server. */}
			<div className="server-card-badges">
				<span className="server-role-badge">{g.owner ? 'เจ้าของ' : 'ผู้ดูแล'}</span>
				{g.isBotInGuild === null
					? <span className="server-status-badge">ตรวจสอบไม่ได้</span>
					: g.isBotInGuild
						? <span className="server-status-badge status-online"><span className="status-dot" />พร้อมใช้งาน</span>
						: <span className="server-status-badge status-offline">ยังไม่มี Megu</span>}
			</div>

			<div className="server-card-avatar-wrapper">
				<ServerCardAvatar guild={g} />
			</div>

			<div className="server-card-body">
				<div className="server-card-title" title={g.name}>{g.name}</div>
				<div className="server-card-details">
					{typeof g.memberCount === 'number'
						? `${g.memberCount.toLocaleString('th-TH')} คน · ID ${g.id}`
						: `ID ${g.id}`}
				</div>
			</div>

			{/* Never offer an invite on an unverified server — the whole point of
			    this state is that we do not know whether Megu is already in it. */}
			<div className="server-card-footer">
				{g.isBotInGuild === false
					? <a href={g.inviteUrl} target="_blank" rel="noreferrer" className="btn btn-secondary btn-sm server-card-btn">+ เชิญ Megu</a>
					: <Link href={`/servers/${g.id}`} className="btn btn-primary btn-sm server-card-btn">ตั้งค่า</Link>}
			</div>
		</div>
	);
}

export default function ServersPage() {
	const [loggedIn, setLoggedIn] = useState(null);
	const [guilds, setGuilds] = useState([]);
	const [botOnline, setBotOnline] = useState(true);
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		fetch('/api/guilds', { credentials: 'same-origin' })
			.then(r => {
				if (r.status === 401) {
					setLoggedIn(false);
					return null;
				}
				setLoggedIn(true);
				return r.ok ? r.json() : null;
			})
			.then(data => {
				if (data) setBotOnline(data.botOnline !== false);
				if (data?.guilds) {
					setGuilds([...data.guilds].sort((a, b) => {
						if (a.isBotInGuild !== b.isBotInGuild) return a.isBotInGuild ? -1 : 1;
						return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
					}));
				}
			})
			.catch(() => {})
			.finally(() => setLoading(false));
	}, []);

	if (loading) {
		return (
			<div className="center-screen">
				<MeguMark size={72} mood="asleep" />
				<p className="quiet-note">กำลังโหลด…</p>
			</div>
		);
	}

	if (loggedIn === false) {
		return (
			<div className="center-screen">
				<MeguMark size={110} />
				<h1 style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(1.9rem, 5vw, 2.8rem)', letterSpacing: '-.03em' }}>
					เซิร์ฟเวอร์ของคุณ
				</h1>
				<p className="quiet-note" style={{ maxWidth: '42ch' }}>
					เข้าสู่ระบบเพื่อดูเซิร์ฟเวอร์ที่คุณดูแล แล้วตั้งค่าให้ Megu ทำงานในนั้น
				</p>
				<a href="/api/auth/login" className="btn btn-primary btn-lg">เข้าสู่ระบบด้วย Discord</a>
			</div>
		);
	}

	const active = guilds.filter(g => g.isBotInGuild === true);
	const missing = guilds.filter(g => g.isBotInGuild === false);

	return (
		<div className="stack-lg">
			<header className="page-head rise">
				<h1>เลือกเซิร์ฟเวอร์ที่จะตั้งค่า</h1>
				<div className="page-meta">
					{botOnline
						? <>
							<span>{active.length} เซิร์ฟเวอร์ที่มี Megu อยู่</span>
							{missing.length > 0 && <span>{missing.length} เซิร์ฟเวอร์ที่ยังไม่ได้เชิญ</span>}
						</>
						: <span>{guilds.length} เซิร์ฟเวอร์ที่คุณดูแล</span>}
				</div>
			</header>

			{!botOnline && (
				<div className="notice rise">
					<strong>ตรวจสอบสถานะ Megu ไม่ได้</strong> — เว็บถามโพรเซสบอทว่าอยู่ในเซิร์ฟเวอร์ไหนบ้างไม่สำเร็จ
					จึงยังบอกไม่ได้ว่าเซิร์ฟเวอร์ไหนมี Megu แล้ว ไม่ได้แปลว่าไม่มี
					<br />
					มักเกิดจากรัน <code>backend/web/web.js</code> เดี่ยวๆ หรือโพรเซสบอทไม่ได้ทำงาน —
					รัน <code>npm run dev</code> เพื่อเปิดทั้งบอทและเว็บพร้อมกัน
				</div>
			)}

			{guilds.length === 0
				? (
					<section className="panel rise rise-2">
						<p className="quiet-note">
							ไม่พบเซิร์ฟเวอร์ที่คุณดูแล — หน้านี้แสดงเฉพาะเซิร์ฟเวอร์ที่คุณมีสิทธิ์ผู้ดูแลหรือจัดการเซิร์ฟเวอร์
						</p>
					</section>
				)
				: (
					<div className="server-grid rise rise-2">
						{guilds.map(g => <ServerCard key={g.id} g={g} />)}
					</div>
				)}
		</div>
	);
}
