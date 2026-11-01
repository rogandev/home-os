import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPair,SignJWT} from 'jose';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {createHomeServer,operations} from '../src/server.js';
import {createBackend} from '../src/backend.js';
import {createVerifier} from '../src/oauth.js';
async function session(t,config) {
 const server=createHomeServer(config),client=new Client({name:'synthetic-client',version:'1.0'});
 const [a,b]=InMemoryTransport.createLinkedPair();await server.connect(a);await client.connect(b);
 t.after(()=>client.close());t.after(()=>server.close());return client;
}
test('MCP discovery and write authorization',async t=>{
 let calls=0;const request=async(name,args,write)=>{calls++;return {name,args,write,revision:'a'.repeat(64)};};
 const readonly=await session(t,{request});const readTools=(await readonly.listTools()).tools;
 assert.ok(readTools.length>=10);assert.ok(readTools.every(t=>t.annotations.readOnlyHint));
 assert.equal((await readonly.callTool({name:'create_item',arguments:{}})).isError,true);assert.equal(calls,0);
 const scoped=await session(t,{request,writeEnabled:true,writeAuthorized:false,challenge:'Home-specific challenge'});
 const tools=(await scoped.listTools()).tools;assert.equal(tools.length,operations.length);assert.equal(tools.some(t=>t.name==='delete_item'),false);
 const denial=await scoped.callTool({name:'receive_order',arguments:{}});assert.equal(denial.isError,true);assert.equal(calls,0);assert.ok(denial._meta['mcp/www_authenticate']);
 const writer=await session(t,{request,writeEnabled:true,writeAuthorized:true});
 assert.equal((await writer.callTool({name:'get_item',arguments:{id:'1'}})).structuredContent.result.name,'get_item');
 assert.equal((await writer.callTool({name:'delete_item',arguments:{id:'1'}})).isError,true);
});
test('backend pins endpoint, separates credentials, forbids redirects and never retries',async()=>{
 const calls=[];const fetchImpl=async(url,opts)=>{calls.push({url:String(url),opts});return new Response(JSON.stringify({revision:'a'.repeat(64),data:[]}));};
 const backend=createBackend({origin:'https://synthetic.invalid',readerToken:'r'.repeat(40),writerToken:'w'.repeat(40),fetchImpl});
 await backend('list_items',{},false);await backend('create_item',{},true);
 assert.equal(calls[0].url,'https://synthetic.invalid/connector/home/execute');assert.equal(calls[0].opts.redirect,'error');
 assert.equal(calls[0].opts.headers.Authorization,'Bearer '+'r'.repeat(40));assert.equal(calls[1].opts.headers.Authorization,'Bearer '+'w'.repeat(40));
 let attempts=0;const failing=createBackend({origin:'https://synthetic.invalid',readerToken:'r'.repeat(40),fetchImpl:async()=>{attempts++;throw new Error('SECRET');}});
 await assert.rejects(failing('list_items',{},false));assert.equal(attempts,1);
 assert.throws(()=>createBackend({origin:'http://synthetic.invalid',readerToken:'r'.repeat(40)}));
 assert.throws(()=>createBackend({origin:'https://synthetic.invalid',readerToken:'r'.repeat(40),writerToken:'r'.repeat(40)}));
});
test('OAuth verifies exact Home audience, issuer, subject, expiry and scope',async()=>{
 const {privateKey,publicKey}=await generateKeyPair('RS256');
 const config={issuerUrl:'https://issuer.invalid/',resourceUrl:'https://home-mcp.invalid/mcp',jwksUrl:'https://issuer.invalid/jwks',allowedSubject:'synthetic-owner'};
 const verify=createVerifier(config,publicKey);
 const token=async(changes={})=>new SignJWT({sub:'synthetic-owner',scope:'home:read',aud:config.resourceUrl,iss:config.issuerUrl,iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+60,...changes}).setProtectedHeader({alg:'RS256'}).sign(privateKey);
 assert.deepEqual((await verify(await token())).scopes,['home:read']);
 for(const change of [{sub:'other'},{aud:'https://flowboard.invalid/mcp'},{iss:'https://other.invalid/'},{scope:'flowboard:read'},{exp:1}])await assert.rejects(verify(await token(change)));
});
test('tool errors redact upstream secrets',async t=>{
 const client=await session(t,{request:async()=>{throw Object.assign(new Error('SECRET'),{status:500,code:'SECRET'});}});
 const result=await client.callTool({name:'list_items',arguments:{}});assert.equal(result.isError,true);assert.equal(JSON.stringify(result).includes('SECRET'),false);
});
