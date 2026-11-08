import assert from 'node:assert/strict'
import {mkdtemp,readFile,rm,stat} from 'node:fs/promises'
import {Readable} from 'node:stream'
import path from 'node:path'
import os from 'node:os'
import {apply} from '../index.js'
const root=await mkdtemp(path.join(os.tmpdir(),'scale-host-'));const labDir=path.join(root,'data');const tools=new Map();let handler
apply({get:key=>key==='webServer'?{register:spec=>handler=spec.handler}:key==='tools'?{register:tool=>tools.set(tool.name,tool)}:undefined,effect:fn=>fn()},{projectRoot:root,labDir})
let activeContextRevision,activeSelectionRevision;let activeStudyId
async function request(action,payload={}){if(!activeStudyId && !payload.__identity){const initial=await request('status',{__identity:true});activeStudyId=initial.study.id;activeContextRevision=initial.contextRevision;activeSelectionRevision=initial.selectionRevision}const req=Object.assign(Readable.from([Buffer.from(JSON.stringify({action,payload:{studyId:activeStudyId,contextRevision:activeContextRevision,selectionRevision:activeSelectionRevision,...payload}}))]),{method:'POST',url:'/api/scale-desk',headers:{'x-scale-desk':'1'}});let body;const res={setHeader(){},end:s=>body=s};await handler(req,res);const result=JSON.parse(body);if(!result.ok)throw Error(result.error.message);if(result.data.study)activeStudyId=result.data.study.id;if(result.data.contextRevision)activeContextRevision=result.data.contextRevision;if(Number.isInteger(result.data.selectionRevision))activeSelectionRevision=result.data.selectionRevision;return result.data}
try{
 assert.equal((await request('status')).instruments.length,0);await assert.rejects(stat(labDir));await request('initialize',{sample:true});assert.equal((await request('status')).instruments.length,1)
 const source={text:'participantId,garden_b_1,garden_b_2,garden_b_3,garden_b_4\nP-001,4,2,4,4'};const preview=await request('importPreview',source);assert.equal(preview.scale,'GARDEN');await request('importFile',{...source,targets:preview.targets.filter(target=>target.automatic)});assert.equal((await request('detail',{scale:'GARDEN',wave:'baseline',id:'P-001'})).subs[0].score,4)
 await request('save',{scale:'GARDEN',wave:'followup',id:'P-001',values:{1:'5',2:'1',3:'5',4:'5'}});const exported=await request('export');assert.ok((await readFile(exported.wide,'utf8')).includes('P-001'));const manifest=JSON.parse(await readFile(path.join(labDir,'scores-manifest.json')));assert.ok(manifest.files['scores.csv']);assert.match((await tools.get('scale_score').execute({id:'P-001'})).text,/虚构花园/);assert.match((await tools.get('scale_validate').execute({})).text,/校验/);await request('clear',{scale:'GARDEN',wave:'followup',id:'P-001'});await request('clear',{scale:'GARDEN',wave:'baseline',id:'P-001'});await request('deleteScale',{scale:'GARDEN'});assert.equal((await request('status')).instruments.length,0)
 console.log('synthetic Host smoke ok: pure empty → explicit sample → confirmed import → entry → generation/export → tools → delete stays empty')
}finally{await rm(root,{recursive:true,force:true})}
