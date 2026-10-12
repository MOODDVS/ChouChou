// Dati strutturati Schema.org "Restaurant" (SEO locale) costruiti dai dati
// LIVE dell'admin: nome/telefono/email/indirizzo (Réglages → Général), orari
// (settings) e social. Cache 5 min.
//
// ⚠️ LA FORMA DELLA SCHEDA ORA LA TIENE IL MOTORE, in
// `lib/seo/schedaRistorante.ts`: le regole che valgono per tutti i clienti
// (`@id` e `url` sulla radice, indirizzo intero o niente, `geo` solo con
// coordinate vere, campi vuoti fuori) stanno scritte una volta la'. Qui
// resta quello che e' di ChouChou: le cucine e la regione in due lingue, la
// fotografia. Gli orari li legge il motore (`leggiOrari`, con la sede) e li
// converte il motore (`orariSpecifica`).
import { datiRistorante } from "./ristorante";
import { linksSocial } from "./links";
import { cacheOr } from "./cache";
import { leggiOrari } from "./admin/sede";
import { schedaRistorante, orariSpecifica } from "./seo/schedaRistorante";
import { CLIENT } from "../config/client";
import type { Ambito } from "./admin/sedeRegole";

/** La scheda "Restaurant" come OGGETTO: la stampa `TestaSeo`, che la
 *  mette in pagina solo se la pagina e' indicizzabile. */
/**
 * ⚠️ L'ambito arriva da fuori, non se lo sceglie questa funzione. Qui non c'e'
 * nessuna richiesta da cui dedurre il punto, e indovinarlo vorrebbe dire
 * pubblicare a Google l'indirizzo e gli orari della sede sbagliata — un
 * errore che non da' nessun segnale, se non il cliente che suona a una porta
 * chiusa. Lo passa il Layout, che la richiesta ce l'ha.
 *
 * ⚠️ E la sede entra nella CHIAVE di cache: senza, la prima pagina servita
 * deciderebbe i dati strutturati di tutte le altre per cinque minuti.
 */
export async function restaurantJsonLd(
  siteUrl: string,
  lang: string,
  ambito: Ambito,
): Promise<Record<string, unknown>> {
  return cacheOr(
    `seo:jsonld:${lang}:${ambito.modo === "sede" ? ambito.id : ambito.modo}`,
    async () => {
      const base = siteUrl.replace(/\/$/, "");
      /* ⚠️ ORARI DELLA SEDE, non dell'installazione. Fino al 12/10/2026
         questo file leggeva `settings` da se', senza l'ambito: su un
         gruppo con piu' punti pubblicava a Google gli orari del primo per
         tutti. `leggiOrari` sovrappone quelli della sede, e la conversione
         in `openingHoursSpecification` la fa il motore.
         ⚠️ `leggiOrari` lancia se `settings` e' illeggibile: una scheda
         senza orari e' meglio di una pagina che non apre. */
      const [dati, social, righeOrario] = await Promise.all([
        datiRistorante(ambito),
        linksSocial(),
        leggiOrari(ambito).catch(() => []),
      ]);
      const hours = orariSpecifica(righeOrario);
      const en = lang === "en";

      /* ⚠️ L'INDIRIZZO A PEZZI, NON SPEZZATO. Fino al 12/10/2026 qui si
         tagliava `dati.indirizzo` sulla prima virgola con un'espressione
         regolare: funzionava per questo indirizzo e non in generale (un
         civico con una barra, un «bus 3», una frazione). Adesso i pezzi
         arrivano separati da Général, che e' dove stanno nel database. Se
         Général e' vuoto si ripiega sui pezzi scritti a mano nel config —
         mai su un taglio indovinato. */
      const p =
        dati.via && dati.citta
          ? { via: dati.via, cap: dati.cap, comune: dati.citta }
          : CLIENT.indirizzoParti;
      const regione = en ? "Walloon Brabant" : "Brabant wallon";

      /* ⚠️ LA FORMA DELLA SCHEDA LA DECIDE IL MOTORE
         (`lib/seo/schedaRistorante.ts`): `@id` e `url` sulla radice,
         indirizzo intero o niente, campi vuoti fuori. Qui restano le cose di
         ChouChou — le cucine, la regione in due lingue, la fotografia.
         ⚠️ `url` ADESSO E' SEMPRE LA RADICE. Prima su /en diceva
         `.../en`, con lo stesso `@id` della pagina francese: due indirizzi
         per lo stesso locale, e Google che sceglie. Il locale e' uno. */
      const scheda = schedaRistorante({
        radice: base + "/",
        nome: dati.nome,
        immagine: base + "/slideshow/slide-01.webp",
        telefono: dati.tel,
        email: dati.email,
        fasciaPrezzo: "€€",
        cucina: en ? ["French", "Contemporary", "Homemade"] : ["Française", "Créative", "Fait maison"],
        prenotazioni: true,
        carta: base + (en ? "/en/menu" : "/menu"),
        indirizzo: { ...p, regione, paese: "BE" },
        orari: hours,
        social: social.map((s) => s.url),
        extra: { areaServed: p.comune || regione },
      });

      return scheda;
    },
    300_000
  );
}
