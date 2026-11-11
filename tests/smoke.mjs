import assert from 'node:assert/strict'
import {mkdtemp,readFile,rm,stat,writeFile} from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import {apply} from '../index.js'
import {makeHost,makePage,syntheticStudy} from './support/host.mjs'

// 09/T01：06 之后写请求需要页面身份 + 研究绑定令牌，旧 smoke 只给 {projectRoot,labDir}
// 会被当成 probe 身份。这里改用临时合成研究 + 真实 Host 路由 + studyConnect 令牌。
const researchStore=await mkdtemp(path.join(os.tmpdir(),'scale-host-store-'))
process.env.DSH_RESEARCH_STORE=researchStore
const root=await mkdtemp(path.join(os.tmpdir(),'scale-host-'))
const labDir=path.join(root,'data')
const studyPath=path.join(root,'study.json')
await writeFile(studyPath,JSON.stringify(syntheticStudy({
  studyId:'scale-smoke',
  name:'量表冒烟合成研究',
  dataRoot:'./data',
  participantId:{pattern:'^P-\\d{3}$'},
  visits:[{id:'baseline',label:'基线',order:0},{id:'followup',label:'随访',order:1}],
  tasks:[{id:'garden-baseline',label:'花园基线',visits:['baseline'],required:true,source:{type:'scale',scaleId:'GARDEN',waveId:'baseline'}}],
}),null,2)+'\n')
const host=makeHost(root)
apply(host.ctx,{projectRoot:root})
const handler=host.routes.get('/api/scale-desk')
assert.ok(handler,'scale-desk 应注册路由')
const page=makePage(handler,{workspacePath:root})
await page.connect(studyPath)
const request=page.request
const tools=host.tools
try{
 assert.equal((await request('status')).instruments.length,0);await assert.rejects(stat(labDir));await request('initialize',{sample:true});assert.equal((await request('status')).instruments.length,1)
 const source={text:'participantId,garden_b_1,garden_b_2,garden_b_3,garden_b_4\nP-001,4,2,4,4'};const preview=await request('importPreview',source);assert.equal(preview.scale,'GARDEN');await request('importFile',{...source,targets:preview.targets.filter(target=>target.automatic)});assert.equal((await request('detail',{scale:'GARDEN',wave:'baseline',id:'P-001'})).subs[0].score,4)
 await request('save',{scale:'GARDEN',wave:'followup',id:'P-001',values:{1:'5',2:'1',3:'5',4:'5'}});const exported=await request('export');assert.ok((await readFile(exported.wide,'utf8')).includes('P-001'));const manifest=JSON.parse(await readFile(path.join(labDir,'scores-manifest.json')));assert.ok(manifest.files['scores.csv']); // 07 之后 scale_score 走严格本地投影：只回状态/计数，不再回量表名/逐人内容；
 // 原断言 /虚构花园/ 是投影前的契约，这里验证同一事实（P-001 两条记录可读）。
 assert.match((await tools.get('scale_score').execute({id:'P-001'})).text,/状态 ok/);assert.match((await tools.get('scale_score').execute({id:'P-001'})).text,/records 2/);assert.match((await tools.get('scale_validate').execute({})).text,/校验/);await request('clear',{scale:'GARDEN',wave:'followup',id:'P-001'});await request('clear',{scale:'GARDEN',wave:'baseline',id:'P-001'});await request('deleteScale',{scale:'GARDEN'});assert.equal((await request('status')).instruments.length,0)
 console.log('synthetic Host smoke ok: pure empty → explicit sample → confirmed import → entry → generation/export → tools → delete stays empty')
}finally{await rm(root,{recursive:true,force:true});await rm(researchStore,{recursive:true,force:true})}
