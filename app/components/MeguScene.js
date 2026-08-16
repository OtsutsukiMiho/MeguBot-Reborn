'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Megu as real geometry.
 *
 * The artwork already exists as vector, so nothing is modelled by hand: the
 * paths below are the same shapes as MeguMark, fed through SVGLoader and
 * extruded with a bevel. That is the same construction as the extruded-
 * lettering references — flat art given depth, a bevelled edge to catch the
 * key light, and a material that actually responds to it.
 *
 * Gradients are flattened to solids here on purpose. SVGLoader resolves
 * `fill` to a colour and cannot follow a `url(#…)` reference, so a gradient
 * would silently extrude as black. The shading comes from the lighting rig
 * instead, which is where it belongs once the shape is three-dimensional.
 *
 * `z` stacks the parts front to back and `depth` is how thick each one is.
 * The head is the volume; ears and crown sit slightly behind it so they read
 * as attached rather than pasted on; the face sits on the head's front plane.
 */
const PARTS = [
	// Ears and tail are the silhouette, so they carry the same depth as the head
	// and read as one solid piece rather than parts stuck on.
	{ d: 'M44 64 L57 13 Q59 6 65 11 L104 58 Z', color: 0x2E3778, z: 0, depth: 34 },
	{ d: 'M156 64 L143 13 Q141 6 135 11 L96 58 Z', color: 0x2E3778, z: 0, depth: 34 },
	{ d: 'M60 166 L33 197 Q28 202 33 200 L82 180 Z', color: 0x2E3778, z: 0, depth: 34 },

	// the head is the mass everything else is measured against
	{ rounded: [30, 54, 140, 118, 50], color: 0x323C86, z: 0, depth: 34 },

	// the face sits on the head's front plane, thin enough to read as printed
	{ d: 'M63 105 L89 105 L89 112 A13 13 0 0 1 63 112 Z', color: 0xF4F2EC, z: 34, depth: 3 },
	{ d: 'M111 105 L137 105 L137 112 A13 13 0 0 1 111 112 Z', color: 0xF4F2EC, z: 34, depth: 3 },
	{ d: 'M92 140 Q100 148 108 140 L108 146 Q100 154 92 146 Z', color: 0xF4F2EC, z: 34, depth: 3 },

	// the status light is the one part that stands proud of the face
	{ circle: [150, 76, 10], color: 0xF0B92A, z: 34, depth: 7 },
];

function partToPathData(p) {
	if (p.d) return p.d;
	if (p.circle) {
		const [cx, cy, r] = p.circle;
		return `M ${cx - r} ${cy} a ${r} ${r} 0 1 0 ${r * 2} 0 a ${r} ${r} 0 1 0 ${-r * 2} 0 Z`;
	}
	if (p.rounded) {
		const [x, y, w, h, r] = p.rounded;
		return `M ${x + r} ${y} H ${x + w - r} A ${r} ${r} 0 0 1 ${x + w} ${y + r}`
			+ ` V ${y + h - r} A ${r} ${r} 0 0 1 ${x + w - r} ${y + h}`
			+ ` H ${x + r} A ${r} ${r} 0 0 1 ${x} ${y + h - r}`
			+ ` V ${y + r} A ${r} ${r} 0 0 1 ${x + r} ${y} Z`;
	}
	const [cx, cy, rx, ry] = p.ellipse;
	return `M ${cx - rx} ${cy} a ${rx} ${ry} 0 1 0 ${rx * 2} 0 a ${rx} ${ry} 0 1 0 ${-rx * 2} 0 Z`;
}

export default function MeguScene({ className = '' }) {
	const hostRef = useRef(null);
	const [failed, setFailed] = useState(false);

	useEffect(() => {
		const host = hostRef.current;
		if (!host) return;

		let disposed = false;
		let cleanup = () => {};

		(async () => {
			let THREE, SVGLoader;
			try {
				THREE = await import('three');
				({ SVGLoader } = await import('three/examples/jsm/loaders/SVGLoader.js'));
			}
			catch {
				setFailed(true);
				return;
			}
			if (disposed) return;

			let renderer;
			try {
				renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
			}
			catch {
				// No WebGL — the flat SVG stays on screen instead.
				setFailed(true);
				return;
			}

			const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
			const size = () => ({ w: host.clientWidth || 340, h: host.clientHeight || 340 });
			let { w, h } = size();

			renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
			renderer.setSize(w, h, false);
			renderer.domElement.style.width = '100%';
			renderer.domElement.style.height = '100%';
			renderer.domElement.style.display = 'block';
			host.appendChild(renderer.domElement);

			const scene = new THREE.Scene();
			const camera = new THREE.PerspectiveCamera(30, w / h, 1, 2000);
			camera.position.set(0, 0, 430);

			const group = new THREE.Group();
			const loader = new SVGLoader();
			const made = [];

			for (const part of PARTS) {
				const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"><path d="${partToPathData(part)}" fill="#fff"/></svg>`;
				const parsed = loader.parse(svg);

				for (const path of parsed.paths) {
					for (const shape of path.toShapes(true)) {
						const geo = new THREE.ExtrudeGeometry(shape, {
							depth: part.depth,
							bevelEnabled: true,
							bevelThickness: 1.6,
							bevelSize: 1.4,
							bevelSegments: 3,
							curveSegments: 24,
						});
						// Bevelled edges only read as edges if the normals are smooth
						// across the curve but hard across the fold.
						geo.computeVertexNormals();

						const mat = new THREE.MeshPhysicalMaterial({
							color: part.color,
							roughness: 0.42,
							metalness: 0.0,
							clearcoat: 0.6,
							clearcoatRoughness: 0.35,
							flatShading: false,
						});

						const mesh = new THREE.Mesh(geo, mat);
						mesh.position.z = part.z;
						group.add(mesh);
						made.push({ geo, mat });
					}
				}
			}

			// SVG runs y downward and is anchored top-left; three.js runs y up and
			// wants the model centred on the origin so it rotates about itself.
			group.scale.y = -1;
			const box = new THREE.Box3().setFromObject(group);
			const centre = box.getCenter(new THREE.Vector3());
			group.position.sub(centre);

			const pivot = new THREE.Group();
			pivot.add(group);
			scene.add(pivot);

			scene.add(new THREE.AmbientLight(0xFFFFFF, 1.15));

			const key = new THREE.DirectionalLight(0xFFFFFF, 2.4);
			key.position.set(-120, 180, 260);
			scene.add(key);

			const fill = new THREE.DirectionalLight(0xBFD4FF, 1.0);
			fill.position.set(180, -60, 160);
			scene.add(fill);

			// A rim from behind is what separates the silhouette from the colour
			// field it sits on, and is most of why a render reads as solid.
			const rim = new THREE.DirectionalLight(0xFFE6A8, 1.6);
			rim.position.set(80, 140, -220);
			scene.add(rim);

			const target = { x: 0, y: 0 };
			const current = { x: 0, y: 0 };

			const onPointer = (e) => {
				const r = host.getBoundingClientRect();
				target.x = ((e.clientX - (r.left + r.width / 2)) / window.innerWidth) * 1.4;
				target.y = ((e.clientY - (r.top + r.height / 2)) / window.innerHeight) * 1.0;
			};
			if (!reduced) window.addEventListener('pointermove', onPointer, { passive: true });

			const onResize = () => {
				const s = size();
				w = s.w; h = s.h;
				camera.aspect = w / h;
				camera.updateProjectionMatrix();
				renderer.setSize(w, h, false);
			};
			const ro = new ResizeObserver(onResize);
			ro.observe(host);

			// Pause when off screen. A hero canvas that keeps rendering while the
			// reader is three sections down is pure battery cost.
			let visible = true;
			const io = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; }, { threshold: 0 });
			io.observe(host);

			let raf = 0;
			const start = performance.now();

			const frame = (now) => {
				raf = requestAnimationFrame(frame);
				if (!visible) return;

				const t = (now - start) / 1000;

				if (reduced) {
					pivot.rotation.set(-0.06, 0.34, 0);
					pivot.position.y = 0;
				}
				else {
					current.x += (target.x - current.x) * 0.06;
					current.y += (target.y - current.y) * 0.06;
					pivot.rotation.y = current.x + Math.sin(t * 0.45) * 0.16;
					pivot.rotation.x = current.y + Math.sin(t * 0.62) * 0.07;
					pivot.rotation.z = Math.sin(t * 0.35) * 0.03;
					pivot.position.y = Math.sin(t * 0.7) * 7;
				}

				renderer.render(scene, camera);
			};

			if (reduced) {
				pivot.rotation.set(-0.06, 0.34, 0);
				renderer.render(scene, camera);
			}
			else {
				raf = requestAnimationFrame(frame);
			}

			cleanup = () => {
				cancelAnimationFrame(raf);
				window.removeEventListener('pointermove', onPointer);
				ro.disconnect();
				io.disconnect();
				made.forEach(({ geo, mat }) => { geo.dispose(); mat.dispose(); });
				renderer.dispose();
				if (renderer.domElement.parentNode === host) host.removeChild(renderer.domElement);
			};
		})();

		return () => {
			disposed = true;
			cleanup();
		};
	}, []);

	if (failed) return null;

	return <div ref={hostRef} className={className} aria-hidden="true" />;
}
