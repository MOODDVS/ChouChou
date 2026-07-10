import type { APIRoute } from "astro";
import { DateTime } from "luxon";
import { supabaseAdmin } from "../../lib/db";
import { creaCheckoutSession, type VoceCheckout } from "../../lib/stripe";
import { calcolaSlotGiorno, TIMEZONE, type ConfigGiorno } from "../../lib/slots";

export const prerender = false;

type Supplemento = "none" | "gluten-free" | "ricotta";

const SUPPL: Record<Supplemento, number> = {
  none: 0,
  "gluten-free": 400,
  ricotta: 300,
};
const SUPPL_LABEL: Record<Supplemento, string> = {
  none: "",
  "gluten-free": "Sans gluten",
  ricotta: "Croûte ricotta",
};

interface CheckoutRequest {
  items: { id: string; qty: number; supplement?: Supplemento }[];
  slot: string;
  note?: string;
  customer: {
    name: string;
    surname: string;
    phone: string;
    email: string;
  };
  lang?: "fr" | "en";
}

function isPizza(categoryOrder: number): boolean {
  return categoryOrder === 2 || categoryOrder === 3;
}

export const POST: APIRoute = async ({ request }) => {
  let body: CheckoutRequest;
  try {
    body = await request.json();
  } catch {
    return err(400, "Richiesta non valida");
  }

  if (!Array.isArray(body.items) || body.items.length === 0) {
    return err(400, "Carrello vuoto");
  }
  if (!body.slot || !body.customer?.email || !body.customer?.name) {
    return err(400, "Dati mancanti");
  }

  const lang: "fr" | "en" = body.lang === "en" ? "en" : "fr";

  const ora = DateTime.now().setZone(TIMEZONE);
  const dayOfWeek = ora.weekday === 7 ? 0 : ora.weekday;

  const { data: settings, error: errSettings } = await supabaseAdmin
    .from("settings")
    .select(
      "lunch_active, lunch_open, lunch_close, dinner_active, dinner_open, dinner_close, prep_time_minutes, slot_duration_minutes, exceptional_closures"
    )
    .eq("day_of_week", dayOfWeek)
    .single();

  if (errSettings || !settings) {
    return err(503, "Configurazione orari non disponibile");
  }

  const config: ConfigGiorno = {
    lunch_active: settings.lunch_active,
    lunch_open: settings.lunch_open,
    lunch_close: settings.lunch_close,
    dinner_active: settings.dinner_active,
    dinner_open: settings.dinner_open,
    dinner_close: settings.dinner_close,
    prep_time_minutes: settings.prep_time_minutes,
    slot_duration_minutes: settings.slot_duration_minutes,
    exceptional_closures: Array.isArray(settings.exceptional_closures)
      ? settings.exceptional_closures
      : [],
  };

  const { lunch, dinner } = calcolaSlotGiorno(ora, config);
  const slotValidi = [...lunch, ...dinner];
  if (!slotValidi.includes(body.slot)) {
    return err(409, "Orario di ritiro non più disponibile");
  }

  const ids = body.items.map((i) => i.id);
  const { data: piatti, error: errMenu } = await supabaseAdmin
    .from("menu_items")
    .select("id, name, price_cents, available, category_order")
    .in("id", ids);

  if (errMenu || !piatti) {
    return err(503, "Impossibile leggere il menu");
  }

  const voci: VoceCheckout[] = [];
  const itemsOrdine: {
    id: string;
    name: string;
    qty: number;
    price_cents: number;
    notes: string;
  }[] = [];

  for (const richiesto of body.items) {
    const piatto = piatti.find((p) => p.id === richiesto.id);
    if (!piatto || !piatto.available) {
      return err(409, "Un piatto selezionato non è più disponibile");
    }
    const qty = Math.max(1, Math.floor(richiesto.qty));

    let supplemento: Supplemento = "none";
    const richiestoSuppl = richiesto.supplement;
    if (
      (richiestoSuppl === "gluten-free" || richiestoSuppl === "ricotta") &&
      isPizza(piatto.category_order)
    ) {
      supplemento = richiestoSuppl;
    }
    const supplCents = SUPPL[supplemento];
    const prezzoUnitario = piatto.price_cents + supplCents;

    const nomeRiga =
      supplemento === "none"
        ? piatto.name
        : `${piatto.name} (${SUPPL_LABEL[supplemento]})`;

    voci.push({ name: nomeRiga, price_cents: prezzoUnitario, qty });
    itemsOrdine.push({
      id: piatto.id,
      name: nomeRiga,
      qty,
      price_cents: prezzoUnitario,
      notes: supplemento === "none" ? "" : SUPPL_LABEL[supplemento],
    });
  }

  // Nota libera dell'ordine: la aggiungo come voce speciale in items (qty 0, prezzo 0),
  // così appare nelle notifiche cucina senza modificare il totale né lo schema.
  const noteText = (body.note ?? "").trim().slice(0, 500);
  if (noteText) {
    itemsOrdine.push({
      id: "note",
      name: "NOTE CLIENT",
      qty: 0,
      price_cents: 0,
      notes: noteText,
    });
  }

  const totalCents = itemsOrdine.reduce((s, i) => s + i.price_cents * i.qty, 0);

  const [h, m] = body.slot.split(":").map((n) => parseInt(n, 10));
  const pickup = ora.set({ hour: h, minute: m, second: 0, millisecond: 0 });

  const { data: ordine, error: errInsert } = await supabaseAdmin
    .from("orders")
    .insert({
      status: "pending",
      pickup_time: pickup.toISO(),
      customer_name: `${body.customer.name} ${body.customer.surname}`.trim(),
      customer_email: body.customer.email,
      customer_phone: body.customer.phone,
      items: itemsOrdine,
      total_cents: totalCents,
      lang,
    })
    .select("id")
    .single();

  if (errInsert || !ordine) {
    return err(500, "Impossibile creare l'ordine");
  }

  const siteUrl = process.env.PUBLIC_SITE_URL ?? import.meta.env.PUBLIC_SITE_URL ?? "http://localhost:4321";
  try {
    const url = await creaCheckoutSession({
      voci,
      orderId: ordine.id,
      siteUrl,
      lang,
    });
    await supabaseAdmin
      .from("orders")
      .update({ stripe_session_id: url })
      .eq("id", ordine.id);

    return new Response(JSON.stringify({ url }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch {
    return err(502, "Errore nella creazione del pagamento");
  }
};

function err(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}