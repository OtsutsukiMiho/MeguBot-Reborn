'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const babel=require('next/dist/compiled/babel/core');
const filename=path.join(__dirname,'../app/components/useDraftGuard.js');
const first=babel.transformSync(fs.readFileSync(filename,'utf8'),{filename,configFile:false,babelrc:false,presets:['next/babel']});
const {code}=babel.transformSync(first.code,{filename,configFile:false,babelrc:false,plugins:['next/dist/compiled/babel/plugin-transform-modules-commonjs']});
const oldWindow=global.window,oldDocument=global.document;
try {
	for(const lang of ['en','th']) {
		const effects=[],cleanups=[],t=require(`../app/copy/${lang}`);
		global.window=new EventTarget();global.document=new EventTarget();
		window.location={href:'http://localhost/teams/demo/settings'};
		const state={__NA:true},restored=[];
		window.history={state,pushState:(value,unused,url)=>{restored.push({value,url});window.location.href=url;}};
		const pending=[],navigated=[];
		const module={exports:{}};
		vm.runInThisContext(`(function(require,module,exports){${code}\n})`,{filename})(id=>{
			if(id==='react')return {useRef:value=>({current:value}),useEffect:fn=>effects.push(fn)};
			if(id.endsWith('.css'))return {};
			if(id==='next/navigation')return {};
			if(id==='../copy')return {useCopy:()=>({t})};
			return require(id.startsWith('@babel/runtime/')?`next/dist/compiled/${id}`:id);
		},module,module.exports);
		const {default:guard,requestDraftNavigation:request,useWorkspaceDraftNavigation:register}=module.exports;
		register(value=>pending.push(value),{push:url=>navigated.push(url)});cleanups.push(effects.pop()());
		const mount=(dirty,busy=false,onDiscard=null)=>{const release=guard(dirty,busy,onDiscard);cleanups.push(effects.pop()());return release;};
		assert.equal(request(),true);const release=mount(true);
		assert.equal(request(),false);assert.equal(typeof pending[0].discard,'function');
		const click=(overrides={})=>{const e=new Event('click',{cancelable:true});Object.assign(e,{button:0,...overrides});Object.defineProperty(e,'target',{value:{closest:()=>({href:'http://localhost/teams/demo/projects',target:'',hasAttribute:()=>false})}});document.dispatchEvent(e);return e;};
		assert.equal(click().defaultPrevented,true);
		const count=pending.length;assert.equal(click({ctrlKey:true}).defaultPrevented,false);assert.equal(pending.length,count);
		const unload=new Event('beforeunload',{cancelable:true});window.dispatchEvent(unload);assert.equal(unload.defaultPrevented,true);
		window.location.href='http://localhost/teams/demo';window.dispatchEvent(new Event('popstate'));
		assert.deepEqual(restored,[{value:state,url:'http://localhost/teams/demo/settings'}]);
		let abandoned=0;mount(true,false,()=>abandoned++);const before=pending.length;let resumed=0;assert.equal(request(()=>resumed++),false);assert.equal(pending.length,before+1,'Multiple drafts share one confirmation');assert.equal(abandoned,0,'Cancelled discard preserves attempt');pending.at(-1).discard();assert.equal(resumed,1);assert.equal(abandoned,1,'Confirmed discard retires creation attempt');
		assert.equal(request(),true);assert.equal(pending.length,before+1,'Accepted navigation does not prompt twice');
		const busyRelease=mount(true,true);assert.equal(request(),false,'An in-flight save cannot be abandoned through SPA navigation');busyRelease();assert.equal(request(),true);
		release();for(const cleanup of cleanups)cleanup?.();
		assert.equal(request(),true,'Unmount removes stale drafts');
	}
	console.log('Workspace draft guard passed: EN/TH links/history/unload, cancellation, grouped drafts, in-flight protection, release and cleanup.');
} finally { global.window=oldWindow;global.document=oldDocument; }
