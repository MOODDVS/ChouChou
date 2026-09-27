import type { APIRoute } from "astro";
import { supabaseAdmin } from "../../../lib/db";
import { verificaStaff, nonAutorizzato } from "../../../lib/admin/adminAuth";
import { ambitoDiRichiesta, inserisci, elencoSedi, type Ambito } from "../../../lib/admin/sede";
import { sedeDiVendita, contoDeiBuoni } from "../../../lib/buoniRegole";
import { normalizzaCodice } from "../../../lib/coupons";
import { datiRistorante } from "../../../lib/ristorante";
import { emailBonCadeau, emailBonRistoratore, type BonEmail } from "../../../lib/notifications";
import { creaCheckoutBon } from "../../../lib/stripe";

import { adminLang } from "../../../lib/admin/adminLang";
import { adminT } from "../../../i18n/admin";
export const prerender = false;


/** Messaggio nella lingua dell'admin. `adminLang()` legge un valore globale
 *  gia' in cache (adminBoot): zero query in piu'. Vedi ENGINE.md,
 *  «Messaggi d'errore delle API admin — nella lingua dell'admin». */
async function msg(chiave: string): Promise<string> {
  return adminT(await adminLang())(chiave);
}

// CRUD dei buoni regalo (admin Marketing → Bons cadeaux) + riscatto manuale.
// GET    → elenco buoni (con saldo)
// POST   → crea un buono  |  { action: "redeem", id, amount_cents, note? } riscatto manuale
// PUT    → toggle rapido { id, active }  |  aggiorna i metadati (scadenza, destinatario, messaggio)
// DELETE → elimina (?id=…) — cancella anche i riscatti (FK cascade)

const RE_DATA = /^\d{4}-\d{2}-\d{2}$/;
// Alfabeto senza caratteri ambigui (niente 0/O, 1/I)
const ALF = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
// Colonne arrivate dopo il primo rilascio: su un cliente non ancora migrato
// non esistono, e un insert che le nomina fallisce tutto. Ordine indifferente.
const GIOVANI = ["sender_lang", "recipient_lang", "sold_at_location"] as const;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

/**
 * Prefisso del codice: le 5 iniziali del nome del ristorante (Réglages →
 * Général, fallback client.ts), accenti tolti, solo A-Z0-9.
 * Es. « Bella Napoli » → BELLA. Fallback: BON.
 */
async function prefissoCodice(ambito: Ambito): Promise<string> {
  try {
    const dati = await datiRistorante(ambito);
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

/** Codice lingua valido per un buono (lingue pubbliche), altrimenti null (= default sito). */
function lang5(v: unknown): string | null {
  if (typeof v !== "string") return null; // solo stringhe: niente coercizione di array/oggetti
  const c = v.trim().toLowerCase();
  return ["fr", "en", "it", "nl", "es"].includes(c) ? c : null;
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
  sender_lang?: string;
  recipient_lang?: string;
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
  if (error) return json({ error: await msg("err.read") }, 500);

  // I nomi dei punti, per dire DOVE e' stato venduto e DOVE speso. Vuoto =
  // installazione a punto unico: allora non si chiede nemmeno la colonna
  // `location_id` del registro, che su un cliente non migrato non esiste e
  // farebbe fallire tutta la lettura.
  const sedi = await elencoSedi();
  const nomiSede = new Map(sedi.map((s) => [s.id, s.name]));
  const multi = sedi.length > 0;

  // Righe del ledger dei riscatti: non solo QUANTE volte, ma QUANDO e quanto.
  // Il conteggio da solo diceva «usato 3 volte» e si fermava li': per sapere
  // dove fossero finiti i soldi bisognava aprire la tabella su Supabase.
  type Riscatto = {
    gift_card_id: string;
    amount_cents: number | null;
    created_at: string | null;
    note: string | null;
    kind: string | null;
    created_by: string | null;
    location_id?: string | null;
  };
  // ⚠️ Gli UTILIZZI si leggono SENZA filtro, ed e' una scelta. Il buono e'
  // del marchio: si compra in un punto e si spende in un altro. Filtrando,
  // la cronologia non tornerebbe mai con il saldo — 50 € caricati, 20 spesi
  // a Jourdan, e Stockel vedrebbe «nessun utilizzo» su un buono da 30.
  // Stessa ragione della scheda cliente, che mostra la spesa dell'intero
  // gruppo. La SCRITTURA invece e' per sede: registra DOVE e' stato usato.
  let red: Riscatto[] = [];
  const ricco = await supabaseAdmin
    .from("gift_card_redemptions")
    .select("gift_card_id, amount_cents, created_at, note, kind, created_by" + (multi ? ", location_id" : ""))
    .order("created_at", { ascending: false });
  if (ricco.error) {
    // Cliente non migrato (mancano note/kind/created_by): si torna al solo
    // conteggio, che e' sempre esistito. Meglio meno righe che zero.
    const magro = await supabaseAdmin.from("gift_card_redemptions").select("gift_card_id");
    red = ((magro.data ?? []) as { gift_card_id: string }[]).map((r) => ({
      gift_card_id: r.gift_card_id,
      amount_cents: null,
      created_at: null,
      note: null,
      kind: null,
      created_by: null,
    }));
  } else {
    // `as unknown as`: la select e' costruita a runtime (la colonna della
    // sede si chiede solo se ci sono sedi), quindi supabase-js non puo'
    // dedurne le colonne e rende un tipo d'errore generico. Il controllo sui
    // nomi delle colonne resta nella stringa qui sopra, che e' letterale.
    red = (ricco.data ?? []) as unknown as Riscatto[];
  }

  const usi = new Map<string, Riscatto[]>();
  for (const r of red) {
    if (!r.gift_card_id) continue;
    const lista = usi.get(r.gift_card_id) ?? [];
    lista.push(r);
    usi.set(r.gift_card_id, lista);
  }
  const cards = (data ?? []).map((c) => {
    const lista = usi.get(c.id) ?? [];
    // Il nome lo attacca il server: il client non ha l'elenco delle sedi, e
    // farglielo chiedere a parte vorrebbe dire due letture per una etichetta.
    const conSede = multi
      ? lista.map((r) => ({ ...r, location_name: r.location_id ? (nomiSede.get(r.location_id) ?? "") : "" }))
      : lista;
    const vendutoA = multi && c.sold_at_location ? (nomiSede.get(c.sold_at_location) ?? "") : "";
    return { ...c, uses: lista.length, redemptions: conSede, sold_at_name: vendutoA };
  });

  // IL CONTO FRA LE SOCIETA'. Si calcola qui perche' qui ci sono gia' le due
  // liste INTERE — ed e' l'unico modo di averle intere: una chiamata a parte
  // rischierebbe di ricevere i riscatti filtrati sul punto selezionato, e il
  // conto tornerebbe sbagliato senza dare errore.
  const conto = multi
    ? contoDeiBuoni({
        buoni: (data ?? []).map((c) => ({
          id: c.id, code: c.code, initial_cents: c.initial_cents,
          paid: c.paid, sold_at_location: c.sold_at_location,
        })),
        riscatti: red.map((r) => ({
          gift_card_id: r.gift_card_id, amount_cents: r.amount_cents,
          location_id: r.location_id ?? null,
        })),
      })
    : null;

  return json({
    cards,
    conto: conto && {
      ...conto,
      quote: conto.quote.map((q) => ({ ...q, nome: q.id ? (nomiSede.get(q.id) ?? "") : "" })),
    },
  });
};

export const POST: APIRoute = async ({ request }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();
  const email = (staff as { email?: string }).email ?? null;

  let body: GiftInput;
  try {
    body = await request.json();
  } catch {
    return json({ error: await msg("err.body") }, 400);
  }

  // ⚠️ L'AGGREGATO NON VENDE E NON RISCATTA. Con «toutes les adresses»
  // selezionata nell'header non esiste un punto: non c'e' una societa' che
  // incassa, non c'e' uno Stripe da cui far uscire il link, non c'e' un
  // posto da scrivere nel registro. Fino al 16/09/2026 questo ramo passava
  // lo stesso: il pagamento finiva sul conto del .env e il riscatto moriva
  // con un 500. Meglio dirlo prima, una volta sola per tutti i rami.
  const amb = await ambitoDiRichiesta(request, staff);
  if (amb.modo === "tutte") {
    return json({ error: await msg("err.pickAddress"), code: "no_sede" }, 409);
  }

  // --- Riscatto manuale (servizio in sala) ---
  if (body.action === "redeem") {
    if (!body.id) return json({ error: await msg("err.idMissing") }, 400);
    const amount = intPos(body.amount_cents);
    if (!amount) return json({ error: await msg("err.amount") }, 400);

    const { data: card, error: e1 } = await supabaseAdmin
      .from("gift_cards")
      .select("id, active, expires_at, balance_cents")
      .eq("id", body.id)
      .maybeSingle();
    if (e1) return json({ error: await msg("err.read") }, 500);
    if (!card) return json({ error: await msg("err.voucherNotFound") }, 404);
    if (!card.active) return json({ error: await msg("err.voucherOff") }, 409);
    if (card.expires_at && String(card.expires_at) < oggiISO()) return json({ error: await msg("err.voucherExpired") }, 409);
    if (amount > card.balance_cents) return json({ error: await msg("err.overBalance") }, 409);

    // Optimistic lock: scala il saldo solo se non è cambiato dalla lettura.
    const nuovo = card.balance_cents - amount;
    const { data: upd, error: e2 } = await supabaseAdmin
      .from("gift_cards")
      .update({ balance_cents: nuovo })
      .eq("id", card.id)
      .eq("balance_cents", card.balance_cents)
      .select("id")
      .maybeSingle();
    if (e2) return json({ error: await msg("err.save") }, 500);
    if (!upd) return json({ error: await msg("err.balanceChanged") }, 409);

    await inserisci("gift_card_redemptions", amb, {
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
    if (!body.id) return json({ error: await msg("err.idMissing") }, 400);
    const { data: card, error: e0 } = await supabaseAdmin
      .from("gift_cards")
      .select("id, code, initial_cents, shipping_cents, paid, payment_method, sender_email, sender_name, recipient_name, message, expires_at, pay_token, ship, ship_address, ship_zip, ship_city, ship_country, sender_lang")
      .eq("id", body.id)
      .maybeSingle();
    if (e0) return json({ error: await msg("err.read") }, 500);
    if (!card) return json({ error: await msg("err.voucherNotFound") }, 404);
    if (card.paid !== false) return json({ error: await msg("err.voucherPaid") }, 409);
    const offr = txt(body.sender_email, 200) ?? card.sender_email;
    if (!offr) return json({ error: await msg("err.noGiverEmail") }, 400);

    const site = (import.meta.env.PUBLIC_SITE_URL ?? process.env.PUBLIC_SITE_URL ?? "").replace(/\/$/, "");
    let url: string;
    try {
      const dati = await datiRistorante(amb);
      url = await creaCheckoutBon({
        // ⚠️ I buoni regalo sono del MARCHIO: la riga non ha una sede, quindi
        // il conto e' quello della sede selezionata da chi crea il buono.
        // Con tre societa' resta una domanda aperta — chi incassa un buono
        // comprato online, e chi ci rimette quando viene speso altrove: e'
        // una scelta contabile, non tecnica.
        ambito: amb,
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
    await emailBonCadeau({ ...(card as unknown as BonEmail), pay_url: url, paid: false }, "offrant", offr, amb);
    return json({ ok: true, sent_to: offr });
  }

  // --- Creazione buono ---
  const value = intPos(body.value_cents);
  if (!value) return json({ error: await msg("err.valueRequired") }, 400);
  if (value > 100000000) return json({ error: await msg("err.valueTooHigh") }, 400);

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
    sender_lang: lang5(body.sender_lang),
    recipient_lang: lang5(body.recipient_lang),
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
    // CHI INCASSA. Non e' «a chi appartiene il buono» — quello e' il marchio
    // e resta NULL. E' la societa' che prende i soldi, ed e' la stessa da
    // cui esce il link Stripe qui sotto: conto e cassa non possono divergere.
    sold_at_location: sedeDiVendita(amb),
  };

  // Codice: quello dato dall'utente, oppure auto (con qualche tentativo se collide).
  const dato = txt(body.code, 40);
  const pfx = dato ? "" : await prefissoCodice(amb);
  const tentativi = dato ? [dato] : [generaCodice(pfx), generaCodice(pfx), generaCodice(pfx)];
  let ultimoErr = "Enregistrement impossible";
  for (const code of tentativi) {
    const code_norm = normalizzaCodice(code);
    if (!code_norm) { ultimoErr = "Code invalide."; continue; }
    let { data, error } = await supabaseAdmin
      .from("gift_cards")
      .insert({ ...meta, code, code_norm })
      .select("id, code, pay_token")
      .single();
    // COLONNE GIOVANI non ancora migrate su questo cliente (#70 le lingue,
    // sezione 12 di locations.sql il punto di vendita): si riprova senza.
    // Meglio un buono senza la sua etichetta che nessun buono.
    //
    // ⚠️ Si toglie SOLO la colonna che l'errore nomina, una per giro.
    // Toglierle tutte insieme costerebbe le lingue a ogni cliente che non
    // ha ancora lanciato la sezione 12 — cioe' oggi tutti — e nessuno se ne
    // accorgerebbe: il buono si crea lo stesso, solo in francese.
    const ridotto: Record<string, unknown> = { ...meta };
    for (let giro = 0; giro < 3 && error; giro++) {
      const mancante = GIOVANI.find((c) => (error?.message || "").includes(c) && c in ridotto);
      if (!mancante) break;
      delete ridotto[mancante];
      ({ data, error } = await supabaseAdmin
        .from("gift_cards")
        .insert({ ...ridotto, code, code_norm })
        .select("id, code, pay_token")
        .single());
    }
    if (!error && data) {
      const site = (import.meta.env.PUBLIC_SITE_URL ?? process.env.PUBLIC_SITE_URL ?? "").replace(/\/$/, "");
      // Lien de paiement Stripe (solo se il pagamento è "link")
      let payUrl: string | null = null;
      let payError: string | null = null;
      if (pagamento === "link") {
        try {
          const dati = await datiRistorante(amb);
          payUrl = await creaCheckoutBon({
            ambito: amb,
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
      // ⚠️ La RIGA e' del marchio (`location_id` resta NULL): il buono si
      // spende ovunque. Il PUNTO lo dice chi sta creando il buono, ed e'
      // scritto in `sold_at_location` — chi ha incassato. Per lo stesso
      // motivo la notifica al ristoratore arriva al responsabile di QUEL
      // punto, non a un indirizzo di gruppo.
      if (body.send_recipient && destEmail) void emailBonCadeau(bon, "destinataire", destEmail, amb);
      if (body.send_sender && offrEmail) void emailBonCadeau(bon, "offrant", offrEmail, amb);
      // Notifica al ristoratore (lingua admin), sempre alla creazione.
      void emailBonRistoratore(bon, amb);
      return json({ ok: true, id: data.id, code: data.code, pay_url: payUrl, pay_error: payError }, 201);
    }
    if (error?.code === "23505") { ultimoErr = "err.codeTaken"; continue; }
    return json({ error: await msg("err.save") }, 500);
  }
  return json({ error: await msg(ultimoErr) }, 409);
};

export const PUT: APIRoute = async ({ request }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();

  let body: GiftInput;
  try {
    body = await request.json();
  } catch {
    return json({ error: await msg("err.body") }, 400);
  }
  if (!body.id) return json({ error: await msg("err.idMissing") }, 400);

  // Toggle rapido attivo/pausa
  if (body.value_cents === undefined && body.expires_at === undefined && typeof body.active === "boolean") {
    const { error } = await supabaseAdmin.from("gift_cards").update({ active: body.active }).eq("id", body.id);
    if (error) return json({ error: await msg("err.save") }, 500);
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
    sender_lang: lang5(body.sender_lang),
    recipient_lang: lang5(body.recipient_lang),
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
  if (!att) return json({ error: await msg("err.voucherNotFound") }, 404);
  const intatto = att.initial_cents === att.balance_cents;

  const nuovoVal = Math.floor(Number(body.value_cents) || 0);
  if (nuovoVal > 0 && nuovoVal !== att.initial_cents) {
    if (!intatto) return json({ error: await msg("err.voucherUsed") }, 409);
    patch.initial_cents = nuovoVal;
    patch.balance_cents = nuovoVal;
  }

  const nuovoCode = txt(body.code, 40);
  if (nuovoCode) {
    const cn = normalizzaCodice(nuovoCode);
    if (!cn) return json({ error: await msg("err.code") }, 400);
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

  let { error } = await supabaseAdmin.from("gift_cards").update(patch).eq("id", body.id);
  // Migrazione #70 non ancora lanciata: si riprova senza le colonne lingua
  if (error && /sender_lang|recipient_lang/.test(error.message || "")) {
    const patchNoLang: Record<string, unknown> = { ...patch };
    delete patchNoLang.sender_lang; delete patchNoLang.recipient_lang;
    ({ error } = await supabaseAdmin.from("gift_cards").update(patchNoLang).eq("id", body.id));
  }
  if (error) {
    if (error.code === "23505") return json({ error: await msg("err.codeTaken") }, 409);
    return json({ error: await msg("err.save") }, 500);
  }
  return json({ ok: true });
};

export const DELETE: APIRoute = async ({ request, url }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();
  const id = url.searchParams.get("id");
  if (!id) return json({ error: await msg("err.idMissing") }, 400);
  const { error } = await supabaseAdmin.from("gift_cards").delete().eq("id", id);
  if (error) return json({ error: await msg("err.delete") }, 500);
  return json({ ok: true });
};
