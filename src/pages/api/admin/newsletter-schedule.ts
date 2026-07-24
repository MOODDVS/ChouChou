import type { APIRoute } from "astro";
import { DateTime } from "luxon";
import { supabaseAdmin } from "../../../lib/db";
import { verificaStaff, nonAutorizzato } from "../../../lib/admin/adminAuth";
import { TIMEZONE, aggiornaTimezone } from "../../../lib/slots";
import { parseSegment } from "../../../lib/newsletterSend";

export const prerender = false;

// Newsletter PROGRAMMATE e RICORRENTI (#39, tabella newsletter_schedule).
// GET          → { schedules } attive (missing: true se la #39 non è lanciata)
// POST         → crea:
//   una tantum : { …contenuto, segment, send_date: "YYYY-MM-DD", heure: 0-23 }
//   ricorrente : { …contenuto, segment, recur: "weekly"|"monthly",
//                  recur_dow: 1-7 | recur_day: 1-28, heure: 0-23 }
//   Le ore sono nel FUSO del ristorante; le una-tantum sono salvate in UTC.
// DELETE ?id=  → elimina (il client la invia come POST + X-Method-Override)
// L'invio vero lo fa /api/cron/newsletter (pg_cron, ogni ora).

const SELECT = "id, subject, message, image_url, btn_label, btn_url, btn2_label, btn2_url, segment, send_at, recur, recur_dow, recur_day, recur_heure, active, draft, last_sent_at, created_at";
const RE_DATA = /^\d{4}-\d{2}-\d{2}$/;
const RE_UUID = /^[0-9a-f-]{36}$/i;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export const GET: APIRoute = async ({ request }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();

  const { data, error } = await supabaseAdmin
    .from("newsletter_schedule")
    .select(SELECT)
    .or("active.eq.true,draft.eq.true")
    .order("created_at", { ascending: true });
  // Tabella non ancora creata / senza colonne nuove (migrazione #39): vuoto, non rotto
  if (error) return json({ schedules: [], drafts: [], missing: true });
  const righe = (data ?? []) as { active?: boolean; draft?: boolean }[];
  return json({
    schedules: righe.filter((r) => r.active && !r.draft),
    drafts: righe.filter((r) => r.draft),
  });
};

export const POST: APIRoute = async ({ request }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Corps invalide" }, 400);
  }

  const subject = String(body.subject ?? "").trim();
  const message = String(body.message ?? "").trim();

  // ---- BROUILLON: salvataggio per finire più tardi (validazioni minime) ----
  if (body.draft === true) {
    const ps = parseSegment(String(body.segment ?? ""));
    const bozza: Record<string, unknown> = {
      subject: subject || "(brouillon)",
      message,
      image_url: String(body.image_url ?? "").trim() || null,
      btn_label: String(body.btn_label ?? "").trim() || null,
      btn_url: String(body.btn_url ?? "").trim() || null,
      btn2_label: String(body.btn2_label ?? "").trim() || null,
      btn2_url: String(body.btn2_url ?? "").trim() || null,
      segment: `${ps.lang}:${ps.group}`,
      draft: true,
      active: false,
    };
    const idBozza = String(body.id ?? "");
    if (RE_UUID.test(idBozza)) {
      const { data, error } = await supabaseAdmin
        .from("newsletter_schedule")
        .update(bozza)
        .eq("id", idBozza)
        .select(SELECT)
        .single();
      if (error || !data) return json({ error: "Enregistrement impossible" }, 500);
      return json({ schedule: data });
    }
    const { data, error } = await supabaseAdmin.from("newsletter_schedule").insert(bozza).select(SELECT).single();
    if (error || !data) {
      return json({ error: "Enregistrement impossible — migration supabase/newsletter_schedule.sql à (re)lancer ?" }, 500);
    }
    return json({ schedule: data }, 201);
  }

  if (!subject) return json({ error: "L'objet est obligatoire" }, 400);
  if (!message) return json({ error: "Le message est obligatoire" }, 400);

  const { lang, group } = parseSegment(String(body.segment ?? ""));
  const segment = `${lang}:${group}`;
  const heure = Math.round(Number(body.heure));
  if (!Number.isFinite(heure) || heure < 0 || heure > 23) return json({ error: "Heure invalide" }, 400);

  try {
    await aggiornaTimezone();
  } catch {
    // fuso di fallback
  }

  const riga: Record<string, unknown> = {
    subject,
    message,
    image_url: String(body.image_url ?? "").trim() || null,
    btn_label: String(body.btn_label ?? "").trim() || null,
    btn_url: String(body.btn_url ?? "").trim() || null,
    btn2_label: String(body.btn2_label ?? "").trim() || null,
    btn2_url: String(body.btn2_url ?? "").trim() || null,
    segment,
    recur_heure: heure,
    active: true,
    draft: false,
  };

  const sendDate = String(body.send_date ?? "").trim();
  const recur = String(body.recur ?? "").trim();
  if (sendDate) {
    // Una tantum: data+ora locali del ristorante → UTC
    if (!RE_DATA.test(sendDate)) return json({ error: "Date invalide" }, 400);
    const dt = DateTime.fromISO(`${sendDate}T${String(heure).padStart(2, "0")}:00:00`, { zone: TIMEZONE });
    if (!dt.isValid) return json({ error: "Date invalide" }, 400);
    if (dt <= DateTime.now()) return json({ error: "Cette date est déjà passée" }, 400);
    riga.send_at = dt.toUTC().toISO();
  } else if (recur === "weekly") {
    const dow = Math.round(Number(body.recur_dow));
    if (!Number.isFinite(dow) || dow < 1 || dow > 7) return json({ error: "Jour de la semaine invalide" }, 400);
    riga.recur = "weekly";
    riga.recur_dow = dow;
  } else if (recur === "monthly") {
    const day = Math.round(Number(body.recur_day));
    if (!Number.isFinite(day) || day < 1 || day > 28) return json({ error: "Jour du mois invalide (1-28)" }, 400);
    riga.recur = "monthly";
    riga.recur_day = day;
  } else {
    return json({ error: "Programmation invalide" }, 400);
  }

  const { data, error } = await supabaseAdmin.from("newsletter_schedule").insert(riga).select(SELECT).single();
  if (error || !data) {
    return json({ error: "Création impossible — migration supabase/newsletter_schedule.sql à lancer ?" }, 500);
  }
  return json({ schedule: data }, 201);
};

export const DELETE: APIRoute = async ({ request, url }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();

  const id = url.searchParams.get("id") ?? "";
  if (!RE_UUID.test(id)) return json({ error: "Id invalide" }, 400);

  const { error } = await supabaseAdmin.from("newsletter_schedule").delete().eq("id", id);
  if (error) return json({ error: "Suppression impossible" }, 500);
  return json({ ok: true });
};
