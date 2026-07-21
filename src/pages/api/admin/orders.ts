import type { APIRoute } from "astro";
import { DateTime } from "luxon";
import { supabaseAdmin } from "../../../lib/db";
import { verificaStaff, nonAutorizzato } from "../../../lib/admin/adminAuth";
import { creaCheckoutSession, type VoceCheckout } from "../../../lib/stripe";
import { calcolaSlotGiorno, TIMEZONE } from "../../../lib/slots";
import { configGiornoEffettiva } from "../../../lib/schedule";
import { prezzoEffettivo } from "../../../lib/pricing";
import { emailLienPaiement } from "../../../lib/notifications";

export const prerender = false;

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

  // Polling toast "Nouvelle commande": gli ultimi ordini PAGATI (per created_at).
  // Il client tiene gli ID già visti e avvisa sui NUOVI. Non si usa più un
  // segnalibro temporale: un ordine nasce 'pending' e diventa 'paid' dopo
  // (webhook), quindi il confronto su created_at mancava le transizioni.
  const recentPaid = url.searchParams.get("recent_paid");
  if (recentPaid) {
    const now = new Date().toISOString();
    const { data, error } = await supabaseAdmin
      .from("orders")
      .select("id, customer_name, total_cents, pickup_time, created_at")
      .eq("status", "paid")
      .order("created_at", { ascending: false })
      .limit(20);
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

  // Soglia: 7 giorni fa a mezzanotte, fuso Europe/Brussels, in ISO completo
  // (pickup_time è timestamptz, quindi confronto con un istante ISO).
  const soglia = DateTime.now()
    .setZone(TIMEZONE)
    .minus({ days: 7 })
    .startOf("day")
    .toISO();

  const CAMPI_LISTA =
    "id, status, pickup_time, customer_name, customer_email, customer_phone, items, total_cents, lang, created_at, refunded_cents, stripe_session_id";
  const [princ, pend] = await Promise.all([
    supabaseAdmin
      .from("orders")
      .select(CAMPI_LISTA)
      .in("status", ["paid", "done", "cancelled"])
      .gte("pickup_time", soglia)
      .order("pickup_time", { ascending: true }),
    // Pending MANUALI (link di pagamento inviato): i pending del sito
    // (checkout abbandonati) restano fuori. Migrazione #29 assente → nessuno.
    supabaseAdmin
      .from("orders")
      .select(CAMPI_LISTA)
      .eq("status", "pending")
      .eq("source", "manual")
      .gte("pickup_time", soglia)
      .order("pickup_time", { ascending: true }),
  ]);

  if (princ.error) {
    return json({ error: "Lecture impossible" }, 500);
  }

  const tutti = [...(princ.data ?? []), ...(pend.error ? [] : (pend.data ?? []))].sort((a, b) =>
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
      const payUrl = await creaCheckoutSession({ voci: vociR, orderId: rid, siteUrl: siteUrlR, lang: langR });
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

  const lang: "fr" | "en" = body.lang === "en" ? "en" : "fr";
  const nome = `${String(body.first_name ?? "").trim()} ${String(body.last_name ?? "").trim()}`.trim();
  const email = String(body.email ?? "").trim();
  const slot = String(body.slot ?? "");
  const items = Array.isArray(body.items) ? body.items : [];
  if (!nome || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: "Nom et email requis" }, 400);
  if (!/^\d{2}:\d{2}$/.test(slot)) return json({ error: "Créneau invalide" }, 400);
  if (!items.length) return json({ error: "Panier vide" }, 400);

  // Créneau valido OGGI (stessa fonte del sito: /api/slots)
  const ora = DateTime.now().setZone(TIMEZONE);
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
    status: "pending",
    source: "manual",
    pickup_time: pickup.toISO(),
    customer_name: nome,
    customer_email: email,
    customer_phone: String(body.phone ?? "").trim() || null,
    items: itemsOrdine,
    total_cents: totale,
    lang,
  };
  let ins = await supabaseAdmin.from("orders").insert(datiOrdine).select("id, cancel_token").single();
  // Migrazione #29 non ancora lanciata: senza source l'ordine sparirebbe
  // dalla lista (pending non manuale) → meglio rifiutare chiaramente.
  if (ins.error && String(ins.error.message ?? "").includes("source")) {
    return json({ error: "Migration orders_source.sql (#29) à lancer sur Supabase" }, 500);
  }
  // Migrazione #30 assente: si continua senza link di annullamento
  if (ins.error && String(ins.error.message ?? "").includes("cancel_token")) {
    ins = await supabaseAdmin.from("orders").insert(datiOrdine).select("id").single();
  }
  if (ins.error || !ins.data) return json({ error: "Création impossible" }, 500);
  const orderId = ins.data.id as string;
  const cancelToken = (ins.data as { cancel_token?: string | null }).cancel_token ?? null;

  const siteUrl = process.env.PUBLIC_SITE_URL ?? import.meta.env.PUBLIC_SITE_URL ?? "http://localhost:4321";
  try {
    const payUrl = await creaCheckoutSession({ voci, orderId, siteUrl, lang });
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

  let q = supabaseAdmin.from("orders").update({ status }).eq("id", id);
  // Annuler è permesso anche su un pending (link di pagamento non pagato);
  // per gli altri passaggi i pending non si toccano (li gestisce il webhook).
  if (status !== "cancelled") q = q.neq("status", "pending");
  const { data, error } = await q.select("id").maybeSingle();

  if (error) return json({ error: "Modification impossible" }, 500);
  if (!data) return json({ error: "Commande introuvable" }, 404);
  return json({ ok: true });
};
