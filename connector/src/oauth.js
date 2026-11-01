import {createRemoteJWKSet,jwtVerify} from 'jose';
import {READ_SCOPE} from './server.js';
export function createVerifier({issuerUrl,resourceUrl,jwksUrl,allowedSubject},keyResolver) {
 const issuer=new URL(issuerUrl),resource=new URL(resourceUrl),jwks=new URL(jwksUrl);
 for(const u of [issuer,resource,jwks]) if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash) throw new Error('Pinned HTTPS OAuth metadata required');
 if(jwks.origin!==issuer.origin||!allowedSubject||resource.pathname!=='/mcp') throw new Error('Explicit Home audience, issuer JWKS and owner required');
 const keys=keyResolver??createRemoteJWKSet(jwks,{timeoutDuration:5000,cooldownDuration:30000});
 return async token=>{
  const {payload}=await jwtVerify(token,keys,{issuer:issuer.href,audience:resource.href,algorithms:['RS256'],requiredClaims:['sub','exp','iat'],maxTokenAge:'15m',clockTolerance:5});
  const scopes=typeof payload.scope==='string'?payload.scope.split(' '):[];
  if(payload.sub!==allowedSubject||!scopes.includes(READ_SCOPE)) throw new Error('Dedicated Home owner grant required');
  return {subject:payload.sub,scopes};
 };
}
