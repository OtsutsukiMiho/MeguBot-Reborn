'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const React=require('react');
const {renderToStaticMarkup}=require('react-dom/server');
const babel=require('next/dist/compiled/babel/core');
const teamStyles=fs.readFileSync(path.join(__dirname,'../app/teams/teams.module.css'),'utf8');
assert.match(teamStyles,/\.peoplePreviewHead \{[^}]*padding-bottom:\.7rem; border-bottom:1px solid var\(--line\); \}/);
assert.match(teamStyles,/\.projectStatus\[data-state='active'\] \{ color:var\(--settled\); background:var\(--settled-soft\); border-color:color-mix/);
const avatarFilename=path.join(__dirname,'../app/components/projects/ProjectAvatar.js');
const avatarFirst=babel.transformSync(fs.readFileSync(avatarFilename,'utf8'),{filename:avatarFilename,configFile:false,babelrc:false,presets:['next/babel']});
const avatarCode=babel.transformSync(avatarFirst.code,{filename:avatarFilename,configFile:false,babelrc:false,plugins:['next/dist/compiled/babel/plugin-transform-modules-commonjs']}).code;
const avatarModule={exports:{}};
vm.runInThisContext(`(function(require,module,exports){${avatarCode}\n})`,{filename:avatarFilename})(id=>id==='react'?React:require(id.startsWith('@babel/runtime/')?`next/dist/compiled/${id}`:id),avatarModule,avatarModule.exports);
const ProjectAvatar=avatarModule.exports.default;

for(const lang of ['en','th']) {
	const t=require(`../app/copy/${lang}`);
	let summary,directory,selectProps,pushed=[],requests=[],pathname='/teams/team/projects';
	const previewProjects={data:{projects:[{id:'preview',code:'PREVIEW',title:'Preview project',status:'active',topicCount:4,progress:75}]},loading:false};
	const goalPreview={data:{goals:[{id:'g',title:'Private goal',access:'private',lifecycle:'active'}]},loading:false};
	const peoplePreview={data:{members:[{userId:'u',displayName:'Alice Member',avatarUrl:'https://cdn.example/alice.png'},{userId:'v',displayName:'Ben Member'},{userId:'w',displayName:'Casey Member',avatarUrl:'https://cdn.example/casey.png'},{userId:'x',displayName:'Hidden Member'}],total:7},loading:false};
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
			if(id==='next/navigation')return {useRouter:()=>({push:value=>pushed.push(value)}),usePathname:()=>pathname};
			if(id.includes('CustomSelect'))return {default:props=>{selectProps=props;return React.createElement('div',{'aria-label':props.ariaLabel},props.options.map(option=>React.createElement('span',{key:option.value},option.label)));},__esModule:true};
			if(id.includes('AuthGate'))return {default:()=>React.createElement('p',null,'Sign in boundary'),__esModule:true};
			if(id==='../WorkspaceSkeleton')return {default:()=>React.createElement('div',{role:'status'},t.teams.workspace.loading),WorkspaceHeaderSkeleton:()=>React.createElement('div',{className:'header-skeleton'}),__esModule:true};
			if(id.includes('TeamMark'))return {default:()=>null,__esModule:true};
			if(id.includes('ProjectAvatar'))return {default:ProjectAvatar,__esModule:true};
			if(id==='./TeamWorkspaceNav')return {default:load('TeamWorkspaceNav'),__esModule:true};
			if(id==='./TeamWorkspaceShell')return {useTeamWorkspace:()=>summary};
			if(id.includes('useWorkspaceResource'))return {default:url=>{requests.push(url);return {...(!url?{loading:false}:url.endsWith('/summary')?summary:url.includes('/goals?')?goalPreview:url.includes('/members?')?peoplePreview:url.includes('/projects?')&&url.endsWith('limit=3')?previewProjects:directory),reload(){}};},__esModule:true};
			return require(id.startsWith('@babel/runtime/')?`next/dist/compiled/${id}`:id);
		},module,module.exports);
		return module.exports.default;
	}
	const Nav=load('TeamWorkspaceNav'),Overview=load('TeamOverview'),Shell=load('TeamWorkspaceShell');
	let html=renderToStaticMarkup(React.createElement(Nav,{teamId:'team',section:'projects',goalsEnabled:true}));
	for(const section of ['overview','projects','people','requests','goals','settings'])assert.ok(html.includes(t.teams.workspace[section].replaceAll('&','&amp;')));
	assert.match(html,/href="\/teams\/team\/projects" aria-current="page"/);
	assert.match(html,/href="\/teams\/team\/join-requests"/);
	selectProps.onChange('people');assert.equal(pushed.at(-1),'/teams/team/people');
	selectProps.onChange('requests');assert.equal(pushed.at(-1),'/teams/team/join-requests');
	selectProps.onChange('invalid');assert.equal(pushed.length,2);
	html=renderToStaticMarkup(React.createElement(Nav,{teamId:'team',section:'overview'}));
	assert.ok(!html.includes('/teams/team/goals'),'Disabled goals must stay undiscoverable');
	summary={data:{team:{id:'team',name:'Example team',discordGuild:{id:'811111111111111111',name:'Example server',icon:'guild-icon'}},capabilities:{canCreateProject:true}},loading:false};
	directory={data:{projects:[{id:'p',code:'CODE',title:'No topic project',status:'active',topicCount:0,progress:0,role:'owner'}],nextCursor:'next+cursor'},loading:false};
	const render=props=>{requests=[];return renderToStaticMarkup(React.createElement(Overview,{teamId:'team',goalsEnabled:true,...props}));};
	html=render({});const overviewCardOrder=['Example server','id="team-people-preview"','id="team-project-preview"','id="team-goal-preview"'].map(marker=>html.indexOf(marker));assert.ok(overviewCardOrder.every((position,index)=>position>=0&&(index===0||overviewCardOrder[index-1]<position)),'Overview cards render Discord, People, Projects, then Goals');assert.ok(html.includes('Preview project'));assert.ok(html.includes('Private goal'));assert.ok(html.includes('Alice Member'));assert.ok(html.includes('Ben Member'));assert.ok(html.includes('Casey Member'));assert.ok(!html.includes('Hidden Member'));assert.ok(html.includes('+4'));assert.ok(html.includes('cdn.example/alice.png'));assert.ok(html.includes('BM</span>'),'Missing member photos use initials fallback');assert.match(html,/role="progressbar"[^>]*aria-valuenow="75"/);assert.match(html,/data-state="active"/);assert.ok(html.includes('Example server'));assert.ok(html.includes('cdn.discordapp.com/icons/811111111111111111/guild-icon.png'));assert.ok(html.includes('role="progressbar"'));assert.deepEqual(requests,[null,'/api/megu/projects?teamId=team&limit=3','/api/megu/teams/team/goals?limit=3','/api/megu/teams/team/members?limit=4']);
	requests=[];pathname='/teams/team/join-requests';html=renderToStaticMarkup(React.createElement(Shell,{teamId:'team',goalsEnabled:true},React.createElement('p',null,'Child content')));assert.ok(html.includes('Example team'));assert.ok(html.includes('Child content'));assert.match(html,/href="\/teams\/team\/join-requests" aria-current="page"/);assert.deepEqual(requests,['/api/megu/teams/team/summary']);
	pathname='/teams/team/projects';
	summary.data.team.role='owner';summary.data.capabilities.canEdit=true;summary.data.capabilities.canManageJoinLink=true;
	html=render({});assert.ok(html.includes(t.teams.ux.invitePeople));assert.match(html,/class="btn btn-primary" href="\/teams\/team\/join-requests"/);assert.ok(html.includes('/teams/team/settings#discord-roles'));assert.ok(html.indexOf(t.teams.ux.configureDiscord)<html.indexOf(t.teams.overviewCopy.openServer),'Discord actions render Configure above Open server');
	summary.data.team.role='member';summary.data.capabilities={canCreateProject:false,canEdit:false,canManageJoinLink:false};
	html=render({});assert.ok(!html.includes(t.teams.ux.invitePeople));assert.ok(!html.includes('settings#discord-roles'));assert.ok(!html.includes('/projects/new'));
	assert.ok(requests.includes('/api/megu/projects?teamId=team&limit=3'),'Overview requests only the authorized project preview');
	summary.data.capabilities={canCreateProject:true};
	html=render({section:'projects',cursor:'current'});assert.ok(html.includes(t.teams.workspace.noTopics));assert.ok(!html.includes('0%'));
	assert.ok(html.includes('/projects/new?team=team'));assert.ok(html.includes('cursor=next%2Bcursor'));
	assert.equal(requests[0],'/api/megu/projects?teamId=team&limit=30&cursor=current');
	directory.data.projects[0].topicCount=3;directory.data.projects[0].progress=25;assert.ok(render({section:'projects'}).includes('25%'));
	directory={data:{projects:[]},loading:false};assert.ok(render({section:'projects'}).includes(t.teams.noProjects));
		summary={error:{status:404,code:'team_not_found'}};html=renderToStaticMarkup(React.createElement(Shell,{teamId:'team',goalsEnabled:true},React.createElement('p',null,'Child content')));assert.match(html,/role="alert"/);assert.ok(!html.includes('Child content'));
	summary={error:{status:401}};assert.ok(renderToStaticMarkup(React.createElement(Shell,{teamId:'team',goalsEnabled:true})).includes('Sign in boundary'));
	summary={loading:true};assert.match(renderToStaticMarkup(React.createElement(Shell,{teamId:'team',goalsEnabled:true})),/header-skeleton/);
}
console.log('Team workspace UI passed: EN/TH shared rail, gated goals, focused bounded projects, cursors, empty metrics, authorization/loading/error states and selector navigation.');
