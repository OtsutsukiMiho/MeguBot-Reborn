import './globals.css';
import Navbar from './components/Navbar';
import Footer from './components/Footer';
import { LangProvider } from './components/LangProvider';

export const metadata = {
	title: {
		default: 'Megu — ผู้จัดการกิจกรรมของกลุ่มคุณ',
		template: '%s · Megu',
	},
	description: 'Megu พาเรื่องที่พวกคุณนัดกันไว้ ตั้งแต่ "เอาไงดี" จนถึง "ทุกคนจ่ายครบ"',
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
		<html lang="th" suppressHydrationWarning>
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
