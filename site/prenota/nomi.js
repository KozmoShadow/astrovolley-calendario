// Elenco fisso dei refertisti che possono prenotare.
//
// Scrivere un nome per riga, tra virgolette, separati da virgola. L'ordine qui
// sotto e' l'ordine in cui compaiono nella pagina: conviene metterli in ordine
// alfabetico di cognome, cosi' si trovano in fretta.
//
// Regole:
//  - usare nome e cognome veri, come devono comparire nel foglio Turni
//  - niente virgole dentro il nome (spezzerebbero la cella del foglio)
//  - se un nome cambia, si cambia qui e si rifa' il push: i turni gia' presi
//    restano scritti con il nome vecchio nel foglio
//
// Se questo elenco resta vuoto, la pagina ripiega sui nomi gia' presenti nei
// turni del foglio. Meglio riempirlo: cosi' chi non ha mai prenotato compare
// lo stesso.

export const NOMI_REFERTISTI = [
  // "Mario Rossi",
  // "Anna Bianchi",
];
