'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const babel = require('next/dist/compiled/babel/core');
const filename = path.join(__dirname, '../app/components/teams/TeamMembershipSource.js');
const source = fs.readFileSync(filename, 'utf8');
const first = babel.transformSync(source, { filename, configFile: false, babelrc: false, presets: ['next/babel'] });
const { code } = babel.transformSync(first.code, { filename, configFile: false, babelrc: false, plugins: ['next/dist/compiled/babel/plugin-transform-modules-commonjs'] });
const component = { exports: {} };
vm.runInThisContext(`(function(require,module,exports){${code}\n})`, { filename })(id => {
	if (id.endsWith('.css')) return {};
	return require(id.startsWith('@babel/runtime/') ? `next/dist/compiled/${id}` : id);
}, component, component.exports);
for (const lang of ['en', 'th']) {
	const c = require(`../app/copy/${lang}`).teams;
	for (const [, key] of source.matchAll(/\bc\.(\w+)/g)) assert.ok(c[key] != null, `${lang} missing ${key}`);
	for (const [manual, discordRole, key] of [[true, false, 'sourceManual'], [false, true, 'sourceDiscord'], [true, true, 'sourceBoth'], [false, false, 'sourceUnknown']]) {
		const props = { team: { id: 'team', revision: 3 }, member: { userId: 'member', displayName: '<Person>', membershipSources: { manual, discordRole }, canRetainManual: false }, c, readError: String, onChanged: async () => {} };
		const html = renderToStaticMarkup(React.createElement(component.exports.default, props));
		assert.ok(html.includes(c[key]));
		assert.ok(!html.includes('<button'), 'Read-only members have no retention action');
		props.member.canRetainManual = true;
		const actionable = renderToStaticMarkup(React.createElement(component.exports.default, props));
		assert.ok(actionable.includes(c.retainMember));
		assert.ok(actionable.includes('aria-expanded="false"'));
		assert.ok(!actionable.includes('type="checkbox"'), 'Consent is not silently preselected');
	}
}
assert.match(source, /expectedRevision: review.revision/);
assert.match(source, /disabled=\{!confirmed \|\| busy\}/);
console.log('Membership source rendering passed: EN/TH, four source states, permissions and closed consent');
