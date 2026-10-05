/**
 * IL TICKET DI CUCINA — le regole pure, nessun import.
 *
 * ⚠️ Perche' questo file non importa niente: `admin/sede.ts` arriva a `db.ts`,
 * che LANCIA all'import se mancano le variabili di Supabase — e in vitest
 * mancano. Un file di prova che ci arrivi, anche per tre livelli di import,
 * non parte affatto, e vitest lo conta come «0 test»: verde a colpo d'occhio,
 * nessuna prova eseguita. E' gia' successo due volte (ENGINE.md). Qui ci sono
 * solo regole; chi legge il database sta altrove.
 *
 * ⚠️ IL TICKET DI CUCINA NON E' UNO SCONTRINO. Non porta prezzi, non porta il
 * totale, non porta l'email del cliente. Chi lo legge ha trenta secondi, le
 * mani sporche e il forno acceso: deve vedere l'ORA DI RITIRO, cosa fare, e
 * un nome per chiamare se qualcosa non va. Ogni riga in piu' e' una riga che
 * copre quelle tre.
 */

import { inCassa } from "./ordiniRegole";

/** Chiavi di STAMPA, per sede. Un gruppo puo' avere la stampante in un punto
 *  e non nell'altro, e il punto senza stampante non deve vedere errori. */
export const RIPIEGO_STAMPA: Record<string, string> = {
  /** La stampa automatica e' SPENTA di ripiego: un cliente che non ha
   *  comprato la stampante non deve trovarsi una coda che accumula errori. */
  print_auto: "0",
  /** Numero della stampante nel servizio di stampa. Vuoto = nessuna. */
  print_printer_id: "",
};

export const CHIAVI_STAMPA = Object.keys(RIPIEGO_STAMPA);

/** Un interruttore spento/acceso letto da una chiave di testo. */
export function accesoStampa(valore: unknown): boolean {
  return String(valore ?? "") === "1";
}

/**
 * Si puo' stampare in questa sede, ADESSO?
 *
 * ⚠️ Volere non e' potere, come per i pagamenti: l'interruttore dice che il
 * ristoratore la vuole, il numero della stampante dice che esiste davvero.
 * Senza il secondo, mettere in coda vuol dire accumulare righe che nessuno
 * stampera' mai.
 */
export function stampaAttiva(auto: unknown, printerId: unknown): boolean {
  return accesoStampa(auto) && String(printerId ?? "").trim() !== "";
}

/**
 * Questo ordine merita un ticket di cucina?
 *
 * ⚠️ `paid` e basta non va bene. Un ordine «da incassare» preso dal sito e'
 * `pending` ma la cucina lo deve preparare lo stesso — e' esattamente la
 * distinzione che la pagina Ordini fa gia' per decidere cosa mostrare. Qui si
 * ripete una volta sola, e le due parti del motore non possono litigare.
 */
export function daStampare(stato: unknown, metodo: unknown): boolean {
  const s = String(stato ?? "");
  if (s === "paid") return true;
  return s === "pending" && String(metodo ?? "") === "onsite";
}

/* ==========================================================================
   PIU' STAMPANTI: CHI STAMPA COSA
   ==========================================================================
   Un cliente puo' volere le pizze dal forno, le bibite dal bar, i freddi dai
   freddi. La configurazione e' una riga per destinazione — nome, categorie,
   stampante — e vive in `print_destinazioni`, una chiave per SEDE con il
   ripiego sul marchio: nessuna tabella nuova, nessuna migrazione dello
   schema del menu.

   ⚠️ LA PRINCIPALE NON HA CATEGORIE, e prende tutto quello che nessuna riga
   ha chiesto. E' lei che impedisce a un piatto nuovo — o a una categoria
   rinominata, o a un piatto cancellato dal menu — di finire nel nulla: un
   ticket sulla stampante sbagliata si vede, uno che non esce no.

   ⚠️ UNA CATEGORIA IN DUE RIGHE VUOL DIRE DUE COMANDE, cioe' due pizze. Qui
   si fa rispettare: la PRIMA riga che la nomina se la prende, e
   `categorieDoppie` dice al pannello quali impedire prima di salvare.
   ========================================================================== */

export interface Destinazione {
  /** Nome corto: finisce sul ticket, nella riga «1/3 — altre 2 al Bar». */
  nome: string;
  /** Nomi delle categorie del menu. Vuoto = e' la principale. */
  cat: string[];
  /** Il numero della stampante, come stringa: viene da una tendina. */
  printer: string;
}

export const CHIAVE_DESTINAZIONI = "print_destinazioni";

/** Legge la configurazione senza mai lanciare: una riga storta nel database
 *  non deve impedire a un ordine di stamparsi dalla principale. */
export function leggiDestinazioni(grezzo: unknown): Destinazione[] {
  let righe: unknown;
  try {
    righe = typeof grezzo === "string" ? JSON.parse(grezzo || "[]") : grezzo;
  } catch { return []; }
  if (!Array.isArray(righe)) return [];
  return righe
    .map((r) => {
      const o = (r ?? {}) as { nome?: unknown; cat?: unknown; printer?: unknown };
      return {
        nome: String(o.nome ?? "").trim().slice(0, 24),
        cat: Array.isArray(o.cat) ? o.cat.map((c) => String(c ?? "").trim()).filter(Boolean) : [],
        printer: String(o.printer ?? "").trim(),
      };
    })
    // Una riga senza stampante non e' una destinazione: e' una buona
    // intenzione, e manderebbe i suoi piatti da nessuna parte.
    .filter((d) => d.printer !== "" && d.cat.length > 0);
}

/** Le categorie nominate da piu' di una riga. Il pannello le impedisce PRIMA
 *  di salvare: scoprirlo in cucina vuol dire due comande uguali. */
export function categorieDoppie(righe: { cat?: string[] }[]): string[] {
  const viste = new Set<string>();
  const doppie = new Set<string>();
  for (const r of righe ?? []) {
    for (const c of r?.cat ?? []) {
      if (viste.has(c)) doppie.add(c); else viste.add(c);
    }
  }
  return [...doppie];
}

export interface PiattoDaDividere {
  qty: number;
  nome: string;
  variante?: string | null;
  nota?: string | null;
  /** La categoria del menu, se la si conosce. */
  categoria?: string | null;
}

export interface GruppoStampa {
  /** `""` per la principale, altrimenti il nome della destinazione. Finisce
   *  nella colonna `dest` della coda, ed e' cio' che rende il ticket UNICO
   *  per ordine e stampante: l'indice del database ci si appoggia. */
  chiave: string;
  nome: string;
  printer: string;
  piatti: PiattoDaDividere[];
}

/**
 * Divide i piatti di un ordine fra le stampanti.
 *
 * ⚠️ L'ordine dei gruppi e' quello della configurazione, con la principale
 * sempre PRIMA: cosi' il numero di parte (`1/3`) non cambia da un ordine
 * all'altro, e chi in cucina vede «2/3» sa sempre quale manca.
 *
 * Un gruppo senza piatti non esiste: niente ticket vuoto, e niente stampa
 * pagata per un foglio con solo l'intestazione.
 */
export function dividiTicket(
  piatti: PiattoDaDividere[],
  destinazioni: Destinazione[],
  stampantePrincipale: string,
  nomePrincipale = "",
): GruppoStampa[] {
  const dove = new Map<string, Destinazione>();
  for (const d of destinazioni) {
    for (const c of d.cat) if (!dove.has(c)) dove.set(c, d); // la prima vince
  }
  const gruppi = new Map<string, GruppoStampa>();
  const chiaveDi = (d: Destinazione | undefined) => (d ? d.nome : "");
  for (const p of piatti) {
    const d = p.categoria ? dove.get(p.categoria) : undefined;
    // ⚠️ Una destinazione senza stampante configurata ricade sulla
    // principale invece di perdere il piatto.
    const printer = d?.printer || stampantePrincipale;
    if (!printer) continue;
    const k = d?.printer ? chiaveDi(d) : "";
    const g = gruppi.get(k) ?? { chiave: k, nome: k || nomePrincipale, printer, piatti: [] };
    g.piatti.push(p);
    gruppi.set(k, g);
  }
  const ordinati: GruppoStampa[] = [];
  if (gruppi.has("")) ordinati.push(gruppi.get("")!);
  for (const d of destinazioni) {
    const g = gruppi.get(d.nome);
    if (g && !ordinati.includes(g)) ordinati.push(g);
  }
  return ordinati;
}

/** Quanti tentativi prima di arrendersi. Oltre, la riga diventa `failed` e
 *  nel pannello compare l'avviso: meglio dirlo che riprovare per ore. */
export const MAX_TENTATIVI = 5;

/**
 * Quanti secondi aspettare prima del tentativo numero `n` (1 = il primo
 * rilancio dopo un errore).
 *
 * ⚠️ Non a intervallo fisso. La causa piu' comune e' la stampante spenta o la
 * carta finita: sono guasti che durano minuti, non secondi. Riprovare ogni
 * cinque secondi per mezz'ora vuol dire trecento chiamate inutili al servizio
 * di stampa, e l'ordine stampato comunque tardi. Si allarga: 10s, 30s, 2min,
 * 5min, 15min — l'ultimo tentativo cade mezz'ora dopo, che e' il tempo in cui
 * qualcuno si accorge e rimette la carta.
 */
const ATTESE = [10, 30, 120, 300, 900];

export function attesaTentativo(n: number): number {
  if (!Number.isFinite(n) || n < 1) return ATTESE[0];
  return ATTESE[Math.min(Math.floor(n), ATTESE.length) - 1];
}

/** Una riga del ticket. Il disegno del cliente restituisce queste, e il
 *  motore le trasforma nella pagina che il servizio di stampa legge. */
export interface RigaTicket {
  testo: string;
  /** ⚠️ `gigante` NON e' «grande di piu'»: e' doppia larghezza, cioe' **24
   *  colonne invece di 48**. Va bene per l'ora, che e' corta; su un nome di
   *  piatto manderebbe a capo mezzo menu. I piatti sono `grande` (doppia
   *  altezza sola), che resta a 48. Le colonne di ogni taglia sono dichiarate
   *  in `escpos.ts`, una volta. */
  taglia?: "gigante" | "grande" | "normale" | "piccolo";
  grassetto?: boolean;
  centrato?: boolean;
  /** Bianco su nero, a tutta larghezza. Per le DUE righe che, se non si
   *  vedono, fanno sbagliare l'ordine: il giorno quando non e' oggi, e i soldi
   *  da incassare. Alla terza non e' piu' un allarme, e' decorazione. */
  inverso?: boolean;
  /** Una linea di separazione sotto questa riga. */
  linea?: boolean;
}

export interface OrdineDaStampare {
  numero: string;
  ora: string;
  cliente: string;
  telefono?: string | null;
  note?: string | null;
  piatti: { qty: number; nome: string; variante?: string | null; nota?: string | null }[];
  daIncassare?: boolean;
  /** Quando l'ordine esce da piu' stampanti. ⚠️ Senza questo, chi prepara
   *  legge un ticket che SEMBRA tutto l'ordine ed e' un terzo: peggio di
   *  nessun ticket, perche' non sa che manca qualcosa. */
  parte?: { n: number; su: number; altri: { nome: string; righe: number }[] } | null;
}

/** Una riga di `orders` per quel poco che serve a stampare. Scritta qui e non
 *  presa dalla pagina Ordini: quel tipo vive dentro uno `<script>` e non si
 *  puo' importare, e copiarlo tutto vorrebbe dire tenerne allineati due. */
export interface RigaOrdine {
  id: string;
  status?: string | null;
  payment_method?: string | null;
  customer_name?: string | null;
  customer_phone?: string | null;
  items?: { id?: string; name?: string; base_name?: string; variant_label?: string; qty?: number; notes?: string }[];
}

/**
 * Dalla riga del database all'ordine da stampare. Pura: l'ora arriva gia'
 * formattata nel fuso del ristorante, perche' il fuso e' una domanda al
 * database e qui dentro non si fanno domande.
 *
 * ⚠️ IL NUMERO non esiste nel database: `orders` ha solo un id lungo. Si
 * prendono le ultime quattro cifre, che e' quello che la gente riesce a
 * leggersi a voce al banco. Il giorno che si vorra' «ordine 7» servira' una
 * colonna vera, e andra' scritta anche nel pannello: due numeri diversi per lo
 * stesso ordine sono peggio di nessun numero.
 */
export function ordineDaRiga(o: RigaOrdine, ora: string): OrdineDaStampare {
  const items = Array.isArray(o.items) ? o.items : [];
  const nota = items.find((i) => String(i?.id ?? "") === "note");
  return {
    numero: String(o.id ?? "").replace(/-/g, "").slice(-4).toUpperCase(),
    ora,
    cliente: String(o.customer_name ?? "").trim(),
    telefono: String(o.customer_phone ?? "").trim() || null,
    note: String(nota?.notes ?? "").trim() || null,
    piatti: items
      .filter((i) => String(i?.id ?? "") !== "note" && Number(i?.qty ?? 0) > 0)
      .map((i) => ({
        qty: Math.max(1, Math.floor(Number(i.qty) || 1)),
        // `base_name` c'e' solo sugli ordini dal 10/09/2026; `name` c'e'
        // sempre, ma porta dentro anche il formato. Il piu' preciso vince.
        nome: String(i.base_name ?? i.name ?? "").trim(),
        variante: String(i.variant_label ?? "").trim() || null,
        nota: String(i.notes ?? "").trim() || null,
      })),
    // ⚠️ «Da incassare» e' una domanda sui SOLDI, non sullo stato: un ordine
    // preso al telefono e pagato al ritiro resta `pending` fino al banco, e
    // quella fascia nera e' l'unica cosa che impedisce di consegnare senza
    // farsi pagare.
    daIncassare: String(o.status ?? "") === "pending" && inCassa(o.payment_method),
  };
}

/**
 * IL TICKET DI RIPIEGO del motore: quello che esce se il cliente non ha un
 * disegno suo. Ogni cliente puo' sostituirlo con il proprio file; questo deve
 * restare leggibile da solo, perche' e' quello che vedranno i primi giorni.
 */
export function ticketCucina(o: OrdineDaStampare): RigaTicket[] {
  const righe: RigaTicket[] = [
    { testo: o.ora, taglia: "gigante", grassetto: true, centrato: true },
    { testo: `#${o.numero}`, taglia: "piccolo", centrato: true, linea: true },
  ];
  // ⚠️ «DA INCASSARE» sta in ALTO, non in fondo. Chi prepara passa il
  // sacchetto a chi sta in cassa, e deve sapere prima di consegnarlo che quei
  // soldi non sono ancora entrati.
  if (o.daIncassare) {
    righe.push({ testo: "DA INCASSARE", taglia: "grande", grassetto: true, centrato: true, inverso: true });
  }
  for (const p of o.piatti) {
    righe.push({ testo: `${p.qty}x ${p.nome}`, taglia: "grande", grassetto: true });
    if (p.variante) righe.push({ testo: `   ${p.variante}`, taglia: "normale" });
    // La nota del piatto e' il punto in cui si sbaglia un ordine: mai piccola.
    if (p.nota) righe.push({ testo: `   ${p.nota}`, taglia: "normale", grassetto: true });
  }
  righe.push({ testo: "", linea: true });
  // ⚠️ Prima del cliente, perche' riguarda la PREPARAZIONE: «questo non e'
  // tutto l'ordine». In fondo al foglio nessuno la leggerebbe.
  if (o.parte && o.parte.su > 1) {
    const altri = o.parte.altri.map((a) => `${a.righe}x ${a.nome}`).join(", ");
    righe.push({
      testo: altri ? `${o.parte.n}/${o.parte.su} — anche: ${altri}` : `${o.parte.n}/${o.parte.su}`,
      taglia: "normale",
      grassetto: true,
      linea: true,
    });
  }
  righe.push({ testo: o.cliente, taglia: "normale", grassetto: true });
  if (o.telefono) righe.push({ testo: o.telefono, taglia: "normale" });
  if (o.note) righe.push({ testo: o.note, taglia: "normale", grassetto: true });
  return righe;
}
