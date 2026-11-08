import {readdir,readFile,rm} from 'node:fs/promises'
import path from 'node:path'
import {randomUUID} from 'node:crypto'
import {atomic} from './persistence.mjs'
const json=async(file,fallback)=>{try{return JSON.parse(await readFile(file,'utf8'))}catch(error){if(error.code==='ENOENT')return fallback;throw error}}
export const transactionPath=cfg=>path.join(cfg.scalesDir,'pending-transaction.json')
async function capture(file){try{return{file,exists:true,text:await readFile(file,'utf8')}}catch(error){if(error.code==='ENOENT')return{file,exists:false};throw error}}
export async function beginMutation(cfg,action){
 const files=[]
 for(const dir of [cfg.answersDir,cfg.defsDir])for(const name of await readdir(dir).catch(error=>{if(error.code==='ENOENT')return[];throw error}))if(/\.(csv|json)$/.test(name))files.push(await capture(path.join(dir,name)))
 for(const file of [cfg.importsPath,cfg.flowPath,cfg.scoresPath,cfg.detailPath,cfg.widePath,path.join(cfg.labDir,'scores-manifest.json')])files.push(await capture(file))
 const journal={schemaVersion:1,id:randomUUID(),studyId:cfg.study.id,action,status:'pending',at:new Date().toISOString(),directories:[cfg.answersDir,cfg.defsDir],files}
 await atomic(transactionPath(cfg),JSON.stringify(journal,null,2)+'\n');return journal
}
export async function mutationState(cfg){const journal=await json(transactionPath(cfg),null);return journal?{id:journal.id,action:journal.action,status:journal.status,at:journal.at,error:journal.error}:null}
export async function rollbackMutation(cfg,journal){
 const known=new Set(journal.files.map(item=>item.file))
 for(const dir of journal.directories)for(const name of await readdir(dir).catch(error=>{if(error.code==='ENOENT')return[];throw error})){const file=path.join(dir,name);if(/\.(csv|json)$/.test(name)&&!known.has(file))await rm(file,{force:true})}
 for(const entry of journal.files){if(entry.exists)await atomic(entry.file,entry.text);else await rm(entry.file,{force:true})}
 await rm(transactionPath(cfg),{force:true})
}
export async function finishMutation(cfg){await rm(transactionPath(cfg),{force:true})}
export async function failMutation(cfg,journal,error){journal.status='recovery-required';journal.error=error.message;await atomic(transactionPath(cfg),JSON.stringify(journal,null,2)+'\n')}
export async function recoverMutation(cfg){const journal=await json(transactionPath(cfg),null);if(!journal)return{recovered:false};if(journal.studyId!==cfg.study.id)throw Error('待恢复事务属于其他研究');await rollbackMutation(cfg,journal);return{recovered:true,id:journal.id}}
