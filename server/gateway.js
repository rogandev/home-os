import express from 'express';
import { createHash } from 'node:crypto';
import { auth } from 'express-openid-connect';
import { createRemoteJWKSet, jwtVerify } from 'jose';

const UPSTREAM = 'https://flowboard-api-production-321b.up.railway.app';
const PREFIX = '/api/data';
const MAX_BODY = 20 * 1024 * 1024;

// No request header or query parameter can select an upstream or grant.
export function resolveRoute(rawUrl, method, routes) {
  const boundary = rawUrl.indexOf('?');
  const path = boundary < 0 ? rawUrl : rawUrl.slice(0, boundary);
  const query = boundary < 0 ? '' : rawUrl.slice(boundary + 1);
  if (!path.startsWith(PREFIX + '/') || /[%\\\x00-\x20#]/.test(path) || path.includes('//')) return null;
  const target = path.slice(PREFIX.length);
  if (target.split('/').some(s => s === '.' || s === '..')) return null;
  const match = routes.some(([pattern, methods]) => methods.includes(method) &&
    new RegExp('^' + pattern.replace(/\{[^}]+\}/g, '[A-Za-z0-9_-]+') + '$').test(target));
  return match ? UPSTREAM + target + (query ? '?' + query : '') : null;
}

export function readConfig(env, origin) {
  if (env.VERCEL_ENV && env.VERCEL_ENV !== 'production') return null;
  const required = ['AUTH_ISSUER_URL','AUTH_CLIENT_ID','AUTH_CLIENT_SECRET','AUTH_SESSION_SECRET','AUTH_ALLOWED_SUBJECT','ROGAN_API_TOKEN'];
  if (required.some(k => !env[k] || env[k] !== env[k].trim()) || env.AUTH_SESSION_SECRET.length < 43) return null;
  // Explicit origins only: preview deployments cannot inherit production credentials.
  if (env.AUTH_BASE_URL !== origin) return null;
  let issuer;
  try { issuer = new URL(env.AUTH_ISSUER_URL); } catch { return null; }
  if (issuer.protocol !== 'https:' || issuer.username || issuer.password || issuer.search || issuer.hash || issuer.pathname !== '/') return null;
  return { origin, issuer: issuer.href, clientID: env.AUTH_CLIENT_ID, clientSecret: env.AUTH_CLIENT_SECRET,
    secret: env.AUTH_SESSION_SECRET, subject: env.AUTH_ALLOWED_SUBJECT, apiToken: env.ROGAN_API_TOKEN };
}

export function createGateway({ origin, routes, env = process.env, fetchImpl = fetch, authFactory = auth }) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use((_req, res, next) => {
    res.set({'Cache-Control':'no-store, private','Vercel-CDN-Cache-Control':'no-store','CDN-Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'});
    next();
  });
  const config = readConfig(env, origin);
  if (!config) {
    app.use((_req, res) => res.status(503).json({error:'Sign-in is not configured.'}));
    return app;
  }
  const keys = createRemoteJWKSet(new URL('.well-known/jwks.json', config.issuer));
  app.use(authFactory({
    issuerBaseURL:config.issuer, baseURL:origin, clientID:config.clientID, clientSecret:config.clientSecret,
    secret:config.secret, authRequired:false, idpLogout:false, enableTelemetry:false,
    authorizationParams:{response_type:'code',response_mode:'query',scope:'openid'},
    idTokenSigningAlg:'RS256',
    routes:{login:false,logout:false,callback:'/api/auth/callback'},
    session:{name:'__Host-rogan-session',rolling:true,rollingDuration:3600,absoluteDuration:28800,
      cookie:{httpOnly:true,secure:true,sameSite:'Lax',path:'/'}},
    // Fixed return path: never forward caller-controlled returnTo or authorization params.
    getLoginState:()=>({returnTo:'/api/auth/complete'}),
    afterCallback:async (_req,_res,session)=> {
      // Code-flow SDK checks state/nonce; additionally verify the signed ID token.
      await jwtVerify(session.id_token, keys, {
        issuer:config.issuer, audience:config.clientID, algorithms:['RS256'],
      });
      return session;
    },
  }));
  app.get('/api/auth/login', (_req,res) => res.oidc.login({returnTo:'/api/auth/complete'}));
  app.get('/api/auth/switch', (_req,res) => res.oidc.login({returnTo:'/api/auth/complete',authorizationParams:{prompt:'login'}}));
  // No tokens, identity or caller-selected return URL enter this completion page.
  // The original tab must verify the session with the server before unlocking.
  const completionScript = `try { const c = new BroadcastChannel('rogan-sign-in'); c.postMessage('complete'); c.close(); } catch {} window.close();`;
  const completionHash = createHash('sha256').update(completionScript).digest('base64');
  app.get('/api/auth/complete', (_req,res) => res
    .set('Content-Security-Policy', `default-src 'none'; script-src 'sha256-${completionHash}'; frame-ancestors 'none'; base-uri 'none'`)
    .type('html').send(`<!doctype html><html lang="en"><meta charset="utf-8"><title>Return to your app</title><p>Return to your original app tab and select Check sign-in. You can close this window.</p><script>${completionScript}</script></html>`));
  const sameOrigin = req => req.get('origin') === origin &&
    (!req.get('sec-fetch-site') || req.get('sec-fetch-site') === 'same-origin');
  // Every account may clear its own local session; only the owner may access data.
  app.post('/api/auth/logout', (req,res) => {
    if (!sameOrigin(req)) return res.status(403).json({error:'Request origin denied.'});
    return res.oidc.logout({returnTo:'/'});
  });
  const signedIn = req => req.oidc?.isAuthenticated() && req.oidc.user?.sub === config.subject;
  app.use((req,res,next)=> {
    if (!signedIn(req)) return res.status(req.oidc?.isAuthenticated() ? 403 : 401).json({error:'Sign in with the approved account.'});
    next();
  });
  app.get('/api/auth/session', (_req,res)=>res.json({authenticated:true,draftScope:createHash('sha256').update(JSON.stringify([config.issuer,config.clientID,config.subject])).digest('hex')}));
  app.use((req,res,next)=> {
    req.upstream = resolveRoute(req.originalUrl,req.method,routes);
    if (!req.upstream) return res.status(404).json({error:'Route not available.'});
    // Custom header and exact Origin protect even same-site sibling domains from CSRF.
    if (req.method !== 'GET' && (!sameOrigin(req) || req.get('x-rogan-request') !== '1'))
      return res.status(403).json({error:'Request origin denied.'});
    if (req.method !== 'GET' && req.headers['content-length'] !== '0' && req.headers['content-length'] && !req.is('application/json'))
      return res.status(415).json({error:'JSON required.'});
    next();
  });
  app.use(express.json({limit:MAX_BODY}));
  app.use(async(req,res)=> {
    try {
      const body = req.method === 'GET' || req.body === undefined ? undefined : JSON.stringify(req.body);
      if (body && Buffer.byteLength(body) > MAX_BODY) return res.status(413).json({error:'Request too large.'});
      const response = await fetchImpl(req.upstream, {
        method:req.method, headers:{'Content-Type':'application/json',Accept:'application/json',Authorization:`Bearer ${config.apiToken}`},
        body, redirect:'error', signal:AbortSignal.timeout(30000),
      });
      // No retry, including on writes whose completion is uncertain.
      if (response.status === 204) return res.status(204).end();
      if (!(response.headers.get('content-type') || '').includes('application/json')) throw Error('Unexpected response');
      const data = await response.json();
      // Keep structured business errors (409/import outcomes) without forwarding upstream cookies/headers.
      if (response.status === 401 || response.status === 403 || response.status >= 500 && !data?.outcomes)
        return res.status(502).json({error:'The data service is unavailable. Refresh and review before retrying a write.'});
      return res.status(response.status).json(data);
    } catch {
      return res.status(502).json({error:'The data service is unavailable. Refresh and review before retrying a write.'});
    }
  });
  app.use((_error,_req,res,_next)=>res.status(400).json({error:'Request could not be completed.'}));
  return app;
}
