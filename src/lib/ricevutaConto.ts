/**
 * LA RICEVUTA UNICA DEL CONTO APERTO — una sola email alla fine, con tutti gli
 * invii (conto-aperto.md, fase 4). A chi ha aperto il conto e a chi ha pagato
 * online (l'email l'ha lasciata a Stripe).
 *
 * ⚠️ UNA VOLTA SOLA: `reservations.tab_receipt_at` (#88) passa da NULL ad
 * adesso con un aggiornamento condizionato, e solo chi ci riesce spedisce. Il
 * webhook e il ritorno sulla pagina arrivano spesso insieme.
 * ⚠️ Mai bloccante: un'email che non parte non riapre un conto pagato.
 */
import { leggi, aggiorna, type Ambito } from "./admin/sede";
import { emailRicevutaConto, type RicevutaConto } from "./notifications";
import { piattiVeri } from "./admin/ordiniConti";

export async function inviaRicevutaConto(ambito: Ambito, contoId: string): Promise<number> {
  const presa = await aggiorna("reservations", ambito, { tab_receipt_at: new Date().toISOString() })
    .eq("id", contoId)
    .is("tab_receipt_at", null)
    .select("id, email, lang, location_id, tab_table_id");
  const c = ((presa.data ?? []) as unknown as { id: string; email: string | null; lang: string | null; location_id: string | null; tab_table_id: string | null }[])[0];
  if (presa.error || !c) return 0;

  const [{ data: ordRaw }, { data: pagRaw }, { data: tavRaw }] = await Promise.all([
    leggi("orders", ambito, "customer_name, items, total_cents, created_at")
      .eq("reservation_id", contoId)
      .not("round_id", "is", null)
      .neq("status", "cancelled")
      .order("created_at", { ascending: true }),
    leggi("table_payments", ambito, "payer_name, payer_email, method, status, amount_cents, tip_cents, paid_at").eq("reservation_id", contoId),
    c.tab_table_id ? leggi("restaurant_tables", ambito, "name").eq("id", c.tab_table_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);

  // Chi ha preso cosa: un blocco per nome, i piatti sommati.
  const persone = new Map<string, RicevutaConto["persone"][number]>();
  let totale = 0;
  for (const o of (ordRaw ?? []) as unknown as { customer_name: string | null; items: unknown; total_cents: number | null }[]) {
    const nome = String(o.customer_name ?? "").trim();
    const p = persone.get(nome) ?? { nome, piatti: [], totale_cents: 0 };
    for (const x of piattiVeri((Array.isArray(o.items) ? o.items : []) as { name?: string; base_name?: string; variant_label?: string; qty?: number }[])) {
      const n = [String(x.base_name ?? x.name ?? "").trim(), String(x.variant_label ?? "").trim()].filter(Boolean).join(" · ");
      const qty = Math.max(1, Math.floor(Number(x.qty) || 1));
      const gia = p.piatti.find((y) => y.nome === n);
      if (gia) gia.qty += qty;
      else p.piatti.push({ nome: n, qty });
    }
    p.totale_cents += Number(o.total_cents) || 0;
    totale += Number(o.total_cents) || 0;
    persone.set(nome, p);
  }
  const pagamenti = ((pagRaw ?? []) as unknown as { payer_name: string | null; payer_email: string | null; method: string; status: string; amount_cents: number; tip_cents: number; paid_at: string | null }[])
    .filter((p) => p.status === "paid")
    .sort((a, b) => String(a.paid_at).localeCompare(String(b.paid_at)));

  const ricevuta: RicevutaConto = {
    location_id: c.location_id,
    lang: c.lang,
    tavolo: String((tavRaw as { name?: string } | null)?.name ?? ""),
    persone: [...persone.values()],
    totale_cents: totale,
    pagamenti: pagamenti.map((p) => ({
      chi: String(p.payer_name ?? "").trim(),
      metodo: p.method === "cash" ? "cash" : p.method === "card" ? "card" : "online",
      importo_cents: Number(p.amount_cents) || 0,
      mancia_cents: Number(p.tip_cents) || 0,
    })),
  };

  const a = new Set<string>();
  for (const e of [c.email, ...pagamenti.map((p) => p.payer_email)]) {
    const s = String(e ?? "").trim().toLowerCase();
    if (s.includes("@")) a.add(s);
  }
  let spedite = 0;
  for (const e of a) {
    try {
      if (await emailRicevutaConto(ricevuta, e)) spedite++;
    } catch (err) {
      console.error("[conto] ricevuta non partita:", err);
    }
  }
  return spedite;
}
