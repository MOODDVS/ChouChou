import type { APIRoute } from "astro";
import { verificaStaff, nonAutorizzato } from "../../../lib/admin/adminAuth";
import { ambitoDiRichiesta, leggi, inserisci, aggiorna, cancella } from "../../../lib/admin/sede";

import { adminLang } from "../../../lib/admin/adminLang";
import { adminT } from "../../../i18n/admin";
export const prerender = false;


/** Messaggio nella lingua dell'admin. `adminLang()` legge un valore globale
 *  gia' in cache (adminBoot): zero query in piu'. Vedi ENGINE.md,
 *  «Messaggi d'errore delle API admin — nella lingua dell'admin». */
async function msg(chiave: string): Promise<string> {
  return adminT(await adminLang())(chiave);
}

// CRUD dei pop-up di comunicazione (admin Marketing → Pop-up).
// GET    → elenco completo (più recente in alto)
// POST   → crea
// PUT    → aggiorna (id obbligatorio; i campi presenti vengono scritti)
// DELETE → elimina (?id=…)

const PAGINE_VALIDE = ["home", "menu", "order", "ambiance", "contact", "links"];
const KIND_VALIDI = ["always", "dates", "weekly"];
const RE_ORA = /^([01]\d|2[0-3]):[0-5]\d$/;
const RE_DATA = /^\d{4}-\d{2}-\d{2}$/;

interface PopupInput {
  id?: string;
  /** Multi-sede: questo pop-up vale per tutte le sedi. */
  all_locations?: boolean;
  title?: string;
  body?: string;
  image_url?: string;
  btn1_label?: string;
  btn1_url?: string;
  btn2_label?: string;
  btn2_url?: string;
  title_en?: string;
  body_en?: string;
  btn1_label_en?: string;
  btn2_label_en?: string;
  title_i18n?: Record<string, string>;
  body_i18n?: Record<string, string>;
  btn1_label_i18n?: Record<string, string>;
  btn2_label_i18n?: Record<string, string>;
  pages?: string[];
  active?: boolean;
  schedule_kind?: string;
  date_start?: string | null;
  date_end?: string | null;
  days?: number[] | null;
  hour_start?: string | null;
  hour_end?: string | null;
  max_shows?: number;
  position?: string;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

/**
 * Valida e normalizza i campi di un pop-up.
 * Ritorna { errore } oppure { valori } pronti per insert/update.
 */
function pulisciI18n(o: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (o && typeof o === "object") {
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
      if (typeof v === "string" && v.trim()) out[k] = v.trim();
    }
  }
  return out;
}

function valida(b: PopupInput): { errore?: string; valori?: Record<string, unknown> } {
  // Multilingua: il pop-up appare in una lingua solo se il suo titolo per
  // quella lingua è compilato. Serve almeno una lingua col titolo.
  const title_i18n = pulisciI18n(b.title_i18n);
  const body_i18n = pulisciI18n(b.body_i18n);
  const btn1_label_i18n = pulisciI18n(b.btn1_label_i18n);
  const btn2_label_i18n = pulisciI18n(b.btn2_label_i18n);
  if (!Object.keys(title_i18n).length) {
    return { errore: "err.titleOneLang" };
  }

  const pages = Array.isArray(b.pages)
    ? b.pages.filter((p) => PAGINE_VALIDE.includes(p))
    : [];
  if (pages.length === 0) return { errore: "err.pickPage" };

  const kind = KIND_VALIDI.includes(b.schedule_kind ?? "") ? b.schedule_kind! : "always";

  let date_start: string | null = null;
  let date_end: string | null = null;
  if (kind === "dates") {
    date_start = (b.date_start ?? "").trim() || null;
    date_end = (b.date_end ?? "").trim() || null;
    if (!date_start || !date_end || !RE_DATA.test(date_start) || !RE_DATA.test(date_end)) {
      return { errore: "err.datesStartEnd" };
    }
    if (date_start > date_end) return { errore: "err.endBeforeStart" };
  }

  let days: number[] | null = null;
  let hour_start: string | null = null;
  let hour_end: string | null = null;
  if (kind === "weekly") {
    days = Array.isArray(b.days)
      ? b.days.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
      : [];
    if (days.length === 0) return { errore: "err.pickDay" };
    hour_start = (b.hour_start ?? "").trim() || null;
    hour_end = (b.hour_end ?? "").trim() || null;
    if (!hour_start || !hour_end || !RE_ORA.test(hour_start) || !RE_ORA.test(hour_end)) {
      return { errore: "err.hoursStartEnd" };
    }
    if (hour_start >= hour_end) return { errore: "err.endTimeBeforeStart" };
  }

  const urlOk = (u: string) => u === "" || u === "#reserver" || /^https?:\/\//.test(u) || u.startsWith("/");
  const btn1_url = (b.btn1_url ?? "").trim();
  const btn2_url = (b.btn2_url ?? "").trim();
  if (!urlOk(btn1_url) || !urlOk(btn2_url)) {
    return { errore: "err.popupLinks" };
  }

  const max_shows = Math.min(10, Math.max(1, Math.floor(Number(b.max_shows ?? 3)) || 3));
  const POS = ["center", "bottom-left", "bottom-center", "bottom-right"];
  const position = POS.includes(String(b.position)) ? String(b.position) : "center";

  return {
    valori: {
      title: title_i18n.fr || null,
      title_en: title_i18n.en || null,
      body: body_i18n.fr || null,
      body_en: body_i18n.en || null,
      btn1_label: btn1_label_i18n.fr || null,
      btn1_label_en: btn1_label_i18n.en || null,
      btn2_label: btn2_label_i18n.fr || null,
      btn2_label_en: btn2_label_i18n.en || null,
      title_i18n,
      body_i18n,
      btn1_label_i18n,
      btn2_label_i18n,
      image_url: (b.image_url ?? "").trim() || null,
      btn1_url: btn1_url || null,
      btn2_url: btn2_url || null,
      pages,
      active: b.active === true,
      schedule_kind: kind,
      date_start,
      date_end,
      days,
      hour_start,
      hour_end,
      max_shows,
      position,
    },
  };
}

export const GET: APIRoute = async ({ request }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();

  const { data, error } = await leggi("popups", await ambitoDiRichiesta(request, staff), "*")
    .order("created_at", { ascending: false });
  if (error) return json({ error: await msg("err.read") }, 500);
  return json({ popups: data ?? [] });
};

export const POST: APIRoute = async ({ request }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();

  let body: PopupInput;
  try {
    body = await request.json();
  } catch {
    return json({ error: await msg("err.body") }, 400);
  }

  const v = valida(body);
  if (v.errore) return json({ error: await msg(v.errore) }, 400);

  // Default: vale per TUTTE le sedi. Il pop-up e' comunicazione del marchio
  // sull'unico sito; quello di un punto solo («Stockel chiuso per lavori»)
  // e' il caso raro, e lo si dice con l'interruttore.
  const ambito = await ambitoDiRichiesta(request, staff);
  const { data, error } = await inserisci("popups", ambito, v.valori!, body.all_locations !== false)
    .select("id")
    .single();
  if (error) return json({ error: await msg("err.save") }, 500);
  return json({ ok: true, id: data.id }, 201);
};

export const PUT: APIRoute = async ({ request }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();

  let body: PopupInput;
  try {
    body = await request.json();
  } catch {
    return json({ error: await msg("err.body") }, 400);
  }
  if (!body.id) return json({ error: await msg("err.idMissing") }, 400);

  const ambito = await ambitoDiRichiesta(request, staff);

  // Toggle rapido attivo/spento: solo { id, active }
  if (body.title === undefined && typeof body.active === "boolean") {
    const { error } = await aggiorna("popups", ambito, { active: body.active })
      .eq("id", body.id);
    if (error) return json({ error: await msg("err.save") }, 500);
    return json({ ok: true });
  }

  const v = valida(body);
  if (v.errore) return json({ error: await msg(v.errore) }, 400);

  const campi = { ...v.valori! } as Record<string, unknown>;
  if ("all_locations" in body && ambito.modo === "sede") {
    campi.location_id = body.all_locations !== false ? null : ambito.id;
  }
  const { error } = await aggiorna("popups", ambito, campi).eq("id", body.id);
  if (error) return json({ error: await msg("err.save") }, 500);
  return json({ ok: true });
};

export const DELETE: APIRoute = async ({ request, url }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();

  const id = url.searchParams.get("id");
  if (!id) return json({ error: await msg("err.idMissing") }, 400);

  const { error } = await cancella("popups", await ambitoDiRichiesta(request, staff)).eq("id", id);
  if (error) return json({ error: await msg("err.delete") }, 500);
  return json({ ok: true });
};
