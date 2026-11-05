/**
 * LA CASELLA GOOGLE BUSINESS DI INTÉGRATIONS — il lavoro (5/11/2026).
 *
 * Tutto quello che Google sapeva di un punto stava in tre posti (la scheda
 * Google di Intégrations, la scheda della sede, un rinvio fra le due). Qui
 * si legge e si scrive per LIVELLO — «marchio» o una sede — con le stesse
 * chiavi di sempre (`google_place_id`, `link_google_review`,
 * `google_location*`): i dati non si spostano, si sposta la schermata.
 *
 * Le regole pure stanno in `googleRegole.ts`.
 */
import { elencoSedi, leggiConfig, scriviConfig, ambitoDiRiga } from "./sede";
import { SEDE_UNICA, type Ambito } from "./sedeRegole";
import {
  controllaPlaceId,
  linkRecensioneDaPlaceId,
  livelloGoogle,
  prontoG,
  type LivelloG,
  type RiepilogoG,
} from "./googleRegole";
import { googleConfigurato, statoGoogle, sincronizzaRecensioni } from "../googleBusiness";
import type { StatoGoogle } from "../googleRegole";

const K_PLACE = "google_place_id";
const K_LINK = "link_google_review";
const K_SCHEDA = "google_location_title";
const K_SCHEDA_PATH = "google_location";
const K_SYNC = "google_reviews_synced_at";
const K_RATING = "google_rating";
const K_COUNT = "google_review_count";

function ambitoDi(livello: string): Ambito {
  return livello === "marchio" ? SEDE_UNICA : ambitoDiRiga(livello);
}

async function livelloValido(livello: string): Promise<boolean> {
  return livello === "marchio" || (await elencoSedi()).some((s) => s.id === livello);
}

export interface LivelloGoogle extends RiepilogoG {
  pronto: boolean;
  /** Il link che si genererebbe dal Place ID (suggerito se il link manca). */
  linkGenerato: string;
  sync: { il: string; voto: string; recensioni: string };
}

async function leggiLivello(id: string, nome: string, conSedi: boolean): Promise<LivelloGoogle> {
  const cfg = await leggiConfig(ambitoDi(id), [K_PLACE, K_LINK, K_SCHEDA, K_SCHEDA_PATH, K_SYNC, K_RATING, K_COUNT]);
  const v = (k: string) => (cfg.valori.get(k) ?? "").trim();
  // Il marchio scrive direttamente in app_config: tutto quello che ha e' suo.
  const suo = (k: string) => id === "marchio" ? !!v(k) : cfg.sovrascritte.has(k);
  const r: RiepilogoG = {
    id, nome,
    placeId: v(K_PLACE), placeProprio: suo(K_PLACE),
    link: v(K_LINK), linkProprio: suo(K_LINK),
    scheda: v(K_SCHEDA_PATH) ? v(K_SCHEDA) || v(K_SCHEDA_PATH) : "", schedaPropria: suo(K_SCHEDA_PATH),
  };
  return {
    ...r,
    pronto: prontoG(r, conSedi),
    linkGenerato: linkRecensioneDaPlaceId(r.placeId),
    sync: { il: v(K_SYNC), voto: v(K_RATING), recensioni: v(K_COUNT) },
  };
}

export interface StatoCasellaGoogle {
  oauth: { stato: StatoGoogle; configurato: boolean };
  places: boolean;
  livelli: LivelloGoogle[];
  casella: { livello: LivelloG; pronti: number; totale: number };
}

export async function statoCasellaGoogle(): Promise<StatoCasellaGoogle> {
  const sedi = await elencoSedi();
  const conSedi = sedi.length > 0;
  const [livelli, stato] = await Promise.all([
    Promise.all([leggiLivello("marchio", "", conSedi), ...sedi.map((s) => leggiLivello(s.id, s.name, conSedi))]),
    statoGoogle().catch(() => "incerto" as StatoGoogle),
  ]);
  return {
    oauth: { stato, configurato: googleConfigurato() },
    places: !!String(import.meta.env.GOOGLE_PLACES_API_KEY ?? process.env.GOOGLE_PLACES_API_KEY ?? "").trim(),
    livelli,
    casella: livelloGoogle(livelli),
  };
}

export type EsitoGoogle =
  | { ok: true; generato?: boolean }
  | { ok: false; errore: "livello" | "chiave" | "formato" | "link" | "niente" | "db" | "sync"; messaggio?: string };

/**
 * Salva Place ID e/o link recensioni di un livello.
 *
 * ⚠️ Il link si GENERA dal Place ID solo quando il livello non ne ha uno
 * SUO: un link scritto a mano non si tocca. E non si genera da solo nelle
 * email: il link e' anche l'interruttore dell'email «laissez un avis», e
 * accenderla in silenzio a chi aveva un Place ID senza link sarebbe un
 * cambiamento che nessuno ha chiesto. Si genera qui, quando qualcuno salva.
 */
export async function salvaGoogle(livello: string, body: { place_id?: unknown; review_url?: unknown }): Promise<EsitoGoogle> {
  if (!(await livelloValido(livello))) return { ok: false, errore: "livello" };
  const ambito = ambitoDi(livello);
  const coppie: Record<string, string> = {};
  let generato = false;
  if (body.place_id !== undefined) {
    const pid = String(body.place_id).trim().slice(0, 200);
    const esito = controllaPlaceId(pid);
    if (esito !== "ok") return { ok: false, errore: esito };
    coppie[K_PLACE] = pid;
  }
  if (body.review_url !== undefined) {
    const url = String(body.review_url).trim().slice(0, 500);
    if (url && !/^https?:\/\/\S+$/i.test(url)) return { ok: false, errore: "link" };
    coppie[K_LINK] = url;
  }
  if (!Object.keys(coppie).length) return { ok: false, errore: "niente" };
  if (coppie[K_PLACE] && body.review_url === undefined) {
    const prima = await leggiLivello(livello, "", false);
    if (!prima.link || !prima.linkProprio) {
      coppie[K_LINK] = linkRecensioneDaPlaceId(coppie[K_PLACE]);
      generato = true;
    }
  }
  const err = await scriviConfig(ambito, coppie);
  if (err) return { ok: false, errore: "db", messaggio: err };
  return { ok: true, generato };
}

/** «Synchroniser maintenant»: le recensioni di questo livello, subito. */
export async function sincronizzaLivello(livello: string): Promise<EsitoGoogle> {
  if (!(await livelloValido(livello))) return { ok: false, errore: "livello" };
  try {
    const r = await sincronizzaRecensioni(ambitoDi(livello));
    if (r.stato !== "ok") return { ok: false, errore: "sync", messaggio: r.stato };
    if (r.reviewError) return { ok: false, errore: "sync", messaggio: r.reviewError };
    return { ok: true };
  } catch (e) {
    return { ok: false, errore: "sync", messaggio: e instanceof Error ? e.message : String(e) };
  }
}
