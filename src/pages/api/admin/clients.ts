import type { APIRoute } from "astro";
import { supabaseAdmin } from "../../../lib/db";
import { verificaStaff, nonAutorizzato } from "../../../lib/admin/adminAuth";
import { eliminaFotoStorage } from "../../../lib/admin/eliminaFotoStorage";

export const prerender = false;

// Lingue valide per il cliente (stesse del widget prenotazioni).
const LINGUE_CLI = new Set(["fr", "en", "es", "it", "nl", "de", "ru", "ar", "zh", "ja"]);
const normLangCli = (v: unknown): string | null => {
  const c = String(v ?? "").trim().toLowerCase();
  return LINGUE_CLI.has(c) ? c : null;
};

// GET  → elenco clienti: UNIONE degli ordini reali (paid/done, aggregati
//        per email) con i clienti aggiunti a mano (tabella `clients`).
// POST → aggiunge un cliente manuale (name, email, phone).
// Chiave cliente = email (minuscolo); fallback telefono, poi nome.

interface RigaOrdine {
  customer_name: string | null;
  customer_email: string | null;
  customer_phone: string | null;
  total_cents: number;
  created_at: string;
}

interface RigaCliente {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  hidden: boolean;
  photo_url?: string | null;
  blocked?: boolean | null;
  created_at?: string | null;
  lang?: string | null;
}

interface Cliente {
  id: string | null; // id nella tabella `clients` se manuale, altrimenti null
  name: string;
  email: string;
  phone: string;
  orders: number;
  reservations: number;
  noshows: number;
  total_cents: number;
  last_order: string | null;
  first_activity: string | null; // PRIMA attività in assoluto (per il tag New)
  manual: boolean;
  photo_url?: string | null;
  blocked?: boolean;
  newsletter_optout?: boolean;
  lang?: string | null; // lingua del cliente (dalla prenotazione più recente)
  key?: string; // chiave di aggregazione (per il dettaglio attività)
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function chiave(email: string, phone: string, name: string): string {
  return email.toLowerCase() || phone || name.toLowerCase();
}

/** Ordini per il dettaglio attività (tutti i campi utili), a pagine di 1000. */
async function ordiniDettaglio(): Promise<
  { customer_name: string | null; customer_email: string | null; customer_phone: string | null; total_cents: number | null; created_at: string; status: string | null }[]
> {
  const PAGINA = 1000;
  const tutti: { customer_name: string | null; customer_email: string | null; customer_phone: string | null; total_cents: number | null; created_at: string; status: string | null }[] = [];
  for (let da = 0; ; da += PAGINA) {
    const { data, error } = await supabaseAdmin
      .from("orders")
      .select("customer_name, customer_email, customer_phone, total_cents, created_at, status")
      .in("status", ["paid", "done"])
      .order("created_at", { ascending: false })
      .range(da, da + PAGINA - 1);
    if (error) return tutti;
    tutti.push(...(data ?? []));
    if (!data || data.length < PAGINA) break;
  }
  return tutti;
}

/** Prenotazioni per il dettaglio attività, a pagine di 1000. */
async function prenotazioniDettaglio(): Promise<
  { first_name: string | null; last_name: string | null; email: string | null; phone: string | null; date: string; heure: string | null; people: number | null; zone: string | null; status: string | null }[]
> {
  const PAGINA = 1000;
  const tutti: { first_name: string | null; last_name: string | null; email: string | null; phone: string | null; date: string; heure: string | null; people: number | null; zone: string | null; status: string | null }[] = [];
  for (let da = 0; ; da += PAGINA) {
    const { data, error } = await supabaseAdmin
      .from("reservations")
      .select("first_name, last_name, email, phone, date, heure, people, zone, status")
      .order("date", { ascending: false })
      .range(da, da + PAGINA - 1);
    if (error) return tutti;
    tutti.push(...(data ?? []));
    if (!data || data.length < PAGINA) break;
  }
  return tutti;
}

/** Legge TUTTI gli ordini incassati (paid/done), a pagine di 1000. */
async function ordiniIncassati(): Promise<RigaOrdine[] | null> {
  const PAGINA = 1000;
  const tutti: RigaOrdine[] = [];
  for (let da = 0; ; da += PAGINA) {
    const { data, error } = await supabaseAdmin
      .from("orders")
      .select("customer_name, customer_email, customer_phone, total_cents, created_at")
      .in("status", ["paid", "done"])
      .order("created_at", { ascending: true })
      .range(da, da + PAGINA - 1);
    if (error) return null;
    tutti.push(...((data ?? []) as RigaOrdine[]));
    if (!data || data.length < PAGINA) break;
  }
  return tutti;
}

interface RigaResa {
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  status: string | null;
  created_at: string | null;
  lang: string | null;
}

/** Prenotazioni non annullate, a pagine di 1000. TOLLERANTE: se la
 *  tabella `reservations` non esiste ancora, torna una lista vuota. */
async function prenotazioniAttive(): Promise<RigaResa[]> {
  const PAGINA = 1000;
  const tutti: RigaResa[] = [];
  for (let da = 0; ; da += PAGINA) {
    const { data, error } = await supabaseAdmin
      .from("reservations")
      .select("first_name, last_name, email, phone, status, created_at, lang")
      .order("created_at", { ascending: true })
      .range(da, da + PAGINA - 1);
    if (error) return tutti; // migrazione non ancora lanciata: nessun blocco
    tutti.push(...((data ?? []) as RigaResa[]));
    if (!data || data.length < PAGINA) break;
  }
  return tutti;
}

/** Legge i clienti manuali (tabella `clients`), a pagine di 1000. */
async function clientiManuali(): Promise<RigaCliente[] | null> {
  const PAGINA = 1000;
  const tutti: RigaCliente[] = [];
  let campi = "id, name, email, phone, hidden, photo_url, blocked, created_at, lang";
  for (let da = 0; ; da += PAGINA) {
    let { data, error } = await supabaseAdmin
      .from("clients")
      .select(campi)
      .order("created_at", { ascending: true })
      .range(da, da + PAGINA - 1);
    // Migrazioni #31/#32 non ancora lanciate: si rilegge senza le colonne nuove
    if (error && (String(error.message ?? "").includes("photo_url") || String(error.message ?? "").includes("blocked") || String(error.message ?? "").includes("lang"))) {
      campi = "id, name, email, phone, hidden, created_at";
      ({ data, error } = await supabaseAdmin
        .from("clients")
        .select(campi)
        .order("created_at", { ascending: true })
        .range(da, da + PAGINA - 1));
    }
    if (error) return null;
    tutti.push(...((data ?? []) as unknown as RigaCliente[]));
    if (!data || data.length < PAGINA) break;
  }
  return tutti;
}

export const GET: APIRoute = async ({ request, url }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();

  // Dettaglio: tutta l'attività (ordini + prenotazioni) di un cliente
  const activityKey = (url.searchParams.get("activity") ?? "").trim();
  if (activityKey) {
    const [ordini, rese] = await Promise.all([ordiniDettaglio(), prenotazioniDettaglio()]);
    const attivita: { type: string; when: string; label: string; status: string; amount_cents: number | null }[] = [];
    for (const o of ordini) {
      const k = chiave((o.customer_email ?? "").trim(), (o.customer_phone ?? "").trim(), (o.customer_name ?? "").trim());
      if (k !== activityKey) continue;
      attivita.push({
        type: "order",
        when: o.created_at,
        label: "Commande",
        status: o.status ?? "paid",
        amount_cents: o.total_cents ?? 0,
      });
    }
    for (const r of rese) {
      const k = chiave((r.email ?? "").trim(), (r.phone ?? "").trim(), `${(r.first_name ?? "").trim()} ${(r.last_name ?? "").trim()}`.trim());
      if (k !== activityKey) continue;
      attivita.push({
        type: "reservation",
        when: `${r.date}T${(r.heure ?? "00:00").slice(0, 5)}:00`,
        label: `Réservation · ${r.people} pers.${r.zone ? ` · ${r.zone}` : ""}`,
        status: r.status ?? "confirmed",
        amount_cents: null,
      });
    }
    attivita.sort((a, b) => (a.when < b.when ? 1 : -1));
    return json({ activity: attivita });
  }

  const [ordini, manuali, rese] = await Promise.all([
    ordiniIncassati(),
    clientiManuali(),
    prenotazioniAttive(),
  ]);
  if (ordini === null || manuali === null) return json({ error: "Lecture impossible" }, 500);

  const mappa = new Map<string, Cliente>();

  // 0) Chiavi dei clienti nascosti ("cancellati" dall'admin): vanno
  //    esclusi sia come record manuali sia come aggregato degli ordini.
  const nascosti = new Set<string>();
  for (const m of manuali) {
    if (!m.hidden) continue;
    const k = chiave((m.email ?? "").trim(), (m.phone ?? "").trim(), (m.name ?? "").trim());
    if (k) nascosti.add(k);
  }

  // 1) Aggregazione dagli ordini (ordine cronologico → l'ultimo vince sui dati).
  for (const o of ordini) {
    const email = (o.customer_email ?? "").trim();
    const phone = (o.customer_phone ?? "").trim();
    const name = (o.customer_name ?? "").trim();
    const key = chiave(email, phone, name);
    if (!key || nascosti.has(key)) continue;

    let c = mappa.get(key);
    if (!c) {
      c = { id: null, name, email, phone, orders: 0, reservations: 0, noshows: 0, total_cents: 0, last_order: o.created_at, first_activity: o.created_at, manual: false };
      mappa.set(key, c);
    }
    c.orders += 1;
    c.total_cents += o.total_cents;
    if (o.created_at >= (c.last_order ?? "")) c.last_order = o.created_at;
    if (!c.first_activity || o.created_at < c.first_activity) c.first_activity = o.created_at;
    if (name) c.name = name;
    if (phone) c.phone = phone;
    if (email) c.email = email;
  }

  // 1b) Prenotazioni: conteggio per cliente (e creazione se ha SOLO prenotato).
  for (const r of rese) {
    const email = (r.email ?? "").trim();
    const phone = (r.phone ?? "").trim();
    const name = `${(r.first_name ?? "").trim()} ${(r.last_name ?? "").trim()}`.trim();
    const key = chiave(email, phone, name);
    if (!key || nascosti.has(key)) continue;

    let c = mappa.get(key);
    if (!c) {
      c = { id: null, name, email, phone, orders: 0, reservations: 0, noshows: 0, total_cents: 0, last_order: null, first_activity: null, manual: false };
      mappa.set(key, c);
    }
    // Lingua: la prenotazione più recente (lista ascendente → l'ultima vince)
    if (r.lang) c.lang = r.lang;
    // Annullata: il cliente resta in lista ma non conta come résa
    if (r.status !== "cancelled") c.reservations += 1;
    if (r.status === "noshow") c.noshows += 1;
    if (r.created_at && (!c.first_activity || r.created_at < c.first_activity)) c.first_activity = r.created_at;
    if (name && !c.name) c.name = name;
    if (phone && !c.phone) c.phone = phone;
    if (email && !c.email) c.email = email;
  }

  // 2) Fusione dei clienti manuali (aggiungono contatti o completano i dati).
  for (const m of manuali) {
    if (m.hidden) continue;
    const email = (m.email ?? "").trim();
    const phone = (m.phone ?? "").trim();
    const name = (m.name ?? "").trim();
    const key = chiave(email, phone, name);
    if (!key) continue;

    const esistente = mappa.get(key);
    if (esistente) {
      esistente.id = m.id;
      esistente.manual = true;
      if (m.photo_url) esistente.photo_url = m.photo_url;
      if (m.blocked) esistente.blocked = true;
      if (m.created_at && (!esistente.first_activity || m.created_at < esistente.first_activity))
        esistente.first_activity = m.created_at;
      // Il record `clients` è il dato CURATO (modale admin): prevale
      // sull'aggregazione da ordini/prenotazioni (prima riempiva solo i
      // buchi → modificare il cognome dal modale non si vedeva mai).
      if (name) esistente.name = name;
      if (email) esistente.email = email;
      if (phone) esistente.phone = phone;
      if (m.lang) esistente.lang = m.lang; // il dato curato (modale) prevale
    } else {
      mappa.set(key, {
        id: m.id, name, email, phone, orders: 0, reservations: 0, noshows: 0, total_cents: 0, last_order: null, first_activity: m.created_at ?? null, manual: true, photo_url: m.photo_url ?? null, blocked: Boolean(m.blocked), lang: m.lang ?? null,
      });
    }
  }

  // Newsletter: chi prenota/ordina/è aggiunto a mano è OPT-IN per default;
  // opt-out = presenza in newsletter_optout (stessa fonte del link email).
  try {
    const { data: optout } = await supabaseAdmin.from("newsletter_optout").select("email");
    const setOptout = new Set((optout ?? []).map((r) => String(r.email ?? "").toLowerCase()));
    for (const c of mappa.values()) {
      if (c.email && setOptout.has(c.email.toLowerCase())) c.newsletter_optout = true;
    }
  } catch { /* tabella assente: tutti opt-in */ }

  const clienti = [...mappa.entries()]
    .map(([k, c]) => ({ ...c, key: k }))
    .sort((a, b) => b.total_cents - a.total_cents);
  return json({ count: clienti.length, clients: clienti });
};

export const POST: APIRoute = async ({ request }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();

  let body: { name?: string; email?: string; phone?: string };
  try {
    body = await request.json();
  } catch {
    return json({ error: "Corps invalide" }, 400);
  }

  const name = (body.name ?? "").trim();
  const email = (body.email ?? "").trim();
  const phone = (body.phone ?? "").trim();

  if (!name) return json({ error: "Le nom est obligatoire" }, 400);
  if (!email && !phone) return json({ error: "Renseignez au moins un email ou un téléphone" }, 400);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ error: "Email invalide" }, 400);
  }

  const { data, error } = await supabaseAdmin
    .from("clients")
    .insert({ name, email: email || null, phone: phone || null })
    .select("id")
    .single();

  if (error) return json({ error: "Enregistrement impossible" }, 500);
  return json({ ok: true, id: data.id }, 201);
};

// PATCH → modifica i dati di un cliente (modale matita nella pagina Clients).
// Se il cliente aggregato non ha ancora un record in `clients` (viene dagli
// ordini/prenotazioni), il record viene CREATO: da lì in poi nome/foto
// prevalgono sui dati grezzi. Match: id → email → telefono.
export const PATCH: APIRoute = async ({ request }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();

  let body: {
    id?: string | null;
    match_email?: string;
    match_phone?: string;
    name?: string;
    email?: string;
    phone?: string;
    photo_url?: string | null;
    blocked?: boolean;
    newsletter_optout?: boolean;
    lang?: string | null;
  };
  try {
    body = await request.json();
  } catch {
    return json({ error: "Corps invalide" }, 400);
  }

  const name = (body.name ?? "").trim();
  const email = (body.email ?? "").trim();
  const phone = (body.phone ?? "").trim();
  if (!name) return json({ error: "Le nom est obligatoire" }, 400);
  if (!email && !phone) return json({ error: "Renseignez au moins un email ou un téléphone" }, 400);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: "Email invalide" }, 400);

  const patch: Record<string, unknown> = {
    name,
    email: email || null,
    phone: phone || null,
    photo_url: typeof body.photo_url === "string" && body.photo_url ? body.photo_url : null,
  };
  if (body.blocked !== undefined) patch.blocked = Boolean(body.blocked);
  if (body.lang !== undefined) patch.lang = normLangCli(body.lang);

  // Record esistente? (id esplicito, poi email, poi telefono)
  let idRiga = (body.id ?? "").trim() || null;
  if (!idRiga) {
    const mEmail = (body.match_email ?? "").trim();
    const mPhone = (body.match_phone ?? "").trim();
    if (mEmail) {
      const { data } = await supabaseAdmin.from("clients").select("id").ilike("email", mEmail).limit(1).maybeSingle();
      if (data) idRiga = data.id;
    }
    if (!idRiga && mPhone) {
      const { data } = await supabaseAdmin.from("clients").select("id").eq("phone", mPhone).limit(1).maybeSingle();
      if (data) idRiga = data.id;
    }
  }

  // Foto precedente: se viene tolta o sostituita, il file va eliminato
  let vecchiaFoto: string | null = null;
  if (idRiga) {
    try {
      const { data } = await supabaseAdmin.from("clients").select("photo_url").eq("id", idRiga).maybeSingle();
      vecchiaFoto = (data as { photo_url?: string | null } | null)?.photo_url ?? null;
    } catch { /* colonna assente */ }
  }

  let esito = idRiga
    ? await supabaseAdmin.from("clients").update(patch).eq("id", idRiga).select("id").maybeSingle()
    : await supabaseAdmin.from("clients").insert(patch).select("id").single();
  // Migrazioni #31/#32 non ancora lanciate: si salva senza le colonne nuove
  if (esito.error && (String(esito.error.message ?? "").includes("photo_url") || String(esito.error.message ?? "").includes("blocked") || String(esito.error.message ?? "").includes("lang"))) {
    delete patch.photo_url;
    delete patch.blocked;
    delete patch.lang;
    esito = idRiga
      ? await supabaseAdmin.from("clients").update(patch).eq("id", idRiga).select("id").maybeSingle()
      : await supabaseAdmin.from("clients").insert(patch).select("id").single();
  }
  if (esito.error) return json({ error: "Enregistrement impossible" }, 500);

  // Foto tolta o sostituita → il vecchio file sparisce dallo Storage
  // (dopo l'update: la riga non la referenzia più, la guardia passa)
  if (vecchiaFoto && vecchiaFoto !== (patch.photo_url ?? null)) {
    await eliminaFotoStorage(vecchiaFoto);
  }

  // Newsletter: opt-out = riga in newsletter_optout; opt-in = riga rimossa
  if (body.newsletter_optout !== undefined && email) {
    try {
      if (body.newsletter_optout) {
        await supabaseAdmin.from("newsletter_optout").upsert({ email: email.toLowerCase() }, { onConflict: "email" });
      } else {
        await supabaseAdmin.from("newsletter_optout").delete().eq("email", email.toLowerCase());
      }
    } catch { /* tabella assente: ignorato */ }
  }

  return json({ ok: true, id: esito.data?.id ?? idRiga });
};

// Cancella un cliente dalla lista.
// - cliente manuale SENZA ordini (?id=..&orders=0): eliminazione vera
// - cliente CON ordini: gli ordini restano (contabilità), quindi il
//   cliente viene NASCOSTO (hidden=true). Se non ha ancora un record
//   nella tabella `clients` (vecchi ordini pre-materializzazione),
//   il record viene creato già nascosto, così la fusione lo esclude.
export const DELETE: APIRoute = async ({ request, url }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();

  const id = url.searchParams.get("id") ?? "";
  const orders = Number(url.searchParams.get("orders") ?? "0");
  const email = (url.searchParams.get("email") ?? "").trim();
  const phone = (url.searchParams.get("phone") ?? "").trim();
  const name = (url.searchParams.get("name") ?? "").trim();

  if (!id && !email && !phone && !name) return json({ error: "Client non identifiable" }, 400);

  // Foto del cliente: va eliminata definitivamente in entrambi i casi
  let fotoDaEliminare: string | null = null;
  if (id) {
    try {
      const { data } = await supabaseAdmin.from("clients").select("photo_url").eq("id", id).maybeSingle();
      fotoDaEliminare = (data as { photo_url?: string | null } | null)?.photo_url ?? null;
    } catch { /* colonna assente */ }
  }

  // Il cliente resta "derivabile" dalla lista se ha ordini pagati OPPURE
  // prenotazioni (di QUALSIASI stato: anche annullate ricreano la riga). In tal
  // caso NON si elimina davvero — si nasconde — altrimenti l'aggregazione lo
  // ricrea e riappare (bug "serve cancellare due volte").
  let haPrenotazioni = false;
  if (email || phone) {
    const conds: string[] = [];
    if (email) conds.push(`email.eq.${email}`);
    if (phone) conds.push(`phone.eq.${phone}`);
    const { data: pr } = await supabaseAdmin
      .from("reservations")
      .select("id")
      .or(conds.join(","))
      .limit(1);
    haPrenotazioni = !!(pr && pr.length);
  }
  const haAttivita = orders > 0 || haPrenotazioni;

  // Manuale puro, SENZA nessuna attività (né ordini né prenotazioni): eliminazione vera.
  if (id && !haAttivita) {
    const { error } = await supabaseAdmin.from("clients").delete().eq("id", id);
    if (error) return json({ error: "Suppression impossible" }, 500);
    await eliminaFotoStorage(fotoDaEliminare);
    return json({ ok: true });
  }

  // Con attività: si nasconde (e si stacca la foto, che viene eliminata).
  if (id) {
    let upd = await supabaseAdmin.from("clients").update({ hidden: true, photo_url: null }).eq("id", id);
    if (upd.error && String(upd.error.message ?? "").includes("photo_url")) {
      upd = await supabaseAdmin.from("clients").update({ hidden: true }).eq("id", id);
    }
    if (upd.error) return json({ error: "Suppression impossible" }, 500);
    await eliminaFotoStorage(fotoDaEliminare);
    return json({ ok: true });
  }

  // Derivato dagli ordini senza record: lo si crea già nascosto.
  const { error } = await supabaseAdmin.from("clients").insert({
    name,
    email: email || null,
    phone: phone || null,
    hidden: true,
  });
  if (error) return json({ error: "Suppression impossible" }, 500);
  return json({ ok: true });
};
