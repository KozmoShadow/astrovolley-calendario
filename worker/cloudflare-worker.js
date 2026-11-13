/**
 * Cloudflare Worker: accesso con GitHub (OAuth) per la pagina admin.
 *
 * E' l'unico pezzo che non puo' stare nel browser, perche' GitHub non espone
 * gli endpoint OAuth con CORS e il client_secret non deve mai finire nella
 * pagina. Il worker fa solo lo scambio del token: non conserva nulla.
 *
 * Variabili d'ambiente (Settings -> Variables and Secrets):
 *   GITHUB_CLIENT_ID      - client id della OAuth App
 *   GITHUB_CLIENT_SECRET  - client secret (come "Secret")
 *   SITE_URL              - https://kozmoshadow.github.io/astrovolley-calendario/admin/
 *   ALLOWED_ORIGIN        - https://kozmoshadow.github.io
 *
 * Endpoint:
 *   GET /login    -> reindirizza a GitHub
 *   GET /callback -> scambia il codice e torna al sito con #token=...
 */

function b64url(bytes) {
  let bin = "";
  for (const b of new Uint8Array(bytes)) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function randomString(len = 32) {
  return b64url(crypto.getRandomValues(new Uint8Array(len)));
}

async function sha256(str) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return b64url(digest);
}

function cookie(request, name) {
  const raw = request.headers.get("Cookie") || "";
  const m = new RegExp(`${name}=([^;]+)`).exec(raw);
  return m ? m[1] : null;
}

const CLEAR = (name) => `${name}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/login") {
      const state = randomString(16);
      const verifier = randomString(32);
      const challenge = await sha256(verifier);

      const authorize = new URL("https://github.com/login/oauth/authorize");
      authorize.searchParams.set("client_id", env.GITHUB_CLIENT_ID);
      authorize.searchParams.set("redirect_uri", `${url.origin}/callback`);
      authorize.searchParams.set("scope", "public_repo");
      authorize.searchParams.set("state", state);
      authorize.searchParams.set("code_challenge", challenge);
      authorize.searchParams.set("code_challenge_method", "S256");

      const headers = new Headers({ Location: authorize.toString() });
      // state e verifier viaggiano in cookie HttpOnly: servono al callback per
      // verificare la richiesta (anti-CSRF) e completare lo scambio (PKCE).
      headers.append("Set-Cookie", `oauth_state=${state}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=600`);
      headers.append("Set-Cookie", `oauth_verifier=${verifier}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=600`);
      return new Response(null, { status: 302, headers });
    }

    if (url.pathname === "/callback") {
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      const verifier = cookie(request, "oauth_verifier");
      const expectedState = cookie(request, "oauth_state");

      if (!code) return new Response("Manca il codice OAuth.", { status: 400 });
      if (!expectedState || state !== expectedState || !verifier) {
        return new Response("Verifica di sicurezza fallita: riprova l'accesso.", { status: 400 });
      }

      const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: env.GITHUB_CLIENT_ID,
          client_secret: env.GITHUB_CLIENT_SECRET,
          code,
          code_verifier: verifier,
          redirect_uri: `${url.origin}/callback`,
        }),
      });
      const data = await tokenRes.json();
      if (!data.access_token) {
        return new Response(`Scambio fallito: ${data.error_description || data.error || "?"}`, { status: 400 });
      }

      // Il token viaggia nel frammento (#): il browser non lo invia ai server,
      // quindi resta fuori dai log. La pagina lo cancella subito dalla barra.
      const site = env.SITE_URL || "https://kozmoshadow.github.io/astrovolley-calendario/admin/";
      const headers = new Headers({
        Location: `${site}#token=${encodeURIComponent(data.access_token)}`,
      });
      headers.append("Set-Cookie", CLEAR("oauth_state"));
      headers.append("Set-Cookie", CLEAR("oauth_verifier"));
      return new Response(null, { status: 302, headers });
    }

    return new Response("Astrovolley OAuth worker attivo.", {
      status: 200,
      headers: { "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN || "*" },
    });
  },
};
