import {mkdir,readFile,writeFile,rename,rm} from 'node:fs/promises'
import path from 'node:path'
import {createHash,randomUUID} from 'node:crypto'
export const hash = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex')
export async function atomic(file,text){await mkdir(path.dirname(file),{recursive:true});const temp=`${file}.${randomUUID()}.tmp`;try{await writeFile(temp,text,'utf8');await rename(temp,file)}finally{await rm(temp,{force:true}).catch(()=>{})}}
export async function definitionSnapshot(cfg,raw){const text=JSON.stringify(raw);const revision=hash(text);const file=path.join(cfg.scalesDir,'definition-history',`${revision}.json`);const existing=await readFile(file,'utf8').catch(error=>{if(error.code==='ENOENT')return null;throw error});if(existing!==null){if(hash(JSON.stringify(JSON.parse(existing)))!==revision)throw Error('定义历史hash不符，拒绝覆盖');return revision}await atomic(file,JSON.stringify(raw,null,2)+'\n');return revision}
export async function publishGeneration(cfg,files,metadata){
 const generation=`${Date.now()}-${randomUUID()}`;const dir=path.join(cfg.labDir,'score-generations',generation);await mkdir(dir,{recursive:true})
 for(const [name,text] of Object.entries(files))await atomic(path.join(dir,name),text)
 const manifest={schemaVersion:1,generation,createdAt:new Date().toISOString(),...metadata,files:Object.fromEntries(Object.entries(files).map(([name,text])=>[name,{path:path.join(dir,name),hash:hash(text)}]))}
 await atomic(path.join(dir,'manifest.json'),JSON.stringify(manifest,null,2)+'\n')
 const targets={'scores.csv':cfg.scoresPath,'scores_detail.csv':cfg.detailPath,'data_wide.csv':cfg.widePath};const previous=new Map();const changed=[]
 try{
  for(const [name,file]of Object.entries(targets)){previous.set(file,await readFile(file).catch(error=>{if(error.code==='ENOENT')return null;throw error}));await atomic(file,files[name]);changed.push(file)}
  await atomic(path.join(cfg.labDir,'scores-manifest.json'),JSON.stringify(manifest,null,2)+'\n')
 }catch(error){for(const file of changed.reverse()){const old=previous.get(file);if(old===null)await rm(file,{force:true});else await atomic(file,old)}throw error}
 return manifest
}
