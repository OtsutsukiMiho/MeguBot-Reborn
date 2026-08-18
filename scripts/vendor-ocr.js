#!/usr/bin/env node
// Put the OCR engine where this app can serve it, instead of where the library
// would rather fetch it from.
//
// tesseract.js defaults to pulling its worker, its WebAssembly core and its
// language data off public CDNs at the moment somebody opens a slip. That would
// mean a phone in a restaurant carpark waiting on jsdelivr, an app that stops
// working when someone else's CDN does, and — the part that actually decides it
// — a third party learning that this person is looking at a payment right now,
// from the referrer, without anyone having agreed to that.
//
// So the engine is copied into `public/ocr/` and served from the same origin as
// everything else. The files are build output, not source: they are generated
// from `node_modules` and downloaded once, and `public/ocr/` is ignored by git.
//
//   npm run ocr:setup
//
// It also runs as part of `npm run build`. If it has never run, the slip reader
// reports itself unavailable and everything else on the page carries on — an
// unread slip is still a slip a human can look at.

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'public', 'ocr');
const LANG_OUT = path.join(OUT, 'lang');

// "fast" rather than the standard data: 2.9MB against 12MB for the pair, over
// the mobile connection of somebody who is standing in a restaurant. The
// accuracy it gives up is on prose, and nothing here is reading prose — it is
// reading a column of numbers and a list of dish names.
const TESSDATA = 'https://tessdata.projectnaptha.com/4.0.0_fast';
const LANGS = ['eng', 'tha'];

// Only the LSTM cores. The legacy engine is a second recogniser bundled for
// documents scanned at 300dpi, which a photograph of thermal paper is not, and
// carrying it would double what a browser might download for nothing.
const CORES = [
	'tesseract-core-lstm.wasm.js',
	'tesseract-core-lstm.wasm',
	'tesseract-core-simd-lstm.wasm.js',
	'tesseract-core-simd-lstm.wasm',
	'tesseract-core-relaxedsimd-lstm.wasm.js',
	'tesseract-core-relaxedsimd-lstm.wasm',
];

function resolvePackage(name) {
	try {
		return path.dirname(require.resolve(`${name}/package.json`, { paths: [ROOT] }));
	}
	catch {
		return null;
	}
}

function copy(from, to) {
	fs.mkdirSync(path.dirname(to), { recursive: true });
	fs.copyFileSync(from, to);
	return fs.statSync(to).size;
}

async function download(url, to) {
	// Present already and non-empty means done. Re-downloading three megabytes
	// on every build is somebody's CI minutes and somebody's bandwidth.
	if (fs.existsSync(to) && fs.statSync(to).size > 0) return { size: fs.statSync(to).size, cached: true };

	const res = await fetch(url);
	if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
	const body = Buffer.from(await res.arrayBuffer());
	fs.mkdirSync(path.dirname(to), { recursive: true });
	fs.writeFileSync(to, body);
	return { size: body.length, cached: false };
}

function mb(bytes) {
	return `${(bytes / 1048576).toFixed(1)}MB`;
}

async function main() {
	const tesseract = resolvePackage('tesseract.js');
	const core = resolvePackage('tesseract.js-core');

	if (!tesseract || !core) {
		console.error('\ntesseract.js is not installed. Run `npm install` first.\n');
		process.exit(1);
	}

	console.log('\nVendoring the OCR engine into public/ocr\n');

	let total = 0;
	total += copy(path.join(tesseract, 'dist', 'worker.min.js'), path.join(OUT, 'worker.min.js'));
	console.log('  worker.min.js');

	for (const file of CORES) {
		const from = path.join(core, file);
		if (!fs.existsSync(from)) {
			console.error(`  missing from tesseract.js-core: ${file}`);
			process.exit(1);
		}
		total += copy(from, path.join(OUT, file));
		console.log(`  ${file}`);
	}

	for (const lang of LANGS) {
		const file = `${lang}.traineddata.gz`;
		const { size, cached } = await download(`${TESSDATA}/${file}`, path.join(LANG_OUT, file));
		total += size;
		console.log(`  lang/${file}  ${mb(size)}${cached ? '  (already here)' : ''}`);
	}

	// What the browser checks before it offers to read anything. A missing
	// manifest is the difference between "reading is not installed on this
	// deployment" and "reading is broken", and those get different sentences.
	fs.writeFileSync(path.join(OUT, 'manifest.json'), `${JSON.stringify({
		engine: require(path.join(tesseract, 'package.json')).version,
		langs: LANGS,
		source: TESSDATA,
	}, null, '\t')}\n`);

	console.log(`\n  ${mb(total)} on disk, of which a browser downloads one core and the languages it needs.\n`);
}

main().catch((error) => {
	console.error(`\nFailed: ${error.message}\n`);
	process.exit(1);
});
