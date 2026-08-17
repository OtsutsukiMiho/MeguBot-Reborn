export default function Footer() {
	return (
		<footer className="footer">
			<div className="footer-inner">
				<div className="footer-left">
					<span className="brand-megubot">Megu</span>
					<span className="footer-divider">•</span>
					<span className="footer-text">ผู้จัดการกิจกรรมของกลุ่มคุณ</span>
				</div>
				<div className="footer-right">
					<span className="footer-text">© {new Date().getFullYear()} Megux Corp</span>
				</div>
			</div>
		</footer>
	);
}
