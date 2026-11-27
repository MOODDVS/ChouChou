/**
 * INCASSARE UN TAVOLO DAL PALMARE, E CHIUDERLO (Enzo, 26/10/2026).
 *
 * Il modale del totale ha due strade:
 *  1. «Paiement en caisse» (`chiediContoInCassa`): esce l'addizione sulla
 *     stampante principale, parte la richiesta d'addizione (`table_calls`,
 *     `reason = 'bill'`: notifica e tavolo BLU sulla mappa). Il tavolo resta
 *     blu finche' qualcuno non incassa, da qualunque parte: Commandes
 *     (contanti, carta, QR) o il palmare.
 *  2. «Encaisser»: tutto, diviso o scelto, contanti / carta / QR — in
 *     `pagamentiSeduta.ts`; saldato il tavolo, la seduta si chiude.
 * `chiudiSeContoChiesto`: dopo un incasso fatto ALTROVE (Commandes, QR della
 * cassa), la seduta si chiude solo se il conto era stato chiesto — se no i
 * clienti possono ancora essere a tavola.
 * ⚠️ Mai il conto aperto del QR: si chiude da Commandes (`chiudiSessioneConto`).
 *
 * VENTI MINUTI DOPO «Paiement en caisse» (27/11/2026, #102): la cassa e' fuori
 * da RestoHub, e nessuno torna sul palmare a dire «hanno pagato». Il tavolo
 * si libera da solo (`liberaCasseScadute`) e i suoi ordini da incassare si
 * chiudono come pagati in cassa. Un ordine nuovo nel frattempo (il caffe')
 * ristampa l'addizione e fa ripartire il tempo (`rilanciaCassa`). Regole in
 * `cassaTavoloRegole.ts`.
 */
import { leggi, aggiorna, inserisci, ambitoDiRiga, type Ambito } from "./sede";
import { sogliaCassa } from "../cassaTavoloRegole";
import { letturaSala } from "./letturaSala";
import { tavoloDellaRiga, tavoliDelleRiga } from "./schedaTavoloRegole";
import { stampaAddizioneTavolo } from "./addizioneTavolo";
import { inviaPushChiamata } from "../push";

interface SedutaIncasso {
  id: string;
  tavoli: string[];
  /** Gli ordini ancora DA INCASSARE (`pending` + `onsite`). */
  ordini: { id: string; total_cents: number; table_label: string | null }[];
  totale: number;
}

type Errore = "nessuno" | "conto" | "vuoto";

async function sedutaDaIncassare(ambito: Ambito, tavoloId: string): Promise<SedutaIncasso | Errore> {
  if (!/^[0-9a-f-]{36}$/i.test(tavoloId)) return "nessuno";
  const l = await letturaSala(ambito);
  const s = l.righe
    .filter((r) => r.status === "seated" && tavoloDellaRiga(r, tavoloId))
    .sort((a, b) => String(b.seated_at ?? "").localeCompare(String(a.seated_at ?? "")))[0];
  if (!s) return "nessuno";
  if (s.tab_status === "pending" || s.tab_status === "open") return "conto";
  const { data } = await leggi("orders", ambito, "id, total_cents, table_label")
    .eq("reservation_id", s.id)
    .eq("status", "pending")
    .eq("payment_method", "onsite");
  const ordini = ((data ?? []) as unknown as SedutaIncasso["ordini"]);
  return {
    id: s.id,
    tavoli: [...new Set([...(s.tab_table_id ? [s.tab_table_id] : []), ...tavoliDelleRiga(s.tables)])],
    ordini,
    totale: ordini.reduce((n, o) => n + Math.max(0, Math.round(Number(o.total_cents) || 0)), 0),
  };
}

/** La seduta finisce (`done`) e le richieste d'addizione dei suoi tavoli si
 *  chiudono: il tavolo torna libero e non e' piu' blu. */
export async function chiudiSeduta(ambito: Ambito, prenId: string, tavoli: string[]): Promise<void> {
  await aggiorna("reservations", ambito, { status: "done" }).eq("id", prenId).eq("status", "seated");
  if (tavoli.length) {
    await aggiorna("table_calls", ambito, { status: "done", done_at: new Date().toISOString() })
      .in("table_id", tavoli)
      .eq("status", "open");
  }
}

export type EsitoCassa = { ok: true; stampa: boolean } | { ok: false; errore: Errore };

/** 1. «Paiement en caisse»: l'addizione in cassa + la richiesta d'addizione. */
export async function chiediContoInCassa(ambito: Ambito, tavoloId: string): Promise<EsitoCassa> {
  const s = await sedutaDaIncassare(ambito, tavoloId);
  if (typeof s === "string") return { ok: false, errore: s };
  if (!s.ordini.length) return { ok: false, errore: "vuoto" };
  const stampa = await stampaAddizioneTavolo(ambito, tavoloId);
  // Una richiesta aperta sola per tavolata: il secondo tocco non ne fa due.
  const { data: aperte } = await leggi("table_calls", ambito, "id")
    .in("table_id", s.tavoli)
    .eq("status", "open")
    .eq("reason", "bill")
    .limit(1);
  if (!(aperte ?? []).length) {
    const { data: tRaw } = await leggi("restaurant_tables", ambito, "id, name").in("id", s.tavoli);
    const nomi = ((tRaw ?? []) as unknown as { id: string; name: string }[])
      .map((t) => t.name).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).join(" + ");
    const ins = await inserisci("table_calls", ambito, {
      table_id: s.tavoli[0],
      table_label: nomi,
      caller_name: "",
      status: "open",
      reason: "bill",
    });
    if (ins.error) console.error("[palmare] richiesta d'addizione:", ins.error);
    else void inviaPushChiamata({ tavolo: nomi, addizione: true }, ambito).catch(() => {});
  }
  await segnaCassa(ambito, s.id);
  return { ok: true, stampa: stampa.ok };
}

/** Il «Pagamento in cassa» parte (o riparte) adesso: fra venti minuti il
 *  tavolo si libera. Senza la #102 non si scrive niente: tutto come prima. */
async function segnaCassa(ambito: Ambito, prenId: string): Promise<void> {
  const { error } = await aggiorna("reservations", ambito, { desk_at: new Date().toISOString() })
    .eq("id", prenId)
    .eq("status", "seated");
  if (error && !String(error.message ?? "").includes("desk_at")) {
    console.error("[palmare] ora della cassa:", error);
  }
}

/**
 * UN ORDINE NUOVO SU UN TAVOLO CHE HA GIA' CHIESTO IL CONTO (il caffe' dopo
 * «Pagamento in cassa»): esce di nuovo l'addizione COMPLETA, aggiornata, e i
 * venti minuti ripartono. Il tavolo torna blu se qualcuno aveva toccato il
 * toast nel frattempo. Mai bloccante: lo chiamano il palmare e il checkout
 * dopo che l'ordine esiste gia'.
 * ⚠️ Niente se il conto non era stato chiesto (`desk_at` vuoto): un tavolo che
 * ordina il secondo giro non deve far uscire un'addizione in cassa.
 */
export async function rilanciaCassa(ambito: Ambito, prenId: string): Promise<boolean> {
  try {
    if (!/^[0-9a-f-]{36}$/i.test(prenId)) return false;
    const { data: rRaw, error } = await leggi("reservations", ambito, "id, status, tables, tab_table_id, tab_status, desk_at")
      .eq("id", prenId).maybeSingle();
    if (error) return false; // senza la #102: come prima
    const r = rRaw as unknown as {
      id: string; status: string; tables: unknown; tab_table_id: string | null; tab_status: string | null; desk_at: string | null;
    } | null;
    if (!r || r.status !== "seated" || !r.desk_at) return false;
    if (r.tab_status === "pending" || r.tab_status === "open") return false;
    const tavoli = [...new Set([...(r.tab_table_id ? [r.tab_table_id] : []), ...tavoliDelleRiga(r.tables)])];
    if (!tavoli.length) return false;
    await segnaCassa(ambito, r.id);
    await stampaAddizioneTavolo(ambito, tavoli[0]);
    // Il tavolo resta (o torna) blu, senza suonare di nuovo i telefoni.
    const { data: aperte } = await leggi("table_calls", ambito, "id")
      .in("table_id", tavoli).eq("status", "open").eq("reason", "bill").limit(1);
    if (!(aperte ?? []).length) {
      const { data: tRaw } = await leggi("restaurant_tables", ambito, "id, name").in("id", tavoli);
      const nomi = ((tRaw ?? []) as unknown as { id: string; name: string }[])
        .map((t) => t.name).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).join(" + ");
      await inserisci("table_calls", ambito, {
        table_id: tavoli[0], table_label: nomi, caller_name: "", status: "open", reason: "bill",
      });
    }
    return true;
  } catch (e) {
    console.error("[palmare] rilancio della cassa:", e);
    return false;
  }
}

/**
 * I TAVOLI CON «PAGAMENTO IN CASSA» DA VENTI MINUTI: si liberano. Gli ordini
 * ancora da incassare si chiudono come pagati in cassa (`done`, metodo
 * `onsite` — da Commandes lo si puo' ancora cambiare in contanti o carta),
 * poi la seduta finisce e il tavolo non e' piu' blu. Rende quanti tavoli ha
 * liberato.
 * ⚠️ Mai un conto aperto del QR: quello si chiude da Commandes.
 * ⚠️ Ogni passo e' condizionato (`pending` + `onsite`, seduta `seated`): il
 * job e due tablet nello stesso secondo non fanno danni, e un ordine
 * incassato a mano nel frattempo resta col suo metodo.
 * Lettura fallita (la #102 non lanciata) → 0, niente si tocca.
 */
export async function liberaCasseScadute(ambito: Ambito, limite = 50): Promise<number> {
  try {
    const { data, error } = await leggi("reservations", ambito, "id, location_id, tables, tab_table_id, tab_status, desk_at")
      .eq("status", "seated")
      .not("desk_at", "is", null)
      .lte("desk_at", sogliaCassa())
      .limit(limite);
    if (error || !data?.length) return 0;
    let liberati = 0;
    for (const r of data as unknown as { id: string; location_id: string | null; tables: unknown; tab_table_id: string | null; tab_status: string | null }[]) {
      if (r.tab_status === "pending" || r.tab_status === "open") continue;
      const a = ambitoDiRiga(r.location_id);
      const chiusi = await aggiorna("orders", a, { status: "done" })
        .eq("reservation_id", r.id).eq("status", "pending").eq("payment_method", "onsite");
      if (chiusi.error) {
        console.error("[palmare] chiusura degli ordini in cassa:", chiusi.error);
        continue; // i soldi prima del tavolo: si riprova al giro dopo
      }
      const tavoli = [...new Set([...(r.tab_table_id ? [r.tab_table_id] : []), ...tavoliDelleRiga(r.tables)])];
      await chiudiSeduta(a, r.id, tavoli);
      liberati++;
    }
    return liberati;
  } catch (e) {
    console.error("[palmare] tavoli da liberare:", e);
    return 0;
  }
}

/**
 * Dopo un incasso fatto ALTROVE (Commandes, il webhook del QR): se la seduta
 * non ha piu' niente da incassare, si chiude — ma solo se `forza` (il QR del
 * palmare) o se il conto era stato chiesto (richiesta d'addizione aperta):
 * altrimenti i clienti possono ancora essere a tavola.
 */
export async function chiudiSeContoChiesto(ambito: Ambito, prenId: string, forza = false): Promise<void> {
  if (!/^[0-9a-f-]{36}$/i.test(prenId)) return;
  const { data: rRaw } = await leggi("reservations", ambito, "id, status, tables, tab_table_id, tab_status").eq("id", prenId).maybeSingle();
  const r = rRaw as unknown as { id: string; status: string; tables: unknown; tab_table_id: string | null; tab_status: string | null } | null;
  if (!r || r.status !== "seated" || r.tab_status === "pending" || r.tab_status === "open") return;
  const { count } = await leggi("orders", ambito, "id", { count: "exact", head: true })
    .eq("reservation_id", r.id).eq("status", "pending").eq("payment_method", "onsite");
  if ((count ?? 0) > 0) return;
  const tavoli = [...new Set([...(r.tab_table_id ? [r.tab_table_id] : []), ...tavoliDelleRiga(r.tables)])];
  if (!forza) {
    if (!tavoli.length) return;
    const { data: aperte } = await leggi("table_calls", ambito, "id")
      .in("table_id", tavoli).eq("status", "open").eq("reason", "bill").limit(1);
    /* «Pagamento in cassa» toccato (#102) vale come conto chiesto anche se
       qualcuno ha gia' chiuso il toast dell'addizione. */
    if (!(aperte ?? []).length) {
      const { data: d, error: eD } = await leggi("reservations", ambito, "desk_at").eq("id", r.id).maybeSingle();
      if (eD || !(d as { desk_at?: unknown } | null)?.desk_at) return;
    }
  }
  await chiudiSeduta(ambito, r.id, tavoli);
}
