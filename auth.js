// Simple password gate for the whole site. Username can be anything; password = SITE_PASSWORD.
export default async (request, context) => {
  const password = Netlify.env.get('SITE_PASSWORD');
  if (!password) return context.next(); // not set: site is open (set it before sharing the URL)
  const header = request.headers.get('authorization') || '';
  if (header.startsWith('Basic ')) {
    try {
      const [, pass] = atob(header.slice(6)).split(/:(.*)/s);
      if (pass === password) return context.next();
    } catch { /* fall through */ }
  }
  return new Response('Password required', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="Greenspace Finance", charset="UTF-8"' }
  });
};
