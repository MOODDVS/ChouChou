import type { APIRoute } from "astro";
import { supabaseAdmin } from "../../../lib/db";
import { verificaStaff, nonAutorizzato } from "../../../lib/admin/adminAuth";
import { isSuper, isSuperUser, ruoloDi } from "../../../lib/admin/superAdmin";

export const prerender = false;

// Utenti dell'admin (Supabase Auth) — riservato al SUPER ADMIN MOODD.
// GET    → elenco utenti (email, creazione, ultimo accesso)
// POST   → crea un utente { email, password }
// PUT    → cambia la password { id, password }
// DELETE → elimina l'utente (?id=…) — mai sé stessi né il super admin

const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const RUOLI = ["super", "admin", "user"];

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
  if (!isSuperUser(staff)) return json({ error: "Réservé au super admin" }, 403);
  return { email: staff.email ?? "" };
}

export const GET: APIRoute = async ({ request }) => {
  const g = await soloSuper(request);
  if (g instanceof Response) return g;

  const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 200 });
  if (error) return json({ error: "Lecture impossible" }, 500);

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
    };
  });
  users.sort((a, b) => a.email.localeCompare(b.email));
  return json({ users });
};

export const POST: APIRoute = async ({ request }) => {
  const g = await soloSuper(request);
  if (g instanceof Response) return g;

  let body: { email?: string; password?: string; first_name?: string; last_name?: string; role?: string };
  try {
    body = await request.json();
  } catch {
    return json({ error: "Corps invalide" }, 400);
  }
  const email = String(body.email ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");
  const first_name = String(body.first_name ?? "").trim().slice(0, 60);
  const last_name = String(body.last_name ?? "").trim().slice(0, 60);
  if (!RE_EMAIL.test(email)) return json({ error: "Email invalide." }, 400);
  const role = RUOLI.includes(String(body.role)) ? String(body.role) : "admin";
  const meta = { first_name, last_name, full_name: `${first_name} ${last_name}`.trim() };

  // Password fornita → creazione diretta (accesso immediato).
  // Password vuota → INVITO via email: l'utente sceglie la sua password.
  if (password) {
    if (password.length < 8) return json({ error: "Mot de passe : 8 caractères minimum." }, 400);
    const { data, error } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true, // niente email di verifica: l'accesso è immediato
      user_metadata: meta,
      app_metadata: { role }, // ruolo scrivibile SOLO con la service key
    });
    if (error) {
      const msg = String(error.message ?? "");
      if (/already/i.test(msg)) return json({ error: "Cet email a déjà un accès." }, 409);
      return json({ error: "Création impossible" }, 500);
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
    const msg = String(error.message ?? "");
    if (/already|registered|exist/i.test(msg)) return json({ error: "Cet email a déjà un accès." }, 409);
    return json({ error: "Invitation impossible" }, 500);
  }
  // Il ruolo va in app_metadata dopo l'invito (non impostabile via inviteUserByEmail).
  if (data.user?.id) {
    await supabaseAdmin.auth.admin.updateUserById(data.user.id, { app_metadata: { role } });
  }
  return json({ ok: true, id: data.user?.id, mode: "invited" }, 201);
};

export const PUT: APIRoute = async ({ request }) => {
  const g = await soloSuper(request);
  if (g instanceof Response) return g;

  let body: { id?: string; password?: string; first_name?: string; last_name?: string; email?: string; role?: string };
  try {
    body = await request.json();
  } catch {
    return json({ error: "Corps invalide" }, 400);
  }
  if (!body.id) return json({ error: "id manquant" }, 400);

  const patch: {
    password?: string;
    email?: string;
    user_metadata?: Record<string, string>;
    app_metadata?: Record<string, string>;
  } = {};
  if (body.role !== undefined) {
    const ruolo = String(body.role);
    if (!RUOLI.includes(ruolo)) return json({ error: "Rôle inconnu." }, 400);
    // Non ci si declassa da soli, e l'accesso MOODD resta sempre super
    const { data: chi } = await supabaseAdmin.auth.admin.getUserById(body.id);
    const mail = chi?.user?.email ?? "";
    if (ruolo !== "super" && isSuper(mail)) {
      return json({ error: "L'accès MOODD reste toujours super admin." }, 409);
    }
    if (ruolo !== "super" && mail.toLowerCase() === g.email.toLowerCase()) {
      return json({ error: "Impossible de retirer son propre rôle." }, 409);
    }
    patch.app_metadata = { role: ruolo };
  }
  if (body.email !== undefined) {
    const em = String(body.email).trim().toLowerCase();
    if (!RE_EMAIL.test(em)) return json({ error: "Email invalide." }, 400);
    patch.email = em;
  }
  if (body.password !== undefined) {
    const password = String(body.password);
    if (password.length < 8) return json({ error: "Mot de passe : 8 caractères minimum." }, 400);
    patch.password = password;
  }
  if (body.first_name !== undefined || body.last_name !== undefined) {
    const first_name = String(body.first_name ?? "").trim().slice(0, 60);
    const last_name = String(body.last_name ?? "").trim().slice(0, 60);
    patch.user_metadata = { first_name, last_name, full_name: `${first_name} ${last_name}`.trim() };
  }
  if (!patch.password && !patch.user_metadata && !patch.email && !patch.app_metadata) return json({ error: "Rien à modifier" }, 400);

  const { error } = await supabaseAdmin.auth.admin.updateUserById(body.id, patch);
  if (error) return json({ error: "Modification impossible" }, 500);
  return json({ ok: true });
};

export const DELETE: APIRoute = async ({ request, url }) => {
  const g = await soloSuper(request);
  if (g instanceof Response) return g;

  const id = url.searchParams.get("id") ?? "";
  if (!id) return json({ error: "id manquant" }, 400);

  // Protezioni: mai eliminare sé stessi né l'accesso super admin MOODD
  const { data: info } = await supabaseAdmin.auth.admin.getUserById(id);
  const target = info?.user?.email ?? "";
  if (isSuper(target)) return json({ error: "L'accès MOODD ne peut pas être supprimé." }, 409);
  if (target.toLowerCase() === g.email.toLowerCase()) {
    return json({ error: "Impossible de supprimer son propre accès." }, 409);
  }

  const { error } = await supabaseAdmin.auth.admin.deleteUser(id);
  if (error) return json({ error: "Suppression impossible" }, 500);
  return json({ ok: true });
};
