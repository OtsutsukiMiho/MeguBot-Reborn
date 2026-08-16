import './globals.css';
import Navbar from './components/Navbar';
import Footer from './components/Footer';

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
	icons: {
		icon: '/icon.png',
		shortcut: '/icon.png',
		apple: '/icon.png',
	},
};

export default function RootLayout({ children }) {
	return (
		// The theme script stamps data-theme before React hydrates, so the
		// server HTML and the client tree differ on <html> by design.
		<html lang="th" suppressHydrationWarning>
			<head>
				<link rel="icon" type="image/png" href="/icon.png" />
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
				<Navbar />
				<main className="container">
					{children}
				</main>
				<Footer />
			</body>
		</html>
	);
}
