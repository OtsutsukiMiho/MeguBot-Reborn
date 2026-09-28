'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const React=require('react');
const {renderToStaticMarkup}=require('react-dom/server');
const babel=require('next/dist/compiled/babel/core');

for(const lang of ['en','th']) {
	const t=require(`../app/copy/${lang}`);
	let summary,directory,selectProps,pushed=[],requests=[];
	function load(name) {
		const filename=path.join(__dirname,`../app/components/teams/${name}.js`);
		const first=babel.transformSync(fs.readFileSync(filename,'utf8'),{filename,configFile:false,babelrc:false,presets:['next/babel']});
		const {code}=babel.transformSync(first.code,{filename,configFile:false,babelrc:false,plugins:['next/dist/compiled/babel/plugin-transform-modules-commonjs']});
		const module={exports:{}};
		vm.runInThisContext(`(function(require,module,exports){${code}\n})`,{filename})(id=>{
			if(id.includes('useDraftGuard')) return {default:()=>()=>{},requestDraftNavigation:()=>true,__esModule:true};
		if(id==='../../copy')return {useCopy:()=>({t,lang})};
			if(id.endsWith('.css'))return new Proxy({},{get:(_,key)=>key});
			if(id==='next/link')return {default:props=>React.createElement('a',props),__esModule:true};
			if(id==='next/navigation')return {useRouter:()=>({push:value=>pushed.push(value)})};
			if(id.includes('CustomSelect'))return {default:props=>{selectProps=props;return React.createElement('div',{'aria-label':props.ariaLabel},props.options.map(option=>React.createElement('span',{key:option.value},option.label)));},__esModule:true};
			if(id.includes('AuthGate'))return {default:()=>React.createElement('p',null,'Sign in boundary'),__esModule:true};
			if(id.includes('TeamMark'))return {default:()=>null,__esModule:true};
			if(id==='./TeamWorkspaceNav')return {default:load('TeamWorkspaceNav'),__esModule:true};
			if(id.includes('useWorkspaceResource'))return {default:url=>{requests.push(url);return {...(!url?{loading:false}:url.endsWith('/summary')?summary:directory),reload(){}};},__esModule:true};
			return require(id.startsWith('@babel/runtime/')?`next/dist/compiled/${id}`:id);
		},module,module.exports);
		return module.exports.default;
	}
	const Nav=load('TeamWorkspaceNav'),Overview=load('TeamOverview');
	let html=renderToStaticMarkup(React.createElement(Nav,{teamId:'team',section:'projects',goalsEnabled:true}));
	for(const section of ['overview','projects','people','requests','goals','settings'])assert.ok(html.includes(t.teams.workspace[section].replaceAll('&','&amp;')));
	assert.match(html,/href="\/teams\/team\/projects" aria-current="page"/);
	selectProps.onChange('people');assert.equal(pushed.at(-1),'/teams/team/people');
	selectProps.onChange('invalid');assert.equal(pushed.length,1);
	html=renderToStaticMarkup(React.createElement(Nav,{teamId:'team',section:'overview'}));
	assert.ok(!html.includes('/teams/team/goals'),'Disabled goals must stay undiscoverable');
	summary={data:{team:{id:'team',name:'Example team',discordGuild:{id:'811111111111111111',name:'Example server'}},capabilities:{canCreateProject:true}},loading:false};
	directory={data:{projects:[{id:'p',code:'CODE',title:'No topic project',status:'active',topicCount:0,progress:0,role:'owner'}],nextCursor:'next+cursor'},loading:false};
	const render=props=>{requests=[];return renderToStaticMarkup(React.createElement(Overview,{teamId:'team',goalsEnabled:true,...props}));};
	html=render({});assert.ok(html.includes('Example team'));assert.ok(!html.includes('No topic project'));assert.deepEqual(requests,['/api/megu/teams/team/summary',null]);
	summary.data.team.role='owner';summary.data.capabilities.canEdit=true;summary.data.capabilities.canManageJoinLink=true;
	html=render({});assert.ok(html.includes(t.teams.ux.invitePeople));assert.ok(html.includes('/teams/team/settings#discord-roles'));
	summary.data.team.role='member';summary.data.capabilities={canCreateProject:false,canEdit:false,canManageJoinLink:false};
	html=render({});assert.ok(!html.includes(t.teams.ux.invitePeople));assert.ok(!html.includes('settings#discord-roles'));assert.ok(!html.includes('/projects/new'));
	assert.deepEqual(requests,['/api/megu/teams/team/summary',null],'Shortcuts must not fetch private project data');
	summary.data.capabilities={canCreateProject:true};
	html=render({section:'projects',cursor:'current'});assert.ok(html.includes(t.teams.workspace.noTopics));assert.ok(!html.includes('0%'));
	assert.ok(html.includes('/projects/new?team=team'));assert.ok(html.includes('cursor=next%2Bcursor'));
	assert.equal(requests[1],'/api/megu/projects?teamId=team&limit=30&cursor=current');
	directory.data.projects[0].topicCount=3;directory.data.projects[0].progress=25;assert.ok(render({section:'projects'}).includes('25%'));
	directory={data:{projects:[]},loading:false};assert.ok(render({section:'projects'}).includes(t.teams.noProjects));
	summary={error:{status:404,code:'team_not_found'}};html=render({section:'projects'});assert.match(html,/role="alert"/);assert.ok(!html.includes('Example team'));assert.equal(requests[1],null);
	summary={error:{status:401}};assert.ok(render({}).includes('Sign in boundary'));
	summary={loading:true};assert.match(render({}),/aria-busy="true"/);
}
console.log('Team workspace UI passed: EN/TH shared rail, gated goals, focused bounded projects, cursors, empty metrics, authorization/loading/error states and selector navigation.');
