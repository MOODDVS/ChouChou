/**
 * LA BIBLIOTECA DELLE FOTO — cosa e' entrato, e cosa non serve a niente.
 *
 * ⚠️ LA DOMANDA CHE LA LIBRERIA NASCONDE e' «questa foto la sta mostrando
 * qualcuno?». L'API lo sa — manda `used_by`, l'elenco dei piatti, dei pop-up e
 * degli eventi che puntano a quell'URL — e la Accueil non lo leggeva: mostrava
 * le ultime otto miniature e basta. Una foto che nessuno usa e' l'unica che si
 * puo' cancellare (la pagina Assets rifiuta di toccare le altre), ed era anche
 * l'unica cosa che non si vedeva da nessuna parte senza aprire la pagina e
 * guardare le card una per una.
 *
 * ⚠️ I TAG «Menu» e «Marketing» VENGONO DALL'USO, non dalla cartella: la
 * stessa foto in `popups/` usata da un piatto e' una foto del menu. E' l'API a
 * deciderlo, e qui non si reinventa.
 *
 * ⚠️ NESSUN IMPORT se non l'aritmetica dei giorni (`lib/giorni.ts`, pura):
 * `db.ts` lancia all'import senza le variabili di Supabase e in vitest mancano
 * — un file di prova che ci arrivi non parte, e vitest lo conta come «0 test»
 * (ENGINE.md).
 */
import { giorniPassati } from "../giorni";

export interface RigaFoto {
  bucket?: string | null;
  name?: string | null;
  url?: string | null;
  size?: number | null;
  created_at?: string | null;
  /** Chi la sta mostrando: «Plat : Tagliata», «Pop-up : Apéro»… */
  used_by?: string[] | null;
  /** «menu» | «marketing», ricavati dall'uso. */
  tags?: string[] | null;
}

/** Le famiglie di una foto, nell'ordine in cui si leggono. ⚠️ Vengono
 *  dall'USO, non dalla cartella: la stessa foto nel bucket `popups` messa su
 *  un piatto e' una foto del menu, e se sta nell'hero del sito e' del sito. */
export const FAMIGLIE = ["menu", "marketing", "site"] as const;
export type Famiglia = (typeof FAMIGLIE)[number];

/** Il filtro della colonna. `""` = tutte. */
export type FiltroFoto = "" | Famiglia | "libere";

/** La sta mostrando qualcuno? */
export function usata(f: RigaFoto | null | undefined): boolean {
  return Array.isArray(f?.used_by) && f!.used_by!.length > 0;
}

/**
 * LE FOTO, DALLA PIU' RECENTE.
 *
 * ⚠️ Si riordina qui anche se l'API le manda gia' in ordine: e' la regola di
 * questa colonna, e una data illeggibile — un file arrivato nel bucket senza
 * `created_at` — deve finire IN FONDO e non in cima, dove si leggerebbe come
 * «appena caricata».
 */
export function recenti<T extends RigaFoto>(foto: T[] | null | undefined): T[] {
  return (foto ?? []).slice().sort((a, b) => {
    const ta = Date.parse(String(a?.created_at ?? ""));
    const tb = Date.parse(String(b?.created_at ?? ""));
    const va = Number.isFinite(ta) ? ta : -Infinity;
    const vb = Number.isFinite(tb) ? tb : -Infinity;
    return vb - va;
  });
}

/** Le foto di un filtro, sempre dalla piu' recente. */
export function conFiltro<T extends RigaFoto>(
  foto: T[] | null | undefined,
  filtro: FiltroFoto,
): T[] {
  const tutte = recenti(foto);
  if (!filtro) return tutte;
  if (filtro === "libere") return tutte.filter((f) => !usata(f));
  return tutte.filter((f) => famiglieDi(f).includes(filtro));
}

/** Le famiglie di una foto, in ordine fisso e senza doppioni: due pastiglie
 *  «Menu» sulla stessa miniatura sarebbero due cose. */
export function famiglieDi(f: RigaFoto | null | undefined): Famiglia[] {
  const t = (f?.tags ?? []).map(String);
  return FAMIGLIE.filter((x) => t.includes(x));
}

/** Quante foto non le usa nessuno. */
export function libere(foto: RigaFoto[] | null | undefined): number {
  return (foto ?? []).filter((f) => !usata(f)).length;
}

/**
 * L'ETA' di una foto, in giorni di calendario del fuso del locale.
 *
 * `null` quando la data non si legge: la riga non scrive niente invece di dire
 * «oggi», che e' il contrario della verita' per un file vecchio di un anno.
 */
export function etaInGiorni(
  iso: unknown,
  oggi: string,
  chiaveDi: (iso: string) => string,
): number | null {
  const s = String(iso ?? "");
  if (!s || !Number.isFinite(Date.parse(s))) return null;
  const k = chiaveDi(s);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(k)) return null;
  return Math.max(0, giorniPassati(k, oggi));
}

export interface ContiFoto {
  totale: number;
  /** Caricate negli ultimi sette giorni. */
  settimana: number;
  libere: number;
  /** Byte in tutto, e byte medi per foto (`0` senza foto). */
  byte: number;
  media: number;
}

/**
 * I NUMERI DEL PIEDE.
 *
 * ⚠️ «Spazio» e' una somma di byte, non un conto di file: quarantasei mega su
 * trentotto foto dicono che qualcuno sta caricando scatti presi col telefono,
 * che il sito poi serve cosi' come sono. E' l'unico posto del pannello dove
 * quel numero si vede.
 */
export function conti(
  foto: RigaFoto[] | null | undefined,
  oggi: string,
  chiaveDi: (iso: string) => string,
): ContiFoto {
  const righe = foto ?? [];
  let byte = 0, settimana = 0;
  for (const f of righe) {
    const n = Number(f?.size);
    if (Number.isFinite(n) && n > 0) byte += n;
    const eta = etaInGiorni(f?.created_at, oggi, chiaveDi);
    if (eta !== null && eta <= 7) settimana++;
  }
  return {
    totale: righe.length,
    settimana,
    libere: libere(righe),
    byte,
    media: righe.length ? Math.round(byte / righe.length) : 0,
  };
}

/**
 * I BYTE, SCRITTI.
 *
 * ⚠️ Le due unita' arrivano da fuori (`tr("as.kb")`, `tr("as.mb")`): questo
 * modulo non conosce le lingue, e la pagina Assets scriveva la stessa riga a
 * modo suo — stessa soglia, stesso arrotondamento, due copie.
 * ⚠️ Mai «0 Ko» per un file che esiste: sotto il kilobyte si scrive 1, perche'
 * un file da 300 byte occupa poco, non niente.
 */
export function peso(bytes: unknown, kb: string, mb: string): string {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return "";
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} ${kb}`;
  return `${(n / (1024 * 1024)).toFixed(1)} ${mb}`;
}
