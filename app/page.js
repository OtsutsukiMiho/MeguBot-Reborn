'use client';

import { useState, useEffect } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import MeguMark from './components/MeguMark';
import { useLang } from './components/LangProvider';

// WebGL cannot render on the server and must not block first paint, so the flat
// vector is what ships in the HTML and the scene fades in over it once it is
// ready. If three fails to load, or the device has no WebGL, the vector simply
// stays — there is no broken state to fall back from.
const MeguScene = dynamic(() => import('./components/MeguScene'), { ssr: false });

/**
 * Every string on the landing page, both languages, in one object.
 *
 * The headline is stored as three pieces rather than marked up inline because
 * the accent word lands in a different place in each language, and the accent
 * has to sit on a word rather than at a fixed character offset.
 */
const COPY = {
	th: {
		label: 'ไทย',
		eyebrow: 'บอท Discord จาก Megux Corp',
		h1: ['เลิกเป็นคนที่ต้อง', 'ทวง', 'เพื่อนเอง'],
		lede: 'Megu พาเรื่องที่พวกคุณนัดกันไว้ ตั้งแต่ “เอาไงดี” จนถึง “ทุกคนจ่ายครบ” เขาถามแทน สรุปแทน เตือนแทน และทวงแทน โดยไม่มีใครต้องเสียเพื่อน',
		ctaIn: 'ไปที่กิจกรรมของฉัน',
		ctaOut: 'เริ่มใช้ฟรีด้วย Discord',
		ctaServers: 'ตั้งค่าบอทในเซิร์ฟเวอร์',
		steps: [
			{ word: 'ถาม', h: 'ว่างวันไหนบ้าง', p: 'แปะลิงก์ในกลุ่มครั้งเดียว เพื่อนกดตอบได้เลย ไม่ต้องสมัคร ไม่ต้องโหลดแอป แล้ว Megu ไล่ตามคนที่ยังไม่ตอบให้เอง' },
			{ word: 'ฟันธง', h: 'สรุปเสาร์ทุ่มนึง', p: 'ไม่มีใครอยากเป็นคนเคาะเพราะกลัวดูเผด็จการ ให้ Megu พูดแทน เขาไม่ใช่คน เลยไม่มีใครโกรธ' },
			{ word: 'หาร', h: 'คนละเท่าไหร่', p: 'ค่าคอร์ท 400 หารกัน 4 คน เขาคิดให้ทันทีว่าใครติดเท่าไหร่ คนที่ไม่ได้ไปก็ไม่ต้องจ่าย' },
			{ word: 'ทวง', h: 'จนกว่าจะครบ', p: 'ส่วนที่ไม่มีใครอยากทำ เขาจำได้ว่าใครยังค้าง ค้างมากี่วัน แล้วทักไปเองอย่างสุภาพ' },
		],
		serverEyebrow: 'อีกครึ่งหนึ่งของ Megu',
		serverH2: 'ในเซิร์ฟเวอร์ เขาทำงานอยู่ตลอด',
		serverLede: 'ก่อนจะมาช่วยเรื่องนัดกับเรื่องเงิน Megu เป็นบอทดูแลเซิร์ฟเวอร์มาก่อน และยังเป็นอยู่ ทุกอย่างข้างล่างนี้ตั้งค่าจากหน้าเว็บได้ ไม่ต้องจำคำสั่ง',
		serverCta: 'ดูเซิร์ฟเวอร์ของฉัน',
		caps: [
			{ h: 'กันสแปม กันลิงก์เชิญ', p: 'ข้อความรัวเกิน 5 ครั้งใน 3 วินาที ลิงก์เชิญเซิร์ฟเวอร์อื่น แท็กรัวเกิน 5 คน และคำที่คุณสั่งห้ามไว้ เลือกได้ว่าจะแค่ลบ ปิดปาก 1 นาที หรือเชิญออก — แอดมินกับคนคุมห้องไม่โดน' },
			{ h: 'ห้องล่อไว้ดักบอทโฆษณา', p: 'ตั้งห้องหลอกไว้ห้องหนึ่ง ใครพิมพ์ลงไปโดนแบนทันที คนจริงไม่มีเหตุต้องพิมพ์ในห้องที่ไม่มีใครคุยกัน' },
			{ h: 'ต้อนรับและให้ยศเอง', p: 'ข้อความต้อนรับตอนเข้า ข้อความบอกลาตอนออก และยศเริ่มต้นที่ติดให้ทันทีโดยไม่ต้องรอใครว่าง' },
			{ h: 'ยศจากการกดอิโมจิ', p: 'แปะข้อความเดียวไว้ ใครอยากได้ยศไหนก็กดอิโมจิเอา ถอดอิโมจิยศก็หลุด ไม่ต้องมีใครมานั่งแจก' },
			{ h: 'อ่านข้อความออกเสียง', p: 'ตั้งห้องแชทไว้ห้องหนึ่ง พิมพ์อะไรลงไป Megu อ่านให้ในห้องเสียง คนที่มือไม่ว่างก็ยังอยู่ในวงสนทนาได้ ตั้งชื่อที่ให้เขาเรียกเองได้ด้วย' },
			{ h: 'บันทึกไว้ทุกเหตุการณ์', p: 'เข้า ออก ลบข้อความ แบน ปลดแบน เปลี่ยนยศ สร้างและลบห้อง คำเชิญ รวม 21 เหตุการณ์ ย้อนดูได้จากหน้าเว็บว่าใครทำอะไรไว้เมื่อไหร่' },
		],
		closeH2: 'หนึ่งบอท สองด้าน',
		closeLede: 'ด้านหนึ่งดูแลเซิร์ฟเวอร์ให้แอดมิน อีกด้านดูแลเรื่องนัดกับเรื่องเงินให้เพื่อนกลุ่มหนึ่ง คนละคนใช้ คนละเรื่อง แต่เป็น Megu ตัวเดียวกัน และคนที่เปิดลิงก์กิจกรรมไม่ต้องมี Discord ด้วยซ้ำ',
	},

	en: {
		label: 'EN',
		eyebrow: 'A Discord bot by Megux Corp',
		h1: ['Stop being the one who ', 'chases', ' everyone'],
		lede: 'Megu carries a plan from “so what are we doing?” all the way to “everyone has paid.” It asks, it settles, it reminds, and it chases — so that none of you has to.',
		ctaIn: 'Go to my activities',
		ctaOut: 'Start free with Discord',
		ctaServers: 'Set up the bot on a server',
		steps: [
			{ word: 'ASK', h: 'Who is free, and when', p: 'Drop one link in the group chat. Your friends answer in a tap — no signup, no app to install. Megu goes after whoever has not replied.' },
			{ word: 'SETTLE', h: 'Saturday, seven. Done.', p: 'Nobody wants to be the one who calls it and looks bossy. Let Megu say it — it is not a person, so nobody takes it personally.' },
			{ word: 'SPLIT', h: 'What each of you owes', p: '฿400 for the court between four people, worked out the moment it is entered. Whoever did not come does not pay.' },
			{ word: 'CHASE', h: 'Until everyone has paid', p: 'The part nobody wants. Megu remembers who is still short, how many days it has been, and asks them politely itself.' },
		],
		serverEyebrow: 'The other half of Megu',
		serverH2: 'In your server, it never clocks off',
		serverLede: 'Long before the planning and the money, Megu was a server bot — and still is. Everything below is configured from the web, with no commands to memorise.',
		serverCta: 'See my servers',
		caps: [
			{ h: 'Spam and invite links', p: 'Five messages in three seconds, invite links to other servers, more than five mentions at once, and any word you ban. Choose whether that just deletes the message, mutes for a minute, or removes the member — admins and moderators are never caught by it.' },
			{ h: 'A decoy channel for ad bots', p: 'Set one channel as bait. Anyone who posts there is banned on the spot. A real member has no reason to type in a room nobody talks in.' },
			{ h: 'Welcomes and starter roles', p: 'A greeting on the way in, a note on the way out, and the starting role applied the moment someone joins rather than whenever a human gets around to it.' },
			{ h: 'Roles from a reaction', p: 'Post one message. Anyone who wants a role reacts to take it and un-reacts to drop it. Nobody has to hand them out.' },
			{ h: 'Messages read aloud', p: 'Point Megu at a text channel and it speaks whatever is typed there into the voice channel, so whoever has their hands full is still part of the conversation. Each member can set the name it calls them by.' },
			{ h: 'Every event on record', p: 'Joins, leaves, deleted messages, bans and unbans, role changes, channels created and destroyed, invites — twenty-one events in all, and the web shows you who did what, and when.' },
		],
		closeH2: 'One bot, two halves',
		closeLede: 'One half looks after a server for its admins. The other looks after the plans and the money for a group of friends. Different people, different problems, the same Megu — and whoever opens an activity link needs no Discord account at all.',
	},
};

export default function HomePage() {
	const [user, setUser] = useState(null);
	const { lang } = useLang();

	useEffect(() => {
		fetch('/api/auth/me')
			.then(res => res.json())
			.then(data => {
				if (data.loggedIn && data.user) setUser(data.user);
			})
			.catch(() => {});
	}, []);

	const t = COPY[lang];
	const [h1a, h1accent, h1b] = t.h1;

	return (
		<div className="stage" lang={lang}>
			{/* The one colour field on the site. It carries its own palette rather
			    than the theme's, so the contrast here is the same at midnight as
			    at noon and never has to be re-checked against a flipping ground. */}
			<section className="hero-field">
				<div className="hero-block">
					<div className="hero-copy">
						<span className="eyebrow enter" style={{ '--i': 0 }}>{t.eyebrow}</span>

						<h1 className="enter" style={{ '--i': 1 }}>
							{h1a}<em>{h1accent}</em>{h1b}
						</h1>

						<p className="lede enter" style={{ '--i': 2 }}>{t.lede}</p>

						<div className="hero-actions enter" style={{ '--i': 3 }}>
							{user
								? <Link href="/activities" className="btn btn-primary btn-lg">{t.ctaIn}</Link>
								: <a href="/api/auth/login" className="btn btn-primary btn-lg">{t.ctaOut}</a>}
							<Link href="/servers" className="btn btn-secondary btn-lg">{t.ctaServers}</Link>
						</div>
					</div>

					{/* The flat mark ships in the HTML; the WebGL scene lands on top of
					    it once it is ready, and simply never arrives if it cannot. */}
					<div className="hero-portrait megu-stage enter" style={{ '--i': 2 }}>
						<MeguMark size={340} className="megu-flat" />
						<MeguScene className="megu-canvas" />
					</div>
				</div>
			</section>

			<div className="flow reveal-stagger">
				{t.steps.map((s, i) => (
					<div className="flow-step reveal" key={s.word}>
						<span className="flow-index">
							{String(i + 1).padStart(2, '0')}
							<span className="word">{s.word}</span>
						</span>
						<h3>{s.h}</h3>
						<p>{s.p}</p>
					</div>
				))}
			</div>

			<section className="server-side">
				<div className="section-head reveal">
					<span className="eyebrow">{t.serverEyebrow}</span>
					<h2>{t.serverH2}</h2>
					<p className="lede">{t.serverLede}</p>
				</div>

				<div className="capabilities reveal-stagger">
					{t.caps.map(c => (
						<article className="capability lift" key={c.h}>
							<h3>{c.h}</h3>
							<p>{c.p}</p>
						</article>
					))}
				</div>

				<Link href="/servers" className="btn btn-secondary btn-lg reveal">{t.serverCta}</Link>
			</section>

			<section className="closing reveal">
				<h2>{t.closeH2}</h2>
				<p className="lede">{t.closeLede}</p>
				<div className="hero-actions">
					{user
						? <Link href="/activities" className="btn btn-primary btn-lg">{t.ctaIn}</Link>
						: <a href="/api/auth/login" className="btn btn-primary btn-lg">{t.ctaOut}</a>}
					<Link href="/servers" className="btn btn-secondary btn-lg">{t.ctaServers}</Link>
				</div>
			</section>
		</div>
	);
}
