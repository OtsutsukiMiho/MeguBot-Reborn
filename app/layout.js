import './globals.css';
import Navbar from './components/Navbar';
import Footer from './components/Footer';
import { LangProvider } from './components/LangProvider';

export const metadata = {
	title: {
		default: 'Megu — ผู้ช่วยจัดการ Discord server',
		template: '%s · Megu',
	},
	description: 'ให้ Megu เปลี่ยนบทสนทนาใน Discord เป็นอีเวนต์ งานเตือน และสิ่งที่ต้องตาม พร้อมช่วยดูแลสมาชิก ห้องเสียง และค่าใช้จ่ายของกลุ่ม',
	applicationName: 'Megu',
	authors: [{ name: 'Megux Corp' }],
	creator: 'Megux Corp',
	publisher: 'Megux Corp',
	// SVG first: it is 700 bytes against icon.png's 1.4 MB and stays crisp at
	// every size. The png is kept only for the platforms that still refuse SVG
	// favicons, and is still the old artwork until someone exports a new one.
	icons: {
		icon: [
			{ url: '/icon.svg', type: 'image/svg+xml' },
			{ url: '/icon.png', type: 'image/png' },
		],
		shortcut: '/icon.svg',
		apple: '/icon.png',
	},
};

export default function RootLayout({ children }) {
	return (
		// The theme script stamps data-theme before React hydrates, so the
		// server HTML and the client tree differ on <html> by design.
		<html lang="en" suppressHydrationWarning>
			<head>
				<link rel="icon" type="image/svg+xml" href="/icon.svg" />
				<link rel="preconnect" href="https://fonts.googleapis.com" />
				<link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
				<link
					href="https://fonts.googleapis.com/css2?family=Anuphan:wght@400;500;600;700&family=IBM+Plex+Sans+Thai:wght@400;500;600;700&family=JetBrains+Mono:wght@500;600;700&display=swap"
					rel="stylesheet"
				/>
				{/*
				  Runs before first paint so a saved theme never flashes the
				  other one. Deliberately tiny and dependency-free.
				*/}
				<script
					dangerouslySetInnerHTML={{
						__html: `try{var m=localStorage.getItem('megu-theme');if(m==='light'||m==='dark')document.documentElement.setAttribute('data-theme',m)}catch(e){}`,
					}}
				/>
			</head>
			<body>
				{/* The direction contract. Emitted into the markup rather than left
				    as a source comment so it survives the production build and can
				    be audited against what actually shipped. */}
				<div
					dangerouslySetInnerHTML={{
						__html: `<!--
THESIS: Megu is a fired celadon piece, not a neutral admin surface. It refuses the flat grey-plus-one-accent arrangement that made the old palette read as anyone's dashboard.
OWN-WORLD: cream stoneware body, jade glaze pooling and thinning across a drifting ground, honey iron at every rim, a warm green-black glaze pool for ink. Rules are crackle-warm, never grey. Recognizable with all content removed.
STORY: the reader sees what still wants them (honey) and what is finished (jade), never a page scolding them in red for owing a friend 100 baht.
FIRST VIEWPORT: title and meta on the drifting ground; one card naming the single thing that needs this reader, its amount in honey, its action navy-bodied with an iron rim; Megu's line below; roster and costs in panels that lift off the drift.
FORM: สังคโลก / Sawankhalok celadon, candidate 7 of the grounded list, seed key 5e338ecb.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance.
-->`,
					}}
				/>
				<LangProvider>
					<Navbar />
					<main className="container">
						{children}
					</main>
					<Footer />
				</LangProvider>
			</body>
		</html>
	);
}
