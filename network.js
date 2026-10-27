import {isIP} from 'node:net';
const normalize=value=>String(value||'').replace(/^::ffff:/,'');
export function clientIp(req,trusted=process.env.TRUSTED_PROXY_IPS||''){
 const peer=normalize(req.socket.remoteAddress);
 const proxies=trusted.split(',').map(v=>normalize(v.trim())).filter(Boolean);
 if(!proxies.includes(peer))return peer;
 // One exact address only. The trusted edge must overwrite this header.
 const forwarded=req.headers['x-real-ip'];
 return typeof forwarded==='string'&&isIP(forwarded)?normalize(forwarded):'';
}
