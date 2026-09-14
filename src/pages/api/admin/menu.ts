import type { APIRoute } from "astro";
import { supabaseAdmin } from "../../../lib/db";
import { verificaStaff, nonAutorizzato } from "../../../lib/admin/adminAuth";
import { ambitoDiRichiesta, leggi, aggiorna, cancella, salva } from "../../../lib/admin/sede";
import { sedeDaScrivere, type Ambito } from "../../../lib/admin/sedeRegole";
import { applicaStato, statiDelPunto } from "../../../lib/menuStato";

export const prerender = false;

const SELECT_BASE =
  "id, category, category_order, sort_order, name, description_fr, description_en, image_url, allergens, price_cents, available, orderable, discount_type, discount_value, discount_scope, is_bestseller, is_vegan, is_spicy, is_suggestion, is_seasonal";
/** Colonne aggiunte da migrazioni successive: su un cliente che non le ha
 *  ancora lanciate la query fallisce, e si riprova senza QUELLA colonna
 *  (non senza tutte, per non perdere le altre). */
const COLONNE_NUOVE = ["sold_out", "name_i18n", "desc_i18n", "variants", "location_id"];

type Risultato = { data: unknown; error: { message?: string } | null };
/** Come Risultato, ma dice anche QUALI colonne ha dovuto togliere per riuscire. */
type RisultatoRipiego = Risultato & { escluse: string[] };

/** Esegue l'operazione togliendo una per una le colonne che il DB non conosce.
 *
 *  ⚠️ Per le LETTURE il ripiego è giusto: un cliente indietro con le migrazioni
 *  deve comunque vedere il menu. Per le SCRITTURE invece toglieva il campo dal
 *  payload e tornava 200: il salvataggio sembrava riuscito e il dato spariva
 *  (caso reale: le varianti che «non si salvavano»). Da qui `escluse`, che il
 *  chiamante DEVE guardare prima di dire all'utente che è andato tutto bene. */
async function conRipiego(
  esegui: (select: string, campi: Record<string, unknown>) => Promise<Risultato>,
  campi: Record<string, unknown> = {}
): Promise<RisultatoRipiego> {
  const escluse = new Set<string>();
  let ultimo: Risultato = { data: null, error: { message: "" } };
  for (let giro = 0; giro <= COLONNE_NUOVE.length; giro++) {
    const sel = [SELECT_BASE, ...COLONNE_NUOVE.filter((c) => !escluse.has(c))].join(", ");
    const c: Record<string, unknown> = { ...campi };
    for (const e of escluse) delete c[e];
    ultimo = await esegui(sel, c);
    const msg = String(ultimo.error?.message ?? "");
    const colpevole = ultimo.error ? COLONNE_NUOVE.find((k) => !escluse.has(k) && msg.includes(k)) : undefined;
    if (!colpevole) return { ...ultimo, escluse: [...escluse] };
    escluse.add(colpevole);
  }
  return { ...ultimo, escluse: [...escluse] };
}

/** Campi che il chiamante voleva scrivere e che il DB non ha accettato.
 *  Vuoto = tutto salvato davvero. */
function campiPersi(res: RisultatoRipiego, campi: Record<string, unknown>): string[] {
  return res.escluse.filter((c) => c in campi);
}

// Lingue del sito pubblico supportate (traduzioni piatti). Vedi superAdmin.ts.
const LANG_CODES = ["fr", "en", "it", "nl", "es"];
/** Ripulisce un oggetto { lang: testo } tenendo solo codici noti e testi non vuoti. */
function pulisciI18n(raw: unknown, max: number): Record<string, string> {
  const out: Record<string, string> = {};
  if (raw && typeof raw === "object") {
    const r = raw as Record<string, unknown>;
    for (const code of LANG_CODES) {
      const v = String(r[code] ?? "").trim();
      if (v) out[code] = v.slice(0, max);
    }
  }
  return out;
}

const MAX_VARIANTI = 12;

/** Un formato come sta nel jsonb. `location_id` e' la sua sede: null = di
 *  tutte, com'e' sempre stato e com'e' su un'installazione a punto unico. */
type Variante = {
  key: string;
  label_i18n: Record<string, string>;
  price_cents: number;
  orderable: boolean;
  sold_out: boolean;
  location_id: string | null;
};

/**
 * Valida i formati di un piatto in arrivo dall'admin.
 *
 * ⚠️ IL FORMATO HA UNA SEDE, il piatto no (quello ce l'ha nella riga).
 * La pizza in teglia esiste solo a Stockel: il piatto e' del gruppo, il
 * formato e' di un punto. Il default scelto (13/09/2026) e' **solo questa
 * sede**: chi aggiunge un formato stando dentro un punto quasi sempre sta
 * aggiungendo qualcosa che quel punto fa e gli altri no; se lo vuole per
 * tutti lo dice con l'interruttore.
 *
 * ⚠️ E non si accetta MAI la sede di un altro punto: l'id arriva dal
 * browser, e scrivere `location_id` di Jourdan stando su Stockel vorrebbe
 * dire modificare il menu di una societa' diversa da quella in cui si e'
 * entrati.
 */
function validaVarianti(raw: unknown, ambito: Ambito): { errore?: string; value?: Variante[] } {
  if (raw == null) return { value: [] };
  if (!Array.isArray(raw)) return { errore: "Formats invalides" };
  if (raw.length > MAX_VARIANTI) return { errore: `Maximum ${MAX_VARIANTI} formats` };
  const viste = new Set<string>();
  const out: Variante[] = [];
  for (const v of raw) {
    if (!v || typeof v !== "object" || Array.isArray(v)) return { errore: "Format invalide" };
    const r = v as Record<string, unknown>;
    const key = String(r.key ?? "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 24);
    if (!key) return { errore: "Chaque format doit avoir une clé" };
    if (viste.has(key)) return { errore: `Clé de format en double : ${key}` };
    viste.add(key);
    const price = Math.round(Number(r.price_cents));
    if (!Number.isFinite(price) || price < 0 || price > 100000000) {
      return { errore: "Prix de format invalide" };
    }
    const label_i18n = pulisciI18n(r.label_i18n, 40);
    if (Object.keys(label_i18n).length === 0) {
      return { errore: "Chaque format doit avoir un libellé" };
    }
    // La sede del formato. Fuori da un punto (installazione a sede unica o
    // aggregato) resta null: non c'e' niente da dividere.
    let location_id: string | null = null;
    if (ambito.modo === "sede") {
      const chiesta = r.location_id;
      if (chiesta === null) location_id = null;                 // «tutte le sedi», detto
      else if (typeof chiesta === "string" && chiesta.trim()) {
        if (chiesta.trim() !== ambito.id) return { errore: "Format d'un autre point de vente" };
        location_id = ambito.id;
      } else location_id = ambito.id;                            // default: solo qui
    }
    out.push({
      key,
      label_i18n,
      price_cents: price,
      orderable: r.orderable !== false,
      sold_out: r.sold_out === true,
      location_id,
    });
  }
  return { value: out };
}

/** I formati di questo piatto che l'admin di QUESTO punto deve vedere:
 *  i suoi e quelli di tutti. Quelli di un altro punto non esistono, qui. */
function variantiVisibili(raw: unknown, ambito: Ambito): unknown {
  if (ambito.modo !== "sede" || !Array.isArray(raw)) return raw;
  return raw.filter((v) => {
    const l = (v as Record<string, unknown>)?.location_id;
    return l == null || l === ambito.id;
  });
}

/** Ordine della sezione (menu_categories); null se la sezione non esiste. */
async function ordineCategoria(nome: string): Promise<number | null> {
  const { data } = await supabaseAdmin
    .from("menu_categories")
    .select("sort_order")
    .eq("name", nome)
    .maybeSingle();
  return data ? data.sort_order : null;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

/**
 * Valida i campi di un piatto in arrivo dall'admin.
 * `parziale = true` (PUT): valida solo i campi presenti.
 * Ritorna { errore } oppure { campi } pronti per il DB.
 */
function validaCampi(
  body: Record<string, unknown>,
  parziale: boolean,
  ambito: Ambito
): { errore?: string; campi?: Record<string, unknown> } {
  const campi: Record<string, unknown> = {};

  if (!parziale || "name" in body) {
    const name = String(body.name ?? "").trim();
    if (!name) return { errore: "Nom requis" };
    campi.name = name.slice(0, 120);
  }
  if (!parziale || "category" in body) {
    const cat = String(body.category ?? "").trim();
    if (!cat) return { errore: "Catégorie requise" };
    campi.category = cat.slice(0, 60);
  }
  if (!parziale || "price_cents" in body) {
    const n = Math.round(Number(body.price_cents));
    if (!Number.isFinite(n) || n < 0 || n > 100000) return { errore: "Prix invalide" };
    campi.price_cents = n;
  }
  if ("category_order" in body) {
    const n = Math.floor(Number(body.category_order));
    if (!Number.isFinite(n) || n < 0 || n > 999) return { errore: "Ordre catégorie invalide" };
    campi.category_order = n;
  }
  if ("sort_order" in body) {
    const n = Math.floor(Number(body.sort_order));
    if (!Number.isFinite(n) || n < 0 || n > 9999) return { errore: "Position invalide" };
    campi.sort_order = n;
  }
  if ("description_fr" in body) {
    const v = String(body.description_fr ?? "").trim();
    campi.description_fr = v ? v.slice(0, 500) : null;
  }
  if ("description_en" in body) {
    const v = String(body.description_en ?? "").trim();
    campi.description_en = v ? v.slice(0, 500) : null;
  }
  if ("name_i18n" in body) {
    campi.name_i18n = pulisciI18n(body.name_i18n, 120);
  }
  if ("variants" in body) {
    const { errore, value } = validaVarianti(body.variants, ambito);
    if (errore) return { errore };
    campi.variants = value;
  }
  if ("desc_i18n" in body) {
    const d = pulisciI18n(body.desc_i18n, 500);
    campi.desc_i18n = d;
    // Allinea le colonne legacy (menu pubblico attuale FR/EN)
    campi.description_fr = d.fr ?? null;
    campi.description_en = d.en ?? null;
  }
  if ("image_url" in body) {
    const v = String(body.image_url ?? "").trim();
    if (v && !/^https:\/\/\S+$/i.test(v)) return { errore: "Photo invalide" };
    campi.image_url = v ? v.slice(0, 500) : null;
  }
  if ("allergens" in body) {
    const arr = body.allergens;
    if (!Array.isArray(arr)) return { errore: "Allergènes invalides" };
    const puliti = [...new Set(arr.map((x) => Math.floor(Number(x))))];
    if (puliti.some((n) => !Number.isFinite(n) || n < 1 || n > 14)) {
      return { errore: "Allergènes invalides (1–14)" };
    }
    campi.allergens = puliti.sort((a, b) => a - b);
  }
  if ("available" in body) campi.available = !!body.available;
  if ("orderable" in body) campi.orderable = !!body.orderable;

  // --- Badge (best-seller / végan / épicé) ---
  if ("is_bestseller" in body) campi.is_bestseller = !!body.is_bestseller;
  if ("is_vegan" in body) campi.is_vegan = !!body.is_vegan;
  if ("is_spicy" in body) campi.is_spicy = !!body.is_spicy;
  if ("is_suggestion" in body) campi.is_suggestion = !!body.is_suggestion;
  if ("is_seasonal" in body) campi.is_seasonal = !!body.is_seasonal;
  // ⚠️ `sold_out` NON viene messo qui quando si sta dentro un punto: e' uno
  // stato della sede e va in `menu_sold_out`. Vedi `scriviStatoPunto`.
  if ("sold_out" in body && ambito.modo !== "sede") campi.sold_out = !!body.sold_out;

  // --- Sconto ---
  if ("discount_type" in body) {
    const t = body.discount_type;
    if (t !== null && t !== "" && t !== "fixed" && t !== "percent") {
      return { errore: "Type de réduction invalide" };
    }
    campi.discount_type = t === "fixed" || t === "percent" ? t : null;
  }
  if ("discount_value" in body) {
    const v = Math.round(Number(body.discount_value));
    if (!Number.isFinite(v) || v < 0 || v > 100000) return { errore: "Valeur de réduction invalide" };
    campi.discount_value = v;
  }
  if ("discount_scope" in body) {
    if (body.discount_scope !== "all" && body.discount_scope !== "online") {
      return { errore: "Application de la réduction invalide" };
    }
    campi.discount_scope = body.discount_scope;
  }
  // Coerenza: percentuale sensata; senza tipo, valore a zero
  if (campi.discount_type === "percent" && Number(campi.discount_value ?? 0) > 99) {
    return { errore: "Pourcentage invalide (1–99)" };
  }
  if ("discount_type" in campi && campi.discount_type === null) {
    campi.discount_value = 0;
  }

  return { campi };
}

/**
 * LO STATO DI QUESTO PUNTO (esaurito piatto + formati finiti).
 *
 * ⚠️ Non tocca `menu_items`: dentro un gruppo il menu e' di tutti e «oggi
 * la burrata e' finita» e' di uno solo. Vedi `src/lib/menuStato.ts`.
 *
 * `base` e' la riga del piatto appena scritta: serve come valore di
 * partenza la prima volta che questo punto tocca questo piatto — senza,
 * accendere un formato spegnerebbe per sbaglio l'esaurito del gruppo.
 */
async function scriviStatoPunto(
  itemId: string,
  ambito: Ambito,
  cambi: { sold_out?: boolean; variants_off?: string[] },
  base: Record<string, unknown> | null,
): Promise<string | null> {
  if (ambito.modo !== "sede") return null;
  if (cambi.sold_out === undefined && cambi.variants_off === undefined) return null;

  const attuale = (await statiDelPunto(ambito, [itemId])).get(itemId);
  const varBase = Array.isArray(base?.variants) ? (base!.variants as Record<string, unknown>[]) : [];
  const riga = {
    item_id: itemId,
    sold_out: cambi.sold_out ?? attuale?.sold_out ?? base?.sold_out === true,
    variants_off:
      cambi.variants_off ??
      attuale?.variants_off ??
      varBase.filter((v) => v?.sold_out === true).map((v) => String(v?.key ?? "")),
    updated_at: new Date().toISOString(),
  };
  const { error } = await salva("menu_sold_out", ambito, riga, "item_id");
  return error ? "Statut du point non enregistré" : null;
}

/** La riga del piatto come la deve vedere l'admin di QUESTO punto: con
 *  l'esaurito del punto sovrapposto e senza i formati di un altro punto. */
function perIlPunto(riga: Record<string, unknown>, ambito: Ambito, stati: Awaited<ReturnType<typeof statiDelPunto>>) {
  const conStato = applicaStato(riga, stati.get(String(riga.id)));
  return { ...conStato, variants: variantiVisibili(conStato.variants, ambito) };
}

// GET /api/admin/menu — TUTTI i piatti (anche nascosti), ordinati
export const GET: APIRoute = async ({ request }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();
  const ambito = await ambitoDiRichiesta(request, staff);

  const ordina = (sel: string) =>
    leggi("menu_items", ambito, sel)
      .order("category_order", { ascending: true })
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true });
  const res = await conRipiego(async (sel) => (await ordina(sel)) as Risultato);
  if (res.error) return json({ error: "Lecture impossible" }, 500);

  let items = (res.data as Record<string, unknown>[]) ?? [];
  if (ambito.modo === "sede") {
    const stati = await statiDelPunto(ambito, items.map((i) => String(i.id)));
    items = items.map((i) => perIlPunto(i, ambito, stati));
  }
  // `sede` dice all'interfaccia dentro quale punto sta scrivendo: e' quella
  // che decide il default dei nuovi formati («solo questa sede»).
  return json({ items, sede: ambito.modo === "sede" ? ambito.id : null });
};

// POST /api/admin/menu — crea un piatto
export const POST: APIRoute = async ({ request }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();
  const ambito = await ambitoDiRichiesta(request, staff);

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Requête invalide" }, 400);
  }

  const { errore, campi } = validaCampi(body, false, ambito);
  if (errore) return json({ error: errore }, 400);
  if (!campi) return json({ error: "Requête invalide" }, 400);

  // Default sensati se non forniti
  if (!("available" in campi)) campi.available = true;
  if (!("orderable" in campi)) campi.orderable = true;
  if (!("allergens" in campi)) campi.allergens = [];
  if (!("sort_order" in campi)) campi.sort_order = 0;

  // A CHI APPARTIENE IL PIATTO. Default: al gruppo — il menu delle tre
  // pizzerie e' lo stesso, e il caso raro e' il piatto di un punto solo.
  // (Il default opposto vale per i FORMATI: vedi `validaVarianti`.)
  //
  // ⚠️ Solo stando DENTRO un punto. Su un'installazione a sede unica la
  // colonna vale gia' null da sola, e sui DB dove la migrazione #73 non e'
  // ancora passata scriverla vorrebbe dire un 409 a ogni piatto creato.
  if (ambito.modo === "sede") {
    campi.location_id = sedeDaScrivere("menu_items", ambito, body.all_locations !== false);
  }

  // La sezione deve esistere; l'ordine viene dal registro sezioni
  const ord = await ordineCategoria(campi.category as string);
  if (ord === null) return json({ error: "Section inconnue" }, 400);
  campi.category_order = ord;

  const res = await conRipiego(
    async (sel, c) => (await supabaseAdmin.from("menu_items").insert(c).select(sel).single()) as Risultato,
    campi
  );
  if (res.error || !res.data) return json({ error: "Création impossible" }, 500);
  const persi = campiPersi(res, campi);
  if (persi.length) {
    return json(
      { error: `Base de données incomplète : colonne(s) ${persi.join(", ")} absente(s). Le plat est créé, pas ces champs. Appliquer les migrations.` },
      409
    );
  }

  const creato = res.data as Record<string, unknown>;
  const errStato = await scriviStatoPunto(
    String(creato.id),
    ambito,
    statoChiesto(body, null, ambito),
    creato
  );
  if (errStato) return json({ error: errStato }, 500);
  return json({ item: ambito.modo === "sede" ? perIlPunto(creato, ambito, await statiDelPunto(ambito, [String(creato.id)])) : creato });
};

/** Cosa il modale ha chiesto di cambiare nello STATO del punto (non nel
 *  piatto): l'esaurito, e i formati spenti qui. */
function statoChiesto(
  body: Record<string, unknown>,
  variantiChieste: Variante[] | null,
  ambito: Ambito
): { sold_out?: boolean; variants_off?: string[] } {
  if (ambito.modo !== "sede") return {};
  const out: { sold_out?: boolean; variants_off?: string[] } = {};
  if ("sold_out" in body) out.sold_out = !!body.sold_out;
  if (variantiChieste) {
    out.variants_off = variantiChieste.filter((v) => v.sold_out).map((v) => v.key);
  }
  return out;
}

// PUT /api/admin/menu — aggiorna un piatto (campi parziali ammessi)
export const PUT: APIRoute = async ({ request }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();
  const ambito = await ambitoDiRichiesta(request, staff);

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Requête invalide" }, 400);
  }

  const id = String(body.id ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ error: "Id invalide" }, 400);

  const { errore, campi } = validaCampi(body, true, ambito);
  if (errore) return json({ error: errore }, 400);
  if (!campi) return json({ error: "Requête invalide" }, 400);

  if ("all_locations" in body && ambito.modo === "sede") {
    campi.location_id = sedeDaScrivere("menu_items", ambito, body.all_locations !== false);
  }

  // ⚠️ FUSIONE DEI FORMATI. Da dentro un punto si vedono solo i formati di
  // questo punto e quelli di tutti: rimandare indietro quella lista e
  // scriverla tal quale CANCELLEREBBE la pizza in teglia di Stockel senza
  // che nessuno l'abbia chiesto. Quindi i formati degli altri punti si
  // rileggono e si rimettono in coda.
  let variantiChieste: Variante[] | null = null;
  if (ambito.modo === "sede" && Array.isArray(campi.variants)) {
    variantiChieste = campi.variants as Variante[];
    const { data: prima } = await leggi("menu_items", ambito, "id, variants, sold_out")
      .eq("id", id)
      .maybeSingle();
    const esistenti = Array.isArray((prima as Record<string, unknown> | null)?.variants)
      ? ((prima as Record<string, unknown>).variants as Record<string, unknown>[])
      : [];
    const altrui = esistenti.filter((v) => {
      const l = v?.location_id;
      return typeof l === "string" && l !== ambito.id;
    });
    const primaPerChiave = new Map(esistenti.map((v) => [String(v?.key ?? ""), v]));
    // L'esaurito del formato NON si scrive nel piatto stando dentro un
    // punto: quello e' il valore del gruppo e resta com'era. Il «finito
    // qui» va in `menu_sold_out.variants_off`.
    const mie = variantiChieste.map((v) => ({
      ...v,
      sold_out: primaPerChiave.get(v.key)?.sold_out === true,
    }));
    campi.variants = [...mie, ...altrui];
  }
  const cambi = statoChiesto(body, variantiChieste, ambito);
  const soloStato = Object.keys(campi).length === 0;
  if (soloStato && cambi.sold_out === undefined && cambi.variants_off === undefined) {
    return json({ error: "Rien à modifier" }, 400);
  }

  if ("category" in campi) {
    const ord = await ordineCategoria(campi.category as string);
    if (ord === null) return json({ error: "Section inconnue" }, 400);
    campi.category_order = ord;
  }

  // Solo un interruttore «finito» dalla lista: niente da toccare nel piatto.
  let riga: Record<string, unknown> | null = null;
  if (soloStato) {
    const res = await conRipiego(async (sel) =>
      (await leggi("menu_items", ambito, sel).eq("id", id).maybeSingle()) as Risultato
    );
    if (res.error || !res.data) return json({ error: "Plat introuvable" }, 404);
    riga = res.data as Record<string, unknown>;
  } else {
    const res = await conRipiego(
      async (sel, c) =>
        (await aggiorna("menu_items", ambito, c).eq("id", id).select(sel).single()) as Risultato,
      campi
    );
    if (res.error || !res.data) return json({ error: "Modification impossible" }, 500);
    const persi = campiPersi(res, campi);
    if (persi.length) {
      return json(
        { error: `Base de données incomplète : colonne(s) ${persi.join(", ")} absente(s). Le reste est enregistré, pas ces champs. Appliquer les migrations.` },
        409
      );
    }
    riga = res.data as Record<string, unknown>;
  }

  const errStato = await scriviStatoPunto(id, ambito, cambi, riga);
  if (errStato) return json({ error: errStato }, 500);

  return json({
    item:
      ambito.modo === "sede"
        ? perIlPunto(riga, ambito, await statiDelPunto(ambito, [id]))
        : riga,
  });
};

// PATCH /api/admin/menu — riordina i piatti di UNA sezione (drag & drop).
// body: { category: string, order: [id, id, ...] } nell'ordine desiderato.
export const PATCH: APIRoute = async ({ request }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();
  const ambito = await ambitoDiRichiesta(request, staff);

  let body: { category?: string; order?: string[] };
  try {
    body = await request.json();
  } catch {
    return json({ error: "Requête invalide" }, 400);
  }
  const category = String(body.category ?? "").trim();
  const order = body.order;
  if (!category) return json({ error: "Section requise" }, 400);
  if (!Array.isArray(order) || order.length === 0) return json({ error: "Ordre requis" }, 400);
  if (order.some((id) => !/^[0-9a-f-]{36}$/i.test(String(id)))) return json({ error: "Id invalide" }, 400);
  if (new Set(order).size !== order.length) return json({ error: "Doublons dans l'ordre" }, 400);

  // L'ordine deve contenere ESATTAMENTE i piatti della sezione VISIBILI da
  // qui: un piatto di un altro punto non e' nella lista e non deve esserci.
  const { data: righe, error: errItems } = await leggi("menu_items", ambito, "id").eq("category", category);
  if (errItems || !righe) return json({ error: "Lecture impossible" }, 500);
  const attuali = new Set(righe.map((r) => String(r.id)));
  if (order.length !== attuali.size || order.some((id) => !attuali.has(id))) {
    return json({ error: "Liste incomplète" }, 400);
  }

  for (let i = 0; i < order.length; i++) {
    const { error } = await aggiorna("menu_items", ambito, { sort_order: i + 1 }).eq("id", order[i]);
    if (error) return json({ error: "Enregistrement impossible" }, 500);
  }
  return json({ ok: true });
};

// DELETE /api/admin/menu?id=... — elimina un piatto
export const DELETE: APIRoute = async ({ request, url }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();
  const ambito = await ambitoDiRichiesta(request, staff);

  const id = url.searchParams.get("id") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ error: "Id invalide" }, 400);

  // `cancella` filtra: l'id di un piatto di un altro punto non trova niente.
  // Le righe di `menu_sold_out` se ne vanno da sole (on delete cascade).
  const { error } = await cancella("menu_items", ambito).eq("id", id);
  if (error) return json({ error: "Suppression impossible" }, 500);

  return json({ ok: true });
};
