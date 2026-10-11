'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const React = require('react'), { renderToStaticMarkup } = require('react-dom/server');
const babel = require('next/dist/compiled/babel/core');
const settings = require('../core/voice-qol-settings');

// Compile the actual tab and its shared controls; no browser/network or mocked
// template fields. Copy is the only application boundary substituted here.
for (const lang of ['en', 'th']) {
	const t = require('../app/copy/' + lang), cache = new Map();
	function load(file) {
		if (cache.has(file)) return cache.get(file);
		const module = { exports: {} }; cache.set(file, module.exports);
		const first = babel.transformSync(fs.readFileSync(file, 'utf8'), { filename: file, configFile: false, babelrc: false, presets: ['next/babel'] });
		const { code } = babel.transformSync(first.code, { filename: file, configFile: false, babelrc: false, plugins: ['next/dist/compiled/babel/plugin-transform-modules-commonjs'] });
		vm.runInThisContext(`(function(require,module,exports){${code}\n})`, { filename: file })(id => {
			if (id.startsWith('@babel/runtime/')) return require('next/dist/compiled/' + id);
			if (id.endsWith('/copy')) return { useCopy: () => ({ t }) };
			if (id.endsWith('.css')) return new Proxy({}, { get: (_, key) => String(key) });
			if (id.includes('voice-qol-settings')) return settings;
			return id.startsWith('.') ? load(require.resolve(path.resolve(path.dirname(file), id))) : require(id);
		}, module, module.exports);
		cache.set(file, module.exports); return module.exports;
	}
	const Tab = load(path.resolve('app/components/Tabs/VoiceTtsTab.js')).default;
	let config = { tts_channel_id: 'text', tts_waiting_room_channel_id: 'voice', tts_lang: 'en',
		tts_channel_template: '{displayname} says {message}', tts_waiting_room_template: '{nickname} is waiting' };
	const changes = [];
	const props = () => ({ config, channels: [{ id: 'voice', name: 'Waiting', type: 2 }, { id: 'text', name: 'TTS', type: 0 }], onChange(key, value) { changes.push([key, value]); config = { ...config, [key]: value }; } });
	function fields() {
		const found = new Map();
		function walk(node) {
			if (!node || typeof node !== 'object') return;
			if (Array.isArray(node)) return node.forEach(walk);
			if (node.props?.id) found.set(node.props.id, node.props);
			walk(node.props?.children);
		}
		walk(Tab(props())); return found;
	}
	for (const [id, key, label, help] of [
		['tts-channel-template', 'tts_channel_template', t.serverTabs.tts.channelTemplate, t.serverTabs.tts.channelTemplateRules],
		['tts-waiting-template', 'tts_waiting_room_template', t.serverTabs.tts.waitingTemplate, t.serverTabs.tts.waitingTemplateRules],
	]) {
		const field = fields().get(id);
		assert.equal(field.value, config[key]); assert.equal(field.disabled, false);
		assert.equal(field['aria-label'], label); assert.equal(field['aria-describedby'], id + '-help'); assert.equal(field.maxLength, 300);
		const html = renderToStaticMarkup(React.createElement(Tab, props()));
		assert.ok(html.includes(label)); assert.ok(html.includes(help));
		assert.ok(html.includes(`for="${id}"`)); assert.ok(html.includes('{message}')); assert.ok(html.includes('{nickname}'));
	}
	fields().get('tts-channel-template').onChange({ target: { value: '{nickname}: {message}' } });
	assert.deepEqual(changes.at(-1), ['tts_channel_template', '{nickname}: {message}']);
	config = { ...config, tts_channel_id: null, tts_waiting_room_channel_id: null };
	assert.equal(fields().get('tts-channel-template').disabled, true); assert.equal(fields().get('tts-waiting-template').disabled, true);
	assert.equal(fields().get('tts-channel-template').value, '{nickname}: {message}');
	assert.equal(fields().get('tts-waiting-template').value, '{nickname} is waiting');
	const disabledHtml = renderToStaticMarkup(React.createElement(Tab, props()));
	assert.match(disabledHtml, /<button[^>]+disabled=""[^>]*>\{message\}<\/button>/);
	config = { ...config, tts_channel_id: 'text', tts_waiting_room_channel_id: 'voice' };
	assert.equal(fields().get('tts-channel-template').value, '{nickname}: {message}');
	config = { tts_lang: 'th' }; // Server switch / old guild: no inherited custom template.
	assert.equal(fields().get('tts-channel-template').value, ''); assert.equal(fields().get('tts-channel-template').placeholder, '{message}');
	assert.equal(fields().get('tts-waiting-template').placeholder, '{nickname} เข้าห้องรอแล้ว');
	config = { ...config, tts_channel_template: '{displayname}', tts_waiting_room_template: '{server}' };
	assert.equal(fields().get('tts-channel-template')['aria-invalid'], true); assert.equal(fields().get('tts-waiting-template')['aria-invalid'], true);
}
const page = fs.readFileSync(path.resolve('app/servers/[guildId]/page.js'), 'utf8');
assert.match(page, /tts: \['tts_waiting_room_template', 'tts_channel_template'/, 'New fields participate in the existing dirty/save flow');
assert.match(page, /document\.getElementById\(id\)\?\.focus\(\)/, 'Invalid fields receive focus on save');
console.log('PASS: actual compiled Voice/TTS tab in EN/TH, labels/help/tokens, validation, defaults, retained disabled values, re-enable and server isolation');
