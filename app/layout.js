import './globals.css';
import Navbar from './components/Navbar';
import Footer from './components/Footer';

export const metadata = {
	title: 'MeguBot Reborn - Discord Community & Voice Bot',
	description: 'Next-Gen Discord Bot & Real-Time Server Management Dashboard',
	icons: {
		icon: '/icon.png',
		shortcut: '/icon.png',
		apple: '/icon.png',
	},
};

export default function RootLayout({ children }) {
	return (
		<html lang="en">
			<head>
				<link rel="icon" type="image/png" href="/icon.png" />
				<link rel="preconnect" href="https://fonts.googleapis.com" />
				<link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
				<link
					href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap"
					rel="stylesheet"
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
