import type { APIRoute } from "astro";
import { supabaseAdmin } from "../../../lib/db";
import { invalidaAppConfig } from "../../../lib/appConfigCache";
import { verificaStaff, nonAutorizzato } from "../../../lib/admin/adminAuth";
import { isSuperUser } from "../../../lib/admin/superAdmin";
import { scordaSedi } from "../../../lib/admin/sede";
import { adminLang } from "../../../lib/admin/adminLang";
import { adminT } from "../../../i18n/admin";

export const prerender = false;

// SEDI (multi-sede) — riservato al SUPER ADMIN MOODD.
//
// GET    → { multi, locations: [...], secrets: { <id>: { stripe_secret_key: bool, … } } }
//          ⚠️ dei segreti si dice SOLO se ci sono. Il valore non esce mai da qui.
// POST   → crea una sede { name, slug, … }
// PATCH  → { multi: "on"|"off" }            accende/spegne il multi-sede
//          { id, ...campi }                 modifica la scheda
//          { id, secret_key, secret_value } scrive un segreto (sola scrittura)
// DELETE ?id= → elimina (il client manda POST + X-Method-Override)
//
// Le sedi NON si cancellano se hanno dati collegati: `on delete restrict`
// nella migrazione #73. E' voluto — cancellare una sede con i suoi ordini
// dentro non e' un'operazione, e' una perdita.

const CHIAVE_MULTI = "multi_location";
/** Gli unici segreti che questa API accetta. Una chiave sconosciuta non e'
 *  un caso da ignorare: e' un errore, e va detto. */
const SEGRETI = ["stripe_secret_key", "stripe_webhook_secret"];

const SELECT =
  "id, name, slug, address, postcode, city, phone, email, timezone, " +
  "company_name, company_vat, google_location, image_url, sort_order, active, created_at";

const RE_SLUG = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;
const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Messaggi d'errore nella lingua dell'admin.
 *  La lingua e' globale (app_config.admin_lang) e il server la conosce gia'
 *  dalla cache di adminBoot: nessuna query in piu'. Senza questo, un admin
 *  in italiano riceveva un toast in francese — non un guasto, ma il genere
 *  di cosa che fa sembrare l'applicazione di qualcun altro. */
async function msg(chiave: string): Promise<string> {
  return adminT(await adminLang())(chiave);
}

/** Traduce l'errore di Postgres in qualcosa di utile, e lo SCRIVE nei log.
 *
 *  ⚠️ Prima questa API rispondeva «Salvataggio impossibile» e buttava via il
 *  motivo. Una colonna mancante (migrazione non lanciata), un vincolo violato
 *  e una rete caduta davano tutti la stessa pastiglia rossa, e per capire
 *  quale fosse bisognava indovinare. Il ripiego silenzioso e' il guasto.
 */
function erroreDb(dove: string, err: { message?: string; code?: string } | null): string {
  const msg = String(err?.message ?? "");
  console.error(`[locations] ${dove}: ${err?.code ?? "?"} ${msg}`);
  // 42703 = colonna inesistente, 42P01 = tabella inesistente: quasi sempre
  // una migrazione non lanciata su QUESTO cliente.
  if (err?.code === "42703" || err?.code === "42P01" || /column .* does not exist|relation .* does not exist/i.test(msg)) {
    return "loc.err.migrazione";
  }
  if (msg.includes("locations_slug_key")) return "loc.err.slugDup";
  return "common.saveErr";
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

/** Sedi, societa' e chiavi Stripe: roba da super admin MOODD, non da cliente. */
async function soloSuper(request: Request): Promise<null | Response> {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();
  if (!isSuperUser(staff)) return json({ error: await msg("loc.err.super") }, 403);
  return null;
}

const testo = (v: unknown, max: number): string => String(v ?? "").trim().slice(0, max);

/** Campi accettati da POST/PATCH, ripuliti. `parziale` = PATCH: si toccano
 *  solo le chiavi arrivate davvero, il resto della riga resta com'e'. */
function campiDa(body: Record<string, unknown>, parziale: boolean): Record<string, unknown> | string {
  const out: Record<string, unknown> = {};
  const metti = (chiave: string, valore: unknown, max: number) => {
    if (parziale && body[chiave] === undefined) return;
    out[chiave] = testo(valore, max);
  };

  if (!parziale || body.name !== undefined) {
    const name = testo(body.name, 60);
    if (!name) return "loc.err.name";
    out.name = name;
  }
  if (!parziale || body.slug !== undefined) {
    const slug = testo(body.slug, 40).toLowerCase();
    if (!RE_SLUG.test(slug)) {
      return "loc.err.slug";
    }
    out.slug = slug;
  }
  metti("address", body.address, 120);
  metti("postcode", body.postcode, 12);
  metti("city", body.city, 60);
  metti("phone", body.phone, 30);
  metti("email", body.email, 120);
  metti("company_name", body.company_name, 120);
  metti("company_vat", body.company_vat, 30);

  if (!parziale || body.timezone !== undefined) {
    out.timezone = testo(body.timezone, 40) || "Europe/Brussels";
  }
  if (!parziale || body.google_location !== undefined) {
    const g = testo(body.google_location, 200);
    out.google_location = g || null;
  }
  // Foto della sede: URL reso da /api/admin/upload, quindi gia' nel nostro
  // storage. Si accetta solo quello — un indirizzo qualunque farebbe
  // caricare al browser del ristoratore un'immagine di terzi.
  if (!parziale || body.image_url !== undefined) {
    const u = testo(body.image_url, 400);
    out.image_url = /^https?:\/\/[^\s"'<>]+$/.test(u) ? u : null;
  }
  if (!parziale || body.sort_order !== undefined) {
    const n = Number(body.sort_order);
    out.sort_order = Number.isFinite(n) ? Math.min(999, Math.max(0, Math.round(n))) : 0;
  }
  if (!parziale || body.active !== undefined) out.active = body.active !== false;

  return out;
}

export const GET: APIRoute = async ({ request }) => {
  const no = await soloSuper(request);
  if (no) return no;

  const { data, error } = await supabaseAdmin
    .from("locations")
    .select(SELECT)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
  if (error) return json({ error: await msg(erroreDb("GET", error)) }, 500);

  // Dei segreti si dice soltanto SE ci sono: mai il valore, nemmeno un pezzo.
  // Questa e' l'unica API che tocca `location_secrets`, ed e' anche il motivo
  // per cui quella tabella e' separata da `location_config`: la lettura
  // generica della configurazione non la incontra proprio.
  const impostati: Record<string, Record<string, boolean>> = {};
  try {
    const { data: righe } = await supabaseAdmin
      .from("location_secrets")
      .select("location_id, key");
    for (const r of (righe ?? []) as { location_id: string; key: string }[]) {
      (impostati[r.location_id] ??= {})[r.key] = true;
    }
  } catch {
    /* tabella assente: nessun segreto impostato */
  }

  let multi = false;
  try {
    const { data: cfg } = await supabaseAdmin
      .from("app_config").select("value").eq("key", CHIAVE_MULTI).maybeSingle();
    multi = String(cfg?.value ?? "").trim().toLowerCase() === "on";
  } catch { /* chiave assente: spento */ }

  return json({ multi, locations: data ?? [], secrets: impostati });
};

export const POST: APIRoute = async ({ request }) => {
  const no = await soloSuper(request);
  if (no) return no;

  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return json({ error: await msg("loc.err.body") }, 400); }

  const campi = campiDa(body, false);
  if (typeof campi === "string") return json({ error: await msg(campi) }, 400);

  const { data, error } = await supabaseAdmin
    .from("locations").insert(campi).select(SELECT).single();
  if (error) {
    // Lo slug e' unico: finisce negli URL pubblici, due sedi non possono averlo uguale.
    const chiave = erroreDb("POST", error);
    return json({ error: await msg(chiave) }, chiave === "loc.err.slugDup" ? 409 : 500);
  }
  scordaSedi();
  return json({ ok: true, location: data }, 201);
};

export const PATCH: APIRoute = async ({ request }) => {
  const no = await soloSuper(request);
  if (no) return no;

  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return json({ error: await msg("loc.err.body") }, 400); }

  // ---- interruttore multi-sede ----
  if (body.multi !== undefined) {
    const acceso = String(body.multi) === "on";
    // Acceso senza sedi non vuol dire niente, e lascerebbe l'admin con un
    // selettore vuoto: meglio dirlo adesso che scoprirlo dopo.
    if (acceso) {
      const { count } = await supabaseAdmin
        .from("locations").select("id", { count: "exact", head: true }).eq("active", true);
      if (!count) return json({ error: await msg("loc.err.needOne") }, 400);
    }
    const { error } = await supabaseAdmin
      .from("app_config")
      .upsert({ key: CHIAVE_MULTI, value: acceso ? "on" : "off" }, { onConflict: "key" });
    if (error) return json({ error: await msg(erroreDb("multi", error)) }, 500);
    invalidaAppConfig();
    scordaSedi();
    return json({ ok: true, multi: acceso });
  }

  const id = testo(body.id, 40);
  if (!RE_UUID.test(id)) return json({ error: await msg("loc.err.notFound") }, 400);

  // ---- scrittura di un segreto (chiave Stripe): SOLA SCRITTURA ----
  // Non c'e' nessun percorso per rileggerlo. Chi lo perde lo rigenera su
  // Stripe: e' il comportamento giusto per una credenziale.
  if (body.secret_key !== undefined) {
    const chiave = testo(body.secret_key, 40);
    if (!SEGRETI.includes(chiave)) return json({ error: await msg("loc.err.secret") }, 400);
    const valore = String(body.secret_value ?? "").trim();

    if (!valore) {
      const { error } = await supabaseAdmin
        .from("location_secrets").delete().eq("location_id", id).eq("key", chiave);
      if (error) return json({ error: await msg("loc.err.delete") }, 500);
      return json({ ok: true, impostato: false });
    }
    const { error } = await supabaseAdmin
      .from("location_secrets")
      .upsert({ location_id: id, key: chiave, value: valore, updated_at: new Date().toISOString() },
              { onConflict: "location_id,key" });
    if (error) return json({ error: await msg(erroreDb("secret", error)) }, 500);
    return json({ ok: true, impostato: true });
  }

  // ---- scheda della sede ----
  const campi = campiDa(body, true);
  if (typeof campi === "string") return json({ error: await msg(campi) }, 400);
  if (Object.keys(campi).length === 0) return json({ error: await msg("loc.err.nothing") }, 400);

  const { data, error } = await supabaseAdmin
    .from("locations").update(campi).eq("id", id).select(SELECT).single();
  if (error) {
    const chiave = erroreDb("PATCH", error);
    return json({ error: await msg(chiave) }, chiave === "loc.err.slugDup" ? 409 : 500);
  }
  scordaSedi();
  return json({ ok: true, location: data });
};

export const DELETE: APIRoute = async ({ request, url }) => {
  const no = await soloSuper(request);
  if (no) return no;

  const id = testo(url.searchParams.get("id"), 40);
  if (!RE_UUID.test(id)) return json({ error: await msg("loc.err.notFound") }, 400);

  const { error } = await supabaseAdmin.from("locations").delete().eq("id", id);
  if (error) {
    // `on delete restrict`: ci sono ordini, prenotazioni o altro collegati.
    // Non si forza. Si disattiva la sede, che la toglie dall'uso lasciando
    // intatto tutto quello che ci e' passato dentro.
    const collegata = String(error.code ?? "") === "23503";
    return json(
      { error: await msg(collegata ? "loc.err.linked" : "loc.err.delete") },
      collegata ? 409 : 500,
    );
  }
  scordaSedi();
  return json({ ok: true });
};
