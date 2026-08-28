'use client';

/**
 * The Megu mark.
 *
 * One silhouette that reads two ways: ears on top say cat, the tail at the
 * lower left says speech bubble. That is the product in a shape — Megu is the
 * thing that says the awkward part so none of the group has to — and it is the
 * part of this mark that cannot be copied, because it is tied to what the bot
 * is for rather than to how it is drawn.
 *
 * Expression lives in one edge. A full circle stares; a circle with a flat lid
 * across the top is calm and unbothered. Every earlier attempt failed by adding
 * features — a crown, goggles, fangs — when the fix was to have almost nothing
 * that can be drawn wrong. Two shapes and a lid carry all six moods.
 *
 * Three colours, all already in the palette: navy body, cream face, gold dot.
 * The dot is not decoration — it is the status light, and it is the only thing
 * besides the eyes that changes between moods.
 */

const DOT = {
	calm: '#F0B92A',
	happy: '#7FE0C4',
	alert: '#E24A5B',
	asking: '#F0B92A',
	asleep: '#8E94A6',
	wink: '#F0B92A',
};

export default function MeguMark({ size = 64, mood = 'calm', className = '', title }) {
	const m = DOT[mood] ? mood : 'calm';
	// Below about 32px the lid and the mouth stop being shapes and start being
	// grey mush, so the mark drops to its two most robust features.
	const tiny = size < 32;

	const eyes = () => {
		if (tiny || m === 'alert') {
			return (
				<>
					<circle cx="76" cy="112" r="14" fill="#F4F2EC" />
					<circle cx="124" cy="112" r="14" fill="#F4F2EC" />
					{!tiny && (
						<>
							<circle cx="70" cy="106" r="4" fill="#212862" />
							<circle cx="118" cy="106" r="4" fill="#212862" />
						</>
					)}
				</>
			);
		}
		if (m === 'happy') {
			return (
				<g stroke="#F4F2EC" strokeWidth="9" strokeLinecap="round" fill="none">
					<path d="M64 118 Q76 100 88 118" />
					<path d="M112 118 Q124 100 136 118" />
				</g>
			);
		}
		if (m === 'asleep') {
			return (
				<g stroke="#F4F2EC" strokeWidth="9" strokeLinecap="round" fill="none">
					<path d="M64 108 Q76 124 88 108" />
					<path d="M112 108 Q124 124 136 108" />
				</g>
			);
		}
		if (m === 'wink') {
			return (
				<>
					<path d="M63 105 L89 105 L89 112 A13 13 0 0 1 63 112 Z" fill="#F4F2EC" />
					<path d="M112 116 Q124 100 136 116" stroke="#F4F2EC" strokeWidth="9" strokeLinecap="round" fill="none" />
				</>
			);
		}
		return (
			<>
				<path d="M63 105 L89 105 L89 112 A13 13 0 0 1 63 112 Z" fill="#F4F2EC" />
				<path d="M111 105 L137 105 L137 112 A13 13 0 0 1 111 112 Z" fill="#F4F2EC" />
				<circle cx="70" cy="99" r="3.4" fill="#FFFFFF" opacity=".55" />
				<circle cx="118" cy="99" r="3.4" fill="#FFFFFF" opacity=".55" />
			</>
		);
	};

	return (
		<svg
			className={className}
			width={size}
			height={size}
			viewBox="-6 -4 212 212"
			fill="none"
			xmlns="http://www.w3.org/2000/svg"
			role="img"
			aria-label={title || 'Megu'}
		>
			<defs>
				{/* Megu's coat is navy, and on the dark theme the page behind her
				    is navy too — measured at 1.36:1, which is not a low-contrast
				    logo, it is an invisible one. The stops are theme variables
				    now, so the mark lifts off a night ground instead of sinking
				    into it. `--megu-body-*` are defined beside the palette. */}
				<linearGradient id="megu-body" x1="0.1" y1="0" x2="0.6" y2="1">
					<stop offset="0%" stopColor="var(--megu-body-lit, #3D4795)" />
					<stop offset="100%" stopColor="var(--megu-body, #212862)" />
				</linearGradient>
			</defs>

			{/* Ears meet exactly at the head's centre line; the tail leaves from the
			    lower left. Neither is ever dropped, at any size — they are the two
			    things that make this mark itself. */}
			<g fill="url(#megu-body)">
				<path d="M44 64 L57 13 Q59 6 65 11 L104 58 Z" />
				<path d="M156 64 L143 13 Q141 6 135 11 L96 58 Z" />
				<rect x="30" y="54" width="140" height="118" rx="50" />
				<path d="M60 166 L33 197 Q28 202 33 200 L82 180 Z" />
			</g>

			{eyes()}

			{!tiny && m !== 'asleep' && m !== 'asking' && (
				<path d="M92 140 Q100 148 108 140" stroke="#F4F2EC" strokeWidth="6.5" strokeLinecap="round" fill="none" />
			)}

			{!tiny && m === 'asking' && (
				<g fill="#F4F2EC">
					<circle cx="86" cy="141" r="4" />
					<circle cx="100" cy="141" r="4" />
					<circle cx="114" cy="141" r="4" />
				</g>
			)}

			<circle cx="150" cy="76" r={tiny ? 11 : 10} fill={DOT[m]} />
		</svg>
	);
}
