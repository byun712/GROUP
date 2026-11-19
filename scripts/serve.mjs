import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {dirname,resolve,extname,sep} from 'node:path';
const appRoot=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.webmanifest':'application/manifest+json'};
export function createTodoServer({root=appRoot,mode='development'}={}){
  const directory=resolve(root);
  return http.createServer(async(req,res)=>{
    if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);res.end();return;}
    let path;try{path=decodeURIComponent(new URL(req.url,'http://localhost').pathname);}catch{res.writeHead(400);res.end();return;}
    if(path==='/'||path==='/todo'){res.writeHead(302,{Location:'/todo/'});res.end();return;}
    const relative=path==='/todo/'?'index.html':path.replace(/^\/todo\//,'');
    if(!path.startsWith('/todo/')||!(/^(index\.html|styles\.css|manifest\.webmanifest|config\.js|sw\.js)$/.test(relative)||/^(assets|src)\//.test(relative))||relative.split('/').includes('..')){res.writeHead(404);res.end('Not found');return;}
    if(mode==='development'&&relative==='sw.js'){res.writeHead(404);res.end('Service worker is disabled in development.');return;}
    const file=resolve(directory,relative);if(!file.startsWith(directory+sep)){res.writeHead(404);res.end();return;}
    try{
      const content=await readFile(file);res.writeHead(200,{'Content-Type':mime[extname(file)]||'application/octet-stream','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; worker-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",...(relative==='sw.js'?{'Service-Worker-Allowed':'/todo/'}:{})});res.end(req.method==='HEAD'?undefined:content);
    }catch{res.writeHead(404);res.end('Not found');}
  });
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const preview=process.argv.includes('--preview'),mode=preview?'production':'development',port=Number(process.env.PORT|| (preview?4174:5174)),host=process.env.HOST||'127.0.0.1';
  const server=createTodoServer({root:preview?resolve(appRoot,'dist'):appRoot,mode});
  server.on('error',error=>{console.error(error.message);process.exitCode=1;});server.listen(port,host,()=>console.log(`모아 ToDo · ${mode} · http://${host}:${port}/todo/`));
}
