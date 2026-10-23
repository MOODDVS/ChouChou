import type { APIRoute } from "astro";
import { verificaStaff, nonAutorizzato } from "../../../lib/admin/adminAuth";
import { ambitoDiRichiesta, ambitoDiRiga, leggi, aggiorna, inserisci } from "../../../lib/admin/sede";
import { quadroPagamenti } from "../../../lib/contoRegole";
import {
  chiudiSessioneConto, lasciaPagamento, pagamentiDelConto, rilasciaInviiScaduti, segnaPagato,
} from "../../../lib/contoServer";
import { inviaRicevutaConto } from "../../../lib/ricevutaConto";
import { stripeDi } from "../../../lib/stripe";
import { accodaAddizione } from "../../../lib/stampaCoda";
import { CAMPI_CONTO, contiApertiDellaSala, riassumiConti, validaConto, rifiutaConto, type RigaConto } from "../../../lib/admin/contiSala";
import { adminLang } from "../../../lib/admin/adminLang";
import { adminT } from "../../../i18n/admin";

/**
 * I CONTI APERTI DELLA SALA, per il tablet (Commandes) — conto-aperto.md.
 *
 * GET  → { conti: [...] }   i conti da validare o aperti (fino a 7 giorni), con gli
 *                           invii, chi ha preso cosa, il totale, il codice e
 *                           se il tavolo ha chiesto l'addizione.
 * POST { azione, id, metodo? }
 *   valida    il primo invio parte: ticket in cucina, conto aperto
 *   rifiuta   nessun invio parte; conto e ordini annullati
 *   incassa   { metodo: cash | card }: il RESTO incassato (quello che non e'
 *             gia' stato pagato online), tavolo chiuso, ricevuta
 *   chiudi    tavolo chiuso SENZA incassare (il non pagato si annulla; con
 *             una parte gia' pagata online, gli ordini restano terminati)
 *   stampa    l'addizione sulla stampante principale
 *
 * ⚠️ Ogni GET fa anche partire gli invii la cui finestra e' scaduta
 * (`rilasciaInviiScaduti`): il tablet guarda ogni 25 secondi, ed e' il
 * battito che manda in cucina il secondo giro di vino.
 * ⚠️ Tutte le scritture passano da `aggiorna`, che filtra per sede: un id di
 * un altro punto non viene toccato.
 */
export const prerender = false;

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

async function msg(chiave: string): Promise<string> {
  return adminT(await adminLang())(chiave);
}

export const GET: APIRoute = async ({ request }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();
  const ambito = await ambitoDiRichiesta(request, staff);
  await rilasciaInviiScaduti(ambito);
  // Quali conti: vedi `contiApertiDellaSala` (non solo oggi, non solo seated).
  const conti = await contiApertiDellaSala(ambito);
  if (conti.length === 0) return json({ conti: [] });
  return json({ conti: await riassumiConti(ambito, conti) });
};

export const POST: APIRoute = async ({ request }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();
  const ambito = await ambitoDiRichiesta(request, staff);
  let body: { azione?: unknown; id?: unknown; metodo?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: "requete invalide" }, 400);
  }
  const id = String(body.id ?? "");
  const azione = String(body.azione ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ error: await msg("err.tabNotFound") }, 404);
  const { data: cRaw } = await leggi("reservations", ambito, CAMPI_CONTO).eq("id", id).maybeSingle();
  const conto = cRaw as unknown as RigaConto | null;
  if (!conto || (conto.tab_status !== "pending" && conto.tab_status !== "open")) {
    return json({ error: await msg("err.tabNotFound") }, 404);
  }
  const adesso = new Date();
  const adessoIso = adesso.toISOString();

  /* VALIDA e RIFIUTA stanno in `lib/admin/contiSala.ts` (23/10/2026): li
     usa anche il palmare (`/api/admin/salle-tab`), e la stessa decisione non
     deve vivere in due posti. */
  if (azione === "valida") {
    const esito = await validaConto(ambito, conto, adesso);
    if (esito === "errore") return json({ error: await msg("err.generalSave") }, 500);
    return json({ ok: true });
  }

  if (azione === "rifiuta") {
    const esito = await rifiutaConto(ambito, conto, adesso);
    if (esito === "non_valido") return json({ error: await msg("err.tabNotFound") }, 409);
    if (esito === "errore") return json({ error: await msg("err.generalSave") }, 500);
    return json({ ok: true });
  }

  if (azione === "incassa") {
    const metodo = String(body.metodo ?? "");
    if (metodo !== "cash" && metodo !== "card") return json({ error: await msg("err.generalSave") }, 400);
    /* ⚠️ Prima PARTE quello che stava ancora aspettando la sua finestra: un
       caffe' ordinato trenta secondi fa e pagato adesso deve comunque uscire
       in cucina. Al conto ancora da validare non si incassa: prima si valida. */
    if (conto.tab_status === "pending") return json({ error: await msg("err.tabValidateFirst") }, 409);
    await aggiorna("table_rounds", ambito, { release_at: adessoIso })
      .eq("reservation_id", conto.id)
      .eq("status", "waiting");
    await rilasciaInviiScaduti(ambito, conto.id);
    /* I PAGAMENTI ONLINE IN CORSO (#88): chi incassa al tavolo chiude la
       partita. Ogni sessione Stripe aperta si fa scadere; se Stripe dice che
       era gia' pagata, la si segna pagata — e allora si incassa solo il
       resto. Poi il resto entra come pagamento del personale. */
    const pagamenti = await pagamentiDelConto(ambito, conto.id);
    // ⚠️ Stripe e la riga nuova: del PUNTO del conto, non di chi guarda.
    const suo = ambitoDiRiga(conto.location_id);
    if (pagamenti) {
      for (const p of pagamenti.filter((x) => x.status === "pending" && x.method === "online")) {
        let pagata = false;
        if (p.stripe_session_id) {
          try {
            const sp = await stripeDi(suo);
            const sess = await sp.checkout.sessions.retrieve(p.stripe_session_id);
            if (sess.payment_status === "paid") pagata = await segnaPagato(ambito, p.id, { sessionId: p.stripe_session_id, email: sess.customer_details?.email ?? null });
            else if (sess.status === "open") await sp.checkout.sessions.expire(p.stripe_session_id);
          } catch (e) {
            console.error("[conto] sessione Stripe all'incasso:", e);
          }
        }
        if (!pagata) await lasciaPagamento(ambito, p);
      }
      // Un pagamento appena arrivato puo' aver saldato e chiuso il conto.
      const { data: oraRaw } = await leggi("reservations", ambito, "tab_status").eq("id", conto.id).maybeSingle();
      if ((oraRaw as { tab_status?: string } | null)?.tab_status === "closed") return json({ ok: true, gia: true });
      const dopo = await pagamentiDelConto(ambito, conto.id);
      const { data: totRaw } = await leggi("orders", ambito, "total_cents")
        .eq("reservation_id", conto.id)
        .not("round_id", "is", null)
        .neq("status", "cancelled");
      const totale = ((totRaw ?? []) as unknown as { total_cents: number | null }[]).reduce((t, o) => t + (Number(o.total_cents) || 0), 0);
      const resto = quadroPagamenti(totale, dopo ?? [], adesso).resto;
      if (resto > 0) {
        await inserisci("table_payments", suo, {
          reservation_id: conto.id, kind: "staff", method: metodo, status: "paid", amount_cents: resto, paid_at: adessoIso,
        });
      }
    }
    const upd = await aggiorna("orders", ambito, { status: "done", payment_method: metodo })
      .eq("reservation_id", conto.id)
      .not("round_id", "is", null)
      .eq("status", "pending");
    if (upd.error) return json({ error: await msg("err.generalSave") }, 500);
    const ch = await chiudiSessioneConto(ambito, conto, adesso);
    if (ch.error) return json({ error: await msg("err.generalSave") }, 500);
    // La ricevuta unica, a chi ha lasciato un'email (mai bloccante).
    void inviaRicevutaConto(ambito, conto.id).catch(() => {});
    return json({ ok: true });
  }

  if (azione === "chiudi") {
    /* ⚠️ Chiudere SENZA incassare: il tavolo e' andato via, o il conto era
       sbagliato. Il non pagato si annulla — un ordine `pending` lasciato li'
       sarebbe un conto fantasma che nessuno incassera' mai. La pagina chiede
       conferma prima di arrivare qui. */
    /* ⚠️ CON UNA PARTE GIA' PAGATA ONLINE gli ordini non si annullano: quei
       soldi sono arrivati, e un conto «annullato» con un incasso dentro non lo
       sa spiegare nessuno. Restano terminati (senza metodo), e la prenotazione
       dice quanto e' entrato davvero. Le sessioni ancora aperte si lasciano. */
    const pagamenti = (await pagamentiDelConto(ambito, conto.id)) ?? [];
    for (const p of pagamenti.filter((x) => x.status === "pending")) await lasciaPagamento(ambito, p);
    const pagato = quadroPagamenti(0, pagamenti.filter((p) => p.status === "paid"), adesso).pagato;
    await aggiorna("orders", ambito, pagato > 0 ? { status: "done", payment_method: null } : { status: "cancelled" })
      .eq("reservation_id", conto.id)
      .not("round_id", "is", null)
      .eq("status", "pending");
    const ch = await chiudiSessioneConto(ambito, conto, adesso, pagato > 0 ? pagato : undefined);
    if (ch.error) return json({ error: await msg("err.generalSave") }, 500);
    return json({ ok: true });
  }

  if (azione === "stampa") {
    const { data: capoRaw } = await leggi("orders", ambito, "id, location_id")
      .eq("reservation_id", conto.id)
      .not("round_id", "is", null)
      .neq("status", "cancelled")
      .order("created_at", { ascending: true })
      .limit(1);
    const capo = ((capoRaw ?? []) as unknown as { id: string; location_id: string | null }[])[0];
    if (!capo) return json({ error: await msg("err.tabEmpty") }, 409);
    const esito = await accodaAddizione(capo);
    if (!esito.accodati) return json({ error: await msg("err.tabPrint"), motivo: esito.motivo }, 409);
    return json({ ok: true });
  }

  return json({ error: "action inconnue" }, 400);
};
