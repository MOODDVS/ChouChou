/**
 * CONFERMARE UN ORDINE — il gesto, in un posto solo.
 *
 * ⚠️ IL GUASTO CHE QUESTO FILE CHIUDE (29/09/2026)
 *
 * 450 Gradi e' andato in linea, due clienti hanno ordinato e pagato, e il
 * ristorante non ha visto niente: nessun ordine nel pannello, nessuna email,
 * nessuna notifica. I webhook di Stripe puntavano ancora al dominio di prova.
 *
 * Non e' stato un errore: e' stato un SILENZIO. Il pagamento riusciva, il
 * cliente vedeva la sua pagina di conferma, l'ordine restava «in attesa» —
 * e la lista del pannello mostra solo `paid`, `done` e `cancelled`, quindi
 * quegli ordini non esistevano per nessuno. L'unico posto al mondo dove era
 * scritto era il pannello di Stripe.
 *
 * ⚠️ La causa vera: **il webhook era l'unico modo di confermare un ordine.**
 * Quattro cose accadono quando un pagamento arriva — lo stato passa a `paid`,
 * parte l'email al cliente, parte quella alla cucina, squilla il telefono del
 * ristoratore, e il cliente entra in rubrica — e vivevano tutte dentro il
 * gestore del webhook. Se il webhook non arriva, non le fa nessuno, e non
 * esiste nessun'altra strada.
 *
 * Qui quel gesto diventa una funzione, che ha gia' due chiamanti:
 *   1. il webhook di Stripe (la strada normale);
 *   2. il recupero dal pannello, che chiede a Stripe se fra gli ordini in
 *      sospeso ce n'e' qualcuno gia' pagato (la rete di sicurezza).
 * E ne avra' un terzo il giorno che si potra' ordinare senza pagare online:
 * li' l'ordine e' confermato nell'istante in cui il cliente preme invio, e
 * deve fare esattamente queste stesse quattro cose.
 *
 * ⚠️ L'IDEMPOTENZA STA QUI DENTRO, e non nei chiamanti: si aggiorna solo se
 * l'ordine e' ancora `pending`. E' quello che impedisce a un evento Stripe
 * consegnato due volte — o al webhook e al recupero che arrivano insieme —
 * di mandare due email allo stesso cliente. Chi chiama non deve saperlo.
 */
import { aggiorna, ambitoDiRiga, type Ambito } from "./admin/sede";
import { supabaseAdmin } from "./db";
import { inviaNotifiche } from "./notifications";
import { inviaPushOrdine } from "./push";

/**
 * Porta un ordine da `pending` a `paid` e fa tutto quello che ne consegue.
 *
 * Rende `true` se l'ha confermato lui, `false` se non c'era niente da fare
 * (ordine gia' confermato, o inesistente). `false` NON e' un errore: e' la
 * risposta giusta quando qualcun altro e' arrivato prima.
 */
export async function confermaOrdinePagato(opts: {
  /** L'ordine da confermare. */
  orderId: string;
  /**
   * L'ambito in cui cercarlo. Dal webhook e' l'AGGREGATO — Stripe non sa
   * niente di sedi e l'ordine puo' essere di qualunque punto; dal pannello e'
   * l'ambito di chi sta guardando.
   */
  ambito: Ambito;
  /** L'id di sessione pulito (`cs_...`), se il chiamante ce l'ha. */
  sessionId?: string;
}): Promise<boolean> {
  const patch: Record<string, unknown> = { status: "paid" };
  // ⚠️ Alla creazione qui dentro c'e' l'URL di pagamento, non l'id: e' il
  // momento della conferma a sostituirlo con l'id vero.
  if (opts.sessionId) patch.stripe_session_id = opts.sessionId;

  const { data: ordine, error } = await aggiorna("orders", opts.ambito, patch)
    .eq("id", opts.orderId)
    .eq("status", "pending") // <-- l'idempotenza
    // `location_id` serve alla notifica push: dice a QUALE cucina suona.
    .select(
      "id, customer_name, customer_email, customer_phone, pickup_time, items, total_cents, lang, location_id",
    )
    .maybeSingle();

  if (error) {
    console.error("[conferma] aggiornamento ordine fallito:", error);
    throw error;
  }
  if (!ordine) return false;

  await inviaNotifiche({
    // La sede la dice la RIGA: e' lei che decide indirizzo, mittente e cucina
    // a cui arriva il ticket.
    location_id: ordine.location_id ?? null,
    numero: opts.orderId.slice(0, 8),
    customer_name: ordine.customer_name,
    customer_email: ordine.customer_email,
    customer_phone: ordine.customer_phone,
    pickup_time: ordine.pickup_time,
    items: ordine.items,
    total_cents: ordine.total_cents,
    lang: ordine.lang === "en" ? "en" : "fr",
  });

  // ⚠️ La sede la dice la RIGA, non la richiesta: senza, un ordine di Stockel
  // farebbe squillare anche Jourdan e Schaerbeek.
  void inviaPushOrdine(
    {
      numero: opts.orderId.slice(0, 8),
      customer_name: ordine.customer_name,
      total_cents: ordine.total_cents,
    },
    ambitoDiRiga(ordine.location_id),
  );

  await registraCliente({
    name: ordine.customer_name,
    email: ordine.customer_email,
    phone: ordine.customer_phone,
  });

  return true;
}

/**
 * Salva il cliente dell'ordine nella rubrica (`clients`).
 * - email gia' presente: completa il telefono se mancava e lo rimette in
 *   evidenza se era nascosto (niente doppioni, fusione per email);
 * - altrimenti lo crea.
 *
 * ⚠️ Non e' mai bloccante: un errore qui non deve far fallire la conferma di
 * un ordine pagato. La rubrica si rimedia, un ordine perso no.
 */
async function registraCliente(c: {
  name: string | null;
  email: string | null;
  phone: string | null;
}): Promise<void> {
  try {
    const email = (c.email ?? "").trim().toLowerCase();
    if (!email) return; // senza email non c'e' chiave di fusione affidabile

    const { data: esistente } = await supabaseAdmin
      .from("clients")
      .select("id, phone, hidden")
      .ilike("email", email)
      .limit(1)
      .maybeSingle();

    if (esistente) {
      const patch: { phone?: string; hidden?: boolean } = {};
      if (!esistente.phone && c.phone) patch.phone = c.phone;
      if (esistente.hidden) patch.hidden = false;
      if (Object.keys(patch).length > 0) {
        await supabaseAdmin.from("clients").update(patch).eq("id", esistente.id);
      }
      return;
    }

    await supabaseAdmin.from("clients").insert({
      name: c.name ?? "",
      email,
      phone: c.phone,
    });
  } catch (e) {
    console.error("[conferma] registrazione cliente fallita:", e);
  }
}
