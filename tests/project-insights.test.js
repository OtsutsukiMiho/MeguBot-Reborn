'use strict';
const assert = require('node:assert/strict');
const { projectInsights } = require('../core/project-insights');
const now = '2026-09-21T00:00:00Z';
const empty = projectInsights([], now);
assert.equal(empty.reportedProgress, null);
assert.equal(empty.onTime.percentage, null);
const topics = [
	{ id: 'a', progress: 100, weight: 100, workflow: 'completed', completedAt: now, completionDeadlineAt: now, deadlineAt: '2026-01-01T00:00:00Z' },
	{ id: 'b', progress: 20, weight: 1, workflow: 'in_review', blocked: true, deadlineAt: now },
	{ id: 'c', progress: 0, workflow: 'in_progress', deadlineAt: '2026-09-20T23:59:59Z' },
	{ id: 'd', progress: 100, workflow: 'completed', updatedAt: now },
	{ id: 'e', progress: 100, workflow: 'completed', completedAt: now },
	{ id: 'archived', progress: 0, workflow: 'in_review', archivedAt: now, blocked: true },
];
const result = projectInsights(topics, now);
assert.equal(result.reportedProgress, 64, 'Arithmetic mean ignores weights and archived topics');
assert.deepEqual(result.overdue.topicIds, ['c'], 'Exact deadline is not yet overdue');
assert.deepEqual(result.awaitingReview.topicIds, ['b']);
assert.deepEqual(result.blocked.topicIds, ['b']);
assert.equal(result.completed.count, 3);
assert.equal(result.onTime.total, 1);
assert.equal(result.onTime.count, 1, 'Use completion deadline snapshot, not edited current deadline');
assert.equal(result.onTime.unknownCompletionCount, 1);
assert.equal(result.onTime.missingDeadlineCount, 1);
assert.equal(result.undatedCount, 2);
assert.throws(() => projectInsights([], 'invalid'), TypeError);
console.log('Project insights: empty denominators, snapshots, archive exclusions and deadline boundaries passed');

// Render the actual component with both locale bundles; parsing alone cannot
// catch missing translated functions or misleading empty-denominator output.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const babel = require('next/dist/compiled/babel/core');
function loadUi(relativePath) {
	const filename = path.join(__dirname, '..', relativePath);
	const compiled = babel.transformSync(fs.readFileSync(filename, 'utf8'), {
		filename, configFile: false, babelrc: false,
		presets: ['next/babel'],
	});
	const { code } = babel.transformSync(compiled.code, { filename, configFile: false, babelrc: false, plugins: ['next/dist/compiled/babel/plugin-transform-modules-commonjs'] });
	const module = { exports: {} };
	vm.runInThisContext(`(function(require,module,exports){${code}\n})`, { filename })(
		id => id.endsWith('.css') ? {} : require(id.startsWith('@babel/runtime/') ? `next/dist/compiled/${id}` : id), module, module.exports,
	);
	return module.exports.default;
}
const Insights = loadUi('app/components/projects/ProjectInsights.js');
for (const lang of ['en', 'th']) {
	const copy = require(`../app/copy/${lang}.js`).projects.insights;
	const render = insights => renderToStaticMarkup(React.createElement(Insights, {
		insights, topics: topics.map(topic => ({ ...topic, number: 1, title: `Topic ${topic.id}` })),
		copy, lang, timezone: 'Asia/Bangkok', onSelect() {}, onRefresh() {}, refreshing: false,
	}));
	const populated = render(result);
	assert.ok(populated.includes('64%'));
	assert.ok(populated.includes('100% · 1/1'));
	assert.ok(populated.includes(copy.excluded(1, 1)));
	assert.ok(populated.includes('Topic c'));
	assert.ok(!populated.includes('Topic archived'));
	assert.ok(populated.includes(copy.notEvaluation));
	assert.ok(render(empty).includes(copy.empty));
	assert.ok(!render(empty).includes('0%'));
	assert.ok(render(null).includes(copy.unavailable));
	const unknownOnly = projectInsights([{ id: 'legacy', workflow: 'completed', progress: 100 }], now);
	assert.ok(render(unknownOnly).includes(copy.notAvailable));
}
console.log('Project insights UI: English/Thai metrics, source topics, exclusions and empty states render');
