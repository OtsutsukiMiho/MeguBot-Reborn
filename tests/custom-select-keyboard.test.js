const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const babel = require('next/dist/compiled/babel/core');
const filename = require.resolve('../app/components/CustomSelect.js');
global.window = { innerHeight: 600 };
global.document = { addEventListener() {}, removeEventListener() {} };
const first = babel.transformSync(fs.readFileSync(filename, 'utf8'), { filename, configFile: false, babelrc: false, presets: ['next/babel'] });
const { code } = babel.transformSync(first.code, { filename, configFile: false, babelrc: false, plugins: ['next/dist/compiled/babel/plugin-transform-modules-commonjs'] });

function harness(props) {
	const hooks = [], selected = [], focus = { current: null }; let cursor = 0, effects = [];
	const react = {
		createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
		useState(value) { const i = cursor++; if (!(i in hooks)) hooks[i] = value; return [hooks[i], next => { hooks[i] = typeof next === 'function' ? next(hooks[i]) : next; }]; },
		useRef(value) { const i = cursor++; return hooks[i] ||= { current: value }; },
		useId() { cursor++; return 'select-id'; },
		useMemo(fn) { cursor++; return fn(); },
		useEffect(fn, deps) { const i = cursor++; if (!hooks[i] || deps.some((item, index) => item !== hooks[i][index])) { hooks[i] = deps; effects.push(fn); } },
	};
	const module = { exports: {} }, t = require('../app/copy/en');
	vm.runInThisContext(`(function(require,module,exports){${code}\n})`, { filename })(name => {
		if (name === 'react') return react;
		if (name === '../copy') return { useCopy: () => ({ t }) };
		if (name.endsWith('.css')) return new Proxy({}, { get: (_, key) => key });
		if (name === 'lucide-react') return { Check: () => null, ChevronDown: () => null, Hash: () => null, Search: () => null };
		return require(name.startsWith('@babel/runtime/') ? `next/dist/compiled/${name}` : name);
	}, module, module.exports);
	function all(node, output = []) { if (!node || typeof node !== 'object') return output; if (Array.isArray(node)) { node.forEach(child => all(child, output)); return output; } if (node.type) output.push(node); for (const child of node.props?.children || []) all(child, output); return output; }
	function render() {
		cursor = 0; const nodes = all(module.exports.default({ ...props, onChange: (...args) => selected.push(args) }));
		for (const node of nodes) if (node.props.ref) node.props.ref.current = {
			focus: () => { focus.current = node; },
			getBoundingClientRect: () => ({ bottom: 100, top: 30 }), contains: () => true,
		};
		const pending = effects; effects = []; for (const fn of pending) fn();
		return {
			nodes, one: predicate => { const found = nodes.find(predicate); assert.ok(found, 'Expected node exists'); return found; },
			byRole: role => nodes.filter(node => node.props.role === role),
		};
	}
	return { render, selected, focus };
}
function key(node, value, target = node) { let prevented = false; node.props.onKeyDown({ key: value, target, preventDefault() { prevented = true; } }); return prevented; }

for (const size of ['compact', 'default']) {
	const h = harness({ ariaLabel: 'Choose role', value: 'c', size, searchable: false, options: [
		{ value: 'a', label: 'Alpha' }, { value: 'b', label: 'Blocked', disabled: true },
		{ value: 'c', label: 'Current' }, { value: 'd', label: 'Delta' },
	] });
	let view = h.render(), trigger = view.one(node => node.props['aria-haspopup'] === 'listbox');
	assert.equal(key(trigger, 'ArrowDown'), true); view = h.render();
	let list = view.one(node => node.props.role === 'listbox'), menu = view.one(node => typeof node.props.onKeyDown === 'function' && node.type === 'div' && node !== list);
	assert.equal(list.props['aria-label'], 'Choose role'); assert.equal(list.props.tabIndex, 0);
	assert.equal(h.focus.current?.props.role, 'listbox');
	assert.ok(view.byRole('option').every(node => node.props.tabIndex === -1));
	assert.equal(view.byRole('option')[1].props.disabled, true);
	assert.equal(view.byRole('option')[2].props['aria-selected'], true);
	assert.equal(list.props['aria-activedescendant'], view.byRole('option')[2].props.id);
	assert.equal(key(menu, 'ArrowDown', list), true); view = h.render();
	assert.equal(view.one(node => node.props.role === 'listbox').props['aria-activedescendant'], view.byRole('option')[3].props.id);
	menu = view.one(node => node.type === 'div' && typeof node.props.onKeyDown === 'function'); list = view.one(node => node.props.role === 'listbox');
	key(menu, 'Home', list); view = h.render();
	assert.equal(view.one(node => node.props.role === 'listbox').props['aria-activedescendant'], view.byRole('option')[0].props.id);
	menu = view.one(node => node.type === 'div' && typeof node.props.onKeyDown === 'function'); list = view.one(node => node.props.role === 'listbox');
	key(menu, 'ArrowDown', list); view = h.render();
	assert.equal(view.one(node => node.props.role === 'listbox').props['aria-activedescendant'], view.byRole('option')[2].props.id, 'Disabled option skipped');
	menu = view.one(node => node.type === 'div' && typeof node.props.onKeyDown === 'function'); list = view.one(node => node.props.role === 'listbox');
	key(menu, 'End', list); view = h.render();
	menu = view.one(node => node.type === 'div' && typeof node.props.onKeyDown === 'function'); list = view.one(node => node.props.role === 'listbox');
	key(menu, ' ', list); view = h.render();
	assert.equal(h.selected.at(-1)[0], 'd'); assert.equal(view.byRole('listbox').length, 0); assert.equal(h.focus.current?.props['aria-haspopup'], 'listbox');
	trigger = view.one(node => node.props['aria-haspopup'] === 'listbox'); trigger.props.onClick(); view = h.render();
	menu = view.one(node => node.type === 'div' && typeof node.props.onKeyDown === 'function'); list = view.one(node => node.props.role === 'listbox');
	key(menu, 'Escape', list); assert.equal(h.render().byRole('listbox').length, 0); assert.equal(h.selected.length, 1);
	trigger = h.render().one(node => node.props['aria-haspopup'] === 'listbox'); trigger.props.onClick(); view = h.render();
	view.byRole('option')[0].props.onClick(); assert.equal(h.selected.at(-1)[0], 'a', 'Pointer selection remains available');
	trigger = h.render().one(node => node.props['aria-haspopup'] === 'listbox'); trigger.props.onClick(); view = h.render();
	view.one(node => node.props.ref && node.props.onBlur).props.onBlur({ currentTarget: { contains: () => false }, relatedTarget: {} });
	assert.equal(h.render().byRole('listbox').length, 0, 'Tabbing outside closes the popup');
}
const options = ['Amber', 'Blue', 'Cyan', 'Dark', 'Emerald', 'Fuchsia', 'Gray'].map((label, index) => ({ value: String(index), label }));
const searched = harness({ ariaLabel: 'Choose server', value: '2', options });
let view = searched.render(); view.one(node => node.props['aria-haspopup'] === 'listbox').props.onClick(); view = searched.render();
let input = view.one(node => node.type === 'input'); assert.equal(searched.focus.current?.type, 'input');
assert.equal(input.props['aria-controls'], view.one(node => node.props.role === 'listbox').props.id);
input.props.onChange({ target: { value: 'a' } }); view = searched.render();
assert.equal(view.byRole('option').length, 6, 'Search filters options');
input = view.one(node => node.type === 'input'); let menu = view.one(node => node.type === 'div' && typeof node.props.onKeyDown === 'function');
assert.equal(key(menu, ' ', input.props.ref.current), false, 'Space remains available for search text');
key(menu, 'End', input); view = searched.render();
assert.equal(view.one(node => node.props.role === 'listbox').props['aria-activedescendant'], view.byRole('option').at(-1).props.id);
menu = view.one(node => node.type === 'div' && typeof node.props.onKeyDown === 'function'); input = view.one(node => node.type === 'input');
key(menu, 'Enter', input); assert.equal(searched.selected.at(-1)[0], '6');
view = searched.render(); view.one(node => node.props['aria-haspopup'] === 'listbox').props.onClick(); view = searched.render();
input = view.one(node => node.type === 'input'); input.props.onChange({ target: { value: 'no-match' } }); view = searched.render();
menu = view.one(node => node.type === 'div' && typeof node.props.onKeyDown === 'function'); input = view.one(node => node.type === 'input');
assert.equal(key(menu, 'Enter', input), true, 'Empty search does not submit an enclosing form');
assert.equal(searched.selected.length, 1);
console.log('CustomSelect keyboard PASS: named listbox, active descendant, arrows/Home/End, disabled skip, Space/Enter, search, Escape, focus and compact/default layouts.');
