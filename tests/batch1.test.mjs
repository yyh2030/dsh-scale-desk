import assert from 'node:assert/strict'
import test from 'node:test'
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import vm from 'node:vm'
import {Readable} from 'node:stream'
import {apply} from '../index.js'
import {normalizeDef,scanTargets,validateData,buildScores,parseCsv,buildDetail,wideCsv} from '../scoring.js'

const rawDef=(id='ALPHA')=>({schema:1,id,name:id,short:id,version:'synthetic-v1',itemCount:4,response:{min:1,max:5,labels:{}},items:[1,2,3,4].map(no=>({no,text:'Synthetic item '+no,reverse:[2,4].includes(no)})),waves:['T0','T1'],codes:{T0:[1,2,3,4].map(no=>'alpha_t0_'+no),T1:[1,2,3,4].map(no=>'alpha_t1_'+no)},missing:{rule:'prorate',minAnswered:2},scoring:{type:'sum',extension:'keep-me',subscales:{custom:{label:'Subset',items:[2,4],reverse:[2,4],range:[4,20],multiplier:2,minAnswered:2,extra:{x:1}}}}})

async function fixture(t){
 const root=await mkdtemp(path.join(os.tmpdir(),'scale-batch1-'));t.after(()=>rm(root,{recursive:true,force:true}))
 const labDir=path.join(root,'separate-lab');const defsDir=path.join(labDir,'scales','defs');await mkdir(defsDir,{recursive:true});await mkdir(path.join(labDir,'scales','answers'))
 await writeFile(path.join(defsDir,'ALPHA.json'),JSON.stringify(rawDef(),null,2)+'\n');await writeFile(path.join(labDir,'scales','flow.json'),JSON.stringify({stages:[]}));await writeFile(path.join(labDir,'subjects.csv'),'编号\nRoster-零\n')
 const tools=new Map();let handler
 apply({get:key=>key==='webServer'?{register:spec=>{handler=spec.handler}}:key==='tools'?{register:tool=>tools.set(tool.name,tool)}:undefined,effect:fn=>fn()}, {projectRoot:root,labDir})
 let activeContextRevision,activeSelectionRevision;let activeStudyId
 async function request(action,payload={}){if(!activeStudyId && !payload.__identity){const initial=await request('status',{__identity:true});activeStudyId=initial.study.id;activeContextRevision=initial.contextRevision;activeSelectionRevision=initial.selectionRevision}const req=Object.assign(Readable.from([Buffer.from(JSON.stringify({action,payload:{...payload,studyId:payload.studyId || activeStudyId,contextRevision:payload.contextRevision || activeContextRevision,selectionRevision:payload.selectionRevision ?? activeSelectionRevision}}))]),{method:'POST',url:'/api/scale-desk',headers:{'x-scale-desk':'1'}});let body;const res={setHeader(){},end:s=>body=s};await handler(req,res);const json=JSON.parse(body);if(!json.ok)throw Error(json.error.message);if(json.data.contextRevision)activeContextRevision=json.data.contextRevision;if(Number.isInteger(json.data.selectionRevision))activeSelectionRevision=json.data.selectionRevision;return json.data}
 return {root,labDir,defsDir,tools,request}
}

// Run the real client factory and hook state. Expose lexical components only in
// this VM: handlers and payload builders are exactly those shipped in client.js.
async function clientHarness(request){
 let factory;const slots=[];let cursor=0;let effects=[]
 const React={createElement:(type,props,...children)=>({type,props:props||{},children:children.flat(Infinity).filter(x=>x!==null&&x!==undefined&&x!==false)}),Component:class{},useState:initial=>{const at=cursor++;if(!(at in slots))slots[at]=typeof initial==='function'?initial():initial;return[slots[at],next=>{slots[at]=typeof next==='function'?next(slots[at]):next}]},useEffect:(fn,deps)=>{const at=cursor++;if(!slots[at]||deps.some((value,i)=>value!==slots[at][i])){slots[at]=deps;effects.push(fn)}},useCallback:fn=>fn,useMemo:fn=>fn(),useRef:initial=>({current:initial})}
 const requests=[];const src=(await readFile(new URL('../client.js',import.meta.url),'utf8')).replace("      inject: ['slots'],","      __test: { LibraryTab, ImportPanel, SheetEntry, ScoreTab },\n      inject: ['slots'],")
 vm.runInNewContext(src,{window:{__ModuleLoader__:{load:spec=>factory=spec.factory}},URLSearchParams,fetch:async(_url,init)=>{const {action,payload}=JSON.parse(init.body);requests.push({action,payload});try{return{ok:true,json:async()=>({ok:true,data:await request(action,payload)})}}catch(error){return{ok:false,json:async()=>({ok:false,error:{message:error.message}})}}}})
 const components=factory(()=>React).__test
 const render=async(name,props)=>{cursor=0;const tree=components[name](props);for(const fn of effects.splice(0))fn();await new Promise(resolve=>setImmediate(resolve));return tree}
 return{render,requests}
}
const nodes=tree=>typeof tree==='object'&&tree?[tree,...tree.children.flatMap(nodes)]:[]
const text=node=>typeof node==='object'?node.children.map(text).join(''):String(node)
const button=(tree,label)=>{const found=nodes(tree).find(n=>(n.type==='button'||n.type?.name==='Btn')&&(n.props.children===label||text(n)===label));assert.ok(found,'button '+label);return found}
const labeled=(tree,label)=>{const found=nodes(tree).find(n=>n.type==='label'&&typeof n.children[0]==='string'&&n.children[0]===label);assert.ok(found,'label '+label);return found.children.find(n=>typeof n==='object')}

test('real client metadata form omits unchanged scoring and parses ideographic separators',async t=>{
 const f=await fixture(t);const before=JSON.parse(await readFile(path.join(f.defsDir,'ALPHA.json')));const data=await f.request('status');const ui=await clientHarness(f.request);const props={data,toast(){},refresh(){}}
 await ui.render('LibraryTab',props);let tree=await ui.render('LibraryTab',props);await button(tree,'编辑信息').props.onClick();tree=await ui.render('LibraryTab',props)
 labeled(tree,'名称').props.onChange({target:{value:'Renamed'}});tree=await ui.render('LibraryTab',props);await button(tree,'保存').props.onClick()
 const payload=ui.requests.find(r=>r.action==='saveMeta').payload;assert.equal(Object.hasOwn(payload,'reverse'),false);assert.equal(Object.hasOwn(payload,'scoringType'),false);assert.equal(Object.hasOwn(payload,'minAnswered'),false)
 const after=JSON.parse(await readFile(path.join(f.defsDir,'ALPHA.json')));assert.deepEqual(after.scoring,before.scoring);assert.deepEqual(after.items,before.items);assert.deepEqual(after.missing,before.missing)
 tree=await ui.render('LibraryTab',props);tree=await ui.render('LibraryTab',props);await button(tree,'编辑信息').props.onClick();tree=await ui.render('LibraryTab',props);labeled(tree,'反向题号（逗号分隔）').props.onChange({target:{value:'1、3'}});tree=await ui.render('LibraryTab',props);await button(tree,'保存').props.onClick();assert.deepEqual(ui.requests.filter(r=>r.action==='saveMeta').at(-1).payload.reverse,[1,3])
})

test('real automatic client import submits changed item and ID indices, with refreshed scores',async t=>{
 const f=await fixture(t);const data=await f.request('status');const ui=await clientHarness(f.request);const props={data,toast(){},onImported(){}};let tree=await ui.render('ImportPanel',props)
 const csv='编号,alternate,alpha_t0_1,alpha_t0_2,alpha_t0_3,alpha_t0_4,spare,spare\nold,P-014,1,2,3,4,5,1'
 nodes(tree).find(n=>n.type==='textarea').props.onChange({target:{value:csv}});tree=await ui.render('ImportPanel',props);await button(tree,'预览全部').props.onClick();tree=await ui.render('ImportPanel',props)
 let select=nodes(tree).find(n=>n.type==='select'&&n.children.some(c=>text(c)==='（缺失）'));assert.equal(select.props.value,2);assert.equal(select.children.filter(n=>n.type==='option'&&text(n).includes('spare')).length,2)
 await select.props.onChange({target:{value:'6'}});await new Promise(resolve=>setImmediate(resolve));tree=await ui.render('ImportPanel',props)
 const id=labeled(tree,'编号列');await id.props.onChange({target:{value:'1'}});await new Promise(resolve=>setImmediate(resolve));tree=await ui.render('ImportPanel',props)
 const previews=ui.requests.filter(r=>r.action==='importPreview');const refreshed=await f.request('importPreview',previews.at(-1).payload);assert.equal(refreshed.preview[0].id,'P-014');assert.equal(refreshed.preview[0].subs.custom,12)
 await button(tree,'导入这份文件（确认目标）').props.onClick();const sent=ui.requests.find(r=>r.action==='importFile').payload;assert.equal(sent.targets.length,1);assert.equal(sent.targets[0].mapping.idIndex,1);assert.equal(sent.targets[0].mapping.items[0].index,6)
 const saved=await f.request('answer',{scale:'ALPHA',wave:'T0',id:'P-014'});assert.equal(saved.values[1],'5');assert.equal(saved.values[2],'2');assert.equal((await f.request('detail',{scale:'ALPHA',wave:'T0',id:'P-014'})).subs[0].score,12)
})

test('real manual entry preserves arbitrary string IDs without truncation', async t=>{
 const f=await fixture(t);const data=await f.request('status');const ui=await clientHarness(f.request);const saved=[];const props={data,toast(){},onSave:async payload=>{saved.push(payload);return f.request('save',payload)},onClear:payload=>f.request('clear',payload)}
 for(const id of ['00123','P-014','123456','合成编号-零']){let tree=await ui.render('SheetEntry',props);nodes(tree).find(node=>node.type==='input'&&node.props.className==='sd-input sd-id-input').props.onChange({target:{value:id}});tree=await ui.render('SheetEntry',props);const save=nodes(tree).find(node=>(node.type==='button'||node.type?.name==='Btn')&&(['保存','保存修改'].includes(node.props.children)||['保存','保存修改'].includes(text(node))));await save.props.onClick();assert.equal(saved.at(-1).id,id);assert.equal((await f.request('answer',{scale:'ALPHA',wave:'T0',id})).id,id)}
})

test('entry controls have labels, question groups and live pressed states',async t=>{
 const f=await fixture(t);const data=await f.request('status');const def=data.instruments[0];def.items[1]={no:2,kind:'choice',text:'Synthetic choice',options:[{value:'a',label:'Alpha'}]};def.items[2]={no:3,kind:'multi',text:'Synthetic multi',options:[{value:'b',label:'Beta'}]};const ui=await clientHarness(f.request);const props={data,toast(){},onSave(){},onClear(){}};let tree=await ui.render('SheetEntry',props)
 for(const [label,id] of [['量表','sd-sheet-scale'],['波次','sd-sheet-wave'],['编号','sd-sheet-id']]){assert.ok(nodes(tree).some(node=>node.type==='label'&&text(node)===label&&node.props.htmlFor===id));assert.ok(nodes(tree).some(node=>node.props.id===id))}assert.equal(nodes(tree).find(node=>node.props.id==='sd-sheet-id').props.placeholder,'P-001')
 const groups=nodes(tree).filter(node=>node.props.role==='group');assert.equal(groups.length,4);for(const group of groups)assert.ok(nodes(tree).some(node=>node.props.id===group.props['aria-labelledby']))
 for(const no of [1,2,3]){tree=await ui.render('SheetEntry',props);const group=nodes(tree).find(node=>node.props['aria-labelledby']==='sd-sheet-question-'+no&&node.props.role==='group');const answer=nodes(group).find(node=>node.type==='button');assert.equal(answer.props['aria-pressed'],false);answer.props.onClick();tree=await ui.render('SheetEntry',props);const selected=nodes(nodes(tree).find(node=>node.props.role==='group'&&node.props['aria-labelledby']==='sd-sheet-question-'+no)).find(node=>node.type==='button');assert.equal(selected.props['aria-pressed'],true)}
})

test('import drop area and score rows support Enter and Space',async t=>{
 const f=await fixture(t);const data=await f.request('status');const importer=await clientHarness(f.request);const tree=await importer.render('ImportPanel',{data,toast(){}});let clicks=0,prevented=0;nodes(tree).find(node=>node.type==='input'&&node.props.type==='file').props.ref.current={click(){clicks++}};const drop=nodes(tree).find(node=>node.props.role==='button');for(const key of ['Enter',' '])drop.props.onKeyDown({key,preventDefault(){prevented++}});assert.equal(clicks,2);assert.equal(prevented,2)
 const scores=await clientHarness(f.request);const props={data,busy:false};let table=await scores.render('ScoreTab',props);let row=nodes(table).find(node=>node.type==='tr'&&node.props.tabIndex===0);assert.equal(row.props['aria-expanded'],false);row.props.onKeyDown({key:'Enter',preventDefault(){}});table=await scores.render('ScoreTab',props);row=nodes(table).find(node=>node.type==='tr'&&node.props.tabIndex===0);assert.equal(row.props['aria-expanded'],true);row.props.onKeyDown({key:' ',preventDefault(){}});table=await scores.render('ScoreTab',props);assert.equal(nodes(table).find(node=>node.type==='tr'&&node.props.tabIndex===0).props['aria-expanded'],false)
})

test('generic Q headers stay candidates until explicit target selection',async t=>{
 const f=await fixture(t);const source={text:'编号,Q1,Q2,Q3,Q4\n00123,1,2,3,4'};const preview=await f.request('importPreview',source);assert.equal(preview.requiresTarget,true);assert.ok(preview.targets.length===2);assert.ok(preview.targets.every(target=>!target.automatic));await assert.rejects(f.request('importApply',source),/明确选择/);await assert.rejects(f.request('importFile',source),/确认导入目标/)
 await f.request('importApply',{...source,scale:'ALPHA',wave:'T1',mapping:preview.mapping});const status=await f.request('status');assert.equal(status.instruments[0].data.T0.rows,0);assert.equal(status.instruments[0].data.T1.rows,1)
})

test('opaque IDs, separate roster, duplicate detail/tool/export, and missing participants agree',async t=>{
 const f=await fixture(t);let status=await f.request('status');assert.equal(status.subjectsPath.replaceAll('\\','/'),path.join(f.labDir,'subjects.csv').replaceAll('\\','/'));assert.ok(status.scores.rows.some(row=>row.id==='Roster-零'))
 for(const id of ['00123','P-014','123456','合成编号-零','12345.0',"'quoted'"]){await f.request('save',{scale:'ALPHA',wave:'T0',id,values:{2:'2',4:'4'}});assert.equal((await f.request('answer',{scale:'ALPHA',wave:'T0',id})).id,id)}
 const source={text:'编号,Q1,Q2,Q3,Q4\nP-014,1,3,3,5',scale:'ALPHA',wave:'T0'};await f.request('importApply',source);assert.equal((await f.request('detail',{id:'P-014',scale:'ALPHA',wave:'T0'})).status,'duplicate');await assert.rejects(f.request('answer',{id:'P-014',scale:'ALPHA',wave:'T0'}),/多份/);const tool=await f.tools.get('scale_score').execute({id:'P-014'});assert.match(tool.text,/duplicate.*未计分/);assert.doesNotMatch(tool.text,/Subset：/)
 await f.request('score');const detail=parseCsv(await readFile(path.join(f.labDir,'scores_detail.csv'),'utf8')).slice(1).filter(row=>row[0]==='P-014');assert.ok(detail.every(row=>row[7]===''&&row[8]==='duplicate'));const wide=parseCsv(await readFile(path.join(f.labDir,'data_wide.csv'),'utf8'));assert.equal(wide.find(row=>row[0]==='P-014')[wide[0].indexOf('ALPHA_T0')],'')
 const a=normalizeDef(rawDef('A'));const b=normalizeDef(rawDef('B'));const files=[{scale:'A',wave:'T0',rows:[{id:'00123',values:{}},{id:'P-014',values:{}}]},{scale:'B',wave:'T0',rows:[{id:'00123',values:{}}]}];const issues=validateData([a,b],files);assert.deepEqual(issues.find(item=>item.scale==='B'&&item.wave==='T0'&&item.ids).ids,['P-014']);assert.ok(!issues.some(item=>item.ids?.includes(undefined)))
})

test('dedicated multi-block codes import only confirmed T0 targets', async t=>{
 const f=await fixture(t)
 const beta=rawDef('BETA');beta.codes={T0:[1,2,3,4].map(no=>'beta_t0_'+no),T1:[1,2,3,4].map(no=>'beta_t1_'+no)}
 await writeFile(path.join(f.defsDir,'BETA.json'),JSON.stringify(beta));await f.request('refresh')
 const source={text:'编号,alpha_t0_1,alpha_t0_2,alpha_t0_3,alpha_t0_4,beta_t0_1,beta_t0_2,beta_t0_3,beta_t0_4\nP-014,1,2,3,4,4,3,2,1'}
 const preview=await f.request('importPreview',source);const targets=preview.targets.filter(target=>target.automatic);assert.deepEqual(targets.map(target=>[target.scale,target.wave]),[['ALPHA','T0'],['BETA','T0']]);await f.request('importFile',{...source,targets})
 const status=await f.request('status');for(const instrument of status.instruments){assert.equal(instrument.data.T0.rows,1);assert.equal(instrument.data.T1.rows,0)}
 // Supplying the current scoring controls is also a no-op for raw custom keys.
 const before=JSON.parse(await readFile(path.join(f.defsDir,'ALPHA.json')));await f.request('saveMeta',{scale:'ALPHA',notes:'only notes',scoringType:'sum',reverse:[4,2],minAnswered:2});const after=JSON.parse(await readFile(path.join(f.defsDir,'ALPHA.json')));assert.deepEqual(after.scoring,before.scoring)
})

test('invalid mapping positions and reused columns cannot write',async t=>{
 const f=await fixture(t);const source={text:'编号,Q1,Q2,Q3,Q4\nP-014,1,2,3,4',scale:'ALPHA',wave:'T0'};const preview=await f.request('importPreview',source)
 for(const index of [99,0,2])await assert.rejects(f.request('importApply',{...source,mapping:{...preview.mapping,items:preview.mapping.items.map(item=>item.no===1?{...item,index}:item)}}),/列/)
 assert.equal((await f.request('status')).instruments[0].data.T0.rows,0)
})
