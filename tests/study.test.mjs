import test,{after} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,readFile,writeFile,readdir,rm,stat} from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import {apply} from '../index.js'
import {hash,publishGeneration} from '../persistence.mjs'
import {researchCore} from '@local/research-core'
import {makeHost,makePage,syntheticStudy} from './support/host.mjs'
const study=id=>({schemaVersion:1,studyId:id,name:'Synthetic '+id,dataRoot:'./'+id,participantId:{pattern:'P-[0-9]+'},visits:[{id:'baseline',label:'First',order:0}],tasks:[{id:'form',visits:['baseline']}],followups:[],plugins:{scales:{}}})

// 06 之后绑定记录写在研究核心的 store 里；旧夹具复用了进程级默认 store，
// 上一次运行留下的 "probe/page → 已删除临时研究" 记录会让写请求直接报 study_missing。
// 每个测试文件用独立临时 store（research-core/tests 的同款做法），不写真实研究数据。
const researchStore=await mkdtemp(path.join(os.tmpdir(),'scale-study-store-'))
process.env.DSH_RESEARCH_STORE=researchStore
after(()=>rm(researchStore,{recursive:true,force:true}))

async function fixture(t,config={}){
  const root=await mkdtemp(path.join(os.tmpdir(),'scale-study-'))
  t.after(()=>rm(root,{recursive:true,force:true}))
  const host=makeHost(root)
  // 用真实宿主路由 + 合成研究定义：页面身份由 pageId 提供，写请求带 studyConnect 得到的令牌。
  apply(host.ctx,{projectRoot:root})
  const handler=host.routes.get('/api/scale-desk');assert.ok(handler,'scale-desk 应注册路由')
  const page=makePage(handler,{workspacePath:root})
  if(config.connect!==false){
    // 默认研究写到 base.json（不是 study.json），dataRoot 保持 ./default，
    // 这样各用例原来的 root/default/scales 路径断言不变。
    const file=path.join(root,'base.json')
    await writeFile(file,JSON.stringify({...study('base'),dataRoot:'./default'},null,2)+'\n')
    await page.connect(file)
  }
  return {root,page,request:page.request,tools:host.tools}
}

test('context epochs reject an old A page after A-B-A and coordinated failure restores saved JSON',async t=>{
  const f=await fixture(t)
  const a=path.join(f.root,'a.json'),b=path.join(f.root,'b.json')
  await f.request('studySave',{path:a,definition:study('a')})
  const old=await f.request('status') // 旧的 A 页面令牌
  await f.request('studySave',{path:b,definition:study('b')})
  await f.request('studyConnect',{path:a})
  // 06 之后页面身份是 pageId + binding token：A-B-A 后旧 A 令牌必须被拒绝，
  // 原断言意图（旧页面不能继续写）不变，只是把 contextRevision 换成当前契约的令牌。
  await assert.rejects(f.request('initialize',{sample:true},{binding:old.binding.token}),/版本|切换|绑定|重新加载/)
  const before=await readFile(a,'utf8')
  // 旧版用 researchSelection 的 peer busy 制造"定义已写入但连接失败"；06 之后连接失败
  // 来自核心的绑定持久化，所以把 store 指到一个文件让持久化必然失败，验证插件仍回滚定义。
  const core=researchCore()
  const storeDir=path.dirname(core.storeFile('bindings'))
  const blocked=path.join(f.root,'blocked-store')
  await writeFile(blocked,'not a directory')
  core.configure({storeDir:blocked})
  try{
    await assert.rejects(f.request('studySave',{path:a,definition:{...study('a'),name:'Changed'},expectedRevision:hash(before)}),/EEXIST|ENOTDIR|exists|目录/i)
  }finally{core.configure({storeDir})}
  assert.equal(await readFile(a,'utf8'),before)
})

test('strict raw scalar errors and semantic errors are blocked before formal scoring',async t=>{
 const f=await fixture(t);await f.request('initialize',{sample:true});const file=path.join(f.root,'default','scales','defs','GARDEN.json');const original=JSON.parse(await readFile(file));for(const mutate of [r=>r.items[0].reverse='false',r=>r.scoring.subscales.experience.items=[],r=>r.response.min='oops',r=>r.missing.rule='strcit',r=>r.missing.minProportion='0.8',r=>r.scoring.subscales.experience.multiplier='Infinity',r=>r.items[0]={...r.items[0],kind:'choice',options:[]}]){const raw=structuredClone(original);mutate(raw);await writeFile(file,JSON.stringify(raw));const status=await f.request('refresh');assert.equal(status.instruments.length,0);assert.equal(status.scores.columns.length,0);assert.ok(status.issues.some(issue=>issue.level==='bad'))}
})

test('a late invalid import target writes no earlier target and no import log',async t=>{
 const f=await fixture(t);const file=path.join(f.root,'study.json');await f.request('studySave',{path:file,definition:study('test')});await f.request('initialize',{sample:true});const dir=path.join(f.root,'test','scales');const raw=JSON.parse(await readFile(path.join(dir,'defs','GARDEN.json')));raw.id='SECOND';raw.name='Second';raw.short='Second';raw.codes.baseline=['second_1','second_2','second_3','second_4'];await writeFile(path.join(dir,'defs','SECOND.json'),JSON.stringify(raw));await f.request('refresh');const source={text:'participantId,invalidId,garden_b_1,garden_b_2,garden_b_3,garden_b_4,second_1,second_2,second_3,second_4\nP-1,BAD,1,2,3,4,4,3,2,1'};const preview=await f.request('importPreview',source);const targets=preview.targets.filter(target=>target.automatic&&target.wave==='baseline').map(target=>target.scale==='SECOND'?{...target,wave:'missing-wave'}:target);assert.equal(targets.length,2);
 // 当前 resolveImport 在编号列整列不合格时会自动换一列重试，所以“编号 pattern 不合格”
 // 已经不能在“第二个目标”上稳定触发（第一个目标里总有合法编号列）。保留本用例意图——
 // 后段目标校验失败时不写前一个目标、也不写导入日志——改用同样在写入前抛出的未知波次。
 await assert.rejects(f.request('importFile',{...source,targets}),/波次/);assert.deepEqual(await readdir(path.join(dir,'answers')),[]);await assert.rejects(stat(path.join(dir,'imports.json')))
})
test('overlapping A status and B connect cannot publish A model into B',async t=>{
 const f=await fixture(t);const a=path.join(f.root,'a.json'),b=path.join(f.root,'b.json');await f.request('studySave',{path:a,definition:study('a')});await f.request('initialize',{sample:true});await f.request('save',{scale:'GARDEN',wave:'baseline',id:'P-1',values:{1:'2'}});await writeFile(b,JSON.stringify(study('b')))
 const results=await Promise.allSettled([f.request('refresh'),f.request('studyConnect',{path:b})]);if(results[1].status==='rejected')await f.request('studyConnect',{path:b});const next=await f.request('status');assert.equal(next.study.id,'b');assert.equal(next.instruments.length,0);await f.request('initialize',{sample:true});await f.request('save',{scale:'GARDEN',wave:'baseline',id:'P-2',values:{1:'3'}});assert.deepEqual((await f.request('status')).scores.rows.map(row=>row.id),['P-2']);assert.ok((await readFile(path.join(f.root,'a','scales','answers','GARDEN__baseline.csv'),'utf8')).includes('P-1'))
})

test('empty status, tools and validation perform no writes',async t=>{const f=await fixture(t,{connect:false});const before=await readdir(f.root);await f.request('status');await f.request('refresh');await f.request('validate');for(const name of ['scale_list','scale_flow','scale_score','scale_validate'])await f.tools.get(name).execute({});assert.deepEqual(await readdir(f.root),before)})
test('study preview/save/connect isolates paths, pattern and identity',async t=>{const f=await fixture(t);const a=path.join(f.root,'a.json');const b=path.join(f.root,'b.json');assert.equal((await f.request('studyPreview',{definition:study('a'),path:a})).valid,true);await assert.rejects(stat(a));await f.request('studySave',{definition:study('a'),path:a});let status=await f.request('status');assert.equal(status.study.id,'a');assert.equal(status.labDir,path.join(f.root,'a'));await f.request('initialize',{sample:true});await assert.rejects(f.request('save',{scale:'GARDEN',wave:'baseline',id:'BAD',values:{1:'1'}}),/pattern/);await f.request('save',{scale:'GARDEN',wave:'baseline',id:'P-1',values:{1:'1'}});await f.request('studySave',{definition:study('b'),path:b});status=await f.request('status');assert.equal(status.instruments.length,0);await f.request('studyConnect',{path:a});assert.equal((await f.request('status')).scores.rows[0].id,'P-1');await assert.rejects(f.request('studySave',{definition:study('a'),path:a}),/已存在|更改/)})
test('concurrent saves keep both subjects and stale revisions conflict',async t=>{const f=await fixture(t);await f.request('initialize',{sample:true});const revision=(await f.request('status')).revision;await Promise.all(['P-1','P-2'].map(id=>f.request('save',{scale:'GARDEN',wave:'baseline',id,values:{1:'2'}})));assert.equal((await f.request('status')).scores.rows.length,2);await assert.rejects(f.request('save',{scale:'GARDEN',wave:'baseline',id:'P-3',values:{1:'3'},expectedRevision:revision}),/更改/);assert.equal((await f.request('status')).scores.rows.length,2)})
test('per-row definition hashes survive changes and old history remains reconstructible',async t=>{const f=await fixture(t);await f.request('initialize',{sample:true});await f.request('save',{scale:'GARDEN',wave:'baseline',id:'P-1',values:{1:'2',2:'2',3:'2',4:'2'}});const dir=path.join(f.root,'default','scales');const before=await readFile(path.join(dir,'answers','GARDEN__baseline.csv'),'utf8');const firstHash=before.split('\r\n')[1].split(',')[1];assert.equal(firstHash.length,64);await f.request('saveMeta',{scale:'GARDEN',reverse:[1],version:'same-display'});await f.request('save',{scale:'GARDEN',wave:'baseline',id:'P-2',values:{1:'2'}});const after=await readFile(path.join(dir,'answers','GARDEN__baseline.csv'),'utf8');assert.ok(after.includes(firstHash));assert.equal(hash(JSON.stringify(JSON.parse(await readFile(path.join(dir,'definition-history',firstHash+'.json'))))),firstHash);assert.ok((await f.request('validate')).issues.some(item=>item.id==='P-1'&&/旧定义/.test(item.text)));const manifest=JSON.parse(await readFile(path.join(f.root,'default','scores-manifest.json')));for(const file of Object.values(manifest.files))assert.equal(hash(await readFile(file.path,'utf8')),file.hash)})
test('legacy CSV remains unchanged on read and invalid raw definitions do not score',async t=>{const f=await fixture(t);await f.request('initialize',{sample:true});const dir=path.join(f.root,'default','scales');const file=path.join(dir,'answers','GARDEN__baseline.csv');await writeFile(file,'编号,q01,q02,q03,q04\nP-1,1,2,3,4\n');const before=await readFile(file);const result=await f.request('refresh');assert.ok(result.issues.some(item=>/没有definitionHash/.test(item.text)));assert.deepEqual(await readFile(file),before);const defPath=path.join(dir,'defs','GARDEN.json');const raw=JSON.parse(await readFile(defPath));raw.items.push({...raw.items[0]});await writeFile(defPath,JSON.stringify(raw));const invalid=await f.request('refresh');assert.equal(invalid.instruments.length,0);assert.ok(invalid.issues.some(item=>/重复/.test(item.text)))})
test('saveWaves adds a new wave without rewriting existing irregular codes',async t=>{const f=await fixture(t);await f.request('initialize',{sample:true});const file=path.join(f.root,'default','scales','defs','GARDEN.json');const raw=JSON.parse(await readFile(file));raw.codes.baseline=['first','repeat','repeat','last'];await writeFile(file,JSON.stringify(raw));await f.request('refresh');await f.request('saveWaves',{scale:'GARDEN',waves:[{name:'baseline',prefix:'ignored_'},{name:'followup',prefix:'ignored_'},{name:'later',prefix:'later_'}]});assert.deepEqual(JSON.parse(await readFile(file)).codes.baseline,raw.codes.baseline)})
