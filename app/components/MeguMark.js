'use client';

/**
 * Megu herself, drawn as vector so she stays crisp from a 20px favicon-sized
 * chip up to a hero. Colours come from the original artwork: navy body, gold
 * crown with a violet gem, rose ears and tongue, cyan-ringed eyes.
 */
export default function MeguMark({ size = 64, crown = true, mood = 'happy', className = '' }) {
	const asleep = mood === 'asleep';

	return (
		<svg
			className={className}
			width={size}
			height={size}
			viewBox="0 0 200 200"
			fill="none"
			xmlns="http://www.w3.org/2000/svg"
			role="img"
			aria-label="Megu"
		>
			<defs>
				<radialGradient id="megu-face" cx="42%" cy="34%" r="78%">
					<stop offset="0%" stopColor="#2B3277" />
					<stop offset="100%" stopColor="#181C4C" />
				</radialGradient>
				<linearGradient id="megu-crown" x1="0" y1="0" x2="0" y2="1">
					<stop offset="0%" stopColor="#FFDE45" />
					<stop offset="100%" stopColor="#E8A712" />
				</linearGradient>
			</defs>

			<g stroke="#0D1030" strokeWidth="4.5" strokeLinejoin="round">
				<path d="M42 96 L36 30 L88 62 Z" fill="url(#megu-face)" />
				<path d="M158 96 L164 30 L112 62 Z" fill="url(#megu-face)" />
				<path d="M50 84 L44 44 L80 66 Z" fill="#F2569B" stroke="none" />
				<path d="M150 84 L156 44 L120 66 Z" fill="#F2569B" stroke="none" />
			</g>

			<g stroke="#B8306F" strokeWidth="2.4" opacity=".55" strokeLinecap="round">
				<path d="M52 78 L72 66" /><path d="M50 68 L69 58" /><path d="M49 58 L64 51" />
				<path d="M148 78 L128 66" /><path d="M150 68 L131 58" /><path d="M151 58 L136 51" />
			</g>

			<circle cx="100" cy="112" r="70" fill="url(#megu-face)" stroke="#0D1030" strokeWidth="5" />

			{crown && (
				<g stroke="#0D1030" strokeWidth="4" strokeLinejoin="round">
					<path d="M62 58 L70 22 L86 42 L100 14 L114 42 L130 22 L138 58 Z" fill="url(#megu-crown)" />
					<ellipse cx="100" cy="46" rx="11" ry="16" fill="#8E8BF0" stroke="#0D1030" strokeWidth="3" />
					<circle cx="70" cy="20" r="5.5" fill="#4C4AE0" strokeWidth="3" />
					<circle cx="100" cy="12" r="5.5" fill="#4C4AE0" strokeWidth="3" />
					<circle cx="130" cy="20" r="5.5" fill="#4C4AE0" strokeWidth="3" />
				</g>
			)}

			<g stroke="#E8EEF2" strokeWidth="2.6" strokeLinecap="round" opacity=".8">
				<path d="M8 108 L46 116" /><path d="M12 132 L48 132" /><path d="M20 154 L52 144" />
				<path d="M192 108 L154 116" /><path d="M188 132 L152 132" /><path d="M180 154 L148 144" />
			</g>

			{asleep ? (
				<g stroke="#7FE0EE" strokeWidth="6" strokeLinecap="round" fill="none">
					<path d="M62 104 q14 14 28 0" />
					<path d="M110 104 q14 14 28 0" />
				</g>
			) : (
				<>
					<ellipse cx="76" cy="104" rx="26" ry="30" fill="#0C1030" />
					<ellipse cx="124" cy="104" rx="26" ry="30" fill="#0C1030" />
					<ellipse cx="76" cy="104" rx="19" ry="23" fill="#7FE0EE" />
					<ellipse cx="124" cy="104" rx="19" ry="23" fill="#7FE0EE" />
					<ellipse cx="76" cy="104" rx="14" ry="19" fill="#FFFFFF" />
					<ellipse cx="124" cy="104" rx="14" ry="19" fill="#FFFFFF" />
					<ellipse cx="76" cy="105" rx="8" ry="14" fill="#0C1030" />
					<ellipse cx="124" cy="105" rx="8" ry="14" fill="#0C1030" />
					<circle cx="80" cy="96" r="3" fill="#FFFFFF" opacity=".9" />
					<circle cx="128" cy="96" r="3" fill="#FFFFFF" opacity=".9" />
				</>
			)}

			<path d="M92 138 L108 138 L100 146 Z" fill="#0C1030" />

			{!asleep && (
				<g>
					<path
						d="M78 150 q22 -6 44 0 q-4 26 -22 38 q-18 -12 -22 -38 Z"
						fill="#F2557A"
						stroke="#0D1030"
						strokeWidth="3"
						strokeLinejoin="round"
					/>
					<path d="M80 148 L86 164 L92 148 Z" fill="#FFFFFF" />
					<path d="M120 148 L114 164 L108 148 Z" fill="#FFFFFF" />
				</g>
			)}
		</svg>
	);
}
