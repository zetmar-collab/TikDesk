// Cookies are obtained only for the validated CDN URL and never logged.
async function sessionFetch(session, url, options) {
  options.signal.throwIfAborted();
  const cookies = await session.cookies.get({ url });
  options.signal.throwIfAborted();
  const headers = { ...options.headers };
  if (cookies.length) headers.Cookie = cookies.map(cookie => cookie.name + '=' + cookie.value).join('; ');
  return fetch(url, { ...options, headers });
}
module.exports = { sessionFetch };
