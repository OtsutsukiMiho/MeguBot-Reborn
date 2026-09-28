'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const babel = require('next/dist/compiled/babel/core');
const filename = require.resolve('../app/components/teams/TeamManage.js');
const first = babel.transformSync(fs.readFileSync(filename, 'utf8'), { filename, configFile: false, babelrc: false, presets: ['next/babel'] });
const { code } = babel.transformSync(first.code, { filename, configFile: false, babelrc: false, plugins: ['next/dist/compiled/babel/plugin-transform-modules-commonjs'] });

function all(node, output = []) {
	if (!node || typeof node !== 'object') return output;
	if (Array.isArray(node)) { node.forEach(child => all(child, output)); return output; }
	if (node.type) output.push(node);
	all(node.props?.children, output); return output;
}
function text(node) { return typeof node === 'string' ? node : Array.isArray(node) ? node.map(text).join('') : node?.props ? text(node.props.children) : ''; }
function harness(t) {
	const slots = []; let cursor = 0; const calls = [];
	const react = {
		createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
		useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], next => { slots[i] = typeof next === 'function' ? next(slots[i]) : next; }]; },
	};
	const module = { exports: {} };
	vm.runInThisContext(`(function(require,module,exports,fetch){${code}\nexports.Lifecycle=Lifecycle;})`, { filename })(name => {
		if (name === 'react') return react;
		if (name.endsWith('.css')) return new Proxy({}, { get: (_, key) => key });
		if (name === 'lucide-react') return new Proxy({}, { get: () => () => null });
		if (name.includes('CustomSelect') || name.includes('ProjectAvatar') || name.includes('TeamMark')) return { default: () => null };
		if (name === 'next/navigation') return { useRouter: () => ({ push() {} }) };
		if (name === 'next/link') return { default: () => null };
		if (name === '../../copy') return { useCopy: () => ({ t }) };
		if (name.startsWith('.') || name.includes('useDraftGuard')) return new Proxy({}, { get: () => () => null });
		return require(name.startsWith('@babel/runtime/') ? `next/dist/compiled/${name}` : name);
	}, module, module.exports, async (url, options) => { calls.push({ url, options }); return { ok: true, json: async () => ({}) }; });
	const data = { team: { id: 'team-test', name: 'Private team', revision: 3, archivedAt: null }, me: { userId: 'owner', role: 'owner' }, ownershipTransfer: null,
		capabilities: { canArchive: true, canRestore: false, canTransferOwnership: false } };
	return { calls, render() { cursor = 0; return all(module.exports.Lifecycle({ data, members: [], c: t.teams, readError: () => 'error', onChanged: async () => {} })); } };
}
for (const lang of ['en', 'th']) {
	const t = require(`../app/copy/${lang}`), c = t.teams, h = harness(t);
	const warning = c.archiveHint;
	assert.ok(lang === 'en' ? warning.includes('Archiving also archives any unfinished goals; they remain archived even after restoration') : warning.includes('การเก็บทีมจะเก็บเป้าหมายที่ยังไม่เสร็จด้วย') && warning.includes('ยังคงถูกเก็บไว้แม้นำทีมกลับมาแล้ว'));
	assert.ok(lang === 'en' ? warning.includes('team and project changes') : warning.includes('ทีมและโปรเจกต์'));
	let nodes = h.render();
	let archive = nodes.find(node => node.type === 'button' && text(node) === c.archive); assert.ok(archive);
	archive.props.onClick(); nodes = h.render();
	assert.ok(nodes.some(node => node.type === 'h3' && text(node) === c.ux.archiveConfirm));
	assert.ok(nodes.some(node => node.type === 'p' && text(node) === warning), 'Disclosed before final action');
	assert.equal(h.calls.length, 0, 'Opening review is read-only');
	const cancel = nodes.find(node => node.type === 'button' && text(node) === c.ux.keepEditing); assert.ok(cancel);
	cancel.props.onClick(); nodes = h.render(); assert.equal(h.calls.length, 0, 'Cancelling does not write');
	assert.ok(!nodes.some(node => node.type === 'h3' && text(node) === c.ux.archiveConfirm));
	archive = nodes.find(node => node.type === 'button' && text(node) === c.archive); archive.props.onClick(); nodes = h.render();
	const confirm = nodes.find(node => node.type === 'button' && text(node) === c.ux.confirmAction); assert.ok(confirm);
	confirm.props.onClick(); assert.equal(h.calls.length, 1); assert.match(h.calls[0].url, /\/archive$/);
}
console.log('Archive disclosure PASS: EN/TH review text, no write before confirmation, cancel without write, confirmed archive endpoint only.');
