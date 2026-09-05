import webpush from "web-push";
import { supabaseAdmin } from "./db";
import { adminLang } from "./admin/adminLang";
import type { AdminLang } from "../i18n/admin";

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

// ---- Helper ad alto livello: notifiche pronte per gli eventi dell'admin ----
// Le notifiche vanno al RISTORATORE → testo nella LINGUA DELL'ADMIN
// (app_config admin_lang, 5 lingue, fallback FR). adminLang() è in cache.

interface TradPush {
  client: string;
  pers: string;
  resaNew: string;
  resaDemande: string;
  resaModif: string;
  resaAnnul: string;
  ordre: string;
  avisNew: string;
  avisMulti: string;
  avisMultiBody: (n: number) => string;
  msg: string;
}

const TRAD_PUSH: Record<AdminLang, TradPush> = {
  fr: { client: "Client", pers: "pers.", resaNew: "Nouvelle réservation", resaDemande: "Nouvelle demande de réservation", resaModif: "Réservation modifiée", resaAnnul: "Réservation annulée", ordre: "Nouvelle commande", avisNew: "Nouvel avis Google", avisMulti: "Nouveaux avis Google", avisMultiBody: (n) => `${n} nouveaux avis à découvrir`, msg: "Nouveau message" },
  en: { client: "Customer", pers: "guests", resaNew: "New reservation", resaDemande: "New reservation request", resaModif: "Reservation modified", resaAnnul: "Reservation cancelled", ordre: "New order", avisNew: "New Google review", avisMulti: "New Google reviews", avisMultiBody: (n) => `${n} new reviews to discover`, msg: "New message" },
  it: { client: "Cliente", pers: "pers.", resaNew: "Nuova prenotazione", resaDemande: "Nuova richiesta di prenotazione", resaModif: "Prenotazione modificata", resaAnnul: "Prenotazione annullata", ordre: "Nuovo ordine", avisNew: "Nuova recensione Google", avisMulti: "Nuove recensioni Google", avisMultiBody: (n) => `${n} nuove recensioni da scoprire`, msg: "Nuovo messaggio" },
  nl: { client: "Klant", pers: "pers.", resaNew: "Nieuwe reservering", resaDemande: "Nieuwe reserveringsaanvraag", resaModif: "Reservering gewijzigd", resaAnnul: "Reservering geannuleerd", ordre: "Nieuwe bestelling", avisNew: "Nieuwe Google-review", avisMulti: "Nieuwe Google-reviews", avisMultiBody: (n) => `${n} nieuwe reviews te ontdekken`, msg: "Nieuw bericht" },
  es: { client: "Cliente", pers: "pers.", resaNew: "Nueva reserva", resaDemande: "Nueva solicitud de reserva", resaModif: "Reserva modificada", resaAnnul: "Reserva anulada", ordre: "Nuevo pedido", avisNew: "Nueva reseña de Google", avisMulti: "Nuevas reseñas de Google", avisMultiBody: (n) => `${n} nuevas reseñas por descubrir`, msg: "Nuevo mensaje" },
};

/** Testi delle notifiche nella lingua admin (fallback FR, mai lancia). */
async function tradPush(): Promise<TradPush> {
  try { return TRAD_PUSH[await adminLang()] ?? TRAD_PUSH.fr; } catch { return TRAD_PUSH.fr; }
}

export interface ResaPushInfo {
  first_name: string;
  last_name: string;
  people: number;
  date: string; // YYYY-MM-DD
  heure: string; // HH:MM
}

// kind: "new" (confermata) | "demande" (in attesa) | "modif" | "annul"
export async function inviaPushResa(kind: "new" | "demande" | "modif" | "annul", r: ResaPushInfo): Promise<PushEsito> {
  const L = await tradPush();
  const parti = String(r.date ?? "").split("-");
  const quando = parti.length === 3 ? `${parti[2]}/${parti[1]}` : String(r.date ?? "");
  const nome = `${r.first_name ?? ""} ${r.last_name ?? ""}`.trim() || L.client;
  const body = `${nome} · ${r.people} ${L.pers} · ${quando} ${r.heure ?? ""}`.trim();
  const title =
    kind === "new" ? L.resaNew :
    kind === "demande" ? L.resaDemande :
    kind === "modif" ? L.resaModif :
    L.resaAnnul;
  return inviaPush({ title, body, url: "/admin/reservations" });
}

export interface OrdinePushInfo {
  numero: string;
  customer_name: string;
  total_cents: number;
}

export async function inviaPushOrdine(o: OrdinePushInfo): Promise<PushEsito> {
  const L = await tradPush();
  const nome = String(o.customer_name ?? "").trim() || L.client;
  const tot = (Number(o.total_cents ?? 0) / 100).toFixed(2).replace(".", ",");
  const body = `${nome} · ${tot} € · #${o.numero}`;
  return inviaPush({ title: L.ordre, body, url: "/admin/orders" });
}


export interface RecensionePushInfo {
  author: string;
  rating: number; // 1..5
  count: number;  // quante nuove recensioni in questo sync
}

/** Notifica all'admin: nuova/e recensione/i Google. */
export async function inviaPushRecensione(info: RecensionePushInfo): Promise<PushEsito> {
  const L = await tradPush();
  const n = Math.max(1, Number(info.count) || 1);
  if (n > 1) {
    return inviaPush({
      title: L.avisMulti,
      body: L.avisMultiBody(n),
      url: "/admin/google",
      tag: "google-review",
    });
  }
  const r = Math.max(0, Math.min(5, Math.round(Number(info.rating) || 0)));
  const stelle = "★".repeat(r) + "☆".repeat(5 - r);
  const nome = String(info.author ?? "").trim() || L.client;
  return inviaPush({
    title: L.avisNew,
    body: `${stelle} · ${nome}`,
    url: "/admin/google",
    tag: "google-review",
  });
}

export interface ContattoPushInfo {
  nome: string;
  oggetto?: string;
  messaggio?: string;
}

/** Notifica all'admin: qualcuno ha scritto dal form di contatto del sito. */
export async function inviaPushContatto(info: ContattoPushInfo): Promise<PushEsito> {
  const L = await tradPush();
  const nome = String(info.nome ?? "").trim().slice(0, 60) || L.client;
  const extra = (String(info.oggetto ?? "").trim() || String(info.messaggio ?? "").trim()).slice(0, 80);
  const body = extra ? `${nome} · ${extra}` : nome;
  return inviaPush({ title: L.msg, body, url: "/admin", tag: "contact" });
}

export interface PushDettaglio { host: string; ok: boolean; code?: number }

/**
 * Come inviaPush ma ritorna il DETTAGLIO per iscrizione (host + esito):
 * serve al bottone "Test" per capire a colpo d'occhio quali dispositivi
 * (iPhone/Apple, Android/Chrome, Firefox) sono iscritti e se la push è
 * partita. Ripulisce comunque le iscrizioni morte (404/410).
 */
export async function inviaPushConDettagli(
  msg: PushMsg,
): Promise<{ sent: number; found: number; puliti: number; dettagli: PushDettaglio[] }> {
  if (!configura()) return { sent: 0, found: 0, puliti: 0, dettagli: [] };
  const { data, error } = await supabaseAdmin
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth");
  if (error) return { sent: 0, found: 0, puliti: 0, dettagli: [] };
  const subs = (data ?? []) as { id: string; endpoint: string; p256dh: string; auth: string }[];
  const payload = JSON.stringify(msg);
  const dettagli: PushDettaglio[] = [];
  const morti: string[] = [];
  let sent = 0;
  await Promise.allSettled(
    subs.map(async (s) => {
      let host = "";
      try { host = new URL(s.endpoint).host; } catch { host = "?"; }
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload);
        sent++;
        dettagli.push({ host, ok: true });
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode;
        dettagli.push({ host, ok: false, code });
        if (code === 404 || code === 410) morti.push(s.id);
      }
    }),
  );
  if (morti.length) {
    try { await supabaseAdmin.from("push_subscriptions").delete().in("id", morti); } catch { /* best-effort */ }
  }
  return { sent, found: subs.length, puliti: morti.length, dettagli };
}
