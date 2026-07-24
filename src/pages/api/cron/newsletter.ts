import type { APIRoute } from "astro";
import { DateTime } from "luxon";
import { supabaseAdmin } from "../../../lib/db";
import { TIMEZONE, aggiornaTimezone } from "../../../lib/slots";
import { inviaNewsletter, parseSegment } from "../../../lib/newsletterSend";

export const prerender = false;

// GET /api/cron/newsletter — chiamato OGNI ORA da pg_cron (come daily-brief).
// Protetto da CRON_SECRET. Invia le newsletter PROGRAMMATE (#39):
// - una tantum : send_at raggiunto → invia e disattiva la riga
// - weekly     : giorno della settimana + ora locale combaciano
// - monthly    : giorno del mese + ora locale combaciano
// Anti-doppione: mai due invii della stessa riga nello stesso giorno locale.
// Quota esaurita: la riga resta attiva e riproverà (una tantum: ogni ora;
// ricorrenti: alla prossima occorrenza).

const CRON_SECRET = import.meta.env.CRON_SECRET;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

interface Riga {
  id: string;
  subject: string;
  message: string;
  image_url: string | null;
  btn_label: string | null;
  btn_url: string | null;
  btn2_label: string | null;
  btn2_url: string | null;
  segment: string;
  send_at: string | null;
  recur: string | null;
  recur_dow: number | null;
  recur_day: number | null;
  recur_heure: number | null;
  last_sent_at: string | null;
}

export const GET: APIRoute = async ({ request, url }) => {
  if (!CRON_SECRET) return json({ error: "CRON_SECRET non configurato" }, 503);
  const chiave = request.headers.get("x-cron-key") ?? url.searchParams.get("key") ?? "";
  if (chiave !== CRON_SECRET) return json({ error: "Non autorisé" }, 401);

  try {
    await aggiornaTimezone();
  } catch {
    // fuso di fallback
  }

  const { data, error } = await supabaseAdmin
    .from("newsletter_schedule")
    .select("*")
    .eq("active", true);
  if (error) return json({ checked: 0, reason: "migration #39 non lanciata?" });

  const ora = DateTime.now().setZone(TIMEZONE);
  const results: { id: string; sent?: number; error?: string }[] = [];

  for (const r of (data ?? []) as Riga[]) {
    let due = false;
    if (r.send_at && !r.recur) {
      due = DateTime.fromISO(r.send_at) <= DateTime.now();
    } else if (r.recur === "weekly") {
      due = ora.weekday === (r.recur_dow ?? -1) && ora.hour === (r.recur_heure ?? -1);
    } else if (r.recur === "monthly") {
      due = ora.day === (r.recur_day ?? -1) && ora.hour === (r.recur_heure ?? -1);
    }
    if (!due) continue;

    // Anti-doppione: già inviata oggi (giorno locale del ristorante)
    if (r.last_sent_at) {
      const ultima = DateTime.fromISO(r.last_sent_at).setZone(TIMEZONE);
      if (ultima.hasSame(ora, "day")) continue;
    }

    const esito = await inviaNewsletter(
      {
        subject: r.subject,
        message: r.message,
        image_url: r.image_url ?? "",
        btn_label: r.btn_label ?? "",
        btn_url: r.btn_url ?? "",
        btn2_label: r.btn2_label ?? "",
        btn2_url: r.btn2_url ?? "",
      },
      parseSegment(r.segment ?? "tous:tous").lang,
      parseSegment(r.segment ?? "tous:tous").group
    );

    if (esito.ok) {
      await supabaseAdmin
        .from("newsletter_schedule")
        .update({ last_sent_at: new Date().toISOString(), ...(r.recur ? {} : { active: false }) })
        .eq("id", r.id);
      results.push({ id: r.id, sent: esito.sent });
    } else {
      // Quota/errore: la riga resta attiva, si riproverà
      results.push({ id: r.id, error: esito.error });
    }
  }

  return json({ checked: (data ?? []).length, results });
};
