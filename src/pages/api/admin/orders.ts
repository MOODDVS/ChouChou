import type { APIRoute } from "astro";
import { DateTime } from "luxon";
import { supabaseAdmin } from "../../../lib/db";
import { verificaStaff, nonAutorizzato } from "../../../lib/admin/adminAuth";
import { creaCheckoutSession, creaCheckoutSupplemento, type VoceCheckout } from "../../../lib/stripe";
import { calcolaSlotGiorno, TIMEZONE } from "../../../lib/slots";
import { configGiornoEffettiva } from "../../../lib/schedule";
import { prezzoEffettivo } from "../../../lib/pricing";
import { emailLienPaiement, inviaNotifiche, inviaModificaOrdine, inviaAnnullaOrdine } from "../../../lib/notifications";

export const prerender = false;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

// Base pubblica del sito per gli URL di ritorno Stripe (es. "/demo01").
// app_config "public_site_base"; vuoto/assente = sito alla radice ("").
// Serve perché i link di pagamento generati dall'admin devono riportare
// il cliente alla conferma del SITO giusto (non alla root sbagliata).
async function basePubblica(): Promise<string | undefined> {
  try {
    const { data } = await supabaseAdmin
      .from("app_config")
      .select("value")
      .eq("key", "public_site_base")
      .maybeSingle();
    const v = String((data as { value?: unknown } | null)?.value ?? "").trim();
    if (!v) return undefined;
    const b = (v.startsWith("/") ? v : "/" + v).replace(/\/$/, "");
    return b || undefined;
  } catch {
    return undefined;
  }
}

// GET /api/admin/orders
// Restituisce gli ordini con ritiro da 7 giorni fa in poi:
// paid (attivi), done (terminati), cancelled (annullati).
// I 'pending' (checkout Stripe mai completato) restano fuori.
// Protetto: serve un token staff valido.
export const GET: APIRoute = async ({ request, url }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();

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
    const { data, error } = await supabaseAdmin
      .from("orders")
      .select("id, customer_name, total_cents, pickup_time, created_at")
      .eq("status", "paid")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) return json({ orders: [], now });
    return json({ orders: data ?? [], now });
  }

  // (Retro-compat) vecchio parametro `new_since`: ordini pagati creati dopo.
  const newSince = url.searchParams.get("new_since");
  if (newSince) {
    const now = new Date().toISOString();
    const { data, error } = await supabaseAdmin
      .from("orders")
      .select("id, customer_name, total_cents, pickup_time, created_at")
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
    const start = DateTime.fromISO(monthParam + "-01", { zone: TIMEZONE });
    if (!start.isValid) return json({ days: [] });
    const daM = start.startOf("month").toISO();
    const aM = start.endOf("month").toISO();
    const { data } = await supabaseAdmin
      .from("orders")
      .select("pickup_time, status, source")
      .gte("pickup_time", daM as string)
      .lte("pickup_time", aM as string);
    const giorni = new Set<string>();
    for (const r of (data ?? []) as Array<{ pickup_time: string; status: string; source?: string | null }>) {
      const ok = ["paid", "done", "cancelled"].includes(r.status) || (r.status === "pending" && r.source === "manual");
      if (!ok) continue;
      const d = DateTime.fromISO(r.pickup_time).setZone(TIMEZONE).toISODate();
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
      const { data } = await supabaseAdmin
        .from("orders")
        .select("customer_name, customer_email, customer_phone, lang, created_at")
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
    type ItemJ = { id?: string; name?: string; qty?: number };
    const rows = new Map<string, { items: ItemJ[]; lang: string; created_at: string }>();
    const raccogli = async (mode: "email" | "phone", val: string) => {
      const base = supabaseAdmin
        .from("orders")
        .select("id, items, lang, created_at")
        .in("status", ["paid", "done"])
        .order("created_at", { ascending: false })
        .limit(500);
      const { data } = mode === "email" ? await base.ilike("customer_email", val) : await base.eq("customer_phone", val);
      for (const r of (data ?? []) as Array<{ id: string; items?: ItemJ[]; lang?: string; created_at: string }>)
        rows.set(r.id, { items: (r.items ?? []) as ItemJ[], lang: String(r.lang ?? ""), created_at: r.created_at });
    };
    try { if (email) await raccogli("email", email); } catch { /* */ }
    try { if (phone) await raccogli("phone", phone); } catch { /* */ }
    const tally = new Map<string, { id: string; name: string; qty: number }>();
    let lang = "";
    let ultima = "";
    for (const r of rows.values()) {
      if (r.created_at > ultima) { ultima = r.created_at; lang = r.lang; }
      for (const it of r.items) {
        if (!it || it.id === "note" || !it.id) continue;
        const q = Math.max(0, Number(it.qty) || 0);
        if (!q) continue;
        const cur = tally.get(it.id) ?? { id: it.id, name: String(it.name ?? ""), qty: 0 };
        cur.qty += q;
        tally.set(it.id, cur);
      }
    }
    const top = [...tally.values()].sort((a, b) => b.qty - a.qty).slice(0, 5);
    return json({ top_items: top, lang });
  }

  // Soglia: 7 giorni fa a mezzanotte, fuso Europe/Brussels, in ISO completo
  // (pickup_time è timestamptz, quindi confronto con un istante ISO).
  const soglia = DateTime.now()
    .setZone(TIMEZONE)
    .minus({ days: 7 })
    .startOf("day")
    .toISO();

  // ?date=YYYY-MM-DD → ordini di QUEL giorno (per consultare il passato),
  // altrimenti la finestra standard (ultimi 7 giorni).
  const dateParam = url.searchParams.get("date");
  let daISO: string | null = null;
  let aISO: string | null = null;
  if (dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
    const d = DateTime.fromISO(dateParam, { zone: TIMEZONE });
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
  const EXTRA_50 = ", supplement_due_cents, refund_due_cents, supplement_paid_at, payment_method";
  const leggi = (campi: string) => {
    const q1 = supabaseAdmin.from("orders").select(campi).in("status", ["paid", "done", "cancelled"]);
    // Pending MANUALI (link di pagamento inviato): i pending del sito
    // (checkout abbandonati) restano fuori. Migrazione #29 assente → nessuno.
    const q2 = supabaseAdmin.from("orders").select(campi).eq("status", "pending").eq("source", "manual");
    if (daISO && aISO) {
      q1.gte("pickup_time", daISO).lte("pickup_time", aISO);
      q2.gte("pickup_time", daISO).lte("pickup_time", aISO);
    } else {
      q1.gte("pickup_time", soglia);
      q2.gte("pickup_time", soglia);
    }
    return Promise.all([
      q1.order("pickup_time", { ascending: true }),
      q2.order("pickup_time", { ascending: true }),
    ]);
  };
  let [princ, pend] = await leggi(CAMPI_BASE + EXTRA_50);
  if (princ.error) [princ, pend] = await leggi(CAMPI_BASE);

  if (princ.error) {
    return json({ error: "Lecture impossible" }, 500);
  }

  // Nota: `select` con stringa variabile (fallback #50) fa perdere a TS il tipo
  // delle righe, quindi le tratto come oggetti generici per l'ordinamento.
  const righe = [
    ...(princ.data ?? []),
    ...(pend.error ? [] : (pend.data ?? [])),
  ] as unknown as Array<Record<string, unknown>>;
  const tutti = righe.sort((a, b) =>
    String(a.pickup_time).localeCompare(String(b.pickup_time))
  );
  return json({ orders: tutti });
};

// POST /api/admin/orders — ordine MANUALE creato dallo staff.
// Crea l'ordine (status pending, source manual), genera la sessione Stripe
// e invia al cliente l'email con il link di pagamento. Il webhook esistente
// lo passerà a 'paid' quando il cliente paga (email cucina/conferma comprese).
export const POST: APIRoute = async ({ request }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();

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
    return json({ error: "Requête invalide" }, 400);
  }

  // ---- RINVIO email di pagamento (ordine pending): sessione Stripe NUOVA
  // (il vecchio link può essere scaduto: 24h) + stessa email col riepilogo.
  if (body.resend_id) {
    const rid = String(body.resend_id);
    if (!/^[0-9a-f-]{36}$/i.test(rid)) return json({ error: "Id invalide" }, 400);
    const { data: ord } = await supabaseAdmin.from("orders").select("*").eq("id", rid).maybeSingle();
    if (!ord || ord.status !== "pending") return json({ error: "Commande introuvable ou déjà payée" }, 404);
    const vociR: VoceCheckout[] = ((ord.items ?? []) as { name: string; qty: number; price_cents: number }[])
      .filter((i) => i.qty > 0)
      .map((i) => ({ name: i.name, price_cents: i.price_cents, qty: i.qty }));
    if (!vociR.length) return json({ error: "Commande vide" }, 409);
    const siteUrlR = process.env.PUBLIC_SITE_URL ?? import.meta.env.PUBLIC_SITE_URL ?? "http://localhost:4321";
    try {
      const langR: "fr" | "en" = ord.lang === "en" ? "en" : "fr";
      const payUrl = await creaCheckoutSession({ voci: vociR, orderId: rid, siteUrl: siteUrlR, lang: langR, returnBase: await basePubblica() });
      await supabaseAdmin.from("orders").update({ stripe_session_id: payUrl }).eq("id", rid);
      void emailLienPaiement({
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
      return json({ error: "Erreur Stripe" }, 502);
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
  if (!nome) return json({ error: "Nom requis" }, 400);
  // Email obbligatoria SOLO per il link di pagamento; facoltativa se pagato di
  // persona (walk-in). Se presente deve comunque essere valida.
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  if (payment === "link" && !emailOk) return json({ error: "Email requise pour le lien de paiement" }, 400);
  if (email && !emailOk) return json({ error: "Email invalide" }, 400);
  if (!/^\d{2}:\d{2}$/.test(slot)) return json({ error: "Créneau invalide" }, 400);
  if (!items.length) return json({ error: "Panier vide" }, 400);

  // Data del ritiro: oggi (default) o un giorno futuro. Le date passate/non valide
  // vengono rifiutate. Per oggi si usa l'ora corrente (filtra gli slot passati),
  // per un giorno futuro l'inizio giornata.
  const oraNow = DateTime.now().setZone(TIMEZONE);
  let ora = oraNow;
  const dStr = String(body.date ?? "").trim();
  if (dStr) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dStr)) return json({ error: "Date invalide" }, 400);
    const d = DateTime.fromISO(dStr, { zone: TIMEZONE });
    if (!d.isValid || d.startOf("day") < oraNow.startOf("day")) return json({ error: "Date invalide" }, 400);
    ora = d.hasSame(oraNow, "day") ? oraNow : d.startOf("day");
  }
  // Créneau valido per QUELLA data (stessa fonte del sito: /api/slots)
  const config = await configGiornoEffettiva(ora);
  if (!config) return json({ error: "Horaires indisponibles" }, 503);
  const { lunch, dinner } = calcolaSlotGiorno(ora, config);
  if (![...lunch, ...dinner].includes(slot)) return json({ error: "Créneau plus disponible" }, 409);

  // Prezzi SEMPRE dal DB (mai dal browser), sconti compresi
  const ids = items.map((i) => String(i.id ?? ""));
  const { data: piatti, error: errMenu } = await supabaseAdmin
    .from("menu_items")
    .select("id, name, price_cents, available, discount_type, discount_value")
    .in("id", ids);
  if (errMenu || !piatti) return json({ error: "Menu illisible" }, 503);

  const voci: VoceCheckout[] = [];
  const itemsOrdine: { id: string; name: string; qty: number; price_cents: number; notes: string }[] = [];
  for (const rich of items) {
    const piatto = piatti.find((x) => x.id === rich.id);
    if (!piatto || !piatto.available) return json({ error: "Un plat n'est plus disponible" }, 409);
    const qty = Math.max(1, Math.floor(Number(rich.qty)));
    const prezzo = prezzoEffettivo(piatto.price_cents, piatto.discount_type, piatto.discount_value);
    voci.push({ name: piatto.name, price_cents: prezzo, qty });
    itemsOrdine.push({ id: piatto.id, name: piatto.name, qty, price_cents: prezzo, notes: "" });
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
  const inserisci = () => supabaseAdmin.from("orders").insert(datiOrdine).select("id, cancel_token").single();
  let ins = await inserisci();
  // Migrazione #29 non ancora lanciata: senza source l'ordine sparirebbe
  // dalla lista (pending non manuale) → meglio rifiutare chiaramente.
  if (ins.error && String(ins.error.message ?? "").includes("source")) {
    return json({ error: "Migration orders_source.sql (#29) à lancer sur Supabase" }, 500);
  }
  // Migrazione #49 mancante: il check lang in ('fr','en') rifiuta it/nl/es.
  if (ins.error && String(ins.error.message ?? "").toLowerCase().includes("lang")) {
    return json({ error: "Migration orders_manual_payment.sql (#49) à lancer (langues + paiement)" }, 500);
  }
  // Migrazione #49 (payment_method) assente: si crea comunque l'ordine, senza il metodo.
  if (ins.error && String(ins.error.message ?? "").includes("payment_method")) {
    delete datiOrdine.payment_method;
    ins = await inserisci();
  }
  // Migrazione #30 assente: si continua senza link di annullamento
  if (ins.error && String(ins.error.message ?? "").includes("cancel_token")) {
    ins = await supabaseAdmin.from("orders").insert(datiOrdine).select("id").single();
  }
  if (ins.error || !ins.data) return json({ error: "Création impossible" }, 500);
  const orderId = ins.data.id as string;
  const cancelToken = (ins.data as { cancel_token?: string | null }).cancel_token ?? null;

  // PAGATO DI PERSONA (contanti/carta): niente Stripe. Notifica cucina sempre;
  // conferma + recensione al cliente solo se ha lasciato l'email (guardie interne).
  if (paidSurPlace) {
    void inviaNotifiche({
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
    const payUrl = await creaCheckoutSession({ voci, orderId, siteUrl, lang: lang === "en" ? "en" : "fr", returnBase: await basePubblica() });
    await supabaseAdmin.from("orders").update({ stripe_session_id: payUrl }).eq("id", orderId);
    void emailLienPaiement({
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
    await supabaseAdmin.from("orders").delete().eq("id", orderId);
    return json({ error: "Erreur Stripe: paiement impossible à créer" }, 502);
  }
};

// PATCH /api/admin/orders — cambia lo stato di un ordine.
// Usato dai bottoni della pagina Commandes: "Terminée" → done,
// "Annuler" (con conferma) → cancelled. Mai su ordini 'pending'.
export const PATCH: APIRoute = async ({ request }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();

  let body: { id?: string; status?: string };
  try {
    body = await request.json();
  } catch {
    return json({ error: "Requête invalide" }, 400);
  }

  const id = String(body.id ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ error: "Id invalide" }, 400);

  const status = String(body.status ?? "");
  if (!["paid", "done", "cancelled"].includes(status)) {
    return json({ error: "Statut invalide" }, 400);
  }

  // Leggo l'ordine PRIMA di aggiornarlo: serve lo stato/metodo precedenti per
  // decidere l'email di annullamento (rimborso online / in cassa / non pagato).
  const SEL_ANN = "id, status, customer_name, customer_email, customer_phone, pickup_time, total_cents, refunded_cents, lang, payment_method";
  let prima: Record<string, unknown> | null = null;
  {
    const r = await supabaseAdmin.from("orders").select(SEL_ANN).eq("id", id).maybeSingle();
    if (!r.error) prima = r.data as Record<string, unknown> | null;
    else {
      const r2 = await supabaseAdmin
        .from("orders")
        .select("id, status, customer_name, customer_email, customer_phone, pickup_time, total_cents, refunded_cents, lang")
        .eq("id", id)
        .maybeSingle();
      prima = r2.data as Record<string, unknown> | null;
    }
  }

  let q = supabaseAdmin.from("orders").update({ status }).eq("id", id);
  // Annuler è permesso anche su un pending (link di pagamento non pagato);
  // per gli altri passaggi i pending non si toccano (li gestisce il webhook).
  if (status !== "cancelled") q = q.neq("status", "pending");
  const { data, error } = await q.select("id").maybeSingle();

  if (error) return json({ error: "Modification impossible" }, 500);
  if (!data) return json({ error: "Commande introuvable" }, 404);

  // Email di annullamento al cliente (solo alla transizione verso "cancelled").
  if (status === "cancelled" && prima && prima.status !== "cancelled" && String(prima.customer_email ?? "").trim()) {
    const inPersona = prima.payment_method === "cash" || prima.payment_method === "card";
    const totale = Number(prima.total_cents ?? 0);
    const gia = Number(prima.refunded_cents ?? 0);
    const residuo = Math.max(0, totale - gia);
    let refundMode: "online" | "in_person" | "unpaid";
    if (prima.status === "pending") refundMode = "unpaid";
    else if (inPersona || residuo <= 0) refundMode = "in_person";
    else refundMode = "online";

    const notif = {
      numero: String(prima.id).slice(0, 8),
      customer_name: String(prima.customer_name ?? ""),
      customer_email: String(prima.customer_email ?? ""),
      customer_phone: (prima.customer_phone as string | null) ?? null,
      pickup_time: String(prima.pickup_time ?? new Date().toISOString()),
      items: [] as { name: string; qty: number; price_cents: number }[],
      total_cents: totale,
      lang: String(prima.lang ?? "fr"),
    };
    try {
      await inviaAnnullaOrdine(notif, { refundMode, refund_cents: residuo });
    } catch {
      /* l'annullamento resta valido anche se l'email fallisce */
    }
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
  };
  try {
    body = await request.json();
  } catch {
    return json({ error: "Requete invalide" }, 400);
  }

  const id = String(body.id ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ error: "Id invalide" }, 400);

  // L'ordine deve esistere ed essere ATTIVO (paid o pending). Leggo anche gli
  // importi/pagamento per gestire la differenza. Le colonne #50 (supplement/
  // refund) potrebbero non esistere ancora: in tal caso ripiego sui campi base
  // e ricordo che la migrazione manca (migMancante).
  const SEL_FULL =
    "id, status, cancel_token, pickup_time, total_cents, refunded_cents, stripe_session_id, payment_method, supplement_due_cents, refund_due_cents, supplement_paid_at, items";
  const SEL_BASE =
    "id, status, cancel_token, pickup_time, total_cents, refunded_cents, stripe_session_id, payment_method, items";
  let migMancante = false;
  let sel = await supabaseAdmin.from("orders").select(SEL_FULL).eq("id", id).maybeSingle();
  if (sel.error) {
    migMancante = true;
    sel = await supabaseAdmin.from("orders").select(SEL_BASE).eq("id", id).maybeSingle();
  }
  const ord = sel.data as Record<string, unknown> | null;
  const errOrd = sel.error;
  if (errOrd) return json({ error: "Lecture impossible" }, 500);
  if (!ord) return json({ error: "Commande introuvable" }, 404);
  if (ord.status !== "paid" && ord.status !== "pending") {
    return json({ error: "Seules les commandes actives sont modifiables" }, 409);
  }
  const isLink = ord.status === "pending";

  const LANG_PUBBLICHE = ["fr", "en", "it", "nl", "es"];
  const lang = LANG_PUBBLICHE.includes(String(body.lang)) ? String(body.lang) : "fr";
  const nome = `${String(body.first_name ?? "").trim()} ${String(body.last_name ?? "").trim()}`.trim();
  const email = String(body.email ?? "").trim();
  const slot = String(body.slot ?? "");
  const items = Array.isArray(body.items) ? body.items : [];
  if (!nome) return json({ error: "Nom requis" }, 400);
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  if (isLink && !emailOk) return json({ error: "Email requise pour le lien de paiement" }, 400);
  if (email && !emailOk) return json({ error: "Email invalide" }, 400);
  if (!/^\d{2}:\d{2}$/.test(slot)) return json({ error: "Creneau invalide" }, 400);
  if (!items.length) return json({ error: "Panier vide" }, 400);

  // Data del ritiro (stessa logica del POST).
  const oraNow = DateTime.now().setZone(TIMEZONE);
  let ora = oraNow;
  const dStr = String(body.date ?? "").trim();
  if (dStr) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dStr)) return json({ error: "Date invalide" }, 400);
    const d = DateTime.fromISO(dStr, { zone: TIMEZONE });
    if (!d.isValid || d.startOf("day") < oraNow.startOf("day")) return json({ error: "Date invalide" }, 400);
    ora = d.hasSame(oraNow, "day") ? oraNow : d.startOf("day");
  }
  const config = await configGiornoEffettiva(ora);
  if (!config) return json({ error: "Horaires indisponibles" }, 503);
  const { lunch, dinner } = calcolaSlotGiorno(ora, config);
  // Orario originale dell'ordine (fuso ristorante): se lo staff NON lo cambia,
  // va accettato anche se ormai e' passato (quindi non piu' tra i disponibili).
  const origSlot = ord.pickup_time
    ? DateTime.fromISO(String(ord.pickup_time)).setZone(TIMEZONE).toFormat("HH:mm")
    : "";
  const origDate = ord.pickup_time
    ? DateTime.fromISO(String(ord.pickup_time)).setZone(TIMEZONE).toFormat("yyyy-MM-dd")
    : "";
  const dataScelta = dStr || oraNow.toFormat("yyyy-MM-dd");
  const slotInvariato = slot === origSlot && dataScelta === origDate;
  if (!slotInvariato && ![...lunch, ...dinner].includes(slot)) {
    return json({ error: "Creneau plus disponible" }, 409);
  }

  // Prezzi SEMPRE dal DB (mai dal browser), sconti compresi.
  const ids = items.map((i) => String(i.id ?? ""));
  const { data: piatti, error: errMenu } = await supabaseAdmin
    .from("menu_items")
    .select("id, name, price_cents, available, discount_type, discount_value")
    .in("id", ids);
  if (errMenu || !piatti) return json({ error: "Menu illisible" }, 503);

  const voci: VoceCheckout[] = [];
  const itemsOrdine: { id: string; name: string; qty: number; price_cents: number; notes: string }[] = [];
  for (const rich of items) {
    const piatto = piatti.find((x) => x.id === rich.id);
    if (!piatto || !piatto.available) return json({ error: "Un plat n'est plus disponible" }, 409);
    const qty = Math.max(1, Math.floor(Number(rich.qty)));
    const prezzo = prezzoEffettivo(piatto.price_cents, piatto.discount_type, piatto.discount_value);
    voci.push({ name: piatto.name, price_cents: prezzo, qty });
    itemsOrdine.push({ id: piatto.id, name: piatto.name, qty, price_cents: prezzo, notes: "" });
  }
  const noteText = String(body.note ?? "").trim().slice(0, 500);
  if (noteText) itemsOrdine.push({ id: "note", name: "NOTE CLIENT", qty: 0, price_cents: 0, notes: noteText });
  const totale = itemsOrdine.reduce((t, i) => t + i.price_cents * i.qty, 0);

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
  // Differenza d'importo: confronto il totale nuovo con quello vecchio.
  const oldTotal = Number(ord.total_cents ?? 0);
  const delta = totale - oldTotal; // >0 aumentato · <0 diminuito
  // "Pagato online" = ordine PAGATO ma NON di persona in cassa (contanti/carta):
  // cioe' ordini del sito o con payment link. Solo per questi si gestisce la
  // differenza (link supplemento / rimborso). Il rimborso vero (refund.ts)
  // richiede comunque un incasso Stripe: se non c'e', l'errore e' esplicito.
  const inPersona = ord.payment_method === "cash" || ord.payment_method === "card";
  const paidOnline = ord.status === "paid" && !inPersona;

  // Pagato online + importo cambiato ma migrazione #50 assente: mi fermo PRIMA
  // di scrivere, per non lasciare un ordine modificato senza traccia della
  // differenza (il rimborso/supplemento resterebbe invisibile).
  if (paidOnline && delta !== 0 && migMancante) {
    return json({ error: "Migration orders_modifica_diff.sql (#50) a lancer sur Supabase" }, 500);
  }

  const { error: errUpd } = await supabaseAdmin.from("orders").update(aggiorna).eq("id", id);
  if (errUpd) {
    if (String(errUpd.message ?? "").toLowerCase().includes("lang")) {
      return json({ error: "Migration orders_manual_payment.sql (#49) a lancer (langues + paiement)" }, 500);
    }
    return json({ error: "Modification impossible" }, 500);
  }

  const numero = id.slice(0, 8);
  const notif = {
    numero,
    customer_name: nome,
    customer_email: email,
    customer_phone: String(body.phone ?? "").trim() || null,
    pickup_time: pickup.toISO() ?? new Date().toISOString(),
    items: itemsOrdine,
    total_cents: totale,
    lang,
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
      const payUrl = await creaCheckoutSession({ voci, orderId: id, siteUrl, lang: lang === "en" ? "en" : "fr", returnBase: await basePubblica() });
      await supabaseAdmin.from("orders").update({ stripe_session_id: payUrl }).eq("id", id);
      void emailLienPaiement({
        ...notif,
        pay_url: payUrl,
        cancel_url: ord.cancel_token ? `${siteUrl.replace(/\/$/, "")}/order/cancel?token=${ord.cancel_token}` : null,
      });
    } catch (e) {
      console.error("[modifica ordine] Stripe error:", e);
      return json({ error: "Erreur Stripe: lien de paiement non regenere" }, 502);
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
    await supabaseAdmin.from("orders").update(diffUpd).eq("id", id);

    let payUrl: string | null = null;
    if (newSupp > 0) {
      const siteUrl = process.env.PUBLIC_SITE_URL ?? import.meta.env.PUBLIC_SITE_URL ?? "http://localhost:4321";
      try {
        payUrl = await creaCheckoutSupplemento({
          orderId: id,
          diffCents: newSupp,
          numero,
          siteUrl,
          lang: lang === "en" ? "en" : "fr",
          returnBase: await basePubblica(),
        });
      } catch (e) {
        console.error("[modifica ordine] supplemento Stripe error:", e);
        return json({ error: "Erreur Stripe: lien de supplement non cree" }, 502);
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
