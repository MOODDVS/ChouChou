import type { APIRoute } from "astro";
import { DateTime } from "luxon";
import { verificaStaff, nonAutorizzato } from "../../../lib/admin/adminAuth";
import { ambitoDiRichiesta, ambitoDiRiga, leggi, aggiorna, inserisci } from "../../../lib/admin/sede";
import { fusoDi } from "../../../lib/fuso";
import { hannoOrdinato, pagamentoVivo, quadroPagamenti } from "../../../lib/contoRegole";
import {
  chiudiSessioneConto, lasciaPagamento, pagamentiDelConto, rilasciaInviiScaduti, segnaPagato, type RigaPagamento,
} from "../../../lib/contoServer";
import { inviaRicevutaConto } from "../../../lib/ricevutaConto";
import { stripeDi } from "../../../lib/stripe";
import { accodaAddizione } from "../../../lib/stampaCoda";
import { piattiVeri } from "../../../lib/admin/ordiniConti";
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

interface RigaConto {
  id: string;
  date: string;
  status: string;
  tables: string[] | null;
  first_name: string;
  people: number;
  seated_at: string | null;
  tab_status: string | null;
  tab_code: string | null;
  tab_table_id: string | null;
  tab_people: number | null;
  tab_validated_at: string | null;
  location_id: string | null;
}
const CAMPI = "id, date, status, tables, first_name, people, seated_at, tab_status, tab_code, tab_table_id, tab_people, tab_validated_at, location_id";

interface RigaOrdineConto {
  id: string;
  customer_name: string | null;
  items: { id?: string; name?: string; base_name?: string; variant_label?: string; qty?: number; price_cents?: number }[] | null;
  total_cents: number | null;
  status: string;
  round_id: string | null;
  reservation_id: string;
  table_label: string | null;
  created_at: string;
}

export const GET: APIRoute = async ({ request }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();
  const ambito = await ambitoDiRichiesta(request, staff);
  await rilasciaInviiScaduti(ambito);
  /* ⚠️ NON SOLO OGGI. Un conto rimasto aperto (il tavolo se n'e' andato
     senza saldare, o nessuno ha premuto «Encaisser») a mezzanotte spariva
     dallo schermo con il suo resto: nel database aperto, in nessuna pagina.
     Resta in Commandes finche' qualcuno non lo incassa o lo chiude — al
     massimo 7 giorni, come la lista degli ordini.
     ⚠️ E non solo `seated`: una prenotazione segnata «Fini» a mano non
     salda il conto. Fuori solo le annullate (un conto rifiutato). */
  const ora = DateTime.now().setZone(await fusoDi(ambito));
  const daData = ora.minus({ days: 7 }).toFormat("yyyy-MM-dd");

  const { data: contiRaw, error } = await leggi("reservations", ambito, CAMPI)
    .gte("date", daData)
    .neq("status", "cancelled")
    .in("tab_status", ["pending", "open"]);
  // Senza la #87 non c'e' nessun conto: la pagina mostra quello di sempre.
  if (error) return json({ conti: [] });
  const conti = (contiRaw ?? []) as unknown as RigaConto[];
  if (conti.length === 0) return json({ conti: [] });
  const ids = conti.map((c) => c.id);
  const tavoliIds = [...new Set(conti.flatMap((c) => [c.tab_table_id, ...(c.tables ?? [])]).filter(Boolean) as string[])];

  const [{ data: ordRaw }, { data: invRaw }, { data: tavRaw }, chiamate, pagRaw] = await Promise.all([
    leggi("orders", ambito, "id, customer_name, items, total_cents, status, round_id, reservation_id, table_label, created_at")
      .in("reservation_id", ids)
      .not("round_id", "is", null)
      .neq("status", "cancelled")
      .order("created_at", { ascending: true }),
    leggi("table_rounds", ambito, "id, reservation_id, number, status, release_at, released_at").in("reservation_id", ids),
    leggi("restaurant_tables", ambito, "id, name").in("id", tavoliIds),
    leggi("table_calls", ambito, "table_id, reason, status, created_at")
      .eq("status", "open")
      .eq("reason", "bill")
      .gte("created_at", DateTime.now().minus({ hours: 12 }).toUTC().toISO() as string)
      .then((r) => (r.error ? [] : ((r.data ?? []) as unknown as { table_id: string | null }[]))),
    // I pagamenti (#88). Senza la migrazione: nessuno, e il conto si incassa
    // tutto al cameriere come prima.
    leggi("table_payments", ambito, "reservation_id, kind, method, status, amount_cents, tip_cents, payer_name, hold_until, order_ids")
      .in("reservation_id", ids)
      .then((r) => (r.error ? [] : ((r.data ?? []) as unknown as (RigaPagamento)[]))),
  ]);
  const adesso = new Date();
  const ordini = (ordRaw ?? []) as unknown as RigaOrdineConto[];
  const invii = (invRaw ?? []) as unknown as { id: string; reservation_id: string; number: number; status: string; release_at: string | null }[];
  const nomeTavolo = new Map(((tavRaw ?? []) as unknown as { id: string; name: string }[]).map((t) => [t.id, t.name]));
  const conAddizione = new Set(chiamate.map((c) => String(c.table_id ?? "")));

  const out = conti.map((c) => {
    const suoi = ordini.filter((o) => o.reservation_id === c.id);
    const nomi = suoi.map((o) => String(o.customer_name ?? "").trim()).filter(Boolean);
    const { ordinato, su } = hannoOrdinato(nomi, c.tab_people ?? c.people);
    const totale = suoi.reduce((t, o) => t + (Number(o.total_cents) || 0), 0);
    /* ⚠️ Il pagato viene dai PAGAMENTI, non dagli ordini: una parte uguale
       pagata online non e' l'ordine di nessuno. In corso = prenotato da chi
       sta pagando adesso (non ancora arrivato). */
    const suoiPag = pagRaw.filter((p) => p.reservation_id === c.id);
    const q = quadroPagamenti(totale, suoiPag, adesso);
    const suoiInvii = invii.filter((i) => i.reservation_id === c.id).sort((a, b) => a.number - b.number);
    const tavoli = [c.tab_table_id, ...(c.tables ?? [])].filter((x, i, a) => x && a.indexOf(x) === i) as string[];
    return {
      id: c.id,
      /** Il giorno del conto: la scheda lo scrive se non e' oggi. */
      data: c.date,
      stato: c.tab_status,
      tavolo: nomeTavolo.get(String(c.tab_table_id)) ?? "",
      tavoli: tavoli.map((t) => nomeTavolo.get(t) ?? "").filter(Boolean),
      codice: c.tab_code ?? "",
      persone: su,
      ordinato,
      // Il semaforo dell'attesa parte dal PRIMO ordine: e' da li' che il
      // tavolo aspetta il cameriere.
      dal: suoi[0]?.created_at ?? c.seated_at ?? null,
      addizione: tavoli.some((t) => conAddizione.has(t)),
      totale_cents: totale,
      pagato_cents: q.pagato,
      in_corso_cents: q.inCorso,
      resto_cents: q.resto,
      pagamenti: suoiPag
        .filter((p) => pagamentoVivo(p, adesso))
        .map((p) => ({
          chi: String(p.payer_name ?? "").trim(),
          importo_cents: Number(p.amount_cents) || 0,
          mancia_cents: Number(p.tip_cents) || 0,
          in_corso: p.status !== "paid",
        })),
      invii: suoiInvii
        .map((i) => ({
          numero: i.number,
          partito: i.status === "released",
          partenza: i.release_at,
          righe: suoi
            .filter((o) => o.round_id === i.id)
            .map((o) => ({
              nome: String(o.customer_name ?? "").trim(),
              piatti: piattiVeri(o.items ?? []).map((p) => ({
                qty: Math.max(1, Math.floor(Number(p.qty) || 1)),
                nome: String(p.base_name ?? p.name ?? "").trim(),
                variante: String(p.variant_label ?? "").trim() || null,
              })),
              totale_cents: Number(o.total_cents) || 0,
            })),
        }))
        .filter((i) => i.righe.length > 0),
    };
  });
  // Prima quelli da validare, poi dal piu' vecchio.
  out.sort((a, b) => (a.stato === b.stato ? String(a.dal).localeCompare(String(b.dal)) : a.stato === "pending" ? -1 : 1));
  return json({ conti: out });
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
  const { data: cRaw } = await leggi("reservations", ambito, CAMPI).eq("id", id).maybeSingle();
  const conto = cRaw as unknown as RigaConto | null;
  if (!conto || (conto.tab_status !== "pending" && conto.tab_status !== "open")) {
    return json({ error: await msg("err.tabNotFound") }, 404);
  }
  const adesso = new Date();
  const adessoIso = adesso.toISOString();

  if (azione === "valida") {
    if (conto.tab_status !== "pending") return json({ ok: true });
    const upd = await aggiorna("reservations", ambito, { tab_status: "open", tab_validated_at: adessoIso })
      .eq("id", conto.id)
      .eq("tab_status", "pending");
    if (upd.error) return json({ error: await msg("err.generalSave") }, 500);
    // Il primo invio parte ADESSO: era l'unico in attesa della validazione.
    await aggiorna("table_rounds", ambito, { release_at: adessoIso })
      .eq("reservation_id", conto.id)
      .eq("status", "waiting")
      .is("release_at", null);
    await rilasciaInviiScaduti(ambito, conto.id);
    return json({ ok: true });
  }

  if (azione === "rifiuta") {
    if (conto.tab_status !== "pending") return json({ error: await msg("err.tabNotFound") }, 409);
    await aggiorna("orders", ambito, { status: "cancelled" })
      .eq("reservation_id", conto.id)
      .not("round_id", "is", null)
      .eq("status", "pending");
    const upd = await aggiorna("reservations", ambito, { tab_status: "closed", tab_closed_at: adessoIso, status: "cancelled" })
      .eq("id", conto.id);
    if (upd.error) return json({ error: await msg("err.generalSave") }, 500);
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
