import { accodaTicket } from "../../../lib/stampaCoda";
import type { APIRoute } from "astro";
import { DateTime } from "luxon";
import { supabaseAdmin } from "../../../lib/db";
import { verificaStaff, nonAutorizzato } from "../../../lib/admin/adminAuth";
import { creaCheckoutSession, creaCheckoutSupplemento, type VoceCheckout } from "../../../lib/stripe";
import { basePubblicaOpz } from "../../../lib/basePubblica";
import { calcolaSlotGiorno } from "../../../lib/slots";
import { fusoDi } from "../../../lib/fuso";
import { configRitiro } from "../../../lib/schedule";
// Multi-sede. `inserisci` e `aggiorna` sono gia' nomi locali qui dentro,
// quindi l'importazione e' rinominata invece di rinominare le loro.
import {
  ambitoDiRichiesta, ambitoDiRiga, cercaAmbito, pagamentoOnlineAttivo, leggi, inserisci as inserisciRiga, aggiorna as aggiornaRighe, cancella,
} from "../../../lib/admin/sede";
import { inCassa, metodoCambiabile, METODI_CASSA_SCELTA, avvisaChePronto, alTavolo } from "../../../lib/ordiniRegole";
import { opzioniTavolo } from "../../../lib/ordiniOpzioni";
import { piattiPerOrdine, rigaOrdine } from "../../../lib/admin/righeOrdine";
import { emailLienPaiement, inviaNotifiche, inviaModificaOrdine, inviaAnnullaOrdine, emailOrdinePronto } from "../../../lib/notifications";
// Consegna e mancia dell'ordine, per le email di annullo e di modifica: senza,
// parlerebbero di «retrait» a chi aspetta il fattorino.
import { consegnaDellOrdine, manciaDellOrdine } from "../../../lib/consegnaOrdine";

import { adminLang } from "../../../lib/admin/adminLang";
import { adminT } from "../../../i18n/admin";
import { rimborsabile } from "../../../lib/admin/ordiniConti";
import { cosaDaIncassare } from "../../../lib/admin/daIncassare";
import { chiudiSeContoChiesto } from "../../../lib/admin/incassoSeduta";
export const prerender = false;


/** Messaggio nella lingua dell'admin. `adminLang()` legge un valore globale
 *  gia' in cache (adminBoot): zero query in piu'. Vedi ENGINE.md,
 *  «Messaggi d'errore delle API admin — nella lingua dell'admin». */
async function msg(chiave: string): Promise<string> {
  return adminT(await adminLang())(chiave);
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

// GET /api/admin/orders
// Restituisce gli ordini con ritiro da 7 giorni fa in poi:
// paid (attivi), done (terminati), cancelled (annullati).
// I 'pending' (checkout Stripe mai completato) restano fuori.
// Protetto: serve un token staff valido.
export const GET: APIRoute = async ({ request, url }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();
  const ambito = await ambitoDiRichiesta(request, staff);
  const fuso = await fusoDi(ambito);

  // ?da_incassare=1 → l'avviso «non incassato» del tablet (AdminNav, ogni
  // mezz'ora): ordini da incassare da piu' di 30 minuti e conti aperti col
  // resto, a tavolo finito. La regola sta in `lib/admin/daIncassare.ts`,
  // la stessa del riepilogo del mattino.
  if (url.searchParams.get("da_incassare")) {
    return json(await cosaDaIncassare(ambito));
  }

  // Polling toast "Nouvelle commande": gli ultimi ordini PAGATI (per created_at).
  // Il client tiene gli ID già visti e avvisa sui NUOVI. Non si usa più un
  // segnalibro temporale: un ordine nasce 'pending' e diventa 'paid' dopo
  // (webhook), quindi il confronto su created_at mancava le transizioni.
  const recentPaid = url.searchParams.get("recent_paid");
  if (recentPaid) {
    const now = new Date().toISOString();
    // Limite ALTO di proposito: il client tiene un set di ID "visti" e avvisa
    // sui nuovi. Con una finestra piccola (es. 20), annullando un ordine pagato
    // ne "risaliva" uno più vecchio mai visto, scambiato per nuovo ordine
    // (toast/beep fantasma). Con la finestra ampia gli ordini pagati ATTIVI
    // (non 'done'/'cancelled') ci stanno tutti: nessuna risalita, nessun falso.
    /* ⚠️ ANCHE GLI ORDINI DA PAGARE AL BANCO (`pending` + `onsite`), non solo
       i pagati. Un fast-food ordina al tavolo (o al ritiro), paga quando lo
       chiamano: l'ordine e' vero dal momento in cui arriva — il ticket esce
       subito — e il tablet deve suonare SUBITO, non quando qualcuno incassa
       (19/10/2026). Prima suonavano solo i `paid`: chi paga in cassa non
       faceva nessun rumore. Incassato diventa `paid`: stesso id, nessun secondo avviso.
       (Gli ordini del conto aperto, `tab`, non ci sono: per loro suona la
       scheda del conto.) */
    const { data, error } = await leggi("orders", ambito, "id, customer_name, total_cents, pickup_time, created_at")
      .or("status.eq.paid,and(status.eq.pending,payment_method.eq.onsite)")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) return json({ orders: [], now });
    return json({ orders: data ?? [], now });
  }

  // (Retro-compat) vecchio parametro `new_since`: ordini pagati creati dopo.
  const newSince = url.searchParams.get("new_since");
  if (newSince) {
    const now = new Date().toISOString();
    const { data, error } = await leggi("orders", ambito, "id, customer_name, total_cents, pickup_time, created_at")
      .eq("status", "paid")
      .gt("created_at", newSince)
      .order("created_at", { ascending: true })
      .limit(20);
    if (error) return json({ orders: [], now });
    return json({ orders: data ?? [], now });
  }

  // ?month=YYYY-MM → elenco dei GIORNI del mese che hanno ordini (per il
  // pallino verde nel datepicker di consultazione).
  const monthParam = url.searchParams.get("month");
  if (monthParam && /^\d{4}-\d{2}$/.test(monthParam)) {
    const start = DateTime.fromISO(monthParam + "-01", { zone: fuso });
    if (!start.isValid) return json({ days: [] });
    const daM = start.startOf("month").toISO();
    const aM = start.endOf("month").toISO();
    const { data } = await leggi("orders", ambito, "pickup_time, status, source")
      .gte("pickup_time", daM as string)
      .lte("pickup_time", aM as string);
    const giorni = new Set<string>();
    for (const r of (data ?? []) as Array<{ pickup_time: string; status: string; source?: string | null }>) {
      const ok = ["paid", "done", "cancelled"].includes(r.status) || (r.status === "pending" && r.source === "manual");
      if (!ok) continue;
      const d = DateTime.fromISO(r.pickup_time).setZone(fuso).toISODate();
      if (d) giorni.add(d);
    }
    return json({ days: [...giorni] });
  }

  // ?client_search=<term> → clienti che hanno GIÀ ordinato (da ordini passati +
  // tabella clients), per l'autocompletamento nel modale "Nuovo ordine".
  const clientSearch = (url.searchParams.get("client_search") ?? "").trim();
  if (clientSearch.length >= 2) {
    const pulito = clientSearch.replace(/[%,()*]/g, "").slice(0, 60);
    if (!pulito) return json({ clients: [] });
    type Match = { name: string; first_name: string; last_name: string; email: string; phone: string; lang: string };
    const out = new Map<string, Match>();
    const keyOf = (m: Match) => (m.email || m.phone || m.name).toLowerCase();
    const push = (name: string, email: string, phone: string, lang: string) => {
      const nm = name.trim();
      if (!nm) return;
      const parts = nm.split(/\s+/);
      const m: Match = { name: nm, first_name: parts[0] ?? "", last_name: parts.slice(1).join(" "), email: email.trim(), phone: phone.trim(), lang: (lang || "").trim() };
      const k = keyOf(m);
      if (!out.has(k)) out.set(k, m); // il primo (più recente) vince → lang dell'ultimo ordine
    };
    // 1) ordini passati (customer_name), dal più recente
    try {
      const { data } = await leggi("orders", ambito, "customer_name, customer_email, customer_phone, lang, created_at")
        .ilike("customer_name", `%${pulito}%`)
        .order("created_at", { ascending: false })
        .limit(60);
      for (const r of (data ?? []) as Array<{ customer_name?: string; customer_email?: string; customer_phone?: string; lang?: string }>)
        push(String(r.customer_name ?? ""), String(r.customer_email ?? ""), String(r.customer_phone ?? ""), String(r.lang ?? ""));
    } catch { /* ignore */ }
    // 2) tabella clients (nome unico) — completa i contatti mancanti
    try {
      const { data } = await supabaseAdmin
        .from("clients")
        .select("name, email, phone, lang, hidden")
        .ilike("name", `%${pulito}%`)
        .limit(12);
      for (const c of (data ?? []) as Array<{ name?: string; email?: string; phone?: string; lang?: string; hidden?: boolean }>) {
        if (c.hidden) continue;
        push(String(c.name ?? ""), String(c.email ?? ""), String(c.phone ?? ""), String(c.lang ?? ""));
      }
    } catch { /* colonne assenti: ignore */ }
    return json({ clients: [...out.values()].slice(0, 8) });
  }

  // ?client_top=1&email=&phone= → i 5 piatti più ordinati dal cliente + la
  // lingua dell'ultimo ordine (per riproporli nel modale "Nuovo ordine").
  if (url.searchParams.get("client_top")) {
    const email = (url.searchParams.get("email") ?? "").trim();
    const phone = (url.searchParams.get("phone") ?? "").trim();
    if (!email && !phone) return json({ top_items: [], lang: "" });
    type ItemJ = { id?: string; name?: string; qty?: number; variant?: string };
    const rows = new Map<string, { items: ItemJ[]; lang: string; created_at: string }>();
    const raccogli = async (mode: "email" | "phone", val: string) => {
      const base = leggi("orders", ambito, "id, items, lang, created_at")
        .in("status", ["paid", "done"])
        .order("created_at", { ascending: false })
        .limit(500);
      const { data } = mode === "email" ? await base.ilike("customer_email", val) : await base.eq("customer_phone", val);
      for (const r of (data ?? []) as Array<{ id: string; items?: ItemJ[]; lang?: string; created_at: string }>)
        rows.set(r.id, { items: (r.items ?? []) as ItemJ[], lang: String(r.lang ?? ""), created_at: r.created_at });
    };
    try { if (email) await raccogli("email", email); } catch { /* */ }
    try { if (phone) await raccogli("phone", phone); } catch { /* */ }
    // Chiave id+FORMATO: «Margherita 33» e «Margherita 45» sono due preferiti
    // diversi. Aggregando sul solo id, cliccare il preferito di un piatto con
    // formati manderebbe una riga senza formato, che il server rifiuta (409).
    const tally = new Map<string, { id: string; name: string; qty: number; variant?: string }>();
    let lang = "";
    let ultima = "";
    for (const r of rows.values()) {
      if (r.created_at > ultima) { ultima = r.created_at; lang = r.lang; }
      for (const it of r.items) {
        if (!it || it.id === "note" || !it.id) continue;
        const q = Math.max(0, Number(it.qty) || 0);
        if (!q) continue;
        const variant = it.variant ? String(it.variant) : undefined;
        const k = variant ? `${it.id}|${variant}` : it.id;
        const cur = tally.get(k) ?? { id: it.id, name: String(it.name ?? ""), qty: 0, ...(variant ? { variant } : {}) };
        cur.qty += q;
        tally.set(k, cur);
      }
    }
    const top = [...tally.values()].sort((a, b) => b.qty - a.qty).slice(0, 5);
    return json({ top_items: top, lang });
  }

  // Soglia: 7 giorni fa a mezzanotte, nel fuso DELLA SEDE, in ISO completo
  // (pickup_time è timestamptz, quindi confronto con un istante ISO).
  const soglia = DateTime.now()
    .setZone(fuso)
    .minus({ days: 7 })
    .startOf("day")
    .toISO();

  // ?date=YYYY-MM-DD → ordini di QUEL giorno (per consultare il passato),
  // altrimenti la finestra standard (ultimi 7 giorni).
  const dateParam = url.searchParams.get("date");
  let daISO: string | null = null;
  let aISO: string | null = null;
  if (dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
    const d = DateTime.fromISO(dateParam, { zone: fuso });
    if (d.isValid) {
      daISO = d.startOf("day").toISO();
      aISO = d.endOf("day").toISO();
    }
  }

  const CAMPI_BASE =
    "id, status, pickup_time, customer_name, customer_email, customer_phone, items, total_cents, lang, created_at, refunded_cents, stripe_session_id";
  // Colonne #50 (differenza dopo modifica). Se la migrazione non e' ancora
  // stata lanciata, il primo select fallisce e si ripiega sui campi base:
  // la lista continua a funzionare, la feature differenza resta dormiente.
  // `source` (#29, piu' vecchia della #50): «en ligne» o creato a mano, per il
  // nastro in testa alla card. Assente → il nastro dice solo «à emporter».
  const EXTRA_50 = ", supplement_due_cents, refund_due_cents, supplement_paid_at, payment_method, source";
  /* Colonne #82 (ordinare dal tavolo). ⚠️ Un tentativo A PARTE, non
     attaccato a EXTRA_50: uniti, un cliente che ha la #50 ma non la #82
     ricadrebbe sui soli campi base e perderebbe `payment_method` — cioe’ gli
     ordini da incassare tornerebbero a sembrare carrelli abbandonati. */
  const EXTRA_82 = ", service, table_label, reservation_id";
  // ⚠️ Nome esplicito: `leggi` e' il passaggio obbligato importato da
  // `sede.ts`, e una funzione locale con lo stesso nome lo ombreggerebbe in
  // TUTTO il corpo dell'handler — comprese le righe SOPRA di lei, che
  // finirebbero nella sua zona morta. Non un errore di compilazione: un
  // ReferenceError a pagina aperta.
  const leggiOrdini = (campi: string) => {
    const q1 = leggi("orders", ambito, campi).in("status", ["paid", "done", "cancelled"]);
    // Pending MANUALI (link di pagamento inviato): i pending del sito
    // (checkout abbandonati) restano fuori. Migrazione #29 assente → nessuno.
    const q2 = leggi("orders", ambito, campi).eq("status", "pending").eq("source", "manual");
    // ⚠️ Gli ordini DA INCASSARE: `pending` perche' nessuno li ha pagati — e
    // dire il contrario sarebbe scrivere un incasso che non e' entrato — ma
    // sono ordini veri, che la cucina sta preparando. Si distinguono da un
    // carrello abbandonato per `payment_method`, non per la configurazione del
    // locale: cosi' restano giusti anche dove la carta e la cassa convivono.
    //
    // ⚠️ Una query a SE', non un `or` dentro q2: se la colonna `source` manca
    // (migrazione #29 non lanciata) quella query fallisce tutta, e gli ordini
    // da incassare sparirebbero per una colonna che non li riguarda.
    const q3 = leggi("orders", ambito, campi).eq("status", "pending").eq("payment_method", "onsite");
    if (daISO && aISO) {
      q1.gte("pickup_time", daISO).lte("pickup_time", aISO);
      q2.gte("pickup_time", daISO).lte("pickup_time", aISO);
      q3.gte("pickup_time", daISO).lte("pickup_time", aISO);
    } else {
      q1.gte("pickup_time", soglia);
      q2.gte("pickup_time", soglia);
      q3.gte("pickup_time", soglia);
    }
    return Promise.all([
      q1.order("pickup_time", { ascending: true }),
      q2.order("pickup_time", { ascending: true }),
      q3.order("pickup_time", { ascending: true }),
    ]);
  };
  /* #84 (la consegna): un tentativo in piu', davanti. Senza la colonna si
     ripiega sulla #82 e la lista resta quella di ieri — che senza la #84 e'
     anche la verita': nessuna consegna puo' essere stata salvata. */
  const EXTRA_84 = ", delivery_address";
  // #85 (il costo della consegna): ancora un passo davanti, stesso ripiego.
  const EXTRA_85 = ", delivery_fee_cents";
  // #86 (la mancia): un passo in piu', stesso ripiego.
  const EXTRA_86 = ", tip_cents";
  // #89 (ordine «pronto» prima dell'incasso): il passo piu' avanti.
  const EXTRA_89 = ", ready_at";
  let [princ, pend, cassa] = await leggiOrdini(CAMPI_BASE + EXTRA_50 + EXTRA_82 + EXTRA_84 + EXTRA_85 + EXTRA_86 + EXTRA_89);
  if (princ.error) [princ, pend, cassa] = await leggiOrdini(CAMPI_BASE + EXTRA_50 + EXTRA_82 + EXTRA_84 + EXTRA_85 + EXTRA_86);
  if (princ.error) [princ, pend, cassa] = await leggiOrdini(CAMPI_BASE + EXTRA_50 + EXTRA_82 + EXTRA_84 + EXTRA_85);
  if (princ.error) [princ, pend, cassa] = await leggiOrdini(CAMPI_BASE + EXTRA_50 + EXTRA_82 + EXTRA_84);
  if (princ.error) [princ, pend, cassa] = await leggiOrdini(CAMPI_BASE + EXTRA_50 + EXTRA_82);
  if (princ.error) [princ, pend, cassa] = await leggiOrdini(CAMPI_BASE + EXTRA_50);
  if (princ.error) [princ, pend, cassa] = await leggiOrdini(CAMPI_BASE);

  if (princ.error) {
    return json({ error: await msg("err.read") }, 500);
  }

  // Nota: `select` con stringa variabile (fallback #50) fa perdere a TS il tipo
  // delle righe, quindi le tratto come oggetti generici per l'ordinamento.
  const righe = [
    ...(princ.data ?? []),
    ...(pend.error ? [] : (pend.data ?? [])),
    ...(cassa.error ? [] : (cassa.data ?? [])),
  ] as unknown as Array<Record<string, unknown>>;
  // ⚠️ Tre query, tre elenchi: una riga che ricadesse in due di essi
  // comparirebbe due volte nella lista. Si tiene la prima, sono la stessa.
  const perId = new Map<string, Record<string, unknown>>();
  for (const r of righe) if (!perId.has(String(r.id))) perId.set(String(r.id), r);
  const tutti = [...perId.values()].sort((a, b) =>
    String(a.pickup_time).localeCompare(String(b.pickup_time))
  );
  /* IL PAGATO IN PARTE (26/10/2026): il palmare incassa un tavolo anche a
     pezzi («Dividi», «Scegli»), e ogni parte e' una riga di `table_payments`.
     Gli ordini restano «da incassare» finche' il tavolo non e' saldato: qui
     ognuno porta quanto la sua seduta ha gia' pagato (`parziale_cents`),
     cosi' la card lo dice e incassa solo il resto. Senza la #88: niente. */
  const sedute = [...new Set(tutti
    .filter((o) => o.status === "pending" && o.payment_method === "onsite" && o.reservation_id)
    .map((o) => String(o.reservation_id)))];
  if (sedute.length) {
    const { data: pagRaw, error: ePag } = await leggi("table_payments", ambito, "reservation_id, amount_cents")
      .in("reservation_id", sedute)
      .eq("status", "paid");
    if (!ePag) {
      const perSeduta = new Map<string, number>();
      for (const p of (pagRaw ?? []) as unknown as { reservation_id: string; amount_cents: number }[]) {
        perSeduta.set(String(p.reservation_id), (perSeduta.get(String(p.reservation_id)) ?? 0) + (Number(p.amount_cents) || 0));
      }
      for (const o of tutti) {
        const v = perSeduta.get(String(o.reservation_id ?? ""));
        if (v && o.status === "pending" && o.payment_method === "onsite") o.parziale_cents = v;
      }
    }
  }
  return json({ orders: tutti });
};

// POST /api/admin/orders — ordine MANUALE creato dallo staff.
// Crea l'ordine (status pending, source manual), genera la sessione Stripe
// e invia al cliente l'email con il link di pagamento. Il webhook esistente
// lo passerà a 'paid' quando il cliente paga (email cucina/conferma comprese).
// `piattiPerOrdine` e `rigaOrdine` stanno in `lib/admin/righeOrdine.ts`
// (23/10/2026): li usa anche il palmare del cameriere.

export const POST: APIRoute = async ({ request }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();
  const ambito = await ambitoDiRichiesta(request, staff);
  const fuso = await fusoDi(ambito);

  let body: {
    first_name?: string;
    last_name?: string;
    email?: string;
    phone?: string;
    lang?: string;
    payment?: string;
    date?: string;
    slot?: string;
    note?: string;
    items?: { id?: string; qty?: number }[];
    resend_id?: string;
  };
  try {
    body = await request.json();
  } catch {
    return json({ error: await msg("err.request") }, 400);
  }

  // ---- RINVIO email di pagamento (ordine pending): sessione Stripe NUOVA
  // (il vecchio link può essere scaduto: 24h) + stessa email col riepilogo.
  if (body.resend_id) {
    const rid = String(body.resend_id);
    if (!/^[0-9a-f-]{36}$/i.test(rid)) return json({ error: await msg("err.id") }, 400);
    const { data: ord } = await leggi("orders", ambito, "*").eq("id", rid).maybeSingle();
    if (!ord || ord.status !== "pending") return json({ error: await msg("err.orderNotFoundOrPaid") }, 404);
    const vociR: VoceCheckout[] = ((ord.items ?? []) as { name: string; qty: number; price_cents: number }[])
      .filter((i) => i.qty > 0)
      .map((i) => ({ name: i.name, price_cents: i.price_cents, qty: i.qty }));
    if (!vociR.length) return json({ error: await msg("err.orderEmpty") }, 409);
    const siteUrlR = process.env.PUBLIC_SITE_URL ?? import.meta.env.PUBLIC_SITE_URL ?? "http://localhost:4321";
    try {
      const langR: "fr" | "en" = ord.lang === "en" ? "en" : "fr";
      // ⚠️ Il conto e' quello dell'ORDINE (`ord` e' letto con `*`), non la
      // sede selezionata nell'header: si sta rimandando il link di un ordine
      // che esiste gia', e deve incassare dove ha sempre dovuto incassare.
      const contoOrd = ambitoDiRiga(ord.location_id as string | null);
      const payUrl = await creaCheckoutSession({ ambito: contoOrd, voci: vociR, orderId: rid, siteUrl: siteUrlR, lang: langR, returnBase: await basePubblicaOpz(contoOrd) });
      await aggiornaRighe("orders", ambito, { stripe_session_id: payUrl }).eq("id", rid);
      void emailLienPaiement({
        // Stessa sede dell'incasso: l'email porta indirizzo e telefono del
        // punto dove l'ordine e' stato preso.
        location_id: ord.location_id as string | null,
        numero: rid.slice(0, 8),
        customer_name: String(ord.customer_name ?? ""),
        customer_email: String(ord.customer_email ?? ""),
        customer_phone: (ord.customer_phone as string | null) ?? null,
        pickup_time: String(ord.pickup_time),
        items: (ord.items ?? []) as { name: string; qty: number; price_cents: number; notes?: string }[],
        total_cents: Number(ord.total_cents ?? 0),
        lang: langR,
        pay_url: payUrl,
        cancel_url: ord.cancel_token
          ? `${siteUrlR.replace(/\/$/, "")}/order/cancel?token=${ord.cancel_token}`
          : null,
      });
      return json({ ok: true });
    } catch (e) {
      console.error("[rinvio email ordine] Stripe error:", e);
      return json({ error: await msg("err.stripe") }, 502);
    }
  }

  // Lingua email = una delle lingue pubbliche (fr/en/it/nl/es), ripiego su FR.
  const LANG_PUBBLICHE = ["fr", "en", "it", "nl", "es"];
  const lang = LANG_PUBBLICHE.includes(String(body.lang)) ? String(body.lang) : "fr";
  // Metodo di pagamento: 'link' (Stripe, default) · 'cash'/'card' (pagato di persona).
  const payment = ["link", "cash", "card"].includes(String(body.payment)) ? String(body.payment) : "link";
  const paidSurPlace = payment === "cash" || payment === "card";
  const nome = `${String(body.first_name ?? "").trim()} ${String(body.last_name ?? "").trim()}`.trim();
  const email = String(body.email ?? "").trim();
  const slot = String(body.slot ?? "");
  const items = Array.isArray(body.items) ? body.items : [];
  // Ordine creato dallo staff: PRENOME e TELEFONO obbligatori — servono a
  // richiamare il cliente se qualcosa non va col ritiro. Il cognome no: al
  // banco spesso non lo si chiede. (La MODIFICA non li impone: gli ordini
  // presi dal sito pubblico possono non avere il telefono.)
  if (!String(body.first_name ?? "").trim()) return json({ error: await msg("err.firstNameRequired") }, 400);
  if (!String(body.phone ?? "").trim()) return json({ error: await msg("err.phoneRequired") }, 400);
  if (!nome) return json({ error: await msg("err.nameRequired") }, 400);
  // Email obbligatoria SOLO per il link di pagamento; facoltativa se pagato di
  // persona (walk-in). Se presente deve comunque essere valida.
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  if (payment === "link" && !emailOk) return json({ error: await msg("err.emailForPayLink") }, 400);

  // ⚠️ Il bottone nascosto e' un suggerimento, non un controllo. Chi manda la
  // richiesta e' il browser, e il browser puo' mandare qualunque cosa — un
  // vecchio schermo aperto da stamattina, per esempio. Senza questo, un
  // ordine `link` su una sede non configurata verrebbe creato, l'email
  // partirebbe, e il cliente pagherebbe su un conto che non e' il suo.
  if (payment === "link" && !(await pagamentoOnlineAttivo(ambito))) {
    return json({ error: await msg("err.payNotConfigured") }, 409);
  }
  if (email && !emailOk) return json({ error: await msg("err.email") }, 400);
  if (!/^\d{2}:\d{2}$/.test(slot)) return json({ error: await msg("err.slot") }, 400);
  if (!items.length) return json({ error: await msg("err.cartEmpty") }, 400);

  // Data del ritiro: oggi (default) o un giorno futuro. Le date passate/non valide
  // vengono rifiutate. Per oggi si usa l'ora corrente (filtra gli slot passati),
  // per un giorno futuro l'inizio giornata.
  const oraNow = DateTime.now().setZone(fuso);
  let ora = oraNow;
  const dStr = String(body.date ?? "").trim();
  if (dStr) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dStr)) return json({ error: await msg("err.date") }, 400);
    const d = DateTime.fromISO(dStr, { zone: fuso });
    if (!d.isValid || d.startOf("day") < oraNow.startOf("day")) return json({ error: await msg("err.date") }, 400);
    ora = d.hasSame(oraNow, "day") ? oraNow : d.startOf("day");
  }
  // Créneau valido per QUELLA data (stessa fonte del sito: /api/slots)
  const config = await configRitiro(ora, await ambitoDiRichiesta(request, staff));
  if (!config) return json({ error: await msg("err.hoursUnavailable") }, 503);
  const { lunch, dinner } = calcolaSlotGiorno(ora, config, fuso);
  if (![...lunch, ...dinner].includes(slot)) return json({ error: await msg("err.slotGone") }, 409);

  // Prezzi SEMPRE dal DB (mai dal browser), sconti compresi
  const ids = items.map((i) => String(i.id ?? ""));
  const { data: piatti, error: errMenu } = await piattiPerOrdine(ids, ambito);
  if (errMenu || !piatti) return json({ error: await msg("err.menuUnreadable") }, 503);

  const voci: VoceCheckout[] = [];
  const itemsOrdine: { id: string; name: string; base_name?: string; variant_label?: string; qty: number; price_cents: number; notes: string; variant?: string }[] = [];
  for (const rich of items) {
    const piatto = piatti.find((x) => x.id === rich.id);
    if (!piatto || !piatto.available || piatto.sold_out === true) return json({ error: await msg("err.dishGone") }, 409);
    const riga = rigaOrdine(piatto, rich as { qty?: unknown; variant?: unknown }, lang, ambito);
    if (!riga) return json({ error: await msg("err.formatGone") }, 409);
    voci.push({ name: riga.name, price_cents: riga.price_cents, qty: riga.qty });
    itemsOrdine.push({ id: piatto.id, name: riga.name, base_name: riga.base_name, ...(riga.variant_label ? { variant_label: riga.variant_label } : {}), qty: riga.qty, price_cents: riga.price_cents, notes: "", ...(riga.variant ? { variant: riga.variant } : {}) });
  }
  const noteText = String(body.note ?? "").trim().slice(0, 500);
  if (noteText) itemsOrdine.push({ id: "note", name: "NOTE CLIENT", qty: 0, price_cents: 0, notes: noteText });
  const totale = itemsOrdine.reduce((t, i) => t + i.price_cents * i.qty, 0);

  const [h, m] = slot.split(":").map((n) => parseInt(n, 10));
  const pickup = ora.set({ hour: h, minute: m, second: 0, millisecond: 0 });

  const datiOrdine: Record<string, unknown> = {
    status: paidSurPlace ? "paid" : "pending",
    source: "manual",
    payment_method: payment,
    pickup_time: pickup.toISO(),
    customer_name: nome,
    customer_email: email || null,
    customer_phone: String(body.phone ?? "").trim() || null,
    items: itemsOrdine,
    total_cents: totale,
    lang,
  };
  const inserisci = () => inserisciRiga("orders", ambito, datiOrdine).select("id, cancel_token").single();
  let ins = await inserisci();
  // Migrazione #29 non ancora lanciata: senza source l'ordine sparirebbe
  // dalla lista (pending non manuale) → meglio rifiutare chiaramente.
  if (ins.error && String(ins.error.message ?? "").includes("source")) {
    return json({ error: await msg("err.migr29") }, 500);
  }
  // Migrazione #49 mancante: il check lang in ('fr','en') rifiuta it/nl/es.
  if (ins.error && String(ins.error.message ?? "").toLowerCase().includes("lang")) {
    return json({ error: await msg("err.migr49") }, 500);
  }
  // Migrazione #49 (payment_method) assente: si crea comunque l'ordine, senza il metodo.
  if (ins.error && String(ins.error.message ?? "").includes("payment_method")) {
    delete datiOrdine.payment_method;
    ins = await inserisci();
  }
  // Migrazione #30 assente: si continua senza link di annullamento
  if (ins.error && String(ins.error.message ?? "").includes("cancel_token")) {
    ins = await inserisciRiga("orders", ambito, datiOrdine).select("id").single();
  }
  if (ins.error || !ins.data) return json({ error: await msg("err.create") }, 500);
  const orderId = ins.data.id as string;
  const cancelToken = (ins.data as { cancel_token?: string | null }).cancel_token ?? null;

  // PAGATO DI PERSONA (contanti/carta): niente Stripe. Notifica cucina sempre;
  // conferma + recensione al cliente solo se ha lasciato l'email (guardie interne).
  if (paidSurPlace) {
    // Il ticket segue l'avviso alla cucina, dallo stesso punto. Un ordine
    // preso al banco e pagato subito e' `paid`: `daStampare` lo riconosce.
    void accodaTicket({
      id: orderId,
      status: "paid",
      payment_method: String(body.payment ?? "") || null,
      location_id: ambito.modo === "sede" ? ambito.id : null,
    });
    void inviaNotifiche({
      // L'ordine e' appena stato inserito con questo ambito.
      location_id: ambito.modo === "sede" ? ambito.id : null,
      numero: orderId.slice(0, 8),
      customer_name: nome,
      customer_email: email,
      customer_phone: String(body.phone ?? "").trim() || null,
      pickup_time: pickup.toISO() ?? new Date().toISOString(),
      items: itemsOrdine,
      total_cents: totale,
      lang,
    });
    return json({ ok: true, id: orderId, paid: true });
  }

  const siteUrl = process.env.PUBLIC_SITE_URL ?? import.meta.env.PUBLIC_SITE_URL ?? "http://localhost:4321";
  try {
    // Ordine appena inserito con questo ambito: stesso conto. (Non puo'
    // essere l'aggregato: `inserisci` lo avrebbe gia' rifiutato.)
    const payUrl = await creaCheckoutSession({ ambito, voci, orderId, siteUrl, lang: lang === "en" ? "en" : "fr", returnBase: await basePubblicaOpz(ambito) });
    await aggiornaRighe("orders", ambito, { stripe_session_id: payUrl }).eq("id", orderId);
    void emailLienPaiement({
      location_id: ambito.modo === "sede" ? ambito.id : null,
      numero: orderId.slice(0, 8),
      customer_name: nome,
      customer_email: email,
      customer_phone: String(body.phone ?? "").trim() || null,
      pickup_time: pickup.toISO() ?? new Date().toISOString(),
      items: itemsOrdine,
      total_cents: totale,
      lang,
      pay_url: payUrl,
      cancel_url: cancelToken ? `${siteUrl.replace(/\/$/, "")}/order/cancel?token=${cancelToken}` : null,
    });
    return json({ ok: true, id: orderId });
  } catch (e) {
    // Sessione Stripe fallita: niente ordine fantasma in lista
    console.error("[ordine manuale] Stripe error:", e);
    await cancella("orders", ambito).eq("id", orderId);
    return json({ error: await msg("err.stripeCreate") }, 502);
  }
};

// PATCH /api/admin/orders — cambia lo stato di un ordine.
// Usato dai bottoni della pagina Commandes: "Terminée" → done,
// "Annuler" (con conferma) → cancelled. Mai su ordini 'pending'.
export const PATCH: APIRoute = async ({ request }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();
  const ambito = await ambitoDiRichiesta(request, staff);

  let body: { id?: string; status?: string; payment?: string; supplement?: string; pronto?: boolean };
  try {
    body = await request.json();
  } catch {
    return json({ error: await msg("err.request") }, 400);
  }

  const id = String(body.id ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ error: await msg("err.id") }, 400);

  /* ───────── Supplemento incassato AL BANCO ─────────
   *
   * ⚠️ Fino al 04/10 il supplemento (una modifica che alza il totale su un
   * ordine pagato online) si poteva saldare in UN modo solo: il cliente paga
   * il link Stripe, e il webhook scrive «pagato». Ma il caso piu' frequente e'
   * l'altro — il cliente arriva, gli si dice «sono 8 € in piu'», e li da' al
   * banco. Quel denaro entrava nel cassetto e il motore non lo sapeva: la
   * barra «Incassare» restava li' per sempre.
   *
   * Qui si dichiara che quei soldi sono entrati. Non c'e' nessun incasso
   * Stripe a confermarlo: e' lo stesso patto del bottone «Incassa» sugli
   * ordini da incassare, e per questo vuole un metodo esplicito.
   */
  const supIncasso = String(body.supplement ?? "").trim();
  if (supIncasso) {
    if (!METODI_CASSA_SCELTA.includes(supIncasso)) {
      return json({ error: await msg("err.payMethod") }, 400);
    }
    const { data: dSup, error: eSup } = await aggiornaRighe("orders", ambito, {
      supplement_due_cents: 0,
      supplement_paid_at: new Date().toISOString(),
    })
      .eq("id", id)
      .gt("supplement_due_cents", 0)
      .select("id")
      .maybeSingle();
    if (eSup) {
      if (String(eSup.message ?? "").includes("supplement")) {
        return json({ error: await msg("err.migr50") }, 500);
      }
      return json({ error: await msg("err.update") }, 500);
    }
    // ⚠️ `gt("supplement_due_cents", 0)`: due tocchi ravvicinati, o due
    // apparecchi, non devono poter «incassare» due volte lo stesso
    // supplemento. Se non c'era niente da incassare, non si e' incassato.
    if (!dSup) return json({ error: await msg("err.noDiff") }, 409);
    return json({ ok: true });
  }

  const prontoChiesto = body.pronto === true;
  let status = String(body.status ?? "");
  if (!prontoChiesto && !["paid", "done", "cancelled"].includes(status)) {
    return json({ error: await msg("err.status") }, 400);
  }

  // ⚠️ La sede dell'ORDINE, non quella selezionata: l'email di annullamento
  // porta l'indirizzo e il telefono del punto dove il cliente aveva ordinato.
  // `SEL_ANN` non seleziona `location_id` (non puo': su un cliente senza la
  // migrazione #73 la colonna non esiste), quindi si legge a parte.
  const contoAnn = await cercaAmbito("orders", id, ambito);

  // Leggo l'ordine PRIMA di aggiornarlo: serve lo stato/metodo precedenti per
  // decidere l'email di annullamento (rimborso online / in cassa / non pagato).
  /* ⚠️ `service` serve all’email «c’e’ pronto»: in sala si manda solo dove
     nessuno porta il piatto. Se la colonna non c’e’ (#82 non lanciata) il
     secondo tentativo qui sotto la lascia cadere, e si torna al
     comportamento di prima — che per un locale senza sala e’ quello giusto. */
  const SEL_ANN = "id, status, customer_name, customer_email, customer_phone, pickup_time, total_cents, refunded_cents, lang, payment_method, service, table_label";
  let prima: Record<string, unknown> | null = null;
  {
    // #89 (`ready_at`) davanti, poi come prima.
    let r = await leggi("orders", ambito, SEL_ANN + ", ready_at").eq("id", id).maybeSingle();
    if (r.error) r = await leggi("orders", ambito, SEL_ANN).eq("id", id).maybeSingle();
    if (!r.error) prima = r.data as Record<string, unknown> | null;
    else {
      const r2 = await leggi("orders", ambito, "id, status, customer_name, customer_email, customer_phone, pickup_time, total_cents, refunded_cents, lang")
        .eq("id", id)
        .maybeSingle();
      prima = r2.data as Record<string, unknown> | null;
    }
  }

  // ⚠️ L'INCASSO IN CASSA e' l'unico modo legittimo di portare un `pending` a
  // `paid` dal pannello: li' il denaro lo prende una persona, non Stripe.
  // Vale SOLO per gli ordini nati per essere pagati al ritiro: un carrello
  // abbandonato non si incassa, e segnarlo pagato sarebbe inventare un
  // incasso. Se la lettura di `prima` non e' riuscita, non si concede niente.
  const daIncassare =
    prima?.status === "pending" && String(prima?.payment_method ?? "") === "onsite";
  /** Gia' segnato pronto (#89): il cliente e' gia' stato chiamato. */
  const giaPronto = Boolean(prima?.ready_at);

  /* ───────── «PRÊT» su un ordine ANCORA DA INCASSARE (#89) ─────────
     Il fast-food: la cucina ha finito, si chiama il cliente, e lui paga al
     banco. L'ordine resta `pending` + `onsite` — nessuno l'ha pagato — ma si
     ricorda di essere pronto (`ready_at`): l'email parte una volta sola, e
     all'incasso si chiude subito. Su un ordine gia' pagato «Prêt» e'
     «Terminée» (`status: "done"`), e lo manda la pagina. */
  if (prontoChiesto) {
    if (!daIncassare) return json({ error: await msg("err.status") }, 400);
    if (giaPronto) return json({ ok: true });
    const { data: dPr, error: ePr } = await aggiornaRighe("orders", ambito, { ready_at: new Date().toISOString() })
      .eq("id", id)
      .eq("status", "pending")
      .is("ready_at", null)
      .select("id")
      .maybeSingle();
    if (ePr) {
      if (String(ePr.message ?? "").includes("ready_at")) return json({ error: await msg("err.migr89") }, 500);
      return json({ error: await msg("err.update") }, 500);
    }
    // Un altro tablet l'ha segnato un istante prima: nessuna seconda email.
    if (!dPr) return json({ ok: true });
    await mandaPronto(prima, contoAnn);
    return json({ ok: true });
  }
  /* L'INCASSO di un ordine gia' pronto (il cliente e' venuto a prenderlo e
     paga adesso) lo CHIUDE: non c'e' piu' niente da preparare. */
  if (status === "paid" && daIncassare && giaPronto) status = "done";
  /** E' l'incasso al banco: `paid`, oppure `done` se era gia' pronto. */
  const incassoBanco = (status === "paid" || (status === "done" && giaPronto)) && daIncassare;

  /* ⚠️ INCASSARE SCRIVE ANCHE **COME**. Il pannello lo chiede con due
     bottoni, ma il bottone e' un suggerimento: la regola sta qui. Il metodo si
     accetta SOLO insieme all'incasso di un ordine nato per la cassa — mai per
     riscrivere il metodo di un ordine passato da Stripe, dove quel valore e'
     la prova di dove sono i soldi.
     Senza questo, l'ordine restava marcato `onsite`: la card mostrava il
     marchio Stripe su contanti finiti nel cassetto, e a fine serata non si
     distingueva piu' chi aveva pagato in contanti e chi con la carta. */
  const metodoIncasso = String(body.payment ?? "").trim();
  if (metodoIncasso && !(incassoBanco && METODI_CASSA_SCELTA.includes(metodoIncasso))) {
    return json({ error: await msg("err.payMethod") }, 400);
  }
  const campi: Record<string, unknown> = metodoIncasso
    ? { status, payment_method: metodoIncasso }
    : { status };
  let q = aggiornaRighe("orders", ambito, campi).eq("id", id);
  // Annuler è permesso anche su un pending (link di pagamento non pagato);
  // per gli altri passaggi i pending non si toccano (li gestisce il webhook).
  if (status !== "cancelled" && !incassoBanco) {
    q = q.neq("status", "pending");
  }
  const { data, error } = await q.select("id").maybeSingle();

  if (error) {
    // Migrazione #49 assente: la colonna del metodo non esiste. Si dice quale
    // migrazione manca, invece di un «impossibile aggiornare» muto.
    if (String(error.message ?? "").includes("payment_method")) {
      return json({ error: await msg("err.migr49") }, 500);
    }
    return json({ error: await msg("err.update") }, 500);
  }
  if (!data) return json({ error: await msg("err.orderNotFound") }, 404);
  /* Incassato al banco un ordine di un tavolo che aveva chiesto il conto
     («Paiement en caisse» dal palmare, 26/10/2026): se non resta niente da
     incassare, la seduta si chiude e il tavolo torna libero (non piu' blu). */
  if (incassoBanco) {
    const { data: rr } = await leggi("orders", ambito, "reservation_id").eq("id", id).maybeSingle();
    const rid = String((rr as { reservation_id?: string | null } | null)?.reservation_id ?? "");
    if (rid) await chiudiSeContoChiesto(ambito, rid).catch((e) => console.error("[incasso] seduta:", e));
  }

  // Email di annullamento al cliente (solo alla transizione verso "cancelled").
  if (status === "cancelled" && prima && prima.status !== "cancelled" && String(prima.customer_email ?? "").trim()) {
    const inPersona = inCassa(prima.payment_method);
    const totale = Number(prima.total_cents ?? 0);
    /* ⚠️ L'importo che l'email promette di rendere e' quello che il
       ristorante tiene ancora (`rimborsabile`), con la differenza di una
       modifica non ancora resa: era `totale − rimborsato`, e a chi aveva
       tolto un piatto l'email annunciava il rimborso solo di quello che
       restava. Le colonne #50 si leggono a parte: senza, valgono zero. */
    const { data: d50 } = await leggi("orders", ambito, "refund_due_cents, supplement_due_cents").eq("id", id).maybeSingle()
      .then((r) => r, () => ({ data: null }));
    const residuo = rimborsabile({
      total_cents: totale,
      refunded_cents: Number(prima.refunded_cents ?? 0),
      refund_due_cents: Number((d50 as { refund_due_cents?: number } | null)?.refund_due_cents ?? 0),
      supplement_due_cents: Number((d50 as { supplement_due_cents?: number } | null)?.supplement_due_cents ?? 0),
    });
    let refundMode: "online" | "in_person" | "unpaid";
    if (prima.status === "pending") refundMode = "unpaid";
    else if (inPersona || residuo <= 0) refundMode = "in_person";
    else refundMode = "online";

    const notif = {
      // La sede del FATTO: l'email dice l'indirizzo del punto dove l'ordine
      // e' stato preso, non di quello selezionato adesso nell'header.
      location_id: contoAnn.modo === "sede" ? contoAnn.id : null,
      numero: String(prima.id).slice(0, 8),
      customer_name: String(prima.customer_name ?? ""),
      customer_email: String(prima.customer_email ?? ""),
      customer_phone: (prima.customer_phone as string | null) ?? null,
      pickup_time: String(prima.pickup_time ?? new Date().toISOString()),
      items: [] as { name: string; qty: number; price_cents: number }[],
      total_cents: totale,
      lang: String(prima.lang ?? "fr"),
      consegna: await consegnaDellOrdine(String(prima.id), contoAnn.modo === "sede" ? contoAnn.id : null),
    };
    // NON si aspetta l'email: l'annullamento e' gia scritto nel database e
    // la risposta deve tornare subito, altrimenti l'admin resta fermo per
    // secondi sul bottone e pensa che non sia successo niente.
    // (Stesso trattamento di `inviaNotifiche` alla creazione dell'ordine.)
    void inviaAnnullaOrdine(notif, { refundMode, refund_cents: residuo }).catch(() => {
      /* l'annullamento resta valido anche se l'email fallisce */
    });
  }

  /* «VOTRE COMMANDE EST PRETE» — e solo quando vuol dire davvero quello.
     ⚠️ Tre condizioni, e nessuna e' di contorno:
     · la TRANSIZIONE (`prima.status !== "done"`): ripremere un bottone gia'
       premuto non deve far partire una seconda email;
     · l'EMAIL, che un ordine preso al banco puo' non avere;
     · la FINESTRA (`avvisaChePronto`): oltre mezz'ora dall'ora di ritiro,
       «Terminée» non vuol dire «e' pronto» ma «il cliente e' passato e
       nessuno aveva cambiato lo stato». Scrivergli che il suo ordine e'
       pronto, col sacchetto gia' a casa sua, e' peggio del silenzio.
     ⚠️ E sta QUI, nella rotta che il pannello chiama: il cron che chiude gli
     ordini rimasti aperti aggiorna la riga per conto suo e non passa di qua.
     Un'email partita da sola alle tre di notte non la spiega nessuno. */
  /* ⚠️ L’INTERRUTTORE SI LEGGE SOLO PER UN ORDINE IN SALA, e dalla sede
     dell’ORDINE (`contoAnn`), non da quella selezionata nell’header: in un
     gruppo, lo snack e il ristorante col cameriere stanno nello stesso
     account e vogliono il contrario l’uno dell’altro. */
  /* ⚠️ Gia' pronto (#89): il cliente e' stato chiamato da «Prêt», e
     l'incasso che chiude l'ordine non lo richiama. */
  if (status === "done" && prima && prima.status !== "done" && !giaPronto) {
    await mandaPronto(prima, contoAnn);
  }

  return json({ ok: true });
};


// PUT /api/admin/orders — MODIFICA di un ordine ATTIVO (paid o pending).
// Ricalcola articoli/prezzi dal DB, aggiorna la riga e RIMANDA l'email:
//   - pending (link non pagato): rigenera la sessione Stripe col nuovo importo
//     e rimanda il link di pagamento aggiornato (importo sempre coerente);
//   - paid (gia' pagato): conferma aggiornata al cliente + ticket in cucina.
// Stato e metodo di pagamento NON cambiano.
export const PUT: APIRoute = async ({ request }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();
  const ambito = await ambitoDiRichiesta(request, staff);
  const fuso = await fusoDi(ambito);

  let body: {
    id?: string;
    first_name?: string;
    last_name?: string;
    email?: string;
    phone?: string;
    lang?: string;
    date?: string;
    slot?: string;
    note?: string;
    items?: { id?: string; qty?: number }[];
    payment?: string;
  };
  try {
    body = await request.json();
  } catch {
    return json({ error: await msg("err.request") }, 400);
  }

  const id = String(body.id ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ error: await msg("err.id") }, 400);

  // L'ordine deve esistere ed essere ATTIVO (paid o pending). Leggo anche gli
  // importi/pagamento per gestire la differenza. Le colonne #50 (supplement/
  // refund) potrebbero non esistere ancora: in tal caso ripiego sui campi base
  // e ricordo che la migrazione manca (migMancante).
  const SEL_FULL =
    "id, status, cancel_token, pickup_time, total_cents, refunded_cents, stripe_session_id, payment_method, supplement_due_cents, refund_due_cents, supplement_paid_at, items";
  const SEL_BASE =
    "id, status, cancel_token, pickup_time, total_cents, refunded_cents, stripe_session_id, payment_method, items";
  let migMancante = false;
  let sel = await leggi("orders", ambito, SEL_FULL).eq("id", id).maybeSingle();
  if (sel.error) {
    migMancante = true;
    sel = await leggi("orders", ambito, SEL_BASE).eq("id", id).maybeSingle();
  }
  const ord = sel.data as Record<string, unknown> | null;
  const errOrd = sel.error;
  if (errOrd) return json({ error: await msg("err.read") }, 500);
  if (!ord) return json({ error: await msg("err.orderNotFound") }, 404);
  if (ord.status !== "paid" && ord.status !== "pending") {
    return json({ error: await msg("err.onlyActiveOrders") }, 409);
  }
  /* ⚠️ `pending` da solo non vuol dire «aspetta un pagamento online». Un
     ordine preso dal sito e da pagare al ritiro e' pending anche lui, e per
     quello l'email non e' obbligatoria: al banco si paga di persona. */
  const isLink = ord.status === "pending" && !inCassa(ord.payment_method);

  const LANG_PUBBLICHE = ["fr", "en", "it", "nl", "es"];
  const lang = LANG_PUBBLICHE.includes(String(body.lang)) ? String(body.lang) : "fr";
  const nome = `${String(body.first_name ?? "").trim()} ${String(body.last_name ?? "").trim()}`.trim();
  const email = String(body.email ?? "").trim();
  const slot = String(body.slot ?? "");
  const items = Array.isArray(body.items) ? body.items : [];
  if (!nome) return json({ error: await msg("err.nameRequired") }, 400);
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  if (isLink && !emailOk) return json({ error: await msg("err.emailForPayLink") }, 400);
  if (email && !emailOk) return json({ error: await msg("err.email") }, 400);
  if (!/^\d{2}:\d{2}$/.test(slot)) return json({ error: await msg("err.slot") }, 400);
  if (!items.length) return json({ error: await msg("err.cartEmpty") }, 400);

  // Data del ritiro (stessa logica del POST).
  const oraNow = DateTime.now().setZone(fuso);
  let ora = oraNow;
  const dStr = String(body.date ?? "").trim();
  if (dStr) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dStr)) return json({ error: await msg("err.date") }, 400);
    const d = DateTime.fromISO(dStr, { zone: fuso });
    if (!d.isValid || d.startOf("day") < oraNow.startOf("day")) return json({ error: await msg("err.date") }, 400);
    ora = d.hasSame(oraNow, "day") ? oraNow : d.startOf("day");
  }
  const config = await configRitiro(ora, await ambitoDiRichiesta(request, staff));
  if (!config) return json({ error: await msg("err.hoursUnavailable") }, 503);
  const { lunch, dinner } = calcolaSlotGiorno(ora, config, fuso);
  // Orario originale dell'ordine (fuso ristorante): se lo staff NON lo cambia,
  // va accettato anche se ormai e' passato (quindi non piu' tra i disponibili).
  const origSlot = ord.pickup_time
    ? DateTime.fromISO(String(ord.pickup_time)).setZone(fuso).toFormat("HH:mm")
    : "";
  const origDate = ord.pickup_time
    ? DateTime.fromISO(String(ord.pickup_time)).setZone(fuso).toFormat("yyyy-MM-dd")
    : "";
  const dataScelta = dStr || oraNow.toFormat("yyyy-MM-dd");
  const slotInvariato = slot === origSlot && dataScelta === origDate;
  if (!slotInvariato && ![...lunch, ...dinner].includes(slot)) {
    return json({ error: await msg("err.slotGone") }, 409);
  }

  // Prezzi SEMPRE dal DB (mai dal browser), sconti compresi.
  const ids = items.map((i) => String(i.id ?? ""));
  const { data: piatti, error: errMenu } = await piattiPerOrdine(ids, ambito);
  if (errMenu || !piatti) return json({ error: await msg("err.menuUnreadable") }, 503);

  const voci: VoceCheckout[] = [];
  const itemsOrdine: { id: string; name: string; base_name?: string; variant_label?: string; qty: number; price_cents: number; notes: string; variant?: string }[] = [];
  for (const rich of items) {
    const piatto = piatti.find((x) => x.id === rich.id);
    if (!piatto || !piatto.available || piatto.sold_out === true) return json({ error: await msg("err.dishGone") }, 409);
    const riga = rigaOrdine(piatto, rich as { qty?: unknown; variant?: unknown }, lang, ambito);
    if (!riga) return json({ error: await msg("err.formatGone") }, 409);
    voci.push({ name: riga.name, price_cents: riga.price_cents, qty: riga.qty });
    itemsOrdine.push({ id: piatto.id, name: riga.name, base_name: riga.base_name, ...(riga.variant_label ? { variant_label: riga.variant_label } : {}), qty: riga.qty, price_cents: riga.price_cents, notes: "", ...(riga.variant ? { variant: riga.variant } : {}) });
  }
  const noteText = String(body.note ?? "").trim().slice(0, 500);
  if (noteText) itemsOrdine.push({ id: "note", name: "NOTE CLIENT", qty: 0, price_cents: 0, notes: noteText });
  /* ⚠️ IL COSTO DELLA CONSEGNA RESTA NEL TOTALE. `items` si ricostruisce dai
     piatti scelti, e la consegna non e' un piatto: senza questa riga il totale
     scenderebbe di 3,50 € e il pannello proporrebbe di RIMBORSARE una
     consegna che c'e' ancora. Lettura a parte (#85): colonna assente → 0, che
     senza la #85 e' anche la verita'. */
  let fuoriPiatti = 0;
  {
    const r = await leggi("orders", ambito, "delivery_fee_cents").eq("id", id).maybeSingle();
    if (!r.error) fuoriPiatti = Math.max(0, Math.round(Number((r.data as { delivery_fee_cents?: unknown } | null)?.delivery_fee_cents ?? 0)) || 0);
  }
  // ⚠️ La mancia, uguale: non e' un piatto, e resta nel totale (#86).
  {
    const r = await leggi("orders", ambito, "tip_cents").eq("id", id).maybeSingle();
    if (!r.error) fuoriPiatti += Math.max(0, Math.round(Number((r.data as { tip_cents?: unknown } | null)?.tip_cents ?? 0)) || 0);
  }
  const totale = itemsOrdine.reduce((t, i) => t + i.price_cents * i.qty, 0) + fuoriPiatti;

  const [h, m] = slot.split(":").map((n) => parseInt(n, 10));
  const pickup = ora.set({ hour: h, minute: m, second: 0, millisecond: 0 });

  const aggiorna: Record<string, unknown> = {
    pickup_time: pickup.toISO(),
    customer_name: nome,
    customer_email: email || null,
    customer_phone: String(body.phone ?? "").trim() || null,
    items: itemsOrdine,
    total_cents: totale,
    lang,
  };
  /* ───────── Metodo di pagamento: solo denaro di cassa ─────────
   *
   * ⚠️ Il bottone nascosto nel modale e' un suggerimento, non un controllo:
   * chi manda la richiesta e' il browser. La regola sta qui.
   *
   * Si puo' passare solo a contanti o carta, e solo su un ordine i cui soldi
   * li prende una persona al banco. Su un ordine incassato da Stripe il
   * metodo e' la PROVA di dove sono i soldi: cambiarlo in «contanti» farebbe
   * sparire dal pannello il rimborso di un incasso che esiste davvero.
   *
   * Su un ordine nato «paga al ritiro» e ancora da incassare, scegliere il
   * metodo E' l'incasso: stesso gesto del bottone «Incassa» sulla card, e
   * quindi stesso effetto — l'ordine diventa pagato ed entra nel conto della
   * giornata. Nessuna email al cliente: ha pagato quello che doveva. */
  const metodoRich = String(body.payment ?? "").trim();
  let incassaOra = false;
  if (metodoRich) {
    if (!METODI_CASSA_SCELTA.includes(metodoRich)) {
      return json({ error: await msg("err.payMethod") }, 400);
    }
    if (!metodoCambiabile(ord.payment_method)) {
      return json({ error: await msg("err.payMethodLocked") }, 409);
    }
    aggiorna.payment_method = metodoRich;
    // Era «da incassare» e adesso ha un metodo: i soldi sono entrati.
    incassaOra = ord.status === "pending";
    if (incassaOra) aggiorna.status = "paid";
  }

  // Differenza d'importo: confronto il totale nuovo con quello vecchio.
  const oldTotal = Number(ord.total_cents ?? 0);
  const delta = totale - oldTotal; // >0 aumentato · <0 diminuito
  // "Pagato online" = ordine PAGATO ma NON di persona in cassa (contanti/carta):
  // cioe' ordini del sito o con payment link. Solo per questi si gestisce la
  // differenza (link supplemento / rimborso). Il rimborso vero (refund.ts)
  // richiede comunque un incasso Stripe: se non c'e', l'errore e' esplicito.
  const inPersona = inCassa(ord.payment_method);
  const paidOnline = ord.status === "paid" && !inPersona;

  // Pagato online + importo cambiato ma migrazione #50 assente: mi fermo PRIMA
  // di scrivere, per non lasciare un ordine modificato senza traccia della
  // differenza (il rimborso/supplemento resterebbe invisibile).
  if (paidOnline && delta !== 0 && migMancante) {
    return json({ error: await msg("err.migr50") }, 500);
  }

  const { error: errUpd } = await aggiornaRighe("orders", ambito, aggiorna).eq("id", id);
  if (errUpd) {
    if (String(errUpd.message ?? "").toLowerCase().includes("lang")) {
      return json({ error: await msg("err.migr49") }, 500);
    }
    // Migrazione #49 assente: la colonna del metodo non esiste ancora. Si dice
    // chiaramente, invece di far passare la modifica senza l'incasso.
    if (String(errUpd.message ?? "").includes("payment_method")) {
      return json({ error: await msg("err.migr49") }, 500);
    }
    return json({ error: await msg("err.update") }, 500);
  }

  // ⚠️ Il conto su cui incassare e l'indirizzo che va nell'email sono quelli
  // dell'ORDINE, non della sede selezionata da chi sta modificando.
  // `SEL_FULL` non seleziona `location_id` (e non puo': su un cliente senza
  // la migrazione #73 quella colonna non esiste ancora), quindi si legge a
  // parte, tollerando l'assenza.
  const conto = await cercaAmbito("orders", id, ambito);

  const numero = id.slice(0, 8);
  const notif = {
    location_id: conto.modo === "sede" ? conto.id : null,
    numero,
    customer_name: nome,
    customer_email: email,
    customer_phone: String(body.phone ?? "").trim() || null,
    pickup_time: pickup.toISO() ?? new Date().toISOString(),
    items: itemsOrdine,
    total_cents: totale,
    lang,
    consegna: await consegnaDellOrdine(id, conto.modo === "sede" ? conto.id : null),
    mancia_cents: await manciaDellOrdine(id, conto.modo === "sede" ? conto.id : null),
  };

  // Diff ordine per l'email "cosa è cambiato": lista unione vecchio+nuovo,
  // per riga oldQty/newQty (0 = tolto / aggiunto). Chiave = nome del piatto.
  type Line = { name: string; oldQty: number; newQty: number; price_cents: number };
  const oldRaw = (Array.isArray(ord.items) ? ord.items : []) as {
    id?: unknown; name?: unknown; qty?: unknown; price_cents?: unknown;
  }[];
  const linesMap = new Map<string, Line>();
  for (const it of oldRaw) {
    if (String(it.id ?? "") === "note") continue;
    const q = Number(it.qty) || 0;
    if (q <= 0) continue;
    const name = String(it.name ?? "");
    const e = linesMap.get(name);
    if (e) e.oldQty += q;
    else linesMap.set(name, { name, oldQty: q, newQty: 0, price_cents: Number(it.price_cents ?? 0) });
  }
  for (const it of itemsOrdine) {
    if (it.id === "note" || it.qty <= 0) continue;
    const e = linesMap.get(it.name);
    if (e) { e.newQty += it.qty; e.price_cents = it.price_cents; }
    else linesMap.set(it.name, { name: it.name, oldQty: 0, newQty: it.qty, price_cents: it.price_cents });
  }
  const lines = [...linesMap.values()];
  const dateChanged = !!origDate && origDate !== dataScelta;
  const changes = {
    timeFrom: origSlot ? (dateChanged ? `${origDate} ${origSlot}` : origSlot) : "",
    timeTo: dateChanged ? `${dataScelta} ${slot}` : slot,
    lines,
    totalFrom: oldTotal,
    totalTo: totale,
  };

  // 1) PENDING (link non pagato): rigenera il link intero e rimanda l'email link.
  if (isLink) {
    const siteUrl = process.env.PUBLIC_SITE_URL ?? import.meta.env.PUBLIC_SITE_URL ?? "http://localhost:4321";
    try {
      const payUrl = await creaCheckoutSession({ ambito: conto, voci, orderId: id, siteUrl, lang: lang === "en" ? "en" : "fr", returnBase: await basePubblicaOpz(conto) });
      await aggiornaRighe("orders", ambito, { stripe_session_id: payUrl }).eq("id", id);
      void emailLienPaiement({
        ...notif,
        pay_url: payUrl,
        cancel_url: ord.cancel_token ? `${siteUrl.replace(/\/$/, "")}/order/cancel?token=${ord.cancel_token}` : null,
      });
    } catch (e) {
      console.error("[modifica ordine] Stripe error:", e);
      return json({ error: await msg("err.stripeRelink") }, 502);
    }
    return json({ ok: true, id });
  }

  // 2) PAGATO ONLINE (sito o payment link): gestisco la differenza col netting.
  //    balance = quanto il cliente deve ancora (>0) o gli va reso (<0), sommando
  //    la posizione precedente (supplemento/rimborso in sospeso) al delta odierno.
  if (paidOnline && !migMancante) {
    const suppDue = Number(ord.supplement_due_cents ?? 0);
    const refDue = Number(ord.refund_due_cents ?? 0);
    const balance = suppDue - refDue + delta;
    const newSupp = Math.max(0, balance);
    const newRef = Math.max(0, -balance);

    const diffUpd: Record<string, unknown> = { supplement_due_cents: newSupp, refund_due_cents: newRef };
    // Nuovo supplemento in sospeso -> azzero un eventuale "differenza pagata" vecchio.
    if (newSupp > 0) diffUpd.supplement_paid_at = null;
    await aggiornaRighe("orders", ambito, diffUpd).eq("id", id);

    let payUrl: string | null = null;
    if (newSupp > 0) {
      const siteUrl = process.env.PUBLIC_SITE_URL ?? import.meta.env.PUBLIC_SITE_URL ?? "http://localhost:4321";
      try {
        payUrl = await creaCheckoutSupplemento({
          ambito: conto,
          orderId: id,
          diffCents: newSupp,
          numero,
          siteUrl,
          lang: lang === "en" ? "en" : "fr",
          returnBase: await basePubblicaOpz(conto),
        });
      } catch (e) {
        console.error("[modifica ordine] supplemento Stripe error:", e);
        return json({ error: await msg("err.stripeExtra") }, 502);
      }
    }
    void inviaModificaOrdine(notif, {
      supplement_url: payUrl,
      supplement_cents: newSupp,
      refund_cents: newRef,
      changes,
    });
    return json({ ok: true, id, supplement_cents: newSupp, refund_cents: newRef });
  }

  // 3) Pagato di persona (cash/card) o senza incasso Stripe: solo mail di modifica.
  //    La differenza la gestisci in cassa.
  void inviaModificaOrdine(notif, { changes });
  return json({ ok: true, id });
};

/**
 * «VOTRE COMMANDE EST PRÊTE» — l'email, con le sue regole: l'indirizzo c'e',
 * la finestra di mezz'ora (`avvisaChePronto`), e in sala l'interruttore
 * dell'avviso letto dalla sede dell'ORDINE. La chiamano «Terminée» (pagato →
 * fatto) e «Prêt» su un ordine ancora da incassare (#89). Mai bloccante.
 */
async function mandaPronto(
  prima: Record<string, unknown> | null,
  contoAnn: Awaited<ReturnType<typeof cercaAmbito>>,
): Promise<void> {
  if (!prima || !String(prima.customer_email ?? "").trim()) return;
  let avvisaInSala = false;
  if (alTavolo(prima.service)) avvisaInSala = (await opzioniTavolo(contoAnn)).avvisa;
  if (!avvisaChePronto(prima.pickup_time, Date.now(), prima.service, avvisaInSala)) return;
  void emailOrdinePronto({
    location_id: contoAnn.modo === "sede" ? contoAnn.id : null,
    numero: String(prima.id).slice(0, 8),
    customer_name: String(prima.customer_name ?? ""),
    customer_email: String(prima.customer_email ?? ""),
    customer_phone: (prima.customer_phone as string | null) ?? null,
    pickup_time: String(prima.pickup_time ?? new Date().toISOString()),
    items: [],
    total_cents: Number(prima.total_cents ?? 0),
    lang: String(prima.lang ?? "fr"),
    // Dal tavolo e al banco: «venez la chercher AU COMPTOIR».
    sala: alTavolo(prima.service)
      ? { tavolo: String(prima.table_label ?? ""), alBanco: avvisaInSala }
      : null,
  }).catch(() => {
    /* l'ordine e' chiuso lo stesso: l'email e' un di piu' */
  });
}
