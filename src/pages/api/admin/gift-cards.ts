import type { APIRoute } from "astro";
import { supabaseAdmin } from "../../../lib/db";
import { verificaStaff, nonAutorizzato } from "../../../lib/admin/adminAuth";
import { normalizzaCodice } from "../../../lib/coupons";
import { datiRistorante } from "../../../lib/ristorante";
import { emailBonCadeau, type BonEmail } from "../../../lib/notifications";
import { creaCheckoutBon } from "../../../lib/stripe";

export const prerender = false;

// CRUD dei buoni regalo (admin Marketing → Bons cadeaux) + riscatto manuale.
// GET    → elenco buoni (con saldo)
// POST   → crea un buono  |  { action: "redeem", id, amount_cents, note? } riscatto manuale
// PUT    → toggle rapido { id, active }  |  aggiorna i metadati (scadenza, destinatario, messaggio)
// DELETE → elimina (?id=…) — cancella anche i riscatti (FK cascade)

const RE_DATA = /^\d{4}-\d{2}-\d{2}$/;
// Alfabeto senza caratteri ambigui (niente 0/O, 1/I)
const ALF = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

/**
 * Prefisso del codice: le 5 iniziali del nome del ristorante (Réglages →
 * Général, fallback client.ts), accenti tolti, solo A-Z0-9.
 * Es. « La Molisana » → LAMOL. Fallback: BON.
 */
async function prefissoCodice(): Promise<string> {
  try {
    const dati = await datiRistorante();
    const n = String(dati.nome ?? "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, "")
      .slice(0, 5);
    return n || "BON";
  } catch {
    return "BON";
  }
}

function generaCodice(prefisso: string): string {
  let blocco = "";
  for (let i = 0; i < 8; i++) {
    if (i === 4) blocco += "-";
    blocco += ALF[Math.floor(Math.random() * ALF.length)];
  }
  return prefisso + "-" + blocco;
}

function intPos(v: unknown): number {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function txt(v: unknown, max = 200): string | null {
  const s = String(v ?? "").trim();
  return s ? s.slice(0, max) : null;
}

function oggiISO(): string {
  return new Date().toISOString().slice(0, 10);
}

interface GiftInput {
  action?: string;
  id?: string;
  amount_cents?: number;
  note?: string;
  value_cents?: number;
  code?: string;
  expires_at?: string | null;
  recipient_name?: string;
  recipient_email?: string;
  recipient_phone?: string;
  sender_name?: string;
  sender_email?: string;
  sender_phone?: string;
  ship?: boolean;
  ship_address?: string;
  ship_zip?: string;
  ship_city?: string;
  ship_country?: string;
  shipping_cents?: number;
  send_recipient?: boolean;
  send_sender?: boolean;
  payment_method?: string;
  message?: string;
  active?: boolean;
}

export const GET: APIRoute = async ({ request }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();

  const { data, error } = await supabaseAdmin
    .from("gift_cards")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) return json({ error: "Lecture impossible" }, 500);

  // Numero di utilizzi per buono (righe del ledger dei riscatti)
  const usi = new Map<string, number>();
  const { data: red } = await supabaseAdmin.from("gift_card_redemptions").select("gift_card_id");
  for (const r of (red ?? []) as { gift_card_id: string }[]) {
    if (r.gift_card_id) usi.set(r.gift_card_id, (usi.get(r.gift_card_id) ?? 0) + 1);
  }
  const cards = (data ?? []).map((c) => ({ ...c, uses: usi.get(c.id) ?? 0 }));
  return json({ cards });
};

export const POST: APIRoute = async ({ request }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();
  const email = (staff as { email?: string }).email ?? null;

  let body: GiftInput;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Corps invalide" }, 400);
  }

  // --- Riscatto manuale (servizio in sala) ---
  if (body.action === "redeem") {
    if (!body.id) return json({ error: "id manquant" }, 400);
    const amount = intPos(body.amount_cents);
    if (!amount) return json({ error: "Montant invalide." }, 400);

    const { data: card, error: e1 } = await supabaseAdmin
      .from("gift_cards")
      .select("id, active, expires_at, balance_cents")
      .eq("id", body.id)
      .maybeSingle();
    if (e1) return json({ error: "Lecture impossible" }, 500);
    if (!card) return json({ error: "Bon introuvable." }, 404);
    if (!card.active) return json({ error: "Bon désactivé." }, 409);
    if (card.expires_at && String(card.expires_at) < oggiISO()) return json({ error: "Bon expiré." }, 409);
    if (amount > card.balance_cents) return json({ error: "Montant supérieur au solde." }, 409);

    // Optimistic lock: scala il saldo solo se non è cambiato dalla lettura.
    const nuovo = card.balance_cents - amount;
    const { data: upd, error: e2 } = await supabaseAdmin
      .from("gift_cards")
      .update({ balance_cents: nuovo })
      .eq("id", card.id)
      .eq("balance_cents", card.balance_cents)
      .select("id")
      .maybeSingle();
    if (e2) return json({ error: "Enregistrement impossible" }, 500);
    if (!upd) return json({ error: "Solde modifié entre-temps, réessaie." }, 409);

    await supabaseAdmin.from("gift_card_redemptions").insert({
      gift_card_id: card.id,
      amount_cents: amount,
      kind: "manual",
      note: txt(body.note, 300),
      created_by: email,
    });
    return json({ ok: true, balance_cents: nuovo });
  }

  // --- Rinvio del lien de paiement all'offrant ---
  if (body.action === "resend_link") {
    if (!body.id) return json({ error: "id manquant" }, 400);
    const { data: card, error: e0 } = await supabaseAdmin
      .from("gift_cards")
      .select("id, code, initial_cents, shipping_cents, paid, payment_method, sender_email, sender_name, recipient_name, message, expires_at, pay_token, ship, ship_address, ship_zip, ship_city, ship_country")
      .eq("id", body.id)
      .maybeSingle();
    if (e0) return json({ error: "Lecture impossible" }, 500);
    if (!card) return json({ error: "Bon introuvable." }, 404);
    if (card.paid !== false) return json({ error: "Bon déjà payé." }, 409);
    const offr = txt(body.sender_email, 200) ?? card.sender_email;
    if (!offr) return json({ error: "Aucune adresse email pour l'offrant." }, 400);

    const site = (import.meta.env.PUBLIC_SITE_URL ?? process.env.PUBLIC_SITE_URL ?? "").replace(/\/$/, "");
    let url: string;
    try {
      const dati = await datiRistorante();
      url = await creaCheckoutBon({
        giftCardId: card.id,
        code: card.code,
        valueCents: card.initial_cents,
        shippingCents: Number(card.shipping_cents) || 0,
        siteUrl: site,
        nomeRistorante: dati.nome,
      });
    } catch (e) {
      return json({ error: e instanceof Error ? e.message : "Stripe indisponible" }, 502);
    }
    await supabaseAdmin.from("gift_cards").update({ stripe_session_id: url }).eq("id", card.id);
    await emailBonCadeau({ ...(card as unknown as BonEmail), pay_url: url, paid: false }, "offrant", offr);
    return json({ ok: true, sent_to: offr });
  }

  // --- Creazione buono ---
  const value = intPos(body.value_cents);
  if (!value) return json({ error: "La valeur est obligatoire." }, 400);
  if (value > 100000000) return json({ error: "Valeur trop élevée." }, 400);

  const expires = body.expires_at && RE_DATA.test(body.expires_at) ? body.expires_at : null;
  // Metodo di pagamento: cash/card = incassato subito · link = in attesa
  const pagamento = ["cash", "card", "link"].includes(String(body.payment_method))
    ? String(body.payment_method)
    : "cash";
  const meta = {
    initial_cents: value,
    balance_cents: value,
    active: true,
    expires_at: expires,
    source: "admin" as const,
    recipient_name: txt(body.recipient_name, 120),
    recipient_email: txt(body.recipient_email, 200),
    recipient_phone: txt(body.recipient_phone, 40),
    sender_name: txt(body.sender_name, 120),
    sender_email: txt(body.sender_email, 200),
    sender_phone: txt(body.sender_phone, 40),
    message: txt(body.message, 500),
    ship: body.ship === true,
    ship_address: body.ship === true ? txt(body.ship_address, 200) : null,
    ship_zip: body.ship === true ? txt(body.ship_zip, 20) : null,
    ship_city: body.ship === true ? txt(body.ship_city, 120) : null,
    ship_country: body.ship === true ? txt(body.ship_country, 80) : null,
    shipping_cents: body.ship === true ? Math.max(0, Math.floor(Number(body.shipping_cents) || 0)) : 0,
    payment_method: pagamento,
    paid: pagamento !== "link",
    paid_at: pagamento !== "link" ? new Date().toISOString() : null,
    created_by: email,
  };

  // Codice: quello dato dall'utente, oppure auto (con qualche tentativo se collide).
  const dato = txt(body.code, 40);
  const pfx = dato ? "" : await prefissoCodice();
  const tentativi = dato ? [dato] : [generaCodice(pfx), generaCodice(pfx), generaCodice(pfx)];
  let ultimoErr = "Enregistrement impossible";
  for (const code of tentativi) {
    const code_norm = normalizzaCodice(code);
    if (!code_norm) { ultimoErr = "Code invalide."; continue; }
    const { data, error } = await supabaseAdmin
      .from("gift_cards")
      .insert({ ...meta, code, code_norm })
      .select("id, code, pay_token")
      .single();
    if (!error && data) {
      const site = (import.meta.env.PUBLIC_SITE_URL ?? process.env.PUBLIC_SITE_URL ?? "").replace(/\/$/, "");
      // Lien de paiement Stripe (solo se il pagamento è "link")
      let payUrl: string | null = null;
      let payError: string | null = null;
      if (pagamento === "link") {
        try {
          const dati = await datiRistorante();
          payUrl = await creaCheckoutBon({
            giftCardId: data.id,
            code: data.code,
            valueCents: value,
            shippingCents: Number(meta.shipping_cents) || 0,
            siteUrl: site,
            nomeRistorante: dati.nome,
          });
          await supabaseAdmin.from("gift_cards").update({ stripe_session_id: payUrl }).eq("id", data.id);
        } catch (e) {
          console.error("Stripe lien de paiement bon cadeau:", e);
          payError = e instanceof Error ? e.message : "Stripe indisponible";
        }
      }
      // Email del buono (opzionali, non bloccanti)
      const bon: BonEmail = {
        ...(meta as unknown as BonEmail),
        code: data.code,
        paid: pagamento !== "link",
        pay_url: payUrl,
        pdf_url: data.pay_token ? `${site}/api/bon-pdf?t=${data.pay_token}` : null,
      };
      const destEmail = meta.recipient_email;
      const offrEmail = txt(body.sender_email, 200);
      if (body.send_recipient && destEmail) void emailBonCadeau(bon, "destinataire", destEmail);
      if (body.send_sender && offrEmail) void emailBonCadeau(bon, "offrant", offrEmail);
      return json({ ok: true, id: data.id, code: data.code, pay_url: payUrl, pay_error: payError }, 201);
    }
    if (error?.code === "23505") { ultimoErr = "Ce code existe déjà."; continue; }
    return json({ error: "Enregistrement impossible" }, 500);
  }
  return json({ error: ultimoErr }, 409);
};

export const PUT: APIRoute = async ({ request }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();

  let body: GiftInput;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Corps invalide" }, 400);
  }
  if (!body.id) return json({ error: "id manquant" }, 400);

  // Toggle rapido attivo/pausa
  if (body.value_cents === undefined && body.expires_at === undefined && typeof body.active === "boolean") {
    const { error } = await supabaseAdmin.from("gift_cards").update({ active: body.active }).eq("id", body.id);
    if (error) return json({ error: "Enregistrement impossible" }, 500);
    return json({ ok: true });
  }

  // Aggiornamento metadati (mai il valore/saldo/codice)
  const patch: Record<string, unknown> = {
    expires_at: body.expires_at && RE_DATA.test(body.expires_at) ? body.expires_at : null,
    recipient_name: txt(body.recipient_name, 120),
    recipient_email: txt(body.recipient_email, 200),
    recipient_phone: txt(body.recipient_phone, 40),
    sender_name: txt(body.sender_name, 120),
    sender_email: txt(body.sender_email, 200),
    sender_phone: txt(body.sender_phone, 40),
    message: txt(body.message, 500),
    ship: body.ship === true,
    ship_address: body.ship === true ? txt(body.ship_address, 200) : null,
    ship_zip: body.ship === true ? txt(body.ship_zip, 20) : null,
    ship_city: body.ship === true ? txt(body.ship_city, 120) : null,
    ship_country: body.ship === true ? txt(body.ship_country, 80) : null,
    shipping_cents: body.ship === true ? Math.max(0, Math.floor(Number(body.shipping_cents) || 0)) : 0,
  };
  if (typeof body.active === "boolean") patch.active = body.active;

  // Stato attuale: valore e codice si correggono SOLO se il buono è ancora
  // intatto (nessun riscatto); il metodo di pagamento solo se non pagato.
  const { data: att } = await supabaseAdmin
    .from("gift_cards")
    .select("initial_cents, balance_cents, paid")
    .eq("id", body.id)
    .maybeSingle();
  if (!att) return json({ error: "Bon introuvable." }, 404);
  const intatto = att.initial_cents === att.balance_cents;

  const nuovoVal = Math.floor(Number(body.value_cents) || 0);
  if (nuovoVal > 0 && nuovoVal !== att.initial_cents) {
    if (!intatto) return json({ error: "Bon déjà utilisé : la valeur ne peut plus être modifiée." }, 409);
    patch.initial_cents = nuovoVal;
    patch.balance_cents = nuovoVal;
  }

  const nuovoCode = txt(body.code, 40);
  if (nuovoCode) {
    const cn = normalizzaCodice(nuovoCode);
    if (!cn) return json({ error: "Code invalide." }, 400);
    patch.code = nuovoCode;
    patch.code_norm = cn;
  }

  if (body.payment_method && ["cash", "card", "link"].includes(String(body.payment_method)) && att.paid === false) {
    const pm = String(body.payment_method);
    patch.payment_method = pm;
    if (pm !== "link") {
      patch.paid = true;
      patch.paid_at = new Date().toISOString();
    }
  }

  const { error } = await supabaseAdmin.from("gift_cards").update(patch).eq("id", body.id);
  if (error) {
    if (error.code === "23505") return json({ error: "Ce code existe déjà." }, 409);
    return json({ error: "Enregistrement impossible" }, 500);
  }
  return json({ ok: true });
};

export const DELETE: APIRoute = async ({ request, url }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();
  const id = url.searchParams.get("id");
  if (!id) return json({ error: "id manquant" }, 400);
  const { error } = await supabaseAdmin.from("gift_cards").delete().eq("id", id);
  if (error) return json({ error: "Suppression impossible" }, 500);
  return json({ ok: true });
};
