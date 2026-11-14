# Accesso con GitHub (OAuth) — guida

Serve per attivare il pulsante **Accedi con GitHub** nella pagina admin, così ogni
dirigente entra con il proprio account (invece di incollare un token). Sono due
servizi gratuiti: una *OAuth App* su GitHub e un *Cloudflare Worker*.

Se preferisci la via più semplice, puoi usare solo il **token personale** e saltare
tutto questo: vedi il README principale.

---

## Passo 1 — Crea la OAuth App su GitHub

1. Vai su https://github.com/settings/developers → **OAuth Apps** → **New OAuth App**.
2. Compila:
   - **Application name**: `Astrovolley Admin`
   - **Homepage URL**: `https://kozmoshadow.github.io/astrovolley-calendario/`
   - **Redirect URIs** (in alcune versioni si chiama *Authorization callback URL*): metti un segnaposto per ora, es.
     `https://astrovolley-oauth.workers.dev/callback`
     (lo correggerai al passo 3, quando avrai l'URL vero del worker)
3. **Register application**.
4. Copia il **Client ID**. Poi **Generate a new client secret** e copia anche quello
   (si vede una volta sola).

> Non serve "Enable Device Flow". Lo scope usato è `public_repo`: basta per scrivere
> su un repository pubblico come questo.

---

## Passo 2 — Crea il Cloudflare Worker

1. Crea un account gratuito su https://dash.cloudflare.com
2. **Workers & Pages** → **Create** → **Create Worker**.
3. Dagli un nome, es. `astrovolley-oauth`, e **Deploy**.
4. **Edit code**: cancella il contenuto di esempio e incolla **tutto** il file
   [`cloudflare-worker.js`](./cloudflare-worker.js) di questa cartella. **Deploy**.
5. Vai in **Settings → Variables and Secrets** e aggiungi quattro voci:

   | Nome | Tipo | Valore |
   |---|---|---|
   | `GITHUB_CLIENT_ID` | Text | il Client ID del passo 1 |
   | `GITHUB_CLIENT_SECRET` | **Secret** | il client secret del passo 1 |
   | `SITE_URL` | Text | `https://kozmoshadow.github.io/astrovolley-calendario/admin/` |
   | `ALLOWED_ORIGIN` | Text | `https://kozmoshadow.github.io` |

6. Torna su **Settings** e copia l'**URL del worker** (tipo
   `https://astrovolley-oauth.<qualcosa>.workers.dev`).

---

## Passo 3 — Collega i due pezzi

1. Su GitHub, torna nella OAuth App (passo 1) → **Redirect URIs** e
   metti l'URL del worker **+ `/callback`**:
   `https://astrovolley-oauth.<qualcosa>.workers.dev/callback`
   → **Update application**.
2. Nel repository, apri `site/admin/config.json` e scrivi l'URL del worker:

   ```json
   {
     "oauthWorkerUrl": "https://astrovolley-oauth.<qualcosa>.workers.dev"
   }
   ```

   (solo l'origine, **senza** `/callback` e senza barra finale)

3. Committa e pusha. Dopo il deploy, ricarica la pagina admin: il pulsante
   **Accedi con GitHub** sarà attivo.

---

## Come funziona (in breve)

```
admin  →  worker /login  →  github.com/login/oauth/authorize
                                 │  (l'utente autorizza)
   admin  ←  worker /callback  ←  github.com/login/oauth/access_token (con secret)
             reindirizza a SITE_URL#token=…
```

- Lo `state` anti-CSRF e il `code_verifier` (PKCE) viaggiano in cookie `HttpOnly`.
- Il token torna nel **frammento** dell'URL (`#`), che il browser non invia ai server:
  resta fuori dai log. La pagina lo salva nel browser e pulisce subito l'indirizzo.
- Il worker non conserva nulla e non registra i token.

---

## Se qualcosa non va

- **"Verifica di sicurezza fallita"**: hai aperto il worker direttamente, oppure i
  cookie sono bloccati. Riparti dal pulsante nella pagina admin.
- **"Scambio fallito: incorrect_client_credentials"**: `GITHUB_CLIENT_ID` o
  `GITHUB_CLIENT_SECRET` sbagliati nel worker.
- **"redirect_uri_mismatch"** (errore mostrato da GitHub): la callback nel passo 3
  non combacia esattamente con quella del worker (controlla `/callback` finale).
- **Il pulsante resta disattivato**: `site/admin/config.json` è vuoto o il sito non è
  stato ancora ridistribuito.
