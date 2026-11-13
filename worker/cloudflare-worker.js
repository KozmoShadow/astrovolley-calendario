/**
 * Cloudflare Worker: scambio del codice OAuth di GitHub per un token.
 *
 * E' l'unico pezzo che non puo' stare nel browser, perche' GitHub non espone
 * gli endpoint OAuth con CORS e il client_secret non deve mai finire nella
 * pagina. Il worker fa solo questo: nessun dato salvato, nessun log di token.
 *
 * Variabili d'ambiente (Settings -> Variables and Secrets):
 *   GITHUB_CLIENT_ID      - client id della OAuth App
 *   GITHUB_CLIENT_SECRET  - client secret (segret0, come "Secret")
 *   SITE_URL              - es. https://kozmoshadow.github.io/astrovolley-calendario/admin/
 *   ALLOWED_ORIGIN        - es. https://kozmoshadow.github.io
 *
 * Endpoint:
 *   GET /login    -> reindirizza a GitHub
 *   GET /callback -> scambia il codice e torna al sito con #token=...
 */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = {
      "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN || "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };
    if (request.method === "OPTIONS") return new Response(null, { headers: cors });

    if (url.pathname === "/login") {
      const state = crypto.randomUUID();
      const authorize = new URL("https://github.com/login/oauth/authorize");
      authorize.searchParams.set("client_id", env.GITHUB_CLIENT_ID);
      authorize.searchParams.set("redirect_uri", `${url.origin}/callback`);
      authorize.searchParams.set("scope", "public_repo");
      authorize.searchParams.set("state", state);
      return new Response(null, {
        status: 302,
        headers: {
          Location: authorize.toString(),
          // Lo state viaggia in un cookie httpOnly: cosi' il callback puo'
          // verificare che la richiesta sia partita davvero da qui.
          "Set-Cookie": `oauth_state=${state}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=600`,
        },
      });
    }

    if (url.pathname === "/callback") {
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      const cookie = request.headers.get("Cookie") || "";
      const expected = /oauth_state=([^;]+)/.exec(cookie)?.[1];

      if (!code) return new Response("Manca il codice OAuth.", { status: 400 });
      if (!expected || state !== expected) {
        return new Response("State non valido: richiesta rifiutata.", { status: 400 });
      }

      const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: env.GITHUB_CLIENT_ID,
          client_secret: env.GITHUB_CLIENT_SECRET,
          code,
          redirect_uri: `${url.origin}/callback`,
        }),
      });
      const data = await tokenRes.json();
      if (!data.access_token) {
        return new Response(`Scambio fallito: ${data.error_description || data.error || "?"}`, { status: 400 });
      }

      // Il token viaggia nel fragment (#): non viene inviato ai server e
      // resta fuori dai log. La pagina lo cancella subito dalla barra.
      const site = env.SITE_URL || "https://kozmoshadow.github.io/astrovolley-calendario/admin/";
      return new Response(null, {
        status: 302,
        headers: {
          Location: `${site}#token=${encodeURIComponent(data.access_token)}`,
          "Set-Cookie": "oauth_state=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0",
        },
      });
    }

    return new Response("Astrovolley OAuth worker attivo.", { status: 200, headers: cors });
  },
};
