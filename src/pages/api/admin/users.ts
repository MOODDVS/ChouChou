import type { APIRoute } from "astro";
import { supabaseAdmin } from "../../../lib/db";
import { verificaStaff, nonAutorizzato } from "../../../lib/admin/adminAuth";
import { isSuper, isSuperUser, ruoloDi, PAGINE_ADMIN } from "../../../lib/admin/superAdmin";
import { pulisciPagine } from "../../../lib/admin/permessiRegole";

import { adminLang } from "../../../lib/admin/adminLang";
import { adminT } from "../../../i18n/admin";
export const prerender = false;


/** Messaggio nella lingua dell'admin. `adminLang()` legge un valore globale
 *  gia' in cache (adminBoot): zero query in piu'. Vedi ENGINE.md,
 *  «Messaggi d'errore delle API admin — nella lingua dell'admin». */
async function msg(chiave: string): Promise<string> {
  return adminT(await adminLang())(chiave);
}

// Utenti dell'admin (Supabase Auth) — riservato al SUPER ADMIN MOODD.
// GET    → elenco utenti (email, creazione, ultimo accesso)
// POST   → crea un utente { email, password }
// PUT    → cambia la password { id, password }
// DELETE → elimina l'utente (?id=…) — mai sé stessi né il super admin

const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const RUOLI = ["super", "admin", "user"];
const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Sede da legare all'utente (multi-sede). "" o assente = nessuna sede, cioè
 * le vede TUTTE — è il caso del proprietario e di ogni cliente a sede unica.
 * Rende `undefined` se il campo non è stato mandato affatto (PATCH parziale),
 * `null` per «nessuna», l'id se valido. Lancia se l'id non esiste.
 */
async function sedeDaBody(v: unknown): Promise<string | null | undefined> {
  if (v === undefined) return undefined;
  const s = String(v ?? "").trim();
  if (!s) return null;
  if (!RE_UUID.test(s)) throw new Error("err.locationUnknown");
  const { data } = await supabaseAdmin.from("locations").select("id").eq("id", s).maybeSingle();
  if (!data) throw new Error("err.locationUnknown");
  return s;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

/** Solo il super admin MOODD può gestire gli accessi. */
async function soloSuper(request: Request): Promise<{ email: string } | Response> {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();
  if (!isSuperUser(staff)) return json({ error: await msg("err.super") }, 403);
  return { email: staff.email ?? "" };
}

export const GET: APIRoute = async ({ request }) => {
  const g = await soloSuper(request);
  if (g instanceof Response) return g;

  const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 200 });
  if (error) return json({ error: await msg("err.read") }, 500);

  const users = (data?.users ?? []).map((u) => {
    const m = (u.user_metadata ?? {}) as { first_name?: string; last_name?: string; full_name?: string };
    const nome = String(m.full_name ?? `${m.first_name ?? ""} ${m.last_name ?? ""}`).trim();
    return {
    id: u.id,
    nome,
    first_name: m.first_name ?? "",
    last_name: m.last_name ?? "",
    email: u.email ?? "",
    created_at: u.created_at,
    last_sign_in_at: u.last_sign_in_at ?? null,
    is_moodd: isSuper(u.email),
    role: ruoloDi({ email: u.email, app_metadata: u.app_metadata as Record<string, unknown> }),
    location_id: (u.app_metadata as { location_id?: string } | undefined)?.location_id ?? null,
    // null = nessuno ha deciso → vale il default del ruolo (vedi permessiRegole)
    pages: (u.app_metadata as { pages?: string[] } | undefined)?.pages ?? null,
    };
  });
  users.sort((a, b) => a.email.localeCompare(b.email));
  return json({ users });
};

export const POST: APIRoute = async ({ request }) => {
  const g = await soloSuper(request);
  if (g instanceof Response) return g;

  let body: { email?: string; password?: string; first_name?: string; last_name?: string; role?: string; location_id?: string; pages?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: await msg("err.body") }, 400);
  }
  const email = String(body.email ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");
  const first_name = String(body.first_name ?? "").trim().slice(0, 60);
  const last_name = String(body.last_name ?? "").trim().slice(0, 60);
  if (!RE_EMAIL.test(email)) return json({ error: await msg("err.email") }, 400);
  const role = RUOLI.includes(String(body.role)) ? String(body.role) : "admin";
  let sede: string | null | undefined;
  try { sede = await sedeDaBody(body.location_id); } catch (e) { return json({ error: await msg((e as Error).message) }, 400); }
  // Le pagine valgono SOLO per il ruolo "user": a un admin le caselle non si
  // applicano, e salvarle lo stesso vorrebbe dire che cambiando ruolo da
  // admin a utente si riattivano scelte fatte mesi prima e dimenticate.
  const pagine = role === "user" ? pulisciPagine(body.pages, PAGINE_ADMIN.map((pg) => pg.key)) : null;
  const appMeta: Record<string, unknown> = { role, location_id: sede ?? null, pages: pagine };
  const meta = { first_name, last_name, full_name: `${first_name} ${last_name}`.trim() };

  // Password fornita → creazione diretta (accesso immediato).
  // Password vuota → INVITO via email: l'utente sceglie la sua password.
  if (password) {
    if (password.length < 8) return json({ error: await msg("err.password8") }, 400);
    const { data, error } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true, // niente email di verifica: l'accesso è immediato
      user_metadata: meta,
      app_metadata: appMeta, // ruolo e sede scrivibili SOLO con la service key
    });
    if (error) {
      const dettaglio = String(error.message ?? "");
      if (/already/i.test(dettaglio)) return json({ error: await msg("err.emailHasAccess") }, 409);
      return json({ error: await msg("err.create") }, 500);
    }
    return json({ ok: true, id: data.user?.id, mode: "created" }, 201);
  }

  // INVITO: crea l'utente e invia l'email d'invito (template Supabase "Invite user").
  const base = (import.meta.env.PUBLIC_SITE_URL ?? new URL(request.url).origin).replace(/\/+$/, "");
  const { data, error } = await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
    data: meta,
    redirectTo: `${base}/admin/reset-password`,
  });
  if (error) {
    const dettaglio = String(error.message ?? "");
    if (/already|registered|exist/i.test(dettaglio)) return json({ error: await msg("err.emailHasAccess") }, 409);
    return json({ error: await msg("err.invite") }, 500);
  }
  // Il ruolo va in app_metadata dopo l'invito (non impostabile via inviteUserByEmail).
  if (data.user?.id) {
    await supabaseAdmin.auth.admin.updateUserById(data.user.id, { app_metadata: appMeta });
  }
  return json({ ok: true, id: data.user?.id, mode: "invited" }, 201);
};

export const PUT: APIRoute = async ({ request }) => {
  const g = await soloSuper(request);
  if (g instanceof Response) return g;

  let body: { id?: string; password?: string; first_name?: string; last_name?: string; email?: string; role?: string; location_id?: string; pages?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: await msg("err.body") }, 400);
  }
  if (!body.id) return json({ error: await msg("err.idMissing") }, 400);

  const patch: {
    password?: string;
    email?: string;
    user_metadata?: Record<string, string>;
    // `unknown` e non `string`: `pages` e' un array. Restringerlo a stringhe
    // era gia' una semplificazione — `location_id` puo' essere null — e con
    // le pagine diventa falsa.
    app_metadata?: Record<string, unknown>;
  } = {};
  if (body.role !== undefined) {
    const ruolo = String(body.role);
    if (!RUOLI.includes(ruolo)) return json({ error: await msg("err.roleUnknown") }, 400);
    // Non ci si declassa da soli, e l'accesso MOODD resta sempre super
    const { data: chi } = await supabaseAdmin.auth.admin.getUserById(body.id);
    const mail = chi?.user?.email ?? "";
    if (ruolo !== "super" && isSuper(mail)) {
      return json({ error: await msg("err.mooddAccessRole") }, 409);
    }
    if (ruolo !== "super" && mail.toLowerCase() === g.email.toLowerCase()) {
      return json({ error: await msg("err.ownRole") }, 409);
    }
    patch.app_metadata = { role: ruolo };
  }
  // ⚠️ `app_metadata` si riscrive per intero: quello che non si rimanda sparisce.
  // Si rilegge SEMPRE quello che c'è e si fonde a mano — anche quando cambia solo
  // il ruolo, o la sede verrebbe cancellata di nascosto (e viceversa).
  try {
    const sede = await sedeDaBody(body.location_id);
    const pagineChieste = body.pages !== undefined;
    if (sede !== undefined || pagineChieste || patch.app_metadata) {
      const { data: chi } = await supabaseAdmin.auth.admin.getUserById(body.id);
      const attuale = (chi?.user?.app_metadata ?? {}) as Record<string, unknown>;
      // Il ruolo che questo utente AVRA' dopo la modifica: se non lo si sta
      // cambiando e' quello di adesso.
      const ruoloFinale = String((patch.app_metadata as { role?: string } | undefined)?.role ?? attuale.role ?? "admin");
      // Le caselle esistono solo per "user". Chi diventa admin le perde: se
      // restassero, un domani rimesso a "user" si ritroverebbe permessi
      // decisi mesi prima e dimenticati da tutti.
      const pagine = ruoloFinale !== "user"
        ? null
        : pagineChieste
          ? pulisciPagine(body.pages, PAGINE_ADMIN.map((pg) => pg.key))
          : ((attuale.pages as string[] | undefined) ?? null);
      patch.app_metadata = {
        ...attuale,
        ...(patch.app_metadata ?? {}),
        ...(sede !== undefined ? { location_id: sede } : {}),
        pages: pagine,
      };
    }
  } catch (e) {
    // `sedeDaBody` lancia una CHIAVE, non una frase: qui si traduce.
    return json({ error: await msg((e as Error).message) }, 400);
  }
  if (body.email !== undefined) {
    const em = String(body.email).trim().toLowerCase();
    if (!RE_EMAIL.test(em)) return json({ error: await msg("err.email") }, 400);
    patch.email = em;
  }
  if (body.password !== undefined) {
    const password = String(body.password);
    if (password.length < 8) return json({ error: await msg("err.password8") }, 400);
    patch.password = password;
  }
  if (body.first_name !== undefined || body.last_name !== undefined) {
    const first_name = String(body.first_name ?? "").trim().slice(0, 60);
    const last_name = String(body.last_name ?? "").trim().slice(0, 60);
    patch.user_metadata = { first_name, last_name, full_name: `${first_name} ${last_name}`.trim() };
  }
  if (!patch.password && !patch.user_metadata && !patch.email && !patch.app_metadata) return json({ error: await msg("err.nothing") }, 400);

  const { error } = await supabaseAdmin.auth.admin.updateUserById(body.id, patch);
  if (error) return json({ error: await msg("err.update") }, 500);
  return json({ ok: true });
};

export const DELETE: APIRoute = async ({ request, url }) => {
  const g = await soloSuper(request);
  if (g instanceof Response) return g;

  const id = url.searchParams.get("id") ?? "";
  if (!id) return json({ error: await msg("err.idMissing") }, 400);

  // Protezioni: mai eliminare sé stessi né l'accesso super admin MOODD
  const { data: info } = await supabaseAdmin.auth.admin.getUserById(id);
  const target = info?.user?.email ?? "";
  if (isSuper(target)) return json({ error: await msg("err.mooddAccessDelete") }, 409);
  if (target.toLowerCase() === g.email.toLowerCase()) {
    return json({ error: await msg("err.ownAccess") }, 409);
  }

  const { error } = await supabaseAdmin.auth.admin.deleteUser(id);
  if (error) return json({ error: await msg("err.delete") }, 500);
  return json({ ok: true });
};
