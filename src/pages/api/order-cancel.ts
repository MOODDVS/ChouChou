import type { APIRoute } from "astro";
// Multi-sede: qui l'AGGREGATO e' la risposta giusta (vedi sotto).
import { leggi, aggiorna, tutteLeSedi, cercaAmbito, ambitoDiRiga } from "../../lib/admin/sede";
import { stripeDi } from "../../lib/stripe";
import { PUBLIC_LANG_CODES } from "../../lib/admin/superAdmin";
import { inviaAnnulloCucina, inviaAnnullaOrdine, type OrdineNotifica } from "../../lib/notifications";
import { inviaPushAnnulloOrdine } from "../../lib/push";

// Annullamento PUBBLICO di un ordine manuale non ancora pagato.
// Identificato dal cancel_token (email "Annuler ma commande").
// Solo status 'pending': un ordine pagato non si annulla da qui (si chiama).

export const prerender = false;

const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

// GET ?token= → riepilogo minimo per la pagina di conferma
export const GET: APIRoute = async ({ url }) => {
  // ⚠️ AGGREGATO, chiesto per nome. L'ordine si trova con il suo token di
  // annullo, che e' un segreto: il token E' l'autorizzazione. Filtrare per
  // sede non protegge niente in piu' e romperebbe l'annullo di ogni punto
  // che non sia il primo — il cliente clicca il link e non succede niente.
  const ambito = tutteLeSedi();
  const token = url.searchParams.get("token") ?? "";
  if (!RE_UUID.test(token)) return json({ error: "invalid" }, 404);
  const { data } = await leggi("orders", ambito, "status, pickup_time, total_cents, customer_name, lang")
    .eq("cancel_token", token)
    .maybeSingle();
  if (!data) return json({ error: "invalid" }, 404);
  return json({
    status: data.status,
    pickup_time: data.pickup_time,
    total_cents: data.total_cents,
    customer_name: data.customer_name,
    // ⚠️ LA LINGUA VERA DELL'ORDINE, non due su cinque. Dalla #49 `orders.lang`
    // tiene fr/en/it/nl/es — il checkout salva la lingua della pagina in cui il
    // cliente ha ordinato — e qui si schiacciava tutto su `fr` tranne `en`: chi
    // aveva ordinato in italiano apriva «Annuler ma commande» in francese.
    // Il link dell'email non porta la lingua, quindi questa risposta e' l'UNICO
    // modo che il sito ha di saperla. Si ripiega su `fr` solo se manca o non e'
    // una lingua che il motore conosce; l'elenco sta in un posto solo.
    lang: PUBLIC_LANG_CODES.includes(String(data.lang)) ? String(data.lang) : "fr",
  });
};

// POST { token } → annulla (solo pending) + fa scadere la sessione Stripe,
// così il link di pagamento non può più incassare un ordine annullato.
export const POST: APIRoute = async ({ request }) => {
  // ⚠️ AGGREGATO, chiesto per nome. L'ordine si trova con il suo token di
  // annullo, che e' un segreto: il token E' l'autorizzazione. Filtrare per
  // sede non protegge niente in piu' e romperebbe l'annullo di ogni punto
  // che non sia il primo — il cliente clicca il link e non succede niente.
  const ambito = tutteLeSedi();
  let body: { token?: string } = {};
  try {
    body = await request.json();
  } catch {
    /* token solo nel body */
  }
  const token = String(body.token ?? "");
  if (!RE_UUID.test(token)) return json({ error: "invalid" }, 404);

  // ⚠️ Si leggono anche i campi delle NOTIFICHE, non solo quelli tecnici: dopo
  // l'annullo non si torna a interrogare il database, e un campo dimenticato
  // qui diventa un'email alla cucina senza il numero dell'ordine.
  const CAMPI_ANNULLO =
    "id, status, stripe_session_id, location_id, numero, customer_name, customer_email, " +
    "customer_phone, pickup_time, items, total_cents, lang, payment_method";
  const { data: ordine } = await leggi("orders", ambito, CAMPI_ANNULLO)
    .eq("cancel_token", token)
    .maybeSingle();
  if (!ordine) return json({ error: "invalid" }, 404);
  if (ordine.status === "cancelled") return json({ ok: true }); // idempotente
  if (ordine.status !== "pending") return json({ error: "paid" }, 409);

  const { error } = await aggiorna("orders", ambito, { status: "cancelled" })
    .eq("id", ordine.id)
    .eq("status", "pending");
  if (error) return json({ error: "server" }, 500);

  // ⚠️ DA QUI IN POI IL RISTORATORE DEVE SAPERLO. L'ordine era gia' stato
  // annunciato: email alla cucina, comanda appesa, magari l'impasto steso.
  // Fino al 03/10/2026 l'annullo dal link cambiava SOLO la riga nel database,
  // e il guasto si scopriva quando nessuno veniva a ritirare — cibo buttato,
  // e la colpa che sembra del cliente. L'annullo fatto dall'admin avvisava
  // gia'; quello fatto dal cliente no, e nessuno se n'era accorto perche'
  // capita di rado.
  //
  // Si arriva qui SOLO se lo stato e' passato davvero da `pending` a
  // `cancelled`: la risposta idempotente qui sopra («gia' annullato») esce
  // prima, cosi' un doppio clic non manda due email.
  //
  // L'ambito e' quello della RIGA, non l'aggregato con cui l'abbiamo cercata:
  // l'avviso deve arrivare alla cucina di quel punto, non alla prima sede.
  const ambitoOrdine = ambitoDiRiga((ordine as { location_id?: string | null }).location_id ?? null);
  const perNotifica = {
    location_id: (ordine as { location_id?: string | null }).location_id ?? null,
    numero: String((ordine as { numero?: unknown }).numero ?? ""),
    customer_name: String((ordine as { customer_name?: unknown }).customer_name ?? ""),
    customer_email: String((ordine as { customer_email?: unknown }).customer_email ?? ""),
    customer_phone: (ordine as { customer_phone?: string | null }).customer_phone ?? null,
    pickup_time: String((ordine as { pickup_time?: unknown }).pickup_time ?? ""),
    items: ((ordine as { items?: unknown }).items ?? []) as OrdineNotifica["items"],
    total_cents: Number((ordine as { total_cents?: unknown }).total_cents ?? 0),
    lang: String((ordine as { lang?: unknown }).lang ?? "fr"),
  } satisfies OrdineNotifica;

  // Non bloccanti: il cliente ha gia' il suo annullo, e un server di posta
  // lento non deve trasformarlo in un errore.
  void inviaAnnulloCucina(perNotifica).catch(console.error);
  void inviaPushAnnulloOrdine(
    { numero: perNotifica.numero, customer_name: perNotifica.customer_name, total_cents: perNotifica.total_cents },
    ambitoOrdine,
  ).catch(console.error);
  // Conferma al cliente. `unpaid`: questo ordine non era pagato — da qui si
  // annullano solo i `pending` — quindi niente parte sul rimborso.
  void inviaAnnullaOrdine(perNotifica, { refundMode: "unpaid" }).catch(console.error);

  // La sessione Stripe viene fatta scadere (l'id cs_… può essere nell'URL salvato)
  const m = /cs_(?:test|live)_[A-Za-z0-9]+/.exec(String(ordine.stripe_session_id ?? ""));
  if (m) {
    try {
      // La sessione da far scadere vive nel conto che l'aveva creata: quello
      // della sede dell'ordine. Con la chiave di un'altra societa' Stripe
      // risponderebbe «no such checkout session» e il link resterebbe vivo.
      const sp = await stripeDi(await cercaAmbito("orders", String(ordine.id), ambito));
      await sp.checkout.sessions.expire(m[0]);
    } catch {
      /* già scaduta o pagata nel frattempo: non bloccante */
    }
  }
  return json({ ok: true });
};
