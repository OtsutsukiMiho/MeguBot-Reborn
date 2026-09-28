'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const babel = require('next/dist/compiled/babel/core');
const filename = path.join(__dirname, '../app/components/teams/TeamMemberTitles.js');
const first = babel.transformSync(fs.readFileSync(filename, 'utf8'), { filename, configFile: false, babelrc: false, presets: ['next/babel'] });
const { code } = babel.transformSync(first.code, { filename, configFile: false, babelrc: false, plugins: ['next/dist/compiled/babel/plugin-transform-modules-commonjs'] });

(async () => {
	for (const lang of ['en', 'th']) {
		const t = require(`../app/copy/${lang}`);
		const module = { exports: {} };
		vm.runInThisContext(`(function(require,module,exports){${code}\n})`, { filename })(id => {
			if (id === 'react') return React;
			if (id === '../../copy') return { useCopy: () => ({ t }) };
			if (id.endsWith('.css')) return {};
			return require(id.startsWith('@babel/runtime/') ? `next/dist/compiled/${id}` : id);
		}, module, module.exports);
		const html = renderToStaticMarkup(React.createElement(module.exports.default, { titles: [{ roleId: 'ceo', name: 'CEO' }, { roleId: 'dev', name: '<Developer>' }] }));
		assert.ok(html.includes(t.serverTitles.badgesLabel)); assert.ok(html.includes('CEO')); assert.ok(html.includes('&lt;Developer&gt;'));
		assert.ok(!html.includes('button') && !html.includes('select'), 'Title badges are not access controls');
		assert.equal(renderToStaticMarkup(React.createElement(module.exports.default, { titles: [] })), '');
		const ids = Array.from({ length: 43 }, (_, i) => `user_${i}`);
		const chunks = []; const received = [];
		await module.exports.loadMemberTitlePages('team', [...ids, ids[0]], async url => {
			const batch = new URL(url, 'https://example.test').searchParams.getAll('userId');
			chunks.push(batch.length);
			return { members: batch.map(userId => ({ userId, titles: [] })) };
		}, page => received.push(...page.map(row => row.userId)));
		assert.deepEqual(chunks, [20, 20, 3]); assert.deepEqual(received, ids);
		await assert.rejects(module.exports.loadMemberTitlePages('team', ['user'], async () => ({ members: [{ userId: 'unexpected', titles: [] }] }), () => {}), /member_titles_invalid/);
		await assert.rejects(module.exports.loadMemberTitlePages('team', Array.from({ length: 501 }, (_, i) => String(i)), async () => { throw new Error('Must not read'); }, () => {}), /member_title_limit/);
		let calls = 0;
		await assert.rejects(module.exports.loadMemberTitlePages('team', ids, async () => { calls++; throw new Error('Aborted'); }, () => {}), /Aborted/);
		assert.equal(calls, 1, 'An aborted request stops subsequent batches');
	}
	console.log('Team title badges passed: EN/TH display-only labels, escaped names, bounded/deduplicated paging and failure stop');
})().catch(error => { console.error(error); process.exitCode = 1; });
