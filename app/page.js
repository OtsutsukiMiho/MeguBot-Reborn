'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
	ArrowRight,
	BellRing,
	CalendarDays,
	Check,
	CircleDollarSign,
	ClipboardCheck,
	MessageCircle,
	Mic2,
	ReceiptText,
	ShieldCheck,
	Users,
} from 'lucide-react';
import MeguMark from './components/MeguMark';
import { useLang } from './components/LangProvider';
import { withFallback } from './copy/fallback';
import styles from './landing.module.css';

const COPY = {
	th: {
		eyebrow: 'ผู้ช่วยประจำ Discord server ของคุณ',
		h1: ['คุยกันใน Discord', 'ที่เหลือให้ Megu', 'จัดการต่อ'],
		lede: 'เปลี่ยนบทสนทนาให้เป็นอีเวนต์ งานเตือน และรายการที่ต้องตามต่อ พร้อมดูแลสมาชิก ห้องเสียง และความเรียบร้อยของเซิร์ฟเวอร์—โดยไม่ต้องย้ายทุกคนไปใช้แอปใหม่',
		primaryOut: 'เพิ่ม Megu เข้าเซิร์ฟเวอร์',
		primaryIn: 'จัดการเซิร์ฟเวอร์ของฉัน',
		secondary: 'ดูวิธีทำงาน',
		freeNote: 'เริ่มต้นใช้ฟรี · ตั้งค่าผ่านเว็บเท่าที่จำเป็น',
		chatLabel: 'ตัวอย่างการทำงาน',
		chatStatus: 'Megu กำลังฟังใน #general',
		chatOneName: 'นัท',
		chatOneInitial: 'น',
		chatOne: 'วันนี้เรามีประชุมบ่ายโมงนะ',
		chatTwoName: 'มินท์',
		chatTwoInitial: 'ม',
		chatTwo: 'Megu สร้างอีเวนต์ประชุมบ่ายโมงให้หน่อย แล้วแจ้งทีมโปรเจกต์ด้วย',
		channelDescription: 'วางแผน คุยงาน และตามเรื่องในที่เดียว',
		composer: 'ส่งข้อความไปที่ #general',
		botName: 'Megu',
		botBadge: 'BOT',
		botReply: 'เรียบร้อย สร้างอีเวนต์ให้แล้ว และกำลังแจ้งคนที่เกี่ยวข้อง',
		eventTitle: 'ประชุมทีมโปรเจกต์',
		eventTime: 'วันนี้ · 13:00 น.',
		eventNotice: 'แท็ก 6 คน · ส่ง DM แล้ว 4 คน',
		planned: 'กำลังมาใน Megu รุ่นถัดไป',
		proof: 'หนึ่งข้อความ กลายเป็นแผนที่ทุกคนเห็นตรงกัน',
		workflowEyebrow: 'จากข้อความธรรมดา สู่งานที่เสร็จจริง',
		workflowTitle: 'Megu รับช่วงต่อจากที่คุยกันค้างไว้',
		workflowLede: 'ไม่ต้องเปิด dashboard เพื่อสร้างงานทุกครั้ง แค่บอก Megu ในห้องที่ทีมใช้อยู่แล้ว แล้วให้เธอจัดโครงสร้างและตามต่อให้',
		steps: [
			{ label: 'เข้าใจ', title: 'รับเรื่องจากบทสนทนา', body: 'เรียกชื่อ Megu แล้วบอกเวลา คนที่เกี่ยวข้อง และสิ่งที่ต้องการด้วยภาษาปกติ' },
			{ label: 'จัดให้', title: 'สร้างแผนในเซิร์ฟเวอร์', body: 'เปลี่ยนข้อความเป็นอีเวนต์ เช็กลิสต์ หรืองานเตือน พร้อมสรุปรายละเอียดให้ตรวจได้ทันที' },
			{ label: 'ตามต่อ', title: 'แจ้งคนที่ต้องรู้', body: 'แท็ก role หรือสมาชิก ส่ง DM และเตือนอีกครั้งตามกติกาที่แอดมินกำหนด' },
		],
		managerEyebrow: 'มากกว่า event bot',
		managerTitle: 'ผู้จัดการเซิร์ฟเวอร์ที่อยู่ในวงสนทนาด้วย',
		managerLede: 'Megu ไม่ได้รอให้คุณจำทุกคำสั่ง เธอช่วยดูทั้งแผนของทีม ประสบการณ์ในห้องเสียง และงานดูแลชุมชนที่กินเวลาทุกวัน',
		groups: [
			{
				label: 'จัดการแผน',
				items: [
					{ title: 'อีเวนต์และนัดหมาย', body: 'สร้างจากบทสนทนา สรุปเวลา และรวมคำตอบว่าใครมาได้', icon: CalendarDays },
					{ title: 'เตือนผ่าน mention และ DM', body: 'ส่งข่าวถึงเฉพาะคนที่เกี่ยวข้อง แล้วตามซ้ำแบบไม่รบกวนทั้งห้อง', icon: BellRing },
					{ title: 'เช็กลิสต์และสิ่งที่ต้องตาม', body: 'จำหัวข้อ งานค้าง และเจ้าของงาน เพื่อให้การคุยจบด้วยคนลงมือทำ', icon: ClipboardCheck },
				],
			},
			{
				label: 'ดูแลชุมชน',
				items: [
					{ title: 'ต้อนรับ ยศ และ moderation', body: 'จัด role อัตโนมัติ กันสแปม ลิงก์เชิญ และบันทึกเหตุการณ์สำคัญ', icon: ShieldCheck },
					{ title: 'อยู่ด้วยในห้องเสียง', body: 'ประกาศชื่อคนเข้า อ่านข้อความ และช่วยให้คนที่ไม่สะดวกใช้ไมค์ยังร่วมวงได้', icon: Mic2 },
					{ title: 'รู้จักคนในเซิร์ฟเวอร์', body: 'ตั้งชื่อที่อยากให้เรียก แยกกลุ่มคน และสื่อสารให้ตรงกับบริบทของแต่ละห้อง', icon: Users },
				],
			},
		],
		moneyEyebrow: 'เรื่องเงินยังอยู่ เมื่อกิจกรรมต้องใช้มัน',
		moneyTitle: 'หารเงินยังทำได้ แค่ไม่แย่งบทหลัก',
		moneyBody: 'ทริป มื้ออาหาร หรือค่า subscription เริ่มจากแผนเดียวกันใน Discord แล้วค่อยเปิดเว็บเมื่อจำเป็นต้องดูยอด สแกน PromptPay หรือแนบหลักฐานการจ่าย',
		moneyPoints: ['สรุปว่าใครร่วมรายการไหน', 'คำนวณยอดที่แต่ละคนต้องจ่าย', 'เก็บหลักฐานโดยที่ Megu ไม่ถือเงินแทนใคร'],
		moneyCta: 'เปิดหน้าค่าใช้จ่าย',
		activityName: 'ทริปหัวหิน',
		activityMeta: '6 คน · 4 รายการ',
		activityAmount: '฿1,240',
		activityDue: 'ยอดของคุณ',
		activityProgress: 'จ่ายแล้ว 4 จาก 6 คน',
		webEyebrow: 'Web companion',
		webTitle: 'เว็บเป็นห้องควบคุม ไม่ใช่ที่ทำงานหลัก',
		webBody: 'ใช้เว็บเฉพาะตอนที่จอใหญ่ช่วยให้ทำงานง่ายกว่า—ตั้งค่าระบบ ดู audit log จัดรายละเอียดกิจกรรม และตรวจรายการค่าใช้จ่าย ส่วนชีวิตประจำวันเกิดขึ้นใน Discord',
		webCta: 'เปิดหน้าจัดการเซิร์ฟเวอร์',
		closeEyebrow: 'ให้เซิร์ฟเวอร์เดินหน้าต่อเองได้',
		closeTitle: 'เพิ่ม Megu ครั้งเดียว แล้วให้เธอช่วยดูเรื่องที่หล่นระหว่างแชท',
		closeBody: 'นัดหมาย งานเตือน ห้องเสียง สมาชิก และค่าใช้จ่ายของกลุ่ม—อยู่ในจังหวะเดียวกับที่ทุกคนคุยกันอยู่แล้ว',
	},
	en: {
		eyebrow: 'The assistant inside your Discord server',
		h1: ['Talk in Discord.', 'Let Megu', 'take it from there.'],
		lede: 'Turn conversations into events, reminders, and follow-ups while Megu helps with members, voice rooms, and everyday server operations—without moving everyone into another app.',
		primaryOut: 'Add Megu to your server',
		primaryIn: 'Manage my servers',
		secondary: 'See how it works',
		freeNote: 'Start free · Use the web only when it helps',
		chatLabel: 'A real workflow',
		chatStatus: 'Megu is listening in #general',
		chatOneName: 'Nat',
		chatOneInitial: 'N',
		chatOne: 'We have a project meeting at one today.',
		chatTwoName: 'Mint',
		chatTwoInitial: 'M',
		chatTwo: 'Megu, create a 1 PM event and let the project team know.',
		channelDescription: 'Plan, coordinate, and follow through together',
		composer: 'Message #general',
		botName: 'Megu',
		botBadge: 'BOT',
		botReply: 'Done. The event is ready and I’m notifying everyone involved.',
		eventTitle: 'Project team meeting',
		eventTime: 'Today · 1:00 PM',
		eventNotice: '6 mentioned · 4 DMs delivered',
		planned: 'Coming in the next Megu release',
		proof: 'One message becomes a plan everyone can see.',
		workflowEyebrow: 'From loose chat to finished work',
		workflowTitle: 'Megu picks up where the conversation leaves off',
		workflowLede: 'You should not need a dashboard to create every task. Tell Megu in the channel your team already uses, then let her structure the plan and follow through.',
		steps: [
			{ label: 'Understand', title: 'Take the request from chat', body: 'Mention Megu and describe the time, people, and outcome in ordinary language.' },
			{ label: 'Organize', title: 'Create the plan in-server', body: 'Turn the message into an event, checklist, or reminder and show the structured details immediately.' },
			{ label: 'Follow up', title: 'Reach the right people', body: 'Mention a role or members, send DMs, and remind again using rules the admins control.' },
		],
		managerEyebrow: 'More than an event bot',
		managerTitle: 'A server manager that stays in the conversation',
		managerLede: 'Megu helps with team plans, the voice-room experience, and the repetitive community work that takes time every day.',
		groups: [
			{
				label: 'Run the plan',
				items: [
					{ title: 'Events and schedules', body: 'Create them from chat, settle the time, and collect who can make it.', icon: CalendarDays },
					{ title: 'Mentions and DM reminders', body: 'Reach only the people involved and follow up without disturbing the whole room.', icon: BellRing },
					{ title: 'Checklists and follow-ups', body: 'Remember topics, open work, and owners so conversations end with action.', icon: ClipboardCheck },
				],
			},
			{
				label: 'Run the community',
				items: [
					{ title: 'Welcome, roles, and moderation', body: 'Automate roles, block spam and invite links, and keep an audit trail.', icon: ShieldCheck },
					{ title: 'Present in voice', body: 'Announce joins, read messages aloud, and include people who cannot use a mic.', icon: Mic2 },
					{ title: 'Know the server', body: 'Use preferred names, member groups, and the context of each room.', icon: Users },
				],
			},
		],
		moneyEyebrow: 'Money stays when the activity needs it',
		moneyTitle: 'Expense splitting still works. It just is not the headline.',
		moneyBody: 'Trips, meals, and shared subscriptions begin with the same Discord plan. Open the web only when a larger screen helps with balances, PromptPay, or payment evidence.',
		moneyPoints: ['Track who joined each expense', 'Calculate exactly what each person owes', 'Keep evidence without Megu ever holding the money'],
		moneyCta: 'Open bills',
		activityName: 'Hua Hin trip',
		activityMeta: '6 people · 4 expenses',
		activityAmount: '฿1,240',
		activityDue: 'Your share',
		activityProgress: '4 of 6 people settled',
		webEyebrow: 'Web companion',
		webTitle: 'The web is the control room, not the workplace',
		webBody: 'Use it where a larger screen genuinely helps: configure the server, inspect the audit log, shape an activity, and review expenses. Everyday work stays in Discord.',
		webCta: 'Open server controls',
		closeEyebrow: 'Keep the server moving',
		closeTitle: 'Add Megu once. Let her catch what falls between messages.',
		closeBody: 'Schedules, reminders, voice rooms, members, and shared expenses—handled in the same rhythm as the conversation.',
	},
};

function Avatar({ children, tone = 'blue' }) {
	return <span className={`${styles.avatar} ${styles[`avatar${tone}`]}`} aria-hidden="true">{children}</span>;
}

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

	const t = withFallback(COPY.en, COPY[lang]);
	const [headlineLead, headlineAccent, headlineEnd] = t.h1;

	return (
		<div className={styles.landing} lang={lang}>
			<section className={styles.hero} data-landing-hero>
				<div className={styles.heroInner}>
					<div className={styles.heroCopy}>
						<p className={styles.eyebrow}><MessageCircle size={16} /> {t.eyebrow}</p>
						<h1>{headlineLead}<br /><em>{headlineAccent}</em><br />{headlineEnd}</h1>
						<p className={styles.heroLede}>{t.lede}</p>
						<div className={styles.heroActions}>
							<Link href="/servers" className={styles.primaryCta}>
								{user ? t.primaryIn : t.primaryOut}<ArrowRight size={18} />
							</Link>
							<Link href="#workflow" className={styles.secondaryCta}>{t.secondary}</Link>
						</div>
						<p className={styles.freeNote}><Check size={15} /> {t.freeNote}</p>
					</div>

					<div className={styles.demoWrap} aria-label={t.chatLabel}>
						<div className={styles.demoTopline}>
							<span>{t.chatLabel}</span>
							<span className={styles.liveStatus}><i />{t.chatStatus}</span>
						</div>
						<div className={styles.discordWindow}>
							<div className={styles.channelBar}>
								<span className={styles.hash}>#</span>
								<div><strong>general</strong><small>{t.channelDescription}</small></div>
								<span className={styles.windowDots} aria-hidden="true"><i /><i /><i /></span>
							</div>

							<div className={styles.chatBody}>
								<div className={styles.message}>
									<Avatar tone="gold">{t.chatOneInitial}</Avatar>
									<div><div className={styles.messageMeta}><strong>{t.chatOneName}</strong><time>12:04</time></div><p>{t.chatOne}</p></div>
								</div>
								<div className={styles.message}>
									<Avatar tone="mint">{t.chatTwoInitial}</Avatar>
									<div><div className={styles.messageMeta}><strong>{t.chatTwoName}</strong><time>12:05</time></div><p><mark>@Megu</mark> {t.chatTwo.replace(/^Megu[,.]?\s*/i, '')}</p></div>
								</div>
								<div className={`${styles.message} ${styles.botMessage}`}>
									<span className={styles.meguAvatar}><MeguMark size={40} mood="happy" /></span>
									<div>
										<div className={styles.messageMeta}><strong>{t.botName}</strong><b>{t.botBadge}</b><time>12:05</time></div>
										<p>{t.botReply}</p>
										<div className={styles.eventCard}>
											<div className={styles.eventIcon}><CalendarDays size={20} /></div>
											<div><strong>{t.eventTitle}</strong><span>{t.eventTime}</span><small><BellRing size={13} />{t.eventNotice}</small></div>
											<span className={styles.eventReady}><Check size={14} /></span>
										</div>
									</div>
								</div>
							</div>

							<div className={styles.composer}><span>+</span><p>{t.composer}</p><span>☺</span></div>
						</div>
						<div className={styles.demoCaption}><span>{t.planned}</span><p>{t.proof}</p></div>
					</div>
				</div>
			</section>

			<section className={styles.workflow} id="workflow">
				<div className={styles.sectionIntro}>
					<p className={styles.sectionEyebrow}>{t.workflowEyebrow}</p>
					<h2>{t.workflowTitle}</h2>
					<p>{t.workflowLede}</p>
				</div>
				<div className={styles.steps}>
					{t.steps.map((step, index) => (
						<article className={styles.step} key={step.label}>
							<div className={styles.stepNumber}>{String(index + 1).padStart(2, '0')}</div>
							<p>{step.label}</p>
							<h3>{step.title}</h3>
							<span>{step.body}</span>
						</article>
					))}
				</div>
			</section>

			<section className={styles.manager}>
				<div className={styles.managerIntro}>
					<p className={styles.sectionEyebrow}>{t.managerEyebrow}</p>
					<h2>{t.managerTitle}</h2>
					<p>{t.managerLede}</p>
					<div className={styles.managerMark}><MeguMark size={128} mood="calm" /></div>
				</div>
				<div className={styles.capabilityGroups}>
					{t.groups.map(group => (
						<div className={styles.capabilityGroup} key={group.label}>
							<p className={styles.groupLabel}>{group.label}</p>
							{group.items.map(item => {
								const Icon = item.icon;
								return (
									<article className={styles.capability} key={item.title}>
										<Icon size={20} />
										<div><h3>{item.title}</h3><p>{item.body}</p></div>
									</article>
								);
							})}
						</div>
					))}
				</div>
			</section>

			<section className={styles.moneySection}>
				<div className={styles.moneyCopy}>
					<p className={styles.sectionEyebrow}>{t.moneyEyebrow}</p>
					<h2>{t.moneyTitle}</h2>
					<p>{t.moneyBody}</p>
					<ul>{t.moneyPoints.map(point => <li key={point}><Check size={16} />{point}</li>)}</ul>
					<Link href="/bills" className={styles.textLink}>{t.moneyCta}<ArrowRight size={17} /></Link>
				</div>
				<div className={styles.expensePreview}>
					<div className={styles.expenseTop}>
						<div><ReceiptText size={20} /><span>{t.activityName}</span></div>
						<small>{t.activityMeta}</small>
					</div>
					<p>{t.activityDue}</p>
					<strong>{t.activityAmount}</strong>
					<div className={styles.progressTrack}><span /></div>
					<div className={styles.expenseBottom}><span>{t.activityProgress}</span><CircleDollarSign size={20} /></div>
				</div>
			</section>

			<section className={styles.webCompanion}>
				<div>
					<p className={styles.sectionEyebrow}>{t.webEyebrow}</p>
					<h2>{t.webTitle}</h2>
				</div>
				<div>
					<p>{t.webBody}</p>
					<Link href="/servers" className={styles.textLink}>{t.webCta}<ArrowRight size={17} /></Link>
				</div>
			</section>

			<section className={styles.closing}>
				<div className={styles.closingMark}><MeguMark size={88} mood="happy" /></div>
				<p className={styles.closeEyebrow}>{t.closeEyebrow}</p>
				<h2>{t.closeTitle}</h2>
				<p>{t.closeBody}</p>
				<Link href="/servers" className={styles.closeCta}>{user ? t.primaryIn : t.primaryOut}<ArrowRight size={18} /></Link>
			</section>
		</div>
	);
}
