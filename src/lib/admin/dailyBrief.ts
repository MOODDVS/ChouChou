import { Resend } from "resend";
import { DateTime } from "luxon";
import { supabaseAdmin } from "../db";
import { CLIENT } from "../../config/client";
import { SERVIZI_WIDGET } from "../reservationI18n";
import { caricaToday } from "./caricaToday";
import { TIMEZONE, aggiornaTimezone } from "../slots";

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
  String(t ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
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

function rigaTab(label: string, valore: string, ultima = false, rosso = false): string {
  const bordo = ultima ? "" : "border-bottom:1px solid #3a3335;";
  const colore = rosso ? "color:#ff8a8f;font-weight:bold;" : "color:#ffffff;";
  return `<tr><td style="padding:12px 20px;${bordo}color:#b3aca6;font-size:13px;vertical-align:top;">${label}</td><td style="padding:12px 20px;${bordo}${colore}font-size:14px;text-align:right;line-height:1.8;">${valore}</td></tr>`;
}

function intestazione(testo: string): string {
  return `<tr><td style="padding:34px 40px 8px;"><p style="margin:0;color:#ffffff;font-size:12px;letter-spacing:2px;text-transform:uppercase;border-bottom:1px solid #3a3335;padding-bottom:10px;text-align:center;">${testo}</p></td></tr>`;
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

  // ---------------- HTML ----------------
  const dataLunga = cap(ora.setLocale("fr-BE").toFormat("cccc d LLLL yyyy"));
  const dataIeriTxt = ieri.setLocale("fr-BE").toFormat("cccc d LLLL");
  const dataOggiTxt = ora.setLocale("fr-BE").toFormat("cccc d LLLL");

  const cardIeri = (label: string, numero: string, sotto: string): string =>
    `<td width="50%" style="padding:14px 18px;background:#1c1819;border:1px solid #3a3335;"><p style="margin:0;color:#b3aca6;font-size:11px;letter-spacing:2px;text-transform:uppercase;">${label}</p><p style="margin:8px 0 0;color:#dfab4e;font-size:34px;line-height:1;font-family:Georgia,'Times New Roman',serif;">${numero}</p><p style="margin:6px 0 0;color:#ffffff;font-size:14px;">${sotto}</p></td>`;

  const righeIeri: string[] = [];
  if (noshowIeri.length) {
    const nomi = noshowIeri
      .slice(0, 3)
      .map((r) => `${esc(`${r.first_name ?? ""} ${r.last_name ?? ""}`.trim())} ${String(r.heure ?? "").slice(0, 5)}`)
      .join(" · ");
    righeIeri.push(rigaTab("No-show", `${noshowIeri.length}${nomi ? ` (${nomi})` : ""}`, false, true));
  }
  if (annullateIeri) righeIeri.push(rigaTab("Annulées", String(annullateIeri)));
  if (nuoviClienti) righeIeri.push(rigaTab("Nouveaux clients", String(nuoviClienti)));
  if (top3.length) {
    righeIeri.push(
      rigaTab(
        "Top 3 des plats",
        top3.map(([n, q], i) => `<strong style="color:#dfab4e;">${i + 1}.</strong> ${esc(n)} (${q}×)`).join("<br/>"),
        true
      )
    );
  }
  // ultima riga senza bordo
  if (righeIeri.length && !top3.length) {
    righeIeri[righeIeri.length - 1] = righeIeri[righeIeri.length - 1].replace(/border-bottom:1px solid #3a3335;/g, "");
  }

  const righeOggi: string[] = [];
  for (const { sv, tavoli, couverts } of perServizio) {
    const nome = SERVIZI_WIDGET[sv.key]?.fr ?? sv.key;
    righeOggi.push(
      rigaTab(
        `${esc(nome)} <span style="color:#5d5555;">·</span> ${sv.from}–${sv.to}`,
        `<strong style="color:#dfab4e;">${couverts} couvert${couverts > 1 ? "s" : ""}</strong> · ${tavoli} table${tavoli > 1 ? "s" : ""}`
      )
    );
  }
  if (grandiTavoli.length) {
    righeOggi.push(
      rigaTab(
        "Grandes tables (≥ 6 pers.)",
        grandiTavoli
          .slice(0, 4)
          .map((r) => `${String(r.heure ?? "").slice(0, 5)} — ${esc(`${r.first_name ?? ""} ${r.last_name ?? ""}`.trim())} (${r.people})`)
          .join("<br/>"),
        true
      )
    );
  }
  if (righeOggi.length && !grandiTavoli.length) {
    righeOggi[righeOggi.length - 1] = righeOggi[righeOggi.length - 1].replace(/border-bottom:1px solid #3a3335;/g, "");
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
    const quando = g === 0 ? "aujourd'hui" : g === 1 ? "demain" : ora.plus({ days: g }).setLocale("fr-BE").toFormat("cccc d LLLL");
    riaperturaTxt = `Réouverture ${quando} à ${today.reopen.heure}.`;
  }

  const blocOggi = chiusoOggi
    ? `<tr><td style="padding:20px 40px 4px;text-align:center;"><p style="margin:0;color:#d24d55;font-size:22px;font-family:Georgia,'Times New Roman',serif;">Fermé aujourd'hui</p>${riaperturaTxt ? `<p style="margin:10px 0 0;color:#b3aca6;font-size:14px;">${riaperturaTxt}</p>` : ""}</td></tr>`
    : `<tr><td style="padding:16px 40px 4px;text-align:center;"><p style="margin:0;color:#b3aca6;font-size:12px;letter-spacing:2px;text-transform:uppercase;">Couverts réservés</p><p style="margin:6px 0 0;color:#dfab4e;font-size:42px;line-height:1;font-family:Georgia,'Times New Roman',serif;">${couvertsOggi}</p><p style="margin:8px 0 0;color:#ffffff;font-size:14px;">${resaOggi.length} réservation${resaOggi.length > 1 ? "s" : ""} confirmée${resaOggi.length > 1 ? "s" : ""}</p></td></tr>`;

  const TAG_FR: Record<string, string> = { important: "IMPORTANT", recurrent: "RÉCURRENT", fournisseur: "FOURNISSEUR" };
  const blocNote = note.length
    ? `<tr><td style="padding:18px 40px 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#dfab4e;"><tr><td style="padding:16px 20px;"><p style="margin:0;color:#2c2013;font-size:11px;letter-spacing:2px;text-transform:uppercase;font-weight:bold;">✏️ Notes de l'équipe</p><p style="margin:10px 0 0;color:#2c2013;font-size:14px;line-height:1.8;">${note
        .map((n) => {
          const tags = (Array.isArray(n.tags) ? (n.tags as unknown[]) : [])
            .map((t) => TAG_FR[String(t)])
            .filter(Boolean)
            .map((t) => ` <strong style="font-size:10px;letter-spacing:1px;">[${t}]</strong>`)
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
        giorni === 0 ? "aujourd'hui" : giorni === 1 ? "demain" : `dans ${giorni} jours (${DateTime.fromISO(dEv).setLocale("fr-BE").toFormat("cccc d LLLL")})`;
      blocEvento = `<tr><td style="padding:18px 40px 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:rgba(223,171,78,0.10);border:1px solid #dfab4e;"><tr><td style="padding:14px 20px;color:#dfab4e;font-size:13px;line-height:1.6;"><strong style="letter-spacing:1px;">📅 À VENIR</strong><br/><span style="color:#ffffff;">${esc(nomeEv)} ${quando} — pensez au menu spécial et à l'équipe en salle.</span></td></tr></table></td></tr>`;
    }
  }

  const html = `<!doctype html>
  <html lang="fr">
  <head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><meta name="color-scheme" content="dark" /><meta name="supported-color-schemes" content="dark" /></head>
  <body bgcolor="#1c1819" style="margin:0;padding:0;background:#1c1819;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#1c1819" style="background:#1c1819;margin:0;padding:0;"><tr><td>
  <div style="font-family: Arial, Helvetica, sans-serif; background:#1c1819; padding:30px 0; margin:0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;background:#231f20;border:1px solid #3a3335;">
      <tr>
        <td style="padding:40px 40px 20px;text-align:center;">
          <img src="${LOGO_URL}" alt="${esc(CLIENT.nome)}" width="64" height="64" style="display:inline-block;border:0;border-radius:12px;" />
          <p style="margin:16px 0 0;color:#dfab4e;font-size:11px;letter-spacing:4px;font-family:Georgia,'Times New Roman',serif;">${esc((CLIENT.nome + " — " + CLIENT.claim).toUpperCase())}</p>
        </td>
      </tr>
      <tr>
        <td style="padding:0 40px;text-align:center;">
          <h1 style="margin:0;color:#ffffff;font-size:30px;letter-spacing:1px;font-weight:normal;font-family:Georgia,'Times New Roman',serif;">Votre journée</h1>
          <p style="margin:14px 0 0;color:#dfab4e;font-size:21px;letter-spacing:1px;font-family:Georgia,'Times New Roman',serif;">${dataLunga}</p>
          <p style="margin:12px 0 0;color:#b3aca6;font-size:15px;line-height:1.6;">Bonjour ! Voici le récap d'hier et le programme d'aujourd'hui.</p>
        </td>
      </tr>
      ${intestazione(`Hier — ${dataIeriTxt}`)}
      <tr>
        <td style="padding:14px 40px 4px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
            ${cardIeri("Commandes", String(ordIeri.length), `${euro(incassoIeri)} encaissés`)}
            <td width="8" style="font-size:0;">&nbsp;</td>
            ${cardIeri("Réservations", String(servite.length), `${couvertsIeri} couverts servis`)}
          </tr></table>
        </td>
      </tr>
      ${righeIeri.length ? `<tr><td style="padding:10px 40px 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #3a3335;">${righeIeri.join("")}</table></td></tr>` : ""}
      ${intestazione(`Aujourd'hui — ${dataOggiTxt}`)}
      ${blocOggi}
      ${righeOggi.length ? `<tr><td style="padding:14px 40px 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #3a3335;">${righeOggi.join("")}</table></td></tr>` : ""}
      ${blocNote}
      ${blocEvento}
      <tr>
        <td style="padding:28px 40px 8px;text-align:center;">
          <a href="${SITE_URL}/admin" style="display:inline-block;background:#dfab4e;color:#231f20;text-decoration:none;padding:16px 40px;font-size:13px;letter-spacing:2px;text-transform:uppercase;font-weight:bold;border-radius:10px;">Ouvrir l'admin</a>
        </td>
      </tr>
      <tr>
        <td style="padding:26px 40px 34px;text-align:center;">
          <p style="margin:0;color:#5d5555;font-size:11px;line-height:1.7;">${esc(CLIENT.nome)} · Récap automatique quotidien (${oraInvio}) — désactivable dans Réglages → Notifications.</p>
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
      to: dest,
      bcc: "enquiries@moodd.online",
      subject: `Votre journée — ${dataLunga}`,
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
