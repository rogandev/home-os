import {readFileSync} from 'node:fs';
import {Server} from '@modelcontextprotocol/sdk/server/index.js';
import {ListToolsRequestSchema,CallToolRequestSchema} from '@modelcontextprotocol/sdk/types.js';
export const operations=JSON.parse(readFileSync(new URL('./operations.json',import.meta.url),'utf8'));
export const READ_SCOPE='home:read',WRITE_SCOPE='home:write';
export function createHomeServer({request,writeEnabled=false,writeAuthorized=false,challenge=''}) {
 const server=new Server({name:'home-os',version:'0.1.0'},{capabilities:{tools:{}}});
 server.setRequestHandler(ListToolsRequestSchema,async()=>({tools:operations.filter(o=>writeEnabled||o.method==='GET').map(o=>{
  const write=o.method!=='GET';const securitySchemes=[{type:'oauth2',scopes:[READ_SCOPE,...(write?[WRITE_SCOPE]:[])]}];
  return {name:o.name,description:o.description+(write?' Read current revision first. Reuse operationId and identical arguments after uncertain results; do not automatically retry.':''),inputSchema:o.inputSchema,
   annotations:{readOnlyHint:!write,destructiveHint:write,idempotentHint:true,openWorldHint:false},securitySchemes,_meta:{securitySchemes}};
 })}));
 server.setRequestHandler(CallToolRequestSchema,async({params})=>{
  const op=operations.find(o=>o.name===params.name);
  if(!op||op.method!=='GET'&&!writeEnabled) return {isError:true,content:[{type:'text',text:'Unsupported Home operation. Permanent item deletion is unavailable.'}]};
  if(op.method!=='GET'&&!writeAuthorized) return {isError:true,content:[{type:'text',text:'Dedicated Home write approval is required.'}],_meta:{'mcp/www_authenticate':[challenge]}};
  try {const result=await request(params.name,params.arguments??{},op.method!=='GET');return {content:[{type:'text',text:JSON.stringify(result)}],structuredContent:{result}};}
  catch(error){
   const status=Number.isInteger(error.status)?error.status:null;
   const message=status===409?'Conflict: read current Home state and reconcile. Keep the original operation ID only when retrying identical uncertain requests.':status===400?'Invalid arguments or Home business rule rejected the request. Read the tool schema and current state.':status===401||status===403?'Home access unavailable. Do not substitute other credentials.':'Operation failed or outcome is unknown. Retry only with the original operationId and identical arguments; never repeat a stock operation with a new ID to recover an uncertain result.';
   return {isError:true,content:[{type:'text',text:message}],structuredContent:{error:message,status,code:typeof error.code==='string'&&/^HOME_[A-Z0-9_]+$/.test(error.code)?error.code:null}};
  }
 });return server;
}
