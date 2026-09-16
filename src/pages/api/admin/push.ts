import type { APIRoute } from "astro";
import { supabaseAdmin } from "../../../lib/db";
import { verificaStaff, nonAutorizzato } from "../../../lib/admin/adminAuth";
import { inviaPushConDettagli, type PushDettaglio } from "../../../lib/push";
import { ambitoDiRichiesta, cancella } from "../../../lib/admin/sede";
import { sedeDaScrivere } from "../../../lib/admin/sedeRegole";
import { adminLang } from "../../../lib/admin/adminLang";
import type { AdminLang } from "../../../i18n/admin";

// Corpo della notifica di TEST nella lingua admin (fallback FR).
const TEST_BODY: Record<AdminLang, string> = {
  fr: "Les notifications fonctionnent \u2713",
  en: "Notifications are working \u2713",
  it: "Le notifiche funzionano \u2713",
  nl: "Meldingen werken \u2713",
  es: "Las notificaciones funcionan \u2713",
};

export const prerender = false;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

// POST { subscription } -> salva l'iscrizione del device.
// POST { test: true }   -> invia una notifica di prova a tutti i device iscritti.
export const POST: APIRoute = async ({ request }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();
  let body: { subscription?: { endpoint?: string; keys?: { p256dh?: string; auth?: string } }; test?: boolean };
  try {
    body = await request.json();
  } catch {
    return json({ error: "Requête invalide" }, 400);
  }
  if (body.test) {
    const lang = await adminLang();
    const r = await inviaPushConDettagli({ title: "MOODD", body: TEST_BODY[lang] ?? TEST_BODY.fr, url: "/admin" }, await ambitoDiRichiesta(request, staff));
    // Riepilogo per tipo di dispositivo (aiuta a capire se l'iPhone è iscritto).
    const tipo = (d: PushDettaglio): string => {
      const h = d.host.toLowerCase();
      if (h.includes("apple")) return "iPhone";
      if (h.includes("fcm") || h.includes("google")) return "Android/Chrome";
      if (h.includes("mozilla")) return "Firefox";
      return h || "?";
    };
    const per: Record<string, { ok: number; ko: number; codes: number[] }> = {};
    for (const d of r.dettagli) {
      const k = tipo(d);
      per[k] ??= { ok: 0, ko: 0, codes: [] };
      if (d.ok) per[k].ok++;
      else { per[k].ko++; if (d.code) per[k].codes.push(d.code); }
    }
    const riassunto = Object.entries(per)
      .map(([k, v]) => `${k}: ${v.ok} OK${v.ko ? ` · ${v.ko} KO${v.codes.length ? " (" + v.codes.join(",") + ")" : ""}` : ""}`)
      .join(" · ") || "nessun dispositivo iscritto";
    return json({ ok: true, sent: r.sent, found: r.found, puliti: r.puliti, riassunto, dettagli: r.dettagli });
  }
  const sub = body.subscription;
  if (!sub?.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) {
    return json({ error: "Subscription invalide" }, 400);
  }
  const email = (staff as { email?: string }).email ?? null;
  // ⚠️ `onConflict` resta su `endpoint` da solo, NON su (location_id, endpoint):
  // l'endpoint e' gia' unico al mondo (lo assegna il browser) e non esiste un
  // indice a due colonne — `salva()` ne costruirebbe uno che il database non
  // ha, e il salvataggio morirebbe. Un telefono ha UNA iscrizione: se il
  // responsabile cambia punto e si riscrive, la riga si sposta con lui.
  const location_id = sedeDaScrivere("push_subscriptions", await ambitoDiRichiesta(request, staff));
  const { error } = await supabaseAdmin
    .from("push_subscriptions")
    .upsert({ endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth, user_email: email, ...(location_id ? { location_id } : {}) }, { onConflict: "endpoint" });
  if (error) return json({ error: "Enregistrement impossible" }, 500);
  return json({ ok: true });
};

// DELETE ?endpoint=  -> disattiva (rimuove) l'iscrizione di questo device.
export const DELETE: APIRoute = async ({ request, url }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();
  const endpoint = url.searchParams.get("endpoint") ?? "";
  if (endpoint) {
    // Filtrato: un endpoint di un altro punto non si cancella da qui.
    try { await cancella("push_subscriptions", await ambitoDiRichiesta(request, staff)).eq("endpoint", endpoint); } catch { /* best-effort */ }
  }
  return json({ ok: true });
};
