// Configurazione della pagina di prenotazione.
//
// Due indirizzi, per due usi diversi:
//
// URL_CSV    il CSV pubblicato del foglio (lettura). Si prende dal link
//            "Pubblica sul web" del foglio, come in site/data/dirigenza.json.
//            Deve finire con &output=csv&gid=0 e serve Access-Control-Allow-Origin,
//            che Google manda su questo tipo di URL.
//
// URL_BACKEND la web app Apps Script (scrittura). Si ottiene da Apps Script:
//            Esegui il deployment -> Nuovo deployment -> App web, "Esegui come:
//            me", "Chi ha accesso: chiunque". Deve finire con /exec, non /dev.
//
// Se URL_BACKEND resta vuoto la pagina si apre in sola lettura e mostra un
// avviso: meglio un messaggio chiaro di un bottone che non fa nulla.

export const URL_CSV =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vRBwyVqLXEz0iZwx6GvQ7-e8f5QSReZuMsuB2jaOGZI-ly8N8yLS9SknttfTBZIudlDCcuUmrruC4HL/pub?output=csv&gid=0";

export const URL_BACKEND = "";
