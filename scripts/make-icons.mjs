import {readFile} from 'node:fs/promises';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE||undefined,args:['--no-sandbox']});
try{for(const size of [192,512]){const page=await browser.newPage({viewport:{width:size,height:size},deviceScaleFactor:1});const svg=await readFile(new URL('../assets/icon.svg',import.meta.url),'utf8');await page.setContent(`<style>body{margin:0}svg{width:${size}px;height:${size}px}</style>${svg}`);await page.screenshot({path:new URL(`../assets/icon-${size}.png`,import.meta.url).pathname,omitBackground:true});await page.close();}}finally{await browser.close();}
