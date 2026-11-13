# Funzione serverless per l'accesso con GitHub (opzionale)

Serve **solo** se vuoi attivare il pulsante *Accedi con GitHub* nella pagina admin
(comodo quando i gestori sono più d'uno). Se usi il **token personale**, puoi
ignorare questa cartella.

Perché serve: GitHub non permette al browser di scambiare il codice OAuth per un
token (niente CORS su quell'endpoint) e il `client_secret` non deve mai stare nella
pagina. Questo piccolo worker fa **solo** lo scambio e non conserva nulla.

## 1. Crea la OAuth App su GitHub

GitHub → **Settings → Developer settings → OAuth Apps → New OAuth App**:

- *Application name*: `Astrovolley Admin`
- *Homepage URL*: `https://kozmoshadow.github.io/astrovolley-calendario/`
- *Authorization callback URL*: l'URL del worker + `/callback` (es.
  `https://astrovolley-oauth.<tuo-sottodominio>.workers.dev/callback`)

Segnati **Client ID** e genera un **Client secret**.

## 2. Pubblica il worker (Cloudflare, piano gratuito)

1. Crea un account su https://dash.cloudflare.com (gratis).
2. **Workers & Pages → Create → Worker**, dagli un nome (es. `astrovolley-oauth`).
3. Incolla il contenuto di `cloudflare-worker.js` e salva.
4. **Settings → Variables and Secrets**, aggiungi:
   - `GITHUB_CLIENT_ID` (variabile)
   - `GITHUB_CLIENT_SECRET` (**Secret**)
   - `SITE_URL` = `https://kozmoshadow.github.io/astrovolley-calendario/admin/`
   - `ALLOWED_ORIGIN` = `https://kozmoshadow.github.io`
5. Copia l'URL pubblico del worker.

## 3. Collega il worker alla pagina admin

In `site/admin/admin.js`, in cima, imposta:

```js
const OAUTH_WORKER_URL = "https://astrovolley-oauth.<tuo-sottodominio>.workers.dev";
```

Fatto: il pulsante *Accedi con GitHub* reindirizza al worker, che riporta alla
pagina con il token nel frammento dell'URL (`#token=…`), mai nei log dei server.

## Come funziona lo scambio

```
admin  →  worker /login  →  github.com/login/oauth/authorize
                                │ (utente autorizza)
   admin  ←  worker /callback  ←  github.com/login/oauth/access_token (con secret)
             reindirizza a SITE_URL#token=…
```

Lo `state` anti-CSRF viaggia in un cookie `HttpOnly`; il token viaggia nel
frammento (`#`), che il browser non invia ai server.
