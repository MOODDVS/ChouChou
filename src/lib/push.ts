import webpush from "web-push";
import { supabaseAdmin } from "./db";

// VAPID dalle env (lazy: nessun throw all'import se mancano -> push semplicemente saltati).
const PUB = import.meta.env.PUBLIC_VAPID_KEY ?? process.env.PUBLIC_VAPID_KEY ?? "";
const PRIV = import.meta.env.VAPID_PRIVATE_KEY ?? process.env.VAPID_PRIVATE_KEY ?? "";
const SUBJ = import.meta.env.VAPID_SUBJECT ?? process.env.VAPID_SUBJECT ?? "mailto:admin@moodd.online";

let pronto = false;
function configura(): boolean {
  if (!PUB || !PRIV) return false;
  if (!pronto) { webpush.setVapidDetails(SUBJ, PUB, PRIV); pronto = true; }
  return true;
}

export interface PushMsg {
  title: string;
  body: string;
  url?: string;
  tag?: string;
}

// Invia una notifica a TUTTE le iscrizioni. Ritorna quante ne sono partite.
// Ripulisce le subscription scadute (404/410). Best-effort: non lancia mai.
export interface PushEsito { sent: number; found: number; errors: string[] }

export async function inviaPush(msg: PushMsg): Promise<PushEsito> {
  const errors: string[] = [];
  if (!configura()) {
    console.warn("VAPID non configurato: salto le notifiche push");
    return { sent: 0, found: 0, errors: ["VAPID non configuré"] };
  }
  const { data, error } = await supabaseAdmin
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth");
  if (error) return { sent: 0, found: 0, errors: ["DB: " + error.message] };
  const subs = (data ?? []) as { id: string; endpoint: string; p256dh: string; auth: string }[];
  const payload = JSON.stringify(msg);
  const morti: string[] = [];
  let inviati = 0;
  await Promise.allSettled(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          payload
        );
        inviati++;
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode;
        const bd = (e as { body?: string }).body;
        console.error("[push] send error", code, bd, e);
        errors.push("HTTP " + (code ?? "?") + (bd ? " " + String(bd).slice(0, 120) : ""));
        if (code === 404 || code === 410) morti.push(s.id);
      }
    })
  );
  if (morti.length) {
    try { await supabaseAdmin.from("push_subscriptions").delete().in("id", morti); } catch { /* best-effort */ }
  }
  return { sent: inviati, found: subs.length, errors };
}
