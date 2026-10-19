import type { APIRoute } from "astro";
import { verificaStaff, nonAutorizzato } from "../../../lib/admin/adminAuth";
import { ambitoDiRichiesta, cercaAmbito, leggi, aggiorna } from "../../../lib/admin/sede";
import { ritardoAmmesso, RITARDI_MIN, alTavolo } from "../../../lib/ordiniRegole";
import { opzioniTavolo } from "../../../lib/ordiniOpzioni";
import { emailOrdineRitardato } from "../../../lib/notifications";
import { consegnaDellOrdine } from "../../../lib/consegnaOrdine";
import { adminLang } from "../../../lib/admin/adminLang";
import { adminT } from "../../../i18n/admin";

/**
 * RITARDARE UN ORDINE — e dirlo al cliente.
 *
 * POST { id, minuti } → { ok: true, pickup_time } | { error }
 *
 * ⚠️ IL RITARDO SPOSTA DAVVERO `pickup_time`, non e' una nota. Quell'ora la
 * leggono la colonna della Accueil, il semaforo dei ritardatari sulla card e
 * il ticket di cucina: lasciarla ferma vorrebbe dire un ordine rosso «in
 * ritardo» per un ritardo che abbiamo concesso noi.
 *
 * ⚠️ I MINUTI SONO UN ELENCO CHIUSO. Il pannello mostra quattro bottoni, ma il
 * bottone e' un suggerimento: qui si rifiuta tutto il resto. Un `minuti`
 * negativo arrivato a mano ANTICIPEREBBE il ritiro — e il cliente riceverebbe
 * un'email che gli dice di correre.
 *
 * ⚠️ NON si ritarda cio' che e' finito. Un ordine consegnato o annullato non
 * ha piu' un'ora di ritiro da spostare, e l'email sarebbe assurda.
 *
 * ⚠️ L'ORA DI PRIMA viaggia fino all'email. Senza, il cliente leggerebbe solo
 * la nuova e non saprebbe di quanto e' cambiata — ne' se riguarda lui.
 */
export const prerender = false;

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

async function msg(chiave: string): Promise<string> {
  return adminT(await adminLang())(chiave);
}

export const POST: APIRoute = async ({ request }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();
  const ambito = await ambitoDiRichiesta(request, staff);

  let body: { id?: string; minuti?: number };
  try {
    body = await request.json();
  } catch {
    return json({ error: await msg("err.request") }, 400);
  }
  const id = String(body.id ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ error: await msg("err.id") }, 400);
  if (!ritardoAmmesso(body.minuti)) return json({ error: await msg("err.delayMinutes") }, 400);
  const minuti = Math.round(Number(body.minuti));

  const conto = await cercaAmbito("orders", id, ambito);
  const { data: ord, error } = await leggi(
    "orders",
    ambito,
    "id, status, pickup_time, customer_name, customer_email, customer_phone, total_cents, lang",
  )
    .eq("id", id)
    .maybeSingle();
  if (error || !ord) return json({ error: await msg("err.orderNotFound") }, 404);

  const stato = String(ord.status ?? "");
  if (stato !== "paid" && stato !== "pending") {
    return json({ error: await msg("err.delayClosed") }, 409);
  }

  const primaIso = String(ord.pickup_time ?? "");
  const prima = new Date(primaIso).getTime();
  if (!Number.isFinite(prima)) return json({ error: await msg("err.delayNoTime") }, 409);
  const dopoIso = new Date(prima + minuti * 60_000).toISOString();

  const { data: fatto, error: eUp } = await aggiorna("orders", ambito, { pickup_time: dopoIso })
    .eq("id", id)
    /* ⚠️ `eq` sull'ora di prima: due ritardi premuti insieme da due apparecchi
       sommerebbero venti minuti a testa partendo dalla stessa ora, e il
       secondo cancellerebbe il primo. Cosi' il secondo non trova piu' la riga
       e se ne accorge, invece di sovrascrivere in silenzio. */
    .eq("pickup_time", primaIso)
    .select("id")
    .maybeSingle();
  if (eUp) return json({ error: await msg("err.update") }, 500);
  if (!fatto) return json({ error: await msg("err.delayRace") }, 409);

  // ⚠️ Non si aspetta l'email: il ritardo e' gia' scritto, e la risposta deve
  // tornare subito. Un ristoratore fermo sul bottone lo preme di nuovo.
  /* ⚠️ DAL TAVOLO, COL CAMERIERE, NIENTE «RETRAIT DÉCALÉ»: chi e' seduto non
     deve ritirare niente, e un'email che gli sposta un'ora di ritiro e'
     soltanto confusione. Al banco invece si', e dice dove.
     ⚠️ Lettura a parte: `service` arriva con la #82, e se manca vuol dire
     asporto — il comportamento di prima. */
  let sala: { tavolo: string; alBanco: boolean } | null = null;
  let silenzio = false;
  {
    const r = await leggi("orders", ambito, "service, table_label").eq("id", id).maybeSingle();
    const riga = (r.error ? null : r.data) as { service?: unknown; table_label?: unknown } | null;
    if (riga && alTavolo(riga.service)) {
      const { avvisa } = await opzioniTavolo(conto);
      if (avvisa) sala = { tavolo: String(riga.table_label ?? ""), alBanco: true };
      else silenzio = true;
    }
  }

  if (!silenzio && String(ord.customer_email ?? "").trim()) {
    void emailOrdineRitardato({
      location_id: conto.modo === "sede" ? conto.id : null,
      numero: String(ord.id).slice(0, 8),
      customer_name: String(ord.customer_name ?? ""),
      customer_email: String(ord.customer_email ?? ""),
      customer_phone: (ord.customer_phone as string | null) ?? null,
      pickup_time: dopoIso,
      items: [],
      total_cents: Number(ord.total_cents ?? 0),
      lang: String(ord.lang ?? "fr"),
      ora_prima: primaIso,
      sala,
      // Una consegna in ritardo dice «livraison décalée», non «retrait».
      consegna: await consegnaDellOrdine(String(ord.id), conto.modo === "sede" ? conto.id : null),
    }).catch(() => {
      /* il ritardo resta valido anche se l'email non parte */
    });
  }

  return json({ ok: true, pickup_time: dopoIso, minuti, scelte: RITARDI_MIN });
};
