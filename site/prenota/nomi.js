// Elenco fisso dei refertisti che possono prenotare.
//
// Scrivere un nome per riga, tra virgolette, separati da virgola. L'ordine qui
// sotto non conta: la pagina li ordina per cognome. Conviene comunque tenerli
// in ordine, cosi' si controlla a occhio che non manchi nessuno.
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
  "Francesca Avizzano",
  "Diego Beato",
  "Antonio Caliendo",
  "Lucrezia Cardinale",
  "Enrico Cioccia",
  "Anna Esposito",
  "Lorenzo Esposito",
  "Maria Facciolli",
  "Francesco Ferro",
  "Alberta Guida",
  "Antonio Liguoro",
  "Francesca Maiella",
  "Luigi Maiello",
  "Simona Salierno",
  "Iolanda Starita",
  "Francesco Zaza",
  "Ciro Sansone",
];
