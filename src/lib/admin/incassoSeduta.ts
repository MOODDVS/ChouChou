/**
 * INCASSARE UN TAVOLO DAL PALMARE, E CHIUDERLO (Enzo, 26/10/2026).
 *
 * Il modale del totale ha due strade:
 *  1. «Paiement en caisse» (`chiediContoInCassa`): esce l'addizione sulla
 *     stampante principale, parte la richiesta d'addizione (`table_calls`,
 *     `reason = 'bill'`: notifica e tavolo BLU sulla mappa). Il tavolo resta
 *     blu finche' qualcuno non incassa, da qualunque parte: Commandes
 *     (contanti, carta, QR) o il palmare.
 *  2. «Encaisser» (`incassaSeduta`): contanti o carta → gli ordini da
 *     incassare diventano pagati e la seduta si chiude subito (tavolo
 *     libero); QR (`qrSeduta`) → il QR del pagamento Stripe del tavolo, e
 *     il webhook chiude la seduta quando arriva il pagamento.
 * `chiudiSeContoChiesto`: dopo un incasso fatto ALTROVE (Commandes, QR della
 * cassa), la seduta si chiude solo se il conto era stato chiesto — se no i
 * clienti possono ancora essere a tavola.
 * ⚠️ Mai il conto aperto del QR: si chiude da Commandes (`chiudiSessioneConto`).
 */
import { leggi, aggiorna, inserisci, type Ambito } from "./sede";
import { letturaSala } from "./letturaSala";
import { tavoloDellaRiga, tavoliDelleRiga } from "./schedaTavoloRegole";
import { stampaAddizioneTavolo } from "./addizioneTavolo";
import { inviaPushChiamata } from "../push";
import { creaCheckoutIncasso } from "../stripe";
import { qrSvg } from "../qrSvg";
import { CLIENT } from "../../config/client";

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
async function chiudiSeduta(ambito: Ambito, prenId: string, tavoli: string[]): Promise<void> {
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
  return { ok: true, stampa: stampa.ok };
}

export type EsitoIncasso = { ok: true; totale: number } | { ok: false; errore: Errore | "salvataggio" };

/** 2a. «Encaisser» in contanti o carta: tutto pagato, seduta chiusa. */
export async function incassaSeduta(ambito: Ambito, tavoloId: string, metodo: unknown): Promise<EsitoIncasso> {
  if (metodo !== "cash" && metodo !== "card") return { ok: false, errore: "salvataggio" };
  const s = await sedutaDaIncassare(ambito, tavoloId);
  if (typeof s === "string") return { ok: false, errore: s };
  const ids = s.ordini.map((o) => o.id);
  if (ids.length) {
    // Gia' pronti: chiusi (come l'incasso al banco). Senza la #89 non c'e' la colonna.
    await aggiorna("orders", ambito, { status: "done", payment_method: metodo })
      .in("id", ids).eq("status", "pending").eq("payment_method", "onsite").not("ready_at", "is", null);
    const r = await aggiorna("orders", ambito, { status: "paid", payment_method: metodo })
      .in("id", ids).eq("status", "pending").eq("payment_method", "onsite");
    if (r.error) return { ok: false, errore: "salvataggio" };
  }
  await chiudiSeduta(ambito, s.id, s.tavoli);
  return { ok: true, totale: s.totale };
}

export type EsitoQr = { ok: true; svg: string; totale: number } | { ok: false; errore: Errore | "stripe" };

/** 2b. «Encaisser» col QR: il pagamento Stripe del tavolo. */
export async function qrSeduta(ambito: Ambito, tavoloId: string, base: string): Promise<EsitoQr> {
  const s = await sedutaDaIncassare(ambito, tavoloId);
  if (typeof s === "string") return { ok: false, errore: s };
  if (!s.ordini.length || s.totale <= 0) return { ok: false, errore: "vuoto" };
  const tavolo = s.ordini.map((o) => String(o.table_label ?? "").trim()).find(Boolean) ?? "";
  try {
    const c = await creaCheckoutIncasso({
      ambito,
      ordini: s.ordini.map((o) => o.id),
      chiudiSeduta: s.id,
      nome: `${CLIENT.nome}${tavolo ? ` · ${tavolo}` : ""}`,
      totaleCents: s.totale,
      successUrl: `${base}/paiement/ok`,
      cancelUrl: `${base}/paiement/ok?annule=1`,
    });
    return { ok: true, svg: qrSvg(c.url), totale: s.totale };
  } catch (e) {
    console.error("[palmare] QR:", String((e as Error)?.message ?? e));
    return { ok: false, errore: "stripe" };
  }
}

/** Il palmare chiede: e' pagato? (la seduta non e' piu' da incassare) */
export async function sedutaPagata(ambito: Ambito, tavoloId: string): Promise<boolean> {
  const s = await sedutaDaIncassare(ambito, tavoloId);
  if (s === "nessuno") return true; // chiusa: il webhook ha gia' fatto
  if (typeof s === "string") return false;
  return s.ordini.length === 0;
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
    if (!(aperte ?? []).length) return;
  }
  await chiudiSeduta(ambito, r.id, tavoli);
}
