/**
 * LA CONSEGNA — regole pure (nessun import, si prova in vitest).
 *
 * Réglages → Cuisine → Commandes en ligne → «Livraison»
 * (`orders_delivery`, chiave di sede, SPENTA di ripiego). Accesa, il cliente
 * sceglie al checkout fra ritiro e consegna; il ritiro resta SEMPRE possibile.
 *
 * ⚠️ Qui ci sono solo la forma dell'indirizzo e come si scrive. Spesa minima,
 * zone (codici postali), costo e mance sono passi successivi: quando
 * arriveranno leggeranno `cap` da solo, ed e' per questo che l'indirizzo e'
 * un oggetto e non una riga di testo (migrazione #84).
 */

export interface IndirizzoConsegna {
  via: string;
  numero: string;
  /** La «boîte» (bte / bus), facoltativa. */
  box: string;
  cap: string;
  comune: string;
  /** Per il fattorino: piano, campanello, codice del portone. Facoltativa. */
  note: string;
}

/** Le misure massime. ⚠️ Non sono estetica: tutto questo finisce su un
 *  ticket da 24 colonne e in un'email — un «numero» da 400 caratteri e' un
 *  modo di riempire la comanda di qualcun altro. */
const MAX = { via: 120, numero: 12, box: 12, cap: 10, comune: 80, note: 300 } as const;

/** Un codice postale plausibile: cifre e lettere, 3–10 caratteri. ⚠️ Non solo
 *  i quattro numeri belgi: il motore serve anche Zurigo, Londra e Dubai. */
const CAP_VALIDO = /^[0-9A-Za-z][0-9A-Za-z -]{2,9}$/;

const pulisci = (v: unknown, max: number): string =>
  String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);

/**
 * L'indirizzo arrivato dal browser, ripulito — oppure `null` se manca
 * qualcosa di obbligatorio (via, numero, codice postale, comune).
 * ⚠️ `null` e non un indirizzo a meta': il fattorino con «Rue de la Loi, 1040»
 * e senza numero suona a tutto il palazzo, o torna indietro.
 */
export function indirizzoDaRichiesta(raw: unknown): IndirizzoConsegna | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const ind: IndirizzoConsegna = {
    via: pulisci(r.via, MAX.via),
    numero: pulisci(r.numero, MAX.numero),
    box: pulisci(r.box, MAX.box),
    cap: pulisci(r.cap, MAX.cap).toUpperCase(),
    comune: pulisci(r.comune, MAX.comune),
    note: pulisci(r.note, MAX.note),
  };
  if (!ind.via || !ind.numero || !ind.comune || !CAP_VALIDO.test(ind.cap)) return null;
  return ind;
}

/** L'indirizzo salvato sull'ordine (jsonb), riletto. Riga vecchia, colonna
 *  assente o JSON storto → `null`, cioe' «non e' una consegna». */
export function indirizzoDaRiga(raw: unknown): IndirizzoConsegna | null {
  let v = raw;
  if (typeof v === "string") {
    try {
      v = JSON.parse(v);
    } catch {
      return null;
    }
  }
  return indirizzoDaRichiesta(v);
}

/**
 * L'indirizzo in UNA riga: «Rue de la Loi 16/3, 1000 Bruxelles».
 * ⚠️ La boîte con la barra e non con «bte»: la comanda la legge chi parla
 * francese, olandese o italiano, e «12/3» si capisce in tutte le lingue.
 */
export function rigaIndirizzo(ind: IndirizzoConsegna): string {
  const civico = ind.box ? `${ind.numero}/${ind.box}` : ind.numero;
  return `${ind.via} ${civico}, ${ind.cap} ${ind.comune}`;
}

/** Il link che apre l'indirizzo su una mappa (Google Maps lo apre anche
 *  l'app sul telefono). Nessuna chiave, nessun servizio da pagare. */
export function linkMappa(ind: IndirizzoConsegna): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(rigaIndirizzo(ind))}`;
}

/* ───────── Spesa minima e consegna gratuita ─────────
 *
 * Due importi del ristoratore, in centesimi, chiavi di sede:
 *   `orders_delivery_min_cents`   sotto questa cifra non si consegna;
 *   `orders_delivery_free_cents`  da questa cifra la consegna e' gratis;
 *   `orders_delivery_fee_cents`   quanto costa la consegna (migrazione #85).
 * 0 o vuoto = nessuna soglia, cioe' il comportamento di oggi.
 *
 * ⚠️ SI CONFRONTANO CON I PIATTI DOPO LO SCONTO, senza costo di consegna ne'
 * mancia: un minimo che si raggiunge pagando la consegna o lasciando una mancia
 * non e' un minimo d'ordine. E dopo il codice promo, perche' e' quello che il
 * ristorante incassa davvero per la cucina.
 */

/** Il tetto oltre il quale un importo e' certamente un errore di battitura
 *  (100 000 € al posto di 100,00). */
export const SOGLIA_MAX_CENTS = 1_000_000;

/** Un importo salvato (centesimi, testo) riletto. Illeggibile, negativo o
 *  esagerato → 0, cioe' nessuna soglia: un valore storto non deve fermare
 *  tutte le consegne. */
export function sogliaCents(v: unknown): number {
  const n = Math.round(Number(String(v ?? "").trim()));
  return Number.isFinite(n) && n > 0 && n <= SOGLIA_MAX_CENTS ? n : 0;
}

/** Un importo scritto in euro dal ristoratore («50», «49,90», «49.9») in
 *  centesimi. Vuoto = 0. `null` = illeggibile: il salvataggio lo rifiuta
 *  invece di scrivere qualcosa che nessuno ha chiesto. */
export function euroInCents(v: unknown): number | null {
  const t = String(v ?? "").trim().replace(",", ".");
  if (t === "") return 0;
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  const c = Math.round(Number(t) * 100);
  return c <= SOGLIA_MAX_CENTS ? c : null;
}

/** Quanto manca al minimo per la consegna. 0 = si puo' consegnare. */
export function mancaAlMinimo(piattiCents: number, minimoCents: number): number {
  return minimoCents > 0 ? Math.max(0, minimoCents - Math.max(0, Math.round(piattiCents))) : 0;
}

/**
 * IL COSTO DELLA CONSEGNA per questo carrello: quello del ristoratore, oppure
 * 0 se i piatti (dopo lo sconto) raggiungono la soglia «gratuite dès».
 * ⚠️ Stessa misura del minimo: piatti scontati, senza mancia. Se il carrello
 * e il server misurassero due cose diverse, il cliente vedrebbe «offerte» e
 * pagherebbe la consegna.
 */
export function costoConsegna(piattiCents: number, costoCents: number, gratisCents: number): number {
  if (costoCents <= 0) return 0;
  if (gratisCents > 0 && Math.round(piattiCents) >= gratisCents) return 0;
  return costoCents;
}

/* ───────── Il tempo della consegna ─────────
 *
 * `orders_delivery_delay` (sede): i minuti che servono a portarla, SOPRA il
 * tempo di preparazione. Il primo orario proposto per una consegna e'
 * adesso + preparazione + questo tempo (e lo stesso dall'apertura: alle
 * 18:00 in punto nessuno e' gia' per strada).
 * ⚠️ Solo per la consegna: il ritiro resta con la sola preparazione.
 */

/** Le scelte in Réglages. Un elenco chiuso, come la campanella: si preme un
 *  bottone, non si scrive un numero. */
export const RITARDI_CONSEGNA = [30, 45, 60, 90] as const;

/** Il ripiego: tre quarti d'ora, il tempo piu' comune in citta'. */
export const RITARDO_CONSEGNA_RIPIEGO = 45;

/** Valore salvato riletto. Fuori elenco o illeggibile → 45: mai 0, che
 *  proporrebbe una consegna «fra 15 minuti» che nessuno puo' mantenere. */
export function ritardoConsegna(v: unknown): number {
  const n = Math.round(Number(String(v ?? "").trim()));
  return (RITARDI_CONSEGNA as readonly number[]).includes(n) ? n : RITARDO_CONSEGNA_RIPIEGO;
}

/** Il preavviso di una consegna: preparazione + tragitto. */
export function preavvisoConsegna(prepMinuti: unknown, ritardoMinuti: number): number {
  const prep = Math.max(0, Math.round(Number(prepMinuti) || 0));
  return prep + Math.max(0, ritardoMinuti);
}

/* ───────── I fattorini: quante consegne per orario ─────────
 *
 * `orders_delivery_max` (sede): quante consegne si accettano sullo STESSO
 * orario (lo slot di «Durée d'un créneau»). Di fatto quanti fattorini, o
 * quanti giri: chi raggruppa due indirizzi vicini mette un numero piu' alto.
 * Vuoto o 0 = nessun limite, cioe' il comportamento di oggi.
 * ⚠️ Riguarda SOLO la consegna: un orario pieno sparisce per chi vuole farsi
 * portare la cena, e resta per chi viene a prenderla.
 * ⚠️ Il motore non sa se due indirizzi sono vicini: il numero lo regola il
 * ristoratore, non una mappa.
 */

/** Oltre questo, e' un errore di battitura. */
export const MAX_CONSEGNE_LIMITE = 50;

/** Il limite salvato, riletto: intero 1–50, altrimenti 0 = nessun limite. */
export function maxConsegne(v: unknown): number {
  const t = String(v ?? "").trim();
  if (!/^\d+$/.test(t)) return 0;
  const n = Number(t);
  return n >= 1 && n <= MAX_CONSEGNE_LIMITE ? n : 0;
}

/** Quanto si aspetta un pagamento con la carta prima di non contarlo piu':
 *  chi e' su Stripe sta prendendo quel posto, chi e' sparito da mezz'ora no. */
export const ATTESA_PAGAMENTO_MIN = 30;

/** Una consegna gia' scritta, per quel tanto che serve a contarla. */
export interface RigaOccupazione {
  pickup_time?: unknown;
  status?: unknown;
  payment_method?: unknown;
  created_at?: unknown;
}

/**
 * Questa consegna OCCUPA un fattorino?
 *   · pagata o completata              → si';
 *   · da incassare alla consegna       → si' (e' un ordine vero);
 *   · in pagamento su Stripe da poco   → si': sta prendendo quel posto, e
 *     senza contarla due clienti nello stesso minuto si prenderebbero
 *     l'ultimo;
 *   · annullata, o carrello abbandonato da piu' di mezz'ora → no.
 */
export function occupaFattorino(r: RigaOccupazione, adessoMs: number): boolean {
  const stato = String(r.status ?? "");
  if (stato === "paid" || stato === "done") return true;
  if (stato !== "pending") return false;
  if (String(r.payment_method ?? "") === "onsite") return true;
  const creato = new Date(String(r.created_at ?? "")).getTime();
  return Number.isFinite(creato) && adessoMs - creato <= ATTESA_PAGAMENTO_MIN * 60_000;
}

/** Quante consegne occupano ogni orario («HH:mm» nel fuso della sede). */
export function contaPerOrario(righe: RigaOccupazione[], fuso: string, adessoMs: number): Map<string, number> {
  const conti = new Map<string, number>();
  for (const r of righe) {
    if (!occupaFattorino(r, adessoMs)) continue;
    const t = new Date(String(r.pickup_time ?? ""));
    if (!Number.isFinite(t.getTime())) continue;
    const hhmm = t.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: fuso });
    conti.set(hhmm, (conti.get(hhmm) ?? 0) + 1);
  }
  return conti;
}

/** Gli orari ancora liberi. `max` 0 = nessun limite, tornano tutti. */
export function orariLiberi(orari: string[], conti: Map<string, number>, max: number): string[] {
  if (max <= 0) return orari;
  return orari.filter((o) => (conti.get(o) ?? 0) < max);
}

/* ───────── Le zone: dove si consegna, e a che prezzo ─────────
 *
 * `orders_delivery_zones` (sede): un elenco JSON di zone, ognuna con un nome
 * (per il ristoratore), i codici postali che copre e, se vuole, un costo suo.
 *   [{ "nome": "Centre", "cap": ["1000", "1040"], "costo_cents": 250 }, …]
 *
 * ⚠️ NESSUNA ZONA = SI CONSEGNA OVUNQUE, cioe' il comportamento di prima. Una
 * lista vuota non deve diventare «non si consegna da nessuna parte»: il
 * ristoratore che ha acceso la consegna e non ha ancora scritto le zone si
 * troverebbe un interruttore acceso che non fa niente.
 *
 * ⚠️ CODICI POSTALI, NON UN RAGGIO IN KM. Il raggio vuol dire un servizio
 * esterno che trasforma l'indirizzo in coordinate (a pagamento, o con limiti,
 * e se non risponde il checkout non sa decidere), e la citta' non e' un
 * cerchio: 3 km oltre il canale non sono 3 km di strada. Il codice postale il
 * cliente lo sa, e si controlla senza chiedere niente a nessuno.
 *
 * ⚠️ Il costo della zona SOSTITUISCE il costo unico (`orders_delivery_fee_cents`);
 * zona senza costo = costo unico. La soglia «gratuite dès» vale per tutte.
 */

export interface ZonaConsegna {
  nome: string;
  cap: string[];
  /** `null` = il costo unico di Réglages. */
  costo_cents: number | null;
}

/** Quante zone al massimo: oltre, e' un elenco che nessuno rilegge. */
export const MAX_ZONE = 30;

/** Un codice postale normalizzato: maiuscolo, spazi tolti ai bordi e
 *  compressi. `null` = illeggibile (stessa forma del campo del checkout). */
export function capPulito(v: unknown): string | null {
  const t = String(v ?? "").replace(/\s+/g, " ").trim().toUpperCase();
  return /^[0-9A-Z][0-9A-Z -]{2,9}$/.test(t) ? t : null;
}

/** Le zone salvate, rilette. JSON storto → nessuna zona (= ovunque): una
 *  riga rovinata non deve fermare tutte le consegne. Zone storte si saltano. */
export function zoneDaConfig(raw: unknown): ZonaConsegna[] {
  let arr: unknown = raw;
  if (typeof raw === "string") {
    if (!raw.trim()) return [];
    try {
      arr = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(arr)) return [];
  const out: ZonaConsegna[] = [];
  for (const z of arr.slice(0, MAX_ZONE)) {
    if (!z || typeof z !== "object") continue;
    const r = z as Record<string, unknown>;
    const cap = (Array.isArray(r.cap) ? r.cap : []).map(capPulito).filter((c): c is string => !!c);
    if (cap.length === 0) continue;
    const c = Math.round(Number(r.costo_cents));
    out.push({
      nome: String(r.nome ?? "").trim().slice(0, 40),
      cap: [...new Set(cap)],
      costo_cents: r.costo_cents === null || r.costo_cents === undefined || !Number.isFinite(c) || c < 0 || c > SOGLIA_MAX_CENTS ? null : c,
    });
  }
  return out;
}

/**
 * Le zone scritte in Réglages: nome, codici separati da virgole o spazi, costo
 * in € (vuoto = costo unico). Ritorna le zone pulite oppure l'errore da dire.
 * ⚠️ Un codice in DUE zone si rifiuta: quale costo varrebbe? Il primo trovato,
 * cioe' un prezzo deciso dall'ordine delle righe — nessuno se ne accorgerebbe.
 */
export function zoneDaPagina(
  righe: unknown,
): { zone: ZonaConsegna[] } | { errore: "cap" | "doppio" | "costo" | "troppe"; dettaglio?: string } {
  if (!Array.isArray(righe)) return { zone: [] };
  const zone: ZonaConsegna[] = [];
  const visti = new Map<string, string>();
  for (const r of righe as Record<string, unknown>[]) {
    const nome = String(r?.nome ?? "").trim().slice(0, 40);
    const pezzi = String(r?.cap ?? "").split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean);
    const costoTesto = String(r?.costo ?? "").trim();
    // Riga del tutto vuota: si ignora (e' quella appena aggiunta e mai riempita).
    if (!nome && pezzi.length === 0 && !costoTesto) continue;
    if (pezzi.length === 0) return { errore: "cap", dettaglio: nome };
    const cap: string[] = [];
    for (const p of pezzi) {
      const c = capPulito(p);
      if (!c) return { errore: "cap", dettaglio: p };
      if (visti.has(c) && visti.get(c) !== nome) return { errore: "doppio", dettaglio: c };
      visti.set(c, nome);
      if (!cap.includes(c)) cap.push(c);
    }
    let costo: number | null = null;
    if (costoTesto) {
      const c = euroInCents(costoTesto);
      if (c === null) return { errore: "costo", dettaglio: costoTesto };
      costo = c;
    }
    zone.push({ nome, cap, costo_cents: costo });
  }
  if (zone.length > MAX_ZONE) return { errore: "troppe" };
  return { zone };
}

/**
 * La zona di un codice postale. Senza zone → `"ovunque"` (si consegna, al costo
 * unico). Con zone e codice fuori da tutte → `null` (non si consegna li').
 */
export function zonaDelCap(zone: ZonaConsegna[], cap: unknown): ZonaConsegna | "ovunque" | null {
  if (zone.length === 0) return "ovunque";
  const c = capPulito(cap);
  if (!c) return null;
  return zone.find((z) => z.cap.includes(c)) ?? null;
}

/** Il costo base di una consegna in quella zona, prima della soglia gratis. */
export function costoBaseZona(zona: ZonaConsegna | "ovunque", costoUnico: number): number {
  if (zona === "ovunque" || zona.costo_cents === null) return costoUnico;
  return zona.costo_cents;
}
