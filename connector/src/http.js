import {createServer} from 'node:http';
import {StreamableHTTPServerTransport} from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {createHomeServer,READ_SCOPE,WRITE_SCOPE} from './server.js';
const json=(res,status,body,headers={})=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store',...headers});res.end(JSON.stringify(body));};
export function createHttpServer({request,verifyToken,resourceUrl,issuerUrl,allowedSubject,writeEnabled=false}) {
 const resource=new URL(resourceUrl),issuer=new URL(issuerUrl);
 for(const u of [resource,issuer]) if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash) throw new Error('HTTPS metadata required');
 if(resource.pathname!=='/mcp'||!allowedSubject||typeof verifyToken!=='function'||typeof request!=='function'||typeof writeEnabled!=='boolean') throw new Error('Explicit Home configuration required');
 const metadata='/.well-known/oauth-protected-resource/mcp';
 const challenge=`Bearer resource_metadata="${resource.origin}${metadata}", scope="${READ_SCOPE}"`;
 let active=0;
 const server=createServer(async(req,res)=>{
  if(active>=16) return json(res,429,{error:'Busy; retry later'});
  active++;let completed=false;const release=()=>{if(!completed){completed=true;active--;}};res.once('close',release);
  try {
   if(req.url==='/health'&&req.method==='GET')return json(res,200,{status:'ok',writeEnabled});
   if(req.url===metadata&&req.method==='GET')return json(res,200,{resource:resource.href,authorization_servers:[issuer.href],scopes_supported:[READ_SCOPE,...(writeEnabled?[WRITE_SCOPE]:[])],bearer_methods_supported:['header']});
   if(req.url!=='/mcp')return json(res,404,{error:'Not found'});
   if(req.headers.origin&&req.headers.origin!==resource.origin)return json(res,403,{error:'Origin rejected'});
   const token=/^Bearer ([^\s,]+)$/.exec(req.headers.authorization??'')?.[1];
   let principal;try{if(token)principal=await verifyToken(token);}catch{}
   if(!principal||principal.subject!==allowedSubject||!principal.scopes?.includes(READ_SCOPE))return json(res,401,{error:'Home authentication required'},{'WWW-Authenticate':challenge});
   if(req.method!=='POST')return json(res,405,{error:'Use POST'},{Allow:'POST'});
   if(!(req.headers['content-type']??'').toLowerCase().startsWith('application/json'))return json(res,415,{error:'JSON required'});
   const chunks=[];let bytes=0;for await(const chunk of req){bytes+=chunk.length;if(bytes>65536)return json(res,413,{error:'Request too large'});chunks.push(chunk);}
   let body;try{body=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{return json(res,400,{error:'Invalid JSON'});}
   const mcp=createHomeServer({request,writeEnabled,writeAuthorized:principal.scopes.includes(WRITE_SCOPE),challenge:`Bearer resource_metadata="${resource.origin}${metadata}", error="insufficient_scope", scope="${READ_SCOPE} ${WRITE_SCOPE}"`});
   const transport=new StreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true});
   res.once('close',()=>{void mcp.close().catch(()=>{});});await mcp.connect(transport);await transport.handleRequest(req,res,body);
  }catch{if(!res.headersSent)json(res,500,{error:'Home MCP request failed'});else res.end();}
 });
 server.requestTimeout=30000;server.headersTimeout=10000;server.setTimeout(30000);return server;
}
