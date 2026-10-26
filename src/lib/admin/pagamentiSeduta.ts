/**
 * INCASSARE UN TAVOLO IN PARTI — dal palmare (Enzo, 26/10/2026).
 *
 * «Encaisser» ha tre modi, che si possono mescolare:
 *  - TUTTO: quello che resta, in un colpo;
 *  - DIVIDI: il resto diviso per le persone (proposte dalla prenotazione,
 *    modificabili); ogni quota col suo metodo. Le quote si ricalcolano SEMPRE
 *    su quello che resta: cambiare il numero dopo un pagamento non tocca
 *    l'incassato. L'ultima quota prende i centesimi (71,50 € in 4 = 17,87 +
 *    17,87 + 17,88 + 17,88);
 *  - SCEGLI: gli articoli spuntati (un piatto ×2 = due righe), poi il metodo.
 * Ogni parte e' una riga di `table_payments` (#88, la stessa del conto
 * aperto del QR): importo, metodo (cash / card / online), chi («2/4»), e per
 * «Scegli» gli articoli (`items`, #91). Il QR di una parte e' un pagamento
 * `online` in corso col suo Stripe (`creaCheckoutConto`): il webhook lo segna
 * pagato (`segnaPagato`) e poi `dopoPagamentoSeduta`.
 * Quando il resto arriva a 0, gli ordini diventano pagati (gia' pronti =
 * chiusi) e la seduta si chiude: il tavolo torna libero.
 * ⚠️ Solo i tavoli del cameriere: il conto aperto del QR ha la sua strada.
 * ⚠️ Il totale sono gli ordini DA INCASSARE (`pending` + `onsite`): gli
 * ordini restano cosi' finche' il tavolo non e' saldato.
 */
import { leggi, aggiorna, inserisci, type Ambito } from "./sede";
import { letturaSala } from "./letturaSala";
import { tavoloDellaRiga, tavoliDelleRiga } from "./schedaTavoloRegole";
import { piattiVeri } from "./ordiniConti";
import { pagamentoVivo, quadroPagamenti } from "../contoRegole";
import { creaCheckoutConto } from "../stripe";
import { qrSvg } from "../qrSvg";
import { chiudiSeduta } from "./incassoSeduta";
import { CLIENT } from "../../config/client";
import { quoteRestanti } from "../pagamentiSedutaRegole";

export interface ArticoloSeduta {
  key: string;
  nome: string;
  variante: string | null;
  prezzo: number;
  pagato: boolean;
}
export interface ParteSeduta {
  chi: string;
  modo: "tutto" | "dividi" | "scegli";
  metodo: string;
  importo: number;
  pagata: boolean;
}
export interface QuadroSeduta {
  chiusa: boolean;
  persone: number;
  totale: number;
  pagato: number;
  inCorso: number;
  resto: number;
  /** Il resto meno i pagamenti online in corso: cio' che si puo' ancora chiedere. */
  libero: number;
  parti: ParteSeduta[];
  /** Quante quote di «Dividi» sono gia' fatte (pagate o in corso). */
  quoteFatte: number;
  articoli: ArticoloSeduta[];
  /** «Scegli» c'e' solo con la #91. */
  scegli: boolean;
}

interface Seduta { id: string; tavoli: string[]; persone: number }
interface RigaPag {
  id: string; kind: string; method: string; status: string; amount_cents: number;
  hold_until: string | null; order_ids: string[] | null; payer_name: string | null;
  created_at: string; items?: { o: string; i: number; u: number }[] | null;
}
interface OrdineDaIncassare { id: string; items: unknown; total_cents: number | null; ready_at?: string | null }

const MODO: Record<string, ParteSeduta["modo"]> = { rest: "tutto", share: "dividi", mine: "scegli" };
const KIND: Record<ParteSeduta["modo"], string> = { tutto: "rest", dividi: "share", scegli: "mine" };

async function sedutaDelTavolo(ambito: Ambito, tavoloId: string): Promise<Seduta | null> {
  if (!/^[0-9a-f-]{36}$/i.test(tavoloId)) return null;
  const l = await letturaSala(ambito);
  const s = l.righe
    .filter((r) => r.status === "seated" && tavoloDellaRiga(r, tavoloId))
    .sort((a, b) => String(b.seated_at ?? "").localeCompare(String(a.seated_at ?? "")))[0];
  if (!s || s.tab_status === "pending" || s.tab_status === "open") return null;
  return {
    id: s.id,
    tavoli: [...new Set([...(s.tab_table_id ? [s.tab_table_id] : []), ...tavoliDelleRiga(s.tables)])],
    persone: Math.max(1, Number(s.people) || 1),
  };
}

async function leggiTutto(ambito: Ambito, s: Seduta) {
  const [oRes, pagRes] = await Promise.all([
    leggi("orders", ambito, "id, items, total_cents, created_at")
      .eq("reservation_id", s.id).eq("status", "pending").eq("payment_method", "onsite")
      .order("created_at", { ascending: true }),
    leggi("table_payments", ambito, "id, kind, method, status, amount_cents, hold_until, order_ids, payer_name, created_at, items")
      .eq("reservation_id", s.id).order("created_at", { ascending: true }),
  ]);
  let pagamenti = (pagRes.data ?? []) as unknown as RigaPag[];
  let scegli = !pagRes.error;
  if (pagRes.error) {
    // Senza la #91: niente `items`, e niente «Scegli».
    const r = await leggi("table_payments", ambito, "id, kind, method, status, amount_cents, hold_until, order_ids, payer_name, created_at")
      .eq("reservation_id", s.id).order("created_at", { ascending: true });
    pagamenti = (r.data ?? []) as unknown as RigaPag[];
    scegli = false;
  }
  return { ordini: (oRes.data ?? []) as unknown as OrdineDaIncassare[], pagamenti, scegli };
}

function quadro(s: Seduta, ordini: OrdineDaIncassare[], pagamenti: RigaPag[], scegli: boolean): QuadroSeduta {
  const adesso = new Date();
  const vivi = pagamenti.filter((p) => pagamentoVivo(p, adesso));
  const totale = ordini.reduce((n, o) => n + Math.max(0, Math.round(Number(o.total_cents) || 0)), 0);
  const q = quadroPagamenti(totale, vivi, adesso);
  const pagate = new Set<string>();
  for (const p of vivi) for (const it of p.items ?? []) pagate.add(`${it.o}:${it.i}:${it.u}`);
  const articoli: ArticoloSeduta[] = [];
  for (const o of ordini) {
    const lista = (Array.isArray(o.items) ? o.items : []) as { id?: unknown; qty?: unknown; name?: unknown; base_name?: unknown; variant_label?: unknown; price_cents?: unknown }[];
    lista.forEach((it, i) => {
      if (!piattiVeri([it]).length) return;
      const qty = Math.max(0, Math.floor(Number(it.qty) || 0));
      for (let u = 0; u < qty; u++) {
        const key = `${o.id}:${i}:${u}`;
        articoli.push({
          key,
          nome: String(it.base_name ?? it.name ?? "").trim(),
          variante: String(it.variant_label ?? "").trim() || null,
          prezzo: Math.max(0, Math.round(Number(it.price_cents) || 0)),
          pagato: pagate.has(key),
        });
      }
    });
  }
  return {
    chiusa: false,
    persone: s.persone,
    ...q,
    parti: vivi.map((p) => ({
      chi: String(p.payer_name ?? ""),
      modo: MODO[p.kind] ?? "tutto",
      metodo: p.method,
      importo: Math.round(Number(p.amount_cents) || 0),
      pagata: p.status === "paid",
    })),
    quoteFatte: vivi.filter((p) => p.kind === "share").length,
    articoli,
    scegli,
  };
}

const CHIUSA: QuadroSeduta = { chiusa: true, persone: 0, totale: 0, pagato: 0, inCorso: 0, resto: 0, libero: 0, parti: [], quoteFatte: 0, articoli: [], scegli: false };

/** Il quadro dei pagamenti del tavolo (il modale «Encaisser» del palmare). */
export async function quadroSeduta(ambito: Ambito, tavoloId: string): Promise<QuadroSeduta | null> {
  const s = await sedutaDelTavolo(ambito, tavoloId);
  if (!s) return CHIUSA;
  const { ordini, pagamenti, scegli } = await leggiTutto(ambito, s);
  return quadro(s, ordini, pagamenti, scegli);
}

/** Saldato: ordini pagati (col metodo che ha pagato di piu'), seduta chiusa. */
async function finalizza(ambito: Ambito, s: Seduta, ordini: OrdineDaIncassare[], pagamenti: RigaPag[]): Promise<void> {
  const perMetodo = new Map<string, number>();
  for (const p of pagamenti) {
    if (p.status !== "paid") continue;
    const m = p.method === "online" ? "link" : p.method;
    perMetodo.set(m, (perMetodo.get(m) ?? 0) + (Number(p.amount_cents) || 0));
  }
  const metodo = [...perMetodo.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "cash";
  const ids = ordini.map((o) => o.id);
  if (ids.length) {
    await aggiorna("orders", ambito, { status: "done", payment_method: metodo })
      .in("id", ids).eq("status", "pending").eq("payment_method", "onsite").not("ready_at", "is", null);
    await aggiorna("orders", ambito, { status: "paid", payment_method: metodo })
      .in("id", ids).eq("status", "pending").eq("payment_method", "onsite");
  }
  await chiudiSeduta(ambito, s.id, s.tavoli);
}

export type EsitoParte =
  | { ok: true; chiusa: boolean; quadro: QuadroSeduta }
  | { ok: true; qr: { svg: string; importo: number; id: string } }
  | { ok: false; errore: "nessuno" | "importo" | "quote" | "articoli" | "salvataggio" | "stripe" };

/**
 * UNA PARTE: `modo` tutto | dividi (con `n` persone) | scegli (con `items`),
 * `metodo` cash | card (pagata subito) | online (il QR: pagamento in corso).
 * ⚠️ L'importo lo calcola QUI il server, mai il browser.
 */
export async function pagaParte(ambito: Ambito, tavoloId: string, req: {
  modo?: unknown; metodo?: unknown; n?: unknown; items?: unknown;
}, base = ""): Promise<EsitoParte> {
  const s = await sedutaDelTavolo(ambito, tavoloId);
  if (!s) return { ok: false, errore: "nessuno" };
  const metodo = String(req.metodo ?? "");
  if (!["cash", "card", "online"].includes(metodo)) return { ok: false, errore: "importo" };
  const modo = String(req.modo ?? "") as ParteSeduta["modo"];
  const { ordini, pagamenti, scegli } = await leggiTutto(ambito, s);
  const q = quadro(s, ordini, pagamenti, scegli);
  let importo = 0;
  let chi = "";
  let items: { o: string; i: number; u: number }[] = [];
  if (modo === "tutto") {
    importo = q.libero;
  } else if (modo === "dividi") {
    const n = Math.floor(Number(req.n));
    if (!Number.isFinite(n) || n < 1 || n > 50) return { ok: false, errore: "quote" };
    const restanti = n - q.quoteFatte;
    if (restanti < 1) return { ok: false, errore: "quote" };
    importo = quoteRestanti(q.libero, restanti)[0] ?? 0;
    chi = `${q.quoteFatte + 1}/${n}`;
  } else if (modo === "scegli") {
    if (!scegli) return { ok: false, errore: "articoli" };
    const chieste = [...new Set((Array.isArray(req.items) ? req.items : []).map(String))];
    const perKey = new Map(q.articoli.map((a) => [a.key, a]));
    for (const k of chieste) {
      const a = perKey.get(k);
      if (!a || a.pagato) return { ok: false, errore: "articoli" };
      importo += a.prezzo;
      const [o, i, u] = k.split(":");
      items.push({ o, i: Number(i), u: Number(u) });
    }
    if (!items.length) return { ok: false, errore: "articoli" };
    importo = Math.min(importo, q.libero);
  } else {
    return { ok: false, errore: "importo" };
  }
  if (importo <= 0 || importo > q.libero) return { ok: false, errore: "importo" };

  const online = metodo === "online";
  const scadenza = new Date(Date.now() + 31 * 60 * 1000);
  const riga: Record<string, unknown> = {
    reservation_id: s.id,
    kind: KIND[modo],
    method: metodo,
    status: online ? "pending" : "paid",
    amount_cents: importo,
    payer_name: chi || null,
    order_ids: [...new Set(items.map((x) => x.o))],
    ...(online ? { hold_until: scadenza.toISOString() } : { paid_at: new Date().toISOString() }),
    ...(items.length ? { items } : {}),
  };
  const ins = await inserisci("table_payments", ambito, riga).select("id").maybeSingle();
  if (ins.error || !ins.data) {
    console.error("[palmare] pagamento:", ins.error);
    return { ok: false, errore: "salvataggio" };
  }
  const pagamentoId = String((ins.data as { id: string }).id);

  if (online) {
    try {
      const c = await creaCheckoutConto({
        ambito,
        pagamentoId,
        voci: [{ name: `${CLIENT.nome}${chi ? ` · ${chi}` : ""}`, price_cents: importo, qty: 1 }],
        successUrl: `${base}/paiement/ok`,
        cancelUrl: `${base}/paiement/ok?annule=1`,
        expiresAt: scadenza,
      });
      await aggiorna("table_payments", ambito, { stripe_session_id: c.id }).eq("id", pagamentoId);
      return { ok: true, qr: { svg: qrSvg(c.url), importo, id: pagamentoId } };
    } catch (e) {
      console.error("[palmare] QR della parte:", String((e as Error)?.message ?? e));
      await aggiorna("table_payments", ambito, { status: "cancelled" }).eq("id", pagamentoId);
      return { ok: false, errore: "stripe" };
    }
  }

  // Pagata subito: saldato? allora tutto pagato e tavolo libero.
  const dopo = await leggiTutto(ambito, s);
  const q2 = quadro(s, dopo.ordini, dopo.pagamenti, dopo.scegli);
  if (q2.resto <= 0) {
    await finalizza(ambito, s, dopo.ordini, dopo.pagamenti);
    return { ok: true, chiusa: true, quadro: { ...q2, chiusa: true } };
  }
  return { ok: true, chiusa: false, quadro: q2 };
}

/**
 * Dopo un pagamento online di una parte (il webhook, dopo `segnaPagato`): se
 * la seduta del cameriere e' saldata, si chiude. Il conto aperto del QR non
 * passa di qui (ha `dopoPagamento`).
 */
export async function dopoPagamentoSeduta(ambito: Ambito, pagamentoId: string): Promise<void> {
  const { data: pRaw } = await leggi("table_payments", ambito, "reservation_id").eq("id", pagamentoId).maybeSingle();
  const prenId = String((pRaw as { reservation_id?: string } | null)?.reservation_id ?? "");
  if (!prenId) return;
  const { data: rRaw } = await leggi("reservations", ambito, "id, status, tables, tab_table_id, tab_status, people").eq("id", prenId).maybeSingle();
  const r = rRaw as unknown as { id: string; status: string; tables: unknown; tab_table_id: string | null; tab_status: string | null; people: number | null } | null;
  if (!r || r.status !== "seated" || r.tab_status === "pending" || r.tab_status === "open") return;
  const s: Seduta = {
    id: r.id,
    tavoli: [...new Set([...(r.tab_table_id ? [r.tab_table_id] : []), ...tavoliDelleRiga(r.tables)])],
    persone: Math.max(1, Number(r.people) || 1),
  };
  const { ordini, pagamenti, scegli } = await leggiTutto(ambito, s);
  if (quadro(s, ordini, pagamenti, scegli).resto <= 0) await finalizza(ambito, s, ordini, pagamenti);
}
