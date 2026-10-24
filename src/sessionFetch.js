// Memory-only gate. Expiry blocks background requests as well as user writes.
let blocked = false;
export function blockSessionRequests(value) { blocked = value; }
export async function sessionFetch(url, options = {}) {
  if (typeof url !== 'string' || !url.startsWith('/api/data/') || url.includes('\\')) throw new Error('Invalid data route.');
  if (typeof options.body === 'string' && new TextEncoder().encode(options.body).byteLength > 4_000_000) throw new Error('This request exceeds the secure gateway size limit. No request was sent; keep the original file.');
  if (blocked) return Response.json({error:'Sign in before continuing. No request was sent.'},{status:401});
  const headers = new Headers(options.headers);
  headers.delete('Authorization');
  headers.set('X-Rogan-Request','1');
  const response = await fetch(url,{...options,headers,credentials:'same-origin',redirect:'error',cache:'no-store'});
  if (response.status === 401 || response.status === 403) {
    blocked = true;
    window.dispatchEvent(new Event('rogan-session-ended'));
  }
  return response;
}
