import {readFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=dirname(fileURLToPath(import.meta.resolve('pdfjs-dist/package.json')));
export function pdfAsset(path,res){
 if(!path.startsWith('/vendor/pdfjs/'))return false;
 const asset=path.slice('/vendor/pdfjs/'.length);
 let file,type;
 if(['pdf.mjs','pdf.worker.mjs'].includes(asset)){file='build/'+asset;type='text/javascript; charset=utf-8';}
 else if(/^(cmaps\/[A-Za-z0-9_-]+\.bcmap|standard_fonts\/[A-Za-z0-9_.-]+\.(ttf|pfb)|wasm\/[A-Za-z0-9_.-]+\.(wasm|js))$/.test(asset)){file=asset;type=asset.endsWith('.wasm')?'application/wasm':asset.endsWith('.js')?'text/javascript; charset=utf-8':'application/octet-stream';}
 if(!file){res.writeHead(404);res.end();return true;}
 try{const buffer=readFileSync(join(root,file));res.writeHead(200,{'Content-Type':type,'Cache-Control':'no-cache'});res.end(buffer);}catch(error){if(error.code!=='ENOENT')throw error;res.writeHead(404);res.end();}
 return true;
}
