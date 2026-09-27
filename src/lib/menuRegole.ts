/**
 * IL MENU — le regole, pure, senza database.
 *
 * Stesso patto di `sedeRegole.ts`, `salaRegole.ts` e `clientiRegole.ts`:
 * qui dentro non si legge niente, quindi i test girano sulla funzione vera.
 *
 * ⚠️ IL MODELLO, in tre righe, perche' e' la cosa che si dimentica:
 *
 *   il PIATTO e' del gruppo        — stessa margherita, stesso prezzo, ovunque
 *   il FORMATO e' di un punto      — la teglia la fa solo Stockel
 *   l'ESAURITO e' di un punto      — e non e' una proprieta' del piatto:
 *                                    e' uno stato di oggi, e vive altrove
 *
 * Definizione e stato sono separati apposta. «Cos'e' in carta» cambia
 * raramente e vale per tutti; «cos'e' finito» cambia ogni sera e vale per
 * uno. Tenerli nella stessa colonna vorrebbe dire che Stockel, segnando
 * finita la burrata, la toglie anche a Jourdan.
 */
import type { Ambito } from "./admin/sedeRegole";

export const LANG_CODES = ["fr", "en", "it", "nl", "es"];
export const MAX_VARIANTI = 12;

/** Un formato come sta nel jsonb. `location_id` e' la sua sede: null = di
 *  tutte, com'e' sempre stato e com'e' su un'installazione a punto unico. */
export type Variante = {
  key: string;
  label_i18n: Record<string, string>;
  price_cents: number;
  orderable: boolean;
  sold_out: boolean;
  location_id: string | null;
};

/** Etichette multilingua ripulite: solo le lingue conosciute, senza spazi,
 *  troncate. Una lingua vuota non entra. */
export function pulisciI18n(raw: unknown, max: number): Record<string, string> {
  const out: Record<string, string> = {};
  if (raw && typeof raw === "object") {
    const r = raw as Record<string, unknown>;
    for (const code of LANG_CODES) {
      const v = String(r[code] ?? "").trim();
      if (v) out[code] = v.slice(0, max);
    }
  }
  return out;
}

/**
 * Valida i formati di un piatto in arrivo dall'admin.
 *
 * ⚠️ IL FORMATO HA UNA SEDE, il piatto no (quello ce l'ha nella riga).
 * Il default scelto (13/09/2026) e' **solo questa sede**: chi aggiunge un
 * formato stando dentro un punto quasi sempre sta aggiungendo qualcosa che
 * quel punto fa e gli altri no; se lo vuole per tutti lo dice con
 * l'interruttore. La direzione dell'errore decide il default — un formato
 * di troppo in un punto si vede e si toglie, uno mancante non si vede.
 *
 * ⚠️ E non si accetta MAI la sede di un altro punto: l'id arriva dal
 * browser, e scrivere `location_id` di Jourdan stando su Stockel vorrebbe
 * dire modificare il menu di una societa' diversa da quella in cui si e'
 * entrati.
 */
export function validaVarianti(
  raw: unknown,
  ambito: Ambito,
): { errore?: string; value?: Variante[] } {
  if (raw == null) return { value: [] };
  if (!Array.isArray(raw)) return { errore: "Formats invalides" };
  if (raw.length > MAX_VARIANTI) return { errore: `Maximum ${MAX_VARIANTI} formats` };
  const viste = new Set<string>();
  const out: Variante[] = [];
  for (const v of raw) {
    if (!v || typeof v !== "object" || Array.isArray(v)) return { errore: "Format invalide" };
    const r = v as Record<string, unknown>;
    const key = String(r.key ?? "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 24);
    if (!key) return { errore: "Chaque format doit avoir une clé" };
    if (viste.has(key)) return { errore: `Clé de format en double : ${key}` };
    viste.add(key);
    const price = Math.round(Number(r.price_cents));
    if (!Number.isFinite(price) || price < 0 || price > 100000000) {
      return { errore: "Prix de format invalide" };
    }
    const label_i18n = pulisciI18n(r.label_i18n, 40);
    if (Object.keys(label_i18n).length === 0) {
      return { errore: "Chaque format doit avoir un libellé" };
    }
    // La sede del formato. Fuori da un punto (installazione a sede unica o
    // aggregato) resta null: non c'e' niente da dividere.
    let location_id: string | null = null;
    if (ambito.modo === "sede") {
      const chiesta = r.location_id;
      if (chiesta === null) location_id = null;                 // «tutte le sedi», detto
      else if (typeof chiesta === "string" && chiesta.trim()) {
        if (chiesta.trim() !== ambito.id) return { errore: "Format d'un autre point de vente" };
        location_id = ambito.id;
      } else location_id = ambito.id;                            // default: solo qui
    }
    out.push({
      key,
      label_i18n,
      price_cents: price,
      orderable: r.orderable !== false,
      sold_out: r.sold_out === true,
      location_id,
    });
  }
  return { value: out };
}

/** I formati di questo piatto che l'admin di QUESTO punto deve vedere:
 *  i suoi e quelli di tutti. Quelli di un altro punto non esistono, qui. */
export function variantiVisibili(raw: unknown, ambito: Ambito): unknown {
  if (ambito.modo !== "sede" || !Array.isArray(raw)) return raw;
  return raw.filter((v) => {
    const l = (v as Record<string, unknown>)?.location_id;
    return l == null || l === ambito.id;
  });
}

/**
 * COSA SI SCRIVE DAVVERO NEL PIATTO quando un punto salva i suoi formati.
 *
 * ⚠️ E' il punto piu' pericoloso di tutto il menu. L'admin di Stockel vede
 * i formati SUOI e quelli di tutti — non quelli di Jourdan, che per lui non
 * esistono. Se rimandasse indietro quella lista e la si scrivesse tal quale,
 * la pizza in teglia di Jourdan sparirebbe dal database senza che nessuno
 * l'abbia chiesto, e nessuno se ne accorgerebbe fino a un ordine rifiutato.
 * Quindi i formati degli altri punti si rileggono e si rimettono in coda.
 *
 * ⚠️ E l'ESAURITO del formato non si tocca stando dentro un punto: quello
 * scritto nel piatto e' il valore del GRUPPO. «Finito qui» va in
 * `menu_sold_out.variants_off`, che e' un'altra tabella e un'altra cosa.
 * Scriverlo qui vorrebbe dire che Stockel, segnando finita la teglia,
 * la toglie anche a chi la fa ancora.
 */
export function fondiVarianti(
  chieste: Variante[],
  esistenti: unknown,
  ambito: Ambito,
): Variante[] {
  const vecchie = Array.isArray(esistenti) ? (esistenti as Record<string, unknown>[]) : [];
  if (ambito.modo !== "sede") return chieste;
  const altrui = vecchie.filter((v) => {
    const l = v?.location_id;
    return typeof l === "string" && l !== ambito.id;
  }) as unknown as Variante[];
  const primaPerChiave = new Map(vecchie.map((v) => [String(v?.key ?? ""), v]));
  const mie = chieste.map((v) => ({
    ...v,
    sold_out: primaPerChiave.get(v.key)?.sold_out === true,
  }));
  return [...mie, ...altrui];
}
