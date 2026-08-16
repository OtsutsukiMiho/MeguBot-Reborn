'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import MeguMark from './components/MeguMark';

export default function HomePage() {
	const [user, setUser] = useState(null);

	useEffect(() => {
		fetch('/api/auth/me')
			.then(res => res.json())
			.then(data => {
				if (data.loggedIn && data.user) setUser(data.user);
			})
			.catch(() => {});
	}, []);

	return (
		<div>
			<section className="hero-block rise">
				<div className="hero-copy">
					{/* Megu was a Discord bot before it was any of this. The eyebrow
					    says so on the first screen without blunting the headline. */}
					<span className="eyebrow">บอท Discord จาก Megux Corp</span>
					<h1>เลิกเป็นคนที่ต้อง<em>ทวง</em>เพื่อนเอง</h1>
					<p className="lede">
						Megu พาเรื่องที่พวกคุณนัดกันไว้ ตั้งแต่ &ldquo;เอาไงดี&rdquo; จนถึง &ldquo;ทุกคนจ่ายครบ&rdquo;
						เขาถามแทน สรุปแทน เตือนแทน และทวงแทน โดยไม่มีใครต้องเสียเพื่อน
					</p>
					<div className="hero-actions">
						{user
							? <Link href="/activities" className="btn btn-primary btn-lg">ไปที่กิจกรรมของฉัน</Link>
							: <a href="/api/auth/login" className="btn btn-primary btn-lg">เริ่มใช้ฟรีด้วย Discord</a>}
						<Link href="/servers" className="btn btn-secondary btn-lg">ตั้งค่าบอทในเซิร์ฟเวอร์</Link>
					</div>
				</div>
				<MeguMark size={340} className="hero-portrait" />
			</section>

			<div className="flow rise rise-2">
				<div className="flow-step">
					<span className="flow-index">01<span className="word">ถาม</span></span>
					<h3>ว่างวันไหนบ้าง</h3>
					<p>
						แปะลิงก์ในกลุ่มครั้งเดียว เพื่อนกดตอบได้เลย ไม่ต้องสมัคร ไม่ต้องโหลดแอป
						แล้ว Megu ไล่ตามคนที่ยังไม่ตอบให้เอง
					</p>
				</div>
				<div className="flow-step">
					<span className="flow-index">02<span className="word">ฟันธง</span></span>
					<h3>สรุปเสาร์ทุ่มนึง</h3>
					<p>
						ไม่มีใครอยากเป็นคนเคาะเพราะกลัวดูเผด็จการ
						ให้ Megu พูดแทน เขาไม่ใช่คน เลยไม่มีใครโกรธ
					</p>
				</div>
				<div className="flow-step">
					<span className="flow-index">03<span className="word">หาร</span></span>
					<h3>คนละเท่าไหร่</h3>
					<p>
						ค่าคอร์ท 400 หารกัน 4 คน เขาคิดให้ทันทีว่าใครติดเท่าไหร่
						คนที่ไม่ได้ไปก็ไม่ต้องจ่าย
					</p>
				</div>
				<div className="flow-step">
					<span className="flow-index">04<span className="word">ทวง</span></span>
					<h3>จนกว่าจะครบ</h3>
					<p>
						ส่วนที่ไม่มีใครอยากทำ เขาจำได้ว่าใครยังค้าง ค้างมากี่วัน
						แล้วทักไปเองอย่างสุภาพ
					</p>
				</div>
			</div>

			{/* The four steps above are a sequence, so they are numbered and ruled.
			    What the bot does in a server is a set, not an order — cards, so the
			    difference in form carries the difference in meaning. */}
			<section className="server-side">
				<div className="section-head">
					<span className="eyebrow">อีกครึ่งหนึ่งของ Megu</span>
					<h2>ในเซิร์ฟเวอร์ เขาทำงานอยู่ตลอด</h2>
					<p className="lede">
						ก่อนจะมาช่วยเรื่องนัดกับเรื่องเงิน Megu เป็นบอทดูแลเซิร์ฟเวอร์มาก่อน
						และยังเป็นอยู่ ทุกอย่างข้างล่างนี้ตั้งค่าจากหน้าเว็บได้ ไม่ต้องจำคำสั่ง
					</p>
				</div>

				<div className="capabilities">
					<article className="capability">
						<h3>กันสแปม กันลิงก์เชิญ</h3>
						<p>
							ข้อความรัวเกิน 5 ครั้งใน 3 วินาที ลิงก์เชิญเซิร์ฟเวอร์อื่น แท็กรัวเกิน 5 คน
							และคำที่คุณสั่งห้ามไว้ เลือกได้ว่าจะแค่ลบ ปิดปาก 1 นาที หรือเชิญออก
							— แอดมินกับคนคุมห้องไม่โดน
						</p>
					</article>
					<article className="capability">
						<h3>ห้องล่อไว้ดักบอทโฆษณา</h3>
						<p>
							ตั้งห้องหลอกไว้ห้องหนึ่ง ใครพิมพ์ลงไปโดนแบนทันที
							คนจริงไม่มีเหตุต้องพิมพ์ในห้องที่ไม่มีใครคุยกัน
						</p>
					</article>
					<article className="capability">
						<h3>ต้อนรับและให้ยศเอง</h3>
						<p>
							ข้อความต้อนรับตอนเข้า ข้อความบอกลาตอนออก
							และยศเริ่มต้นที่ติดให้ทันทีโดยไม่ต้องรอใครว่าง
						</p>
					</article>
					<article className="capability">
						<h3>ยศจากการกดอิโมจิ</h3>
						<p>
							แปะข้อความเดียวไว้ ใครอยากได้ยศไหนก็กดอิโมจิเอา
							ถอดอิโมจิยศก็หลุด ไม่ต้องมีใครมานั่งแจก
						</p>
					</article>
					<article className="capability">
						<h3>อ่านข้อความออกเสียง</h3>
						<p>
							ตั้งห้องแชทไว้ห้องหนึ่ง พิมพ์อะไรลงไป Megu อ่านให้ในห้องเสียง
							คนที่มือไม่ว่างก็ยังอยู่ในวงสนทนาได้ ตั้งชื่อที่ให้เขาเรียกเองได้ด้วย
						</p>
					</article>
					<article className="capability">
						<h3>บันทึกไว้ทุกเหตุการณ์</h3>
						<p>
							เข้า ออก ลบข้อความ แบน ปลดแบน เปลี่ยนยศ สร้างและลบห้อง คำเชิญ
							รวม 21 เหตุการณ์ ย้อนดูได้จากหน้าเว็บว่าใครทำอะไรไว้เมื่อไหร่
						</p>
					</article>
				</div>

				<Link href="/servers" className="btn btn-secondary btn-lg">ดูเซิร์ฟเวอร์ของฉัน</Link>
			</section>

			<section className="closing">
				<h2>หนึ่งบอท สองด้าน</h2>
				<p className="lede">
					ด้านหนึ่งดูแลเซิร์ฟเวอร์ให้แอดมิน อีกด้านดูแลเรื่องนัดกับเรื่องเงินให้เพื่อนกลุ่มหนึ่ง
					คนละคนใช้ คนละเรื่อง แต่เป็น Megu ตัวเดียวกัน
					และคนที่เปิดลิงก์กิจกรรมไม่ต้องมี Discord ด้วยซ้ำ
				</p>
				<div className="hero-actions">
					{user
						? <Link href="/activities" className="btn btn-primary btn-lg">ไปที่กิจกรรมของฉัน</Link>
						: <a href="/api/auth/login" className="btn btn-primary btn-lg">เริ่มใช้ฟรีด้วย Discord</a>}
					<Link href="/servers" className="btn btn-secondary btn-lg">ตั้งค่าบอทในเซิร์ฟเวอร์</Link>
				</div>
			</section>
		</div>
	);
}
