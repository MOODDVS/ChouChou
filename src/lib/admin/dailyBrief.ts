import { Resend } from "resend";
import { DateTime } from "luxon";
import { supabaseAdmin } from "../db";
import { CLIENT } from "../../config/client";
import { nomeServizio } from "../reservationI18n";
import { adminLang } from "./adminLang";
import type { AdminLang } from "../../i18n/admin";
import { caricaToday } from "./caricaToday";
import { TIMEZONE, aggiornaTimezone } from "../slots";
import { temaEmail, type TemaEmail } from "../temaBrand";
import { datiRistorante } from "../ristorante";

// Email quotidiana "Votre journée" (récap di ieri + programma di oggi).
// Chiamata dall'endpoint /api/cron/daily-brief (protetto da CRON_SECRET),
// che uno scheduler esterno invoca OGNI ORA: è questa funzione a decidere
// se è il momento di inviare (toggle attivo, ora raggiunta, non ancora
// inviata oggi — chiave app_config `daily_brief_last_sent`).

const RESEND_API_KEY = import.meta.env.RESEND_API_KEY;
const RESEND_FROM = import.meta.env.RESEND_FROM;
const SITE_URL = (import.meta.env.PUBLIC_SITE_URL ?? "").replace(/\/$/, "");
const LOGO_URL = `${SITE_URL}/icon-512.png`;
const resend = RESEND_API_KEY ? new Resend(RESEND_API_KEY) : null;

const esc = (t: unknown): string =>
  String(t ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const euro = (cents: number): string =>
  (cents / 100).toLocaleString("fr-BE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
const cap = (t: string): string => (t ? t.charAt(0).toUpperCase() + t.slice(1) : t);

// ---------------------------------------------------------------- eventi BE
function pasqua(anno: number): Date {
  const a = anno % 19, b = Math.floor(anno / 100), c = anno % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mese = Math.floor((h + l - 7 * m + 114) / 31);
  const giorno = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(anno, mese - 1, giorno);
}
function isoData(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function nDomenica(anno: number, mese0: number, n: number): Date {
  const primo = new Date(anno, mese0, 1);
  return new Date(anno, mese0, 1 + ((7 - primo.getDay()) % 7) + (n - 1) * 7);
}
function eventiAnno(anno: number): [string, string][] {
  const P = pasqua(anno);
  const piu = (gg: number) => new Date(P.getFullYear(), P.getMonth(), P.getDate() + gg);
  const ev: [Date, string][] = [
    [new Date(anno, 0, 1), "Nouvel An"],
    [new Date(anno, 1, 14), "Saint-Valentin"],
    [piu(-47), "Mardi Gras"],
    [P, "Pâques"],
    [piu(1), "Lundi de Pâques"],
    [new Date(anno, 4, 1), "Fête du Travail"],
    [nDomenica(anno, 4, 2), "Fête des Mères"],
    [piu(39), "Ascension"],
    [piu(49), "Pentecôte"],
    [piu(50), "Lundi de Pentecôte"],
    [nDomenica(anno, 5, 2), "Fête des Pères"],
    [new Date(anno, 6, 21), "Fête nationale belge"],
    [new Date(anno, 7, 15), "Assomption"],
    [new Date(anno, 9, 31), "Halloween"],
    [new Date(anno, 10, 1), "Toussaint"],
    [new Date(anno, 10, 11), "Armistice"],
    [new Date(anno, 11, 6), "Saint-Nicolas"],
    [new Date(anno, 11, 24), "Réveillon de Noël"],
    [new Date(anno, 11, 25), "Noël"],
    [new Date(anno, 11, 31), "Réveillon du Nouvel An"],
  ];
  return ev.map(([d, n]) => [isoData(d), n]);
}

// ---------------------------------------------------------------- helpers
async function config(chiavi: string[]): Promise<Map<string, string>> {
  const { data } = await supabaseAdmin.from("app_config").select("key, value").in("key", chiavi);
  return new Map((data ?? []).map((r) => [r.key, r.value ?? ""]));
}

/**
 * Testi del récap quotidiano nella lingua ADMIN. Il brief lo legge il
 * ristoratore: come il ticket cucina e le notifiche prenotazione, segue
 * `admin_lang`, mai la lingua del cliente.
 */
type BTxt = {
  titre: string; lead: string;
  hier: (d: string) => string; aujourdhui: (d: string) => string;
  commandes: string; reservations: string;
  encaisses: (v: string) => string; couvertsServis: (n: number) => string;
  noshow: string; annulees: string; nouveauxClients: string; top3: string;
  couverts: (n: number) => string; tables: (n: number) => string;
  grandesTables: string;
  fermeAuj: string; reouverture: (q: string, h: string) => string;
  motAujourdhui: string; motDemain: string; dansNGiorni: (n: number, d: string) => string;
  couvertsReserves: string; resaConfirmees: (n: number) => string;
  notesEquipe: string; tags: Record<string, string>;
  aVenir: string; evento: (nome: string, quando: string) => string;
  ouvrirAdmin: string; footer: (ora: string) => string; subject: (d: string) => string;
};
const B_TXT: Record<AdminLang, BTxt> = {
  fr: {
    titre: "Votre journée", lead: "Bonjour ! Voici le récap d'hier et le programme d'aujourd'hui.",
    hier: (d) => `Hier — ${d}`, aujourdhui: (d) => `Aujourd'hui — ${d}`,
    commandes: "Commandes", reservations: "Réservations",
    encaisses: (v) => `${v} encaissés`, couvertsServis: (n) => `${n} couvert${n > 1 ? "s" : ""} servi${n > 1 ? "s" : ""}`,
    noshow: "No-show", annulees: "Annulées", nouveauxClients: "Nouveaux clients", top3: "Top 3 des plats",
    couverts: (n) => `${n} couvert${n > 1 ? "s" : ""}`, tables: (n) => `${n} table${n > 1 ? "s" : ""}`,
    grandesTables: "Grandes tables (≥ 6 pers.)",
    fermeAuj: "Fermé aujourd'hui", reouverture: (q, h) => `Réouverture ${q} à ${h}.`,
    motAujourdhui: "aujourd'hui", motDemain: "demain", dansNGiorni: (n, d) => `dans ${n} jours (${d})`,
    couvertsReserves: "Couverts réservés", resaConfirmees: (n) => `${n} réservation${n > 1 ? "s" : ""} confirmée${n > 1 ? "s" : ""}`,
    notesEquipe: "✏️ Notes de l'équipe", tags: { important: "IMPORTANT", recurrent: "RÉCURRENT", fournisseur: "FOURNISSEUR" },
    aVenir: "📅 À VENIR", evento: (n, q) => `${n} ${q} — pensez au menu spécial et à l'équipe en salle.`,
    ouvrirAdmin: "Ouvrir l'admin", footer: (o) => `Récap automatique quotidien (${o}) — désactivable dans Admin → Notifications.`,
    subject: (d) => `Votre journée — ${d}`,
  },
  en: {
    titre: "Your day", lead: "Hello! Here is yesterday's recap and today's programme.",
    hier: (d) => `Yesterday — ${d}`, aujourdhui: (d) => `Today — ${d}`,
    commandes: "Orders", reservations: "Reservations",
    encaisses: (v) => `${v} taken`, couvertsServis: (n) => `${n} guest${n > 1 ? "s" : ""} served`,
    noshow: "No-show", annulees: "Cancelled", nouveauxClients: "New customers", top3: "Top 3 dishes",
    couverts: (n) => `${n} guest${n > 1 ? "s" : ""}`, tables: (n) => `${n} table${n > 1 ? "s" : ""}`,
    grandesTables: "Large tables (≥ 6 guests)",
    fermeAuj: "Closed today", reouverture: (q, h) => `Reopening ${q} at ${h}.`,
    motAujourdhui: "today", motDemain: "tomorrow", dansNGiorni: (n, d) => `in ${n} days (${d})`,
    couvertsReserves: "Booked guests", resaConfirmees: (n) => `${n} confirmed reservation${n > 1 ? "s" : ""}`,
    notesEquipe: "✏️ Team notes", tags: { important: "IMPORTANT", recurrent: "RECURRING", fournisseur: "SUPPLIER" },
    aVenir: "📅 COMING UP", evento: (n, q) => `${n} ${q} — think about the special menu and the floor team.`,
    ouvrirAdmin: "Open the admin", footer: (o) => `Automatic daily recap (${o}) — can be turned off in Admin → Notifications.`,
    subject: (d) => `Your day — ${d}`,
  },
  it: {
    titre: "La tua giornata", lead: "Buongiorno! Ecco il riepilogo di ieri e il programma di oggi.",
    hier: (d) => `Ieri — ${d}`, aujourdhui: (d) => `Oggi — ${d}`,
    commandes: "Ordini", reservations: "Prenotazioni",
    encaisses: (v) => `${v} incassati`, couvertsServis: (n) => `${n} copert${n > 1 ? "i" : "o"} servit${n > 1 ? "i" : "o"}`,
    noshow: "No-show", annulees: "Annullate", nouveauxClients: "Nuovi clienti", top3: "Top 3 dei piatti",
    couverts: (n) => `${n} copert${n > 1 ? "i" : "o"}`, tables: (n) => `${n} tavol${n > 1 ? "i" : "o"}`,
    grandesTables: "Tavoli grandi (≥ 6 pers.)",
    fermeAuj: "Chiuso oggi", reouverture: (q, h) => `Riapertura ${q} alle ${h}.`,
    motAujourdhui: "oggi", motDemain: "domani", dansNGiorni: (n, d) => `tra ${n} giorni (${d})`,
    couvertsReserves: "Coperti prenotati", resaConfirmees: (n) => `${n} prenotazion${n > 1 ? "i" : "e"} confermat${n > 1 ? "e" : "a"}`,
    notesEquipe: "✏️ Note del team", tags: { important: "IMPORTANTE", recurrent: "RICORRENTE", fournisseur: "FORNITORE" },
    aVenir: "📅 IN ARRIVO", evento: (n, q) => `${n} ${q} — pensa al menu speciale e alla squadra in sala.`,
    ouvrirAdmin: "Apri l'admin", footer: (o) => `Riepilogo automatico quotidiano (${o}) — disattivabile in Admin → Notifiche.`,
    subject: (d) => `La tua giornata — ${d}`,
  },
  nl: {
    titre: "Jouw dag", lead: "Goedemorgen! Dit is het overzicht van gisteren en het programma van vandaag.",
    hier: (d) => `Gisteren — ${d}`, aujourdhui: (d) => `Vandaag — ${d}`,
    commandes: "Bestellingen", reservations: "Reserveringen",
    encaisses: (v) => `${v} ontvangen`, couvertsServis: (n) => `${n} gast${n > 1 ? "en" : ""} bediend`,
    noshow: "No-show", annulees: "Geannuleerd", nouveauxClients: "Nieuwe klanten", top3: "Top 3 gerechten",
    couverts: (n) => `${n} gast${n > 1 ? "en" : ""}`, tables: (n) => `${n} tafel${n > 1 ? "s" : ""}`,
    grandesTables: "Grote tafels (≥ 6 pers.)",
    fermeAuj: "Vandaag gesloten", reouverture: (q, h) => `Heropening ${q} om ${h}.`,
    motAujourdhui: "vandaag", motDemain: "morgen", dansNGiorni: (n, d) => `over ${n} dagen (${d})`,
    couvertsReserves: "Gereserveerde gasten", resaConfirmees: (n) => `${n} bevestigde reservering${n > 1 ? "en" : ""}`,
    notesEquipe: "✏️ Notities van het team", tags: { important: "BELANGRIJK", recurrent: "TERUGKEREND", fournisseur: "LEVERANCIER" },
    aVenir: "📅 BINNENKORT", evento: (n, q) => `${n} ${q} — denk aan het speciale menu en aan het zaalteam.`,
    ouvrirAdmin: "Open de admin", footer: (o) => `Automatisch dagoverzicht (${o}) — uit te schakelen in Admin → Meldingen.`,
    subject: (d) => `Jouw dag — ${d}`,
  },
  es: {
    titre: "Tu jornada", lead: "¡Buenos días! Aquí tienes el resumen de ayer y el programa de hoy.",
    hier: (d) => `Ayer — ${d}`, aujourdhui: (d) => `Hoy — ${d}`,
    commandes: "Pedidos", reservations: "Reservas",
    encaisses: (v) => `${v} ingresados`, couvertsServis: (n) => `${n} comensal${n > 1 ? "es" : ""} servido${n > 1 ? "s" : ""}`,
    noshow: "No-show", annulees: "Anuladas", nouveauxClients: "Nuevos clientes", top3: "Top 3 de los platos",
    couverts: (n) => `${n} comensal${n > 1 ? "es" : ""}`, tables: (n) => `${n} mesa${n > 1 ? "s" : ""}`,
    grandesTables: "Mesas grandes (≥ 6 pers.)",
    fermeAuj: "Cerrado hoy", reouverture: (q, h) => `Reapertura ${q} a las ${h}.`,
    motAujourdhui: "hoy", motDemain: "mañana", dansNGiorni: (n, d) => `dentro de ${n} días (${d})`,
    couvertsReserves: "Comensales reservados", resaConfirmees: (n) => `${n} reserva${n > 1 ? "s" : ""} confirmada${n > 1 ? "s" : ""}`,
    notesEquipe: "✏️ Notas del equipo", tags: { important: "IMPORTANTE", recurrent: "RECURRENTE", fournisseur: "PROVEEDOR" },
    aVenir: "📅 PRÓXIMAMENTE", evento: (n, q) => `${n} ${q} — piensa en el menú especial y en el equipo de sala.`,
    ouvrirAdmin: "Abrir el admin", footer: (o) => `Resumen automático diario (${o}) — se puede desactivar en Admin → Notificaciones.`,
    subject: (d) => `Tu jornada — ${d}`,
  },
};
const LOC_BRIEF: Record<AdminLang, string> = { fr: "fr-BE", en: "en-GB", it: "it-IT", nl: "nl-BE", es: "es-ES" };

function rigaTab(tema: TemaEmail, label: string, valore: string, ultima = false, rosso = false): string {
  const bordo = ultima ? "" : `border-bottom:1px solid ${tema.border};`;
  const danger = tema.isDark ? "#ff8a8f" : "#c0392b";
  const colore = rosso ? `color:${danger};font-weight:bold;` : `color:${tema.title};`;
  return `<tr><td style="padding:12px 20px;${bordo}color:${tema.muted};font-size:12px;letter-spacing:1px;text-transform:uppercase;vertical-align:top;">${label}</td><td style="padding:12px 20px;${bordo}${colore}font-size:14px;text-align:right;line-height:1.8;">${valore}</td></tr>`;
}

function intestazione(tema: TemaEmail, testo: string): string {
  return `<tr><td style="padding:34px 40px 8px;"><p style="margin:0;color:${tema.title};font-size:12px;letter-spacing:2px;text-transform:uppercase;border-bottom:1px solid ${tema.border};padding-bottom:10px;text-align:center;">${testo}</p></td></tr>`;
}

// ---------------------------------------------------------------- invio
export async function eseguiDailyBrief(force = false): Promise<{ sent: boolean; reason: string }> {
  await aggiornaTimezone();
  const ora = DateTime.now().setZone(TIMEZONE);
  const oggiISO = ora.toISODate() ?? "";
  const ieri = ora.minus({ days: 1 });
  const ieriISO = ieri.toISODate() ?? "";

  const cfg = await config([
    "daily_brief_enabled",
    "daily_brief_hour",
    "daily_brief_email",
    "daily_brief_last_sent",
    "reservation_notify_email",
    "reservation_services",
    "admin_pages_hidden",
  ]);

  if (cfg.get("daily_brief_enabled") !== "1") return { sent: false, reason: "disattivata" };
  const oraInvio = cfg.get("daily_brief_hour") || "09:00";
  if (!force) {
    if (ora.toFormat("HH:mm") < oraInvio) return { sent: false, reason: "troppo presto (invio " + oraInvio + ")" };
    if (cfg.get("daily_brief_last_sent") === oggiISO) return { sent: false, reason: "già inviata oggi" };
  }

  const dest = (cfg.get("daily_brief_email") || cfg.get("reservation_notify_email") || "").trim();
  if (!dest) return { sent: false, reason: "nessun destinatario configurato" };
  if (!resend || !RESEND_FROM) return { sent: false, reason: "Resend non configurato" };

  // ---------------- dati IERI ----------------
  const daIeri = ieri.startOf("day").toUTC().toISO() ?? "";
  const aIeri = ieri.endOf("day").toUTC().toISO() ?? "";

  const [ordIeriRes, resaIeriRes, clientiIeriRes, notesRes, today] = await Promise.all([
    supabaseAdmin
      .from("orders")
      .select("total_cents, items")
      .in("status", ["paid", "done"])
      .gte("pickup_time", daIeri)
      .lte("pickup_time", aIeri),
    supabaseAdmin
      .from("reservations")
      .select("status, people, heure, first_name, last_name")
      .eq("date", ieriISO),
    supabaseAdmin.from("clients").select("id").gte("created_at", daIeri).lte("created_at", aIeri),
    supabaseAdmin
      .from("admin_notes")
      .select("content, tags, done")
      .eq("done", false)
      .order("created_at", { ascending: false })
      .limit(6)
      .then((r) =>
        r.error && String(r.error.message ?? "").includes("tags")
          ? supabaseAdmin
              .from("admin_notes")
              .select("content, done")
              .eq("done", false)
              .order("created_at", { ascending: false })
              .limit(6)
          : r
      ),
    caricaToday(),
  ]);

  const ordIeri = (ordIeriRes.data ?? []) as { total_cents: number | null; items: unknown }[];
  const incassoIeri = ordIeri.reduce((t, o) => t + (o.total_cents ?? 0), 0);
  const piatti = new Map<string, number>();
  for (const o of ordIeri) {
    for (const it of Array.isArray(o.items) ? (o.items as { name?: unknown; qty?: unknown }[]) : []) {
      const nome = String(it.name ?? "").trim();
      if (nome) piatti.set(nome, (piatti.get(nome) ?? 0) + Math.max(1, Math.floor(Number(it.qty)) || 1));
    }
  }
  const top3 = [...piatti.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);

  type Resa = { status: string | null; people: number | null; heure: string | null; first_name: string | null; last_name: string | null };
  const resaIeri = (resaIeriRes.data ?? []) as Resa[];
  const servite = resaIeri.filter((r) => r.status === "done");
  const couvertsIeri = servite.reduce((t, r) => t + (r.people ?? 0), 0);
  const noshowIeri = resaIeri.filter((r) => r.status === "noshow");
  const annullateIeri = resaIeri.filter((r) => r.status === "cancelled").length;
  const nuoviClienti = (clientiIeriRes.data ?? []).length;

  // ---------------- dati OGGI ----------------
  const { data: resaOggiData } = await supabaseAdmin
    .from("reservations")
    .select("status, people, heure, service_key, first_name, last_name")
    .eq("date", oggiISO)
    .in("status", ["confirmed", "seated"]);
  const resaOggi = (resaOggiData ?? []) as (Resa & { service_key: string | null })[];
  const couvertsOggi = resaOggi.reduce((t, r) => t + (r.people ?? 0), 0);

  let servizi: { key: string; from: string; to: string }[] = [];
  try {
    const grezzi = JSON.parse(cfg.get("reservation_services") || "[]") as { key?: unknown; from?: unknown; to?: unknown }[];
    servizi = grezzi.map((sv) => ({ key: String(sv.key ?? ""), from: String(sv.from ?? ""), to: String(sv.to ?? "") }));
  } catch {
    servizi = [];
  }
  const perServizio = servizi
    .map((sv) => {
      const del = resaOggi.filter((r) => r.service_key === sv.key);
      return { sv, tavoli: del.length, couverts: del.reduce((t, r) => t + (r.people ?? 0), 0) };
    })
    .filter((x) => x.tavoli > 0);
  const grandiTavoli = resaOggi
    .filter((r) => (r.people ?? 0) >= 6)
    .sort((a, b) => String(a.heure).localeCompare(String(b.heure)));

  const note = (notesRes.data ?? []) as { content: string; tags?: unknown }[];

  // Prossimo evento (entro 60 giorni)
  const anno = Number(oggiISO.slice(0, 4));
  const prossimoEv = [...eventiAnno(anno), ...eventiAnno(anno + 1)]
    .filter(([d]) => d >= oggiISO)
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))[0];

  // ---------------- HTML (tema del cliente) ----------------
  const tema = await temaEmail();
  const dati = await datiRistorante();
  const logo = (tema.isDark ? dati.logoNeg || dati.logoPos : dati.logoPos || dati.logoNeg) || dati.logo || LOGO_URL;
  const wordmark = `${SITE_URL}/restohub/wordmark${tema.isDark ? "-negative" : ""}.png`;
  const danger = tema.isDark ? "#ff8a8f" : "#c0392b";

  // Modulo "Commandes" attivo? (super admin -> app_config admin_pages_hidden).
  // Se disattivato, l'email non mostra nulla che riguardi gli ordini.
  let ordiniAttivi = true;
  try {
    const nasc = JSON.parse(cfg.get("admin_pages_hidden") || "[]");
    if (Array.isArray(nasc) && nasc.map(String).includes("orders")) ordiniAttivi = false;
  } catch {
    /* default: attivi */
  }

  const LANG: AdminLang = await adminLang().catch(() => "fr" as AdminLang);
  const B = B_TXT[LANG] ?? B_TXT.fr;
  const LOC = LOC_BRIEF[LANG] ?? "fr-BE";
  const dataLunga = cap(ora.setLocale(LOC).toFormat("cccc d LLLL yyyy"));
  const dataIeriTxt = ieri.setLocale(LOC).toFormat("cccc d LLLL");
  const dataOggiTxt = ora.setLocale(LOC).toFormat("cccc d LLLL");

  const cardIeri = (label: string, numero: string, sotto: string, width = "50%"): string =>
    `<td width="${width}" style="padding:16px 18px;background:${tema.tint};border:1px solid ${tema.border};border-radius:12px;"><p style="margin:0;color:${tema.muted};font-size:11px;letter-spacing:2px;text-transform:uppercase;">${label}</p><p style="margin:8px 0 0;color:${tema.accent};font-size:34px;line-height:1;font-weight:bold;">${numero}</p><p style="margin:6px 0 0;color:${tema.text};font-size:14px;">${sotto}</p></td>`;

  // Con ordini attivi: due card (Commandes + Reservations). Senza: solo Reservations, a tutta larghezza.
  const cardsIeri = ordiniAttivi
    ? `<tr>${cardIeri(B.commandes, String(ordIeri.length), B.encaisses(euro(incassoIeri)))}<td width="8" style="font-size:0;">&nbsp;</td>${cardIeri(B.reservations, String(servite.length), B.couvertsServis(couvertsIeri))}</tr>`
    : `<tr>${cardIeri(B.reservations, String(servite.length), B.couvertsServis(couvertsIeri), "100%")}</tr>`;

  const top3Mostrato = ordiniAttivi && top3.length > 0;
  const righeIeri: string[] = [];
  if (noshowIeri.length) {
    const nomi = noshowIeri
      .slice(0, 3)
      .map((r) => `${esc(`${r.first_name ?? ""} ${r.last_name ?? ""}`.trim())} ${String(r.heure ?? "").slice(0, 5)}`)
      .join(" · ");
    righeIeri.push(rigaTab(tema, B.noshow, `${noshowIeri.length}${nomi ? ` (${nomi})` : ""}`, false, true));
  }
  if (annullateIeri) righeIeri.push(rigaTab(tema, B.annulees, String(annullateIeri)));
  if (nuoviClienti) righeIeri.push(rigaTab(tema, B.nouveauxClients, String(nuoviClienti)));
  if (top3Mostrato) {
    righeIeri.push(
      rigaTab(
        tema,
        B.top3,
        top3.map(([n, q], i) => `<strong style="color:${tema.accent};">${i + 1}.</strong> ${esc(n)} (${q}×)`).join("<br/>"),
        true
      )
    );
  }
  if (righeIeri.length && !top3Mostrato) {
    righeIeri[righeIeri.length - 1] = righeIeri[righeIeri.length - 1].replace(/border-bottom:1px solid [^;]+;/g, "");
  }

  const righeOggi: string[] = [];
  for (const { sv, tavoli, couverts } of perServizio) {
    const nome = nomeServizio(sv.key, LANG);
    righeOggi.push(
      rigaTab(
        tema,
        `${esc(nome)} <span style="color:${tema.muted};">·</span> ${sv.from}–${sv.to}`,
        `<strong style="color:${tema.accent};">${B.couverts(couverts)}</strong> · ${B.tables(tavoli)}`
      )
    );
  }
  if (grandiTavoli.length) {
    righeOggi.push(
      rigaTab(
        tema,
        B.grandesTables,
        grandiTavoli
          .slice(0, 4)
          .map((r) => `${String(r.heure ?? "").slice(0, 5)} — ${esc(`${r.first_name ?? ""} ${r.last_name ?? ""}`.trim())} (${r.people})`)
          .join("<br/>"),
        true
      )
    );
  }
  if (righeOggi.length && !grandiTavoli.length) {
    righeOggi[righeOggi.length - 1] = righeOggi[righeOggi.length - 1].replace(/border-bottom:1px solid [^;]+;/g, "");
  }

  // Oggi: aperto o chiuso?
  const fasceOggi: string[] = [];
  if (today.config) {
    const c = today.config as { lunch_active?: boolean; lunch_open?: string | null; lunch_close?: string | null; dinner_active?: boolean; dinner_open?: string | null; dinner_close?: string | null };
    if (c.lunch_active && c.lunch_open && c.lunch_close) fasceOggi.push(`${String(c.lunch_open).slice(0, 5)}–${String(c.lunch_close).slice(0, 5)}`);
    if (c.dinner_active && c.dinner_open && c.dinner_close) fasceOggi.push(`${String(c.dinner_open).slice(0, 5)}–${String(c.dinner_close).slice(0, 5)}`);
  }
  const chiusoOggi = fasceOggi.length === 0;
  let riaperturaTxt = "";
  if (chiusoOggi && today.reopen) {
    const g = today.reopen.in_days;
    const quando = g === 0 ? B.motAujourdhui : g === 1 ? B.motDemain : ora.plus({ days: g }).setLocale(LOC).toFormat("cccc d LLLL");
    riaperturaTxt = B.reouverture(quando, today.reopen.heure);
  }

  const blocOggi = chiusoOggi
    ? `<tr><td style="padding:20px 40px 4px;text-align:center;"><p style="margin:0;color:${danger};font-size:22px;font-weight:bold;">${esc(B.fermeAuj)}</p>${riaperturaTxt ? `<p style="margin:10px 0 0;color:${tema.muted};font-size:14px;">${riaperturaTxt}</p>` : ""}</td></tr>`
    : `<tr><td style="padding:16px 40px 4px;text-align:center;"><p style="margin:0;color:${tema.muted};font-size:12px;letter-spacing:2px;text-transform:uppercase;">${esc(B.couvertsReserves)}</p><p style="margin:6px 0 0;color:${tema.accent};font-size:42px;line-height:1;font-weight:bold;">${couvertsOggi}</p><p style="margin:8px 0 0;color:${tema.text};font-size:14px;">${esc(B.resaConfirmees(resaOggi.length))}</p></td></tr>`;

  const TAG_FR: Record<string, string> = B.tags;
  const blocNote = note.length
    ? `<tr><td style="padding:18px 40px 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${tema.tint};border:1px solid ${tema.tintBorder};border-radius:12px;"><tr><td style="padding:16px 20px;"><p style="margin:0;color:${tema.accent};font-size:11px;letter-spacing:2px;text-transform:uppercase;font-weight:bold;">${esc(B.notesEquipe)}</p><p style="margin:10px 0 0;color:${tema.text};font-size:14px;line-height:1.8;">${note
        .map((n) => {
          const tags = (Array.isArray(n.tags) ? (n.tags as unknown[]) : [])
            .map((t) => TAG_FR[String(t)])
            .filter(Boolean)
            .map((t) => ` <strong style="font-size:10px;letter-spacing:1px;color:${tema.muted};">[${t}]</strong>`)
            .join("");
          return `• ${esc(n.content)}${tags}`;
        })
        .join("<br/>")}</p></td></tr></table></td></tr>`
    : "";

  let blocEvento = "";
  if (prossimoEv) {
    const [dEv, nomeEv] = prossimoEv;
    const giorni = Math.round(DateTime.fromISO(dEv, { zone: TIMEZONE }).diff(ora.startOf("day"), "days").days);
    if (giorni <= 60) {
      const quando =
        giorni === 0 ? B.motAujourdhui : giorni === 1 ? B.motDemain : B.dansNGiorni(giorni, DateTime.fromISO(dEv).setLocale(LOC).toFormat("cccc d LLLL"));
      blocEvento = `<tr><td style="padding:18px 40px 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${tema.tint};border:1px solid ${tema.tintBorder};border-radius:12px;"><tr><td style="padding:14px 20px;color:${tema.accent};font-size:13px;line-height:1.6;"><strong style="letter-spacing:1px;">${esc(B.aVenir)}</strong><br/><span style="color:${tema.text};">${esc(B.evento(nomeEv, quando))}</span></td></tr></table></td></tr>`;
    }
  }

  const html = `<!doctype html>
  <html lang="${LANG}">
  <head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><meta name="color-scheme" content="light dark" /></head>
  <body style="margin:0;padding:0;background:${tema.bg};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${tema.bg};border-collapse:collapse;margin:0;padding:0;width:100%;"><tr><td align="center" style="padding:8px 14px 24px;">
  <div style="font-family: Arial, Helvetica, sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;background:${tema.card};border:1px solid ${tema.border};border-radius:14px;overflow:hidden;">
      <tr><td style="height:4px;background:${tema.accent};font-size:0;line-height:0;">&nbsp;</td></tr>
      <tr>
        <td style="padding:38px 40px 6px;text-align:center;">
          <img src="${logo}" alt="${esc(dati.nome)}" width="150" style="display:inline-block;width:150px;max-width:60%;height:auto;border:0;" />
          <p style="margin:16px 0 0;color:${tema.muted};font-size:11px;letter-spacing:4px;">${esc((dati.nome + " — " + CLIENT.claim).toUpperCase())}</p>
        </td>
      </tr>
      <tr>
        <td style="padding:6px 40px 0;text-align:center;">
          <h1 style="margin:0;color:${tema.title};font-size:30px;letter-spacing:1px;text-transform:uppercase;font-weight:bold;">${esc(B.titre)}</h1>
          <p style="margin:14px 0 0;color:${tema.accent};font-size:20px;letter-spacing:1px;">${dataLunga}</p>
          <p style="margin:12px 0 0;color:${tema.text};font-size:15px;line-height:1.6;">${esc(B.lead)}</p>
        </td>
      </tr>
      ${intestazione(tema, B.hier(dataIeriTxt))}
      <tr>
        <td style="padding:14px 40px 4px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${cardsIeri}</table>
        </td>
      </tr>
      ${righeIeri.length ? `<tr><td style="padding:12px 40px 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${tema.border};border-radius:12px;overflow:hidden;">${righeIeri.join("")}</table></td></tr>` : ""}
      ${intestazione(tema, B.aujourdhui(dataOggiTxt))}
      ${blocOggi}
      ${righeOggi.length ? `<tr><td style="padding:14px 40px 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${tema.border};border-radius:12px;overflow:hidden;">${righeOggi.join("")}</table></td></tr>` : ""}
      ${blocNote}
      ${blocEvento}
      <tr>
        <td style="padding:28px 40px 8px;text-align:center;">
          <a href="${SITE_URL}/admin" style="display:inline-block;background:${tema.accent};color:${tema.onAccent};text-decoration:none;padding:16px 40px;font-size:13px;letter-spacing:2px;text-transform:uppercase;font-weight:bold;border-radius:10px;">${esc(B.ouvrirAdmin)}</a>
        </td>
      </tr>
      <tr>
        <td style="padding:24px 40px 30px;text-align:center;border-top:1px solid ${tema.border};">
          <p style="margin:0;color:${tema.muted};font-size:12px;line-height:1.8;">${esc(dati.nome)} · ${esc(B.footer(oraInvio))}</p>
          <p style="margin:16px 0 0;"><img src="${wordmark}" alt="RestoHub" width="100" style="display:inline-block;width:100px;max-width:40%;height:auto;opacity:0.7;border:0;" /></p>
        </td>
      </tr>
    </table>
  </div>
  </td></tr></table>
  </body>
  </html>`;

  try {
    await resend.emails.send({
      from: RESEND_FROM,
      to: dest.split(",").map((e) => e.trim()).filter(Boolean),
      bcc: "enquiries@moodd.online",
      subject: B.subject(dataLunga),
      html,
    });
  } catch {
    return { sent: false, reason: "invio Resend fallito" };
  }

  await supabaseAdmin
    .from("app_config")
    .upsert({ key: "daily_brief_last_sent", value: oggiISO }, { onConflict: "key" });

  return { sent: true, reason: "inviata a " + dest };
}
