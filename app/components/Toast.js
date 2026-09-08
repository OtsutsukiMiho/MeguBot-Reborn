'use client';

export default function Toast({ message, isError }) {
	if (!message) return null;

	return (
		<div className={`toast-notification ${isError ? 'toast-error' : 'toast-success'}`} role={isError ? 'alert' : 'status'} aria-live={isError ? 'assertive' : 'polite'} aria-atomic="true">
			<span className="toast-dot"></span>
			<span className="toast-message">{message}</span>
		</div>
	);
}
