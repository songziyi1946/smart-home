import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { readKeyFile, writeProtected } from './infrastructure/encryption.mjs';
import { createBackup, migrateDatabase, restoreBackup } from './infrastructure/backups.mjs';

export function main(args=process.argv.slice(2)) {
  const {positionals,values}=parseArgs({args,allowPositionals:true,options:{'data-dir':{type:'string'},'key-file':{type:'string'},file:{type:'string'}}});
  const [command]=positionals;
  if(positionals.length!==1 || !values['key-file'])throw Error('用法: maintenance.mjs keygen|migrate|backup|restore --key-file PATH [--data-dir PATH --file PATH]');
  const keyPath=resolve(values['key-file']);
  if(command==='keygen'){writeProtected(keyPath,randomBytes(32).toString('hex')+'\n');return;}
  if(!['migrate','backup','restore'].includes(command)||!values['data-dir']||!values.file)throw Error('需指定 migrate/backup/restore、--data-dir 和 --file');
  const directory=resolve(values['data-dir']),key=readKeyFile(keyPath,directory),file=resolve(values.file);
  if(command==='migrate')migrateDatabase(directory,file,key);
  if(command==='backup')createBackup(directory,file,key);
  if(command==='restore')restoreBackup(file,directory,key);
}
if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  try{main();console.log('数据维护完成');}
  catch{console.error('数据维护失败；请检查停服状态、独立密钥、文件权限与备份完整性。未自动覆盖恢复目标。');process.exitCode=1;}
}
