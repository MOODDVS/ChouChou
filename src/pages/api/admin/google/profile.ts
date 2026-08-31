import type { APIRoute } from "astro";
import { verificaStaff, nonAutorizzato } from "../../../../lib/admin/adminAuth";
import { accessToken, locationSalvata, leggiScheda, aggiornaScheda, leggiIndirizzoRaw, GIORNI_ENUM } from "../../../../lib/googleBusiness";

export const prerender = false;

// GET /api/admin/google/profile  -> scheda modificabile (orari, orari speciali, descrizione, tel, sito)
// PUT /api/admin/google/profile  -> aggiorna la scheda su Google

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

async function preludio(request: Request) {
  const staff = await verificaStaff(request);
  if (!staff) return { err: nonAutorizzato() };
  const token = await accessToken();
  if (!token) return { err: json({ error: "Google non collegato" }, 400) };
  const loc = await locationSalvata();
  if (!loc?.path) return { err: json({ error: "Scheda Google non configurata" }, 400) };
  return { token, path: loc.path };
}

function hhmm(v: unknown): { hours: number; minutes: number } | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(v ?? "").trim());
  if (!m) return null;
  const h = +m[1], mi = +m[2];
  if (h < 0 || h > 23 || mi < 0 || mi > 59) return null;
  return { hours: h, minutes: mi };
}
function isoDate(v: unknown): { year: number; month: number; day: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v ?? "").trim());
  if (!m) return null;
  const y = +m[1], mo = +m[2], d = +m[3];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return { year: y, month: mo, day: d };
}

export const GET: APIRoute = async ({ request }) => {
  const p = await preludio(request);
  if (p.err) return p.err;
  const scheda = await leggiScheda(p.token!, p.path!);
  if (!scheda) return json({ error: "Lecture de la fiche impossible" }, 502);
  return json({ scheda });
};

export const PUT: APIRoute = async ({ request }) => {
  const p = await preludio(request);
  if (p.err) return p.err;

  let b: Record<string, unknown>;
  try { b = await request.json(); } catch { return json({ error: "Corps invalide" }, 400); }

  const corpo: Record<string, unknown> = {};
  const masks: string[] = [];

  if (typeof b.description === "string") {
    corpo.profile = { description: b.description.trim().slice(0, 750) };
    masks.push("profile.description");
  }
  if (typeof b.title === "string") {
    const ti = b.title.trim().slice(0, 300);
    if (ti) { corpo.title = ti; masks.push("title"); }
  }
  if (typeof b.phone === "string" || typeof b.phone2 === "string") {
    const pn: { primaryPhone: string; additionalPhones?: string[] } = {
      primaryPhone: String(b.phone ?? "").trim().slice(0, 30),
    };
    const p2 = String(b.phone2 ?? "").trim().slice(0, 30);
    if (p2) pn.additionalPhones = [p2];
    corpo.phoneNumbers = pn;
    masks.push("phoneNumbers");
  }
  if (typeof b.website === "string") {
    const w = b.website.trim();
    if (w && !/^https?:\/\//i.test(w)) return json({ error: "Site web invalide (http/https)" }, 400);
    corpo.websiteUri = w;
    masks.push("websiteUri");
  }
  if (typeof b.status === "string") {
    const st = b.status.trim();
    if (!["OPEN", "CLOSED_TEMPORARILY", "CLOSED_PERMANENTLY"].includes(st))
      return json({ error: "Statut invalide" }, 400);
    corpo.openInfo = { status: st };
    masks.push("openInfo.status");
  }
  if (b.addr && typeof b.addr === "object") {
    const ad = b.addr as { lines?: unknown; postalCode?: unknown; locality?: unknown; adminArea?: unknown; regionCode?: unknown };
    const region = String(ad.regionCode ?? "").trim().toUpperCase();
    // regionCode (codice paese) obbligatorio per l'update dell'indirizzo su Google:
    // se manca, non tocco l'indirizzo per non inviare un dato incompleto.
    if (region) {
      // Parto dall'indirizzo ESISTENTE su Google (conserva languageCode ecc.) e
      // sovrascrivo solo i campi modificati. administrativeArea (Provincia/Regione)
      // va inviato SOLO se quel paese lo usa già: molti paesi (es. Belgio) non lo
      // prevedono e Google risponde INVALID_ARGUMENT se lo mandi.
      const existing = (await leggiIndirizzoRaw(p.token!, p.path!)) ?? {};
      const lines = String(ad.lines ?? "").trim();
      const addr: Record<string, unknown> = {
        ...existing,
        regionCode: region,
        addressLines: lines ? [lines] : [],
        locality: String(ad.locality ?? "").trim(),
        postalCode: String(ad.postalCode ?? "").trim(),
      };
      const admin = String(ad.adminArea ?? "").trim();
      const existingAdmin = String((existing as { administrativeArea?: unknown }).administrativeArea ?? "").trim();
      if (existingAdmin) addr.administrativeArea = admin || existingAdmin; // paese che usa la regione
      else delete addr.administrativeArea; // paese che NON usa la regione (es. Belgio)
      corpo.storefrontAddress = addr;
      masks.push("storefrontAddress");
    }
  }

  if (Array.isArray(b.hours)) {
    const periods: unknown[] = [];
    for (const g of b.hours as { d?: unknown; chiuso?: unknown; ranges?: unknown }[]) {
      const d = Number(g?.d);
      if (!Number.isInteger(d) || d < 0 || d > 6) continue;
      if (g?.chiuso) continue;
      const ranges = Array.isArray(g?.ranges) ? (g.ranges as { a?: unknown; b?: unknown }[]) : [];
      for (const r of ranges) {
        const o = hhmm(r?.a), c = hhmm(r?.b);
        if (!o || !c) continue;
        periods.push({ openDay: GIORNI_ENUM[d], openTime: o, closeDay: GIORNI_ENUM[d], closeTime: c });
      }
    }
    corpo.regularHours = { periods };
    masks.push("regularHours");
  }

  if (Array.isArray(b.special)) {
    const specialHourPeriods: unknown[] = [];
    for (const sp of b.special as { date?: unknown; closed?: unknown; a?: unknown; b?: unknown }[]) {
      const sd = isoDate(sp?.date);
      if (!sd) continue;
      if (sp?.closed) {
        specialHourPeriods.push({ startDate: sd, endDate: sd, closed: true });
      } else {
        const o = hhmm(sp?.a), c = hhmm(sp?.b);
        if (!o || !c) continue;
        specialHourPeriods.push({ startDate: sd, endDate: sd, openTime: o, closeTime: c, closed: false });
      }
    }
    corpo.specialHours = { specialHourPeriods };
    masks.push("specialHours");
  }

  if (!masks.length) return json({ error: "Rien à mettre à jour" }, 400);

  const { ok, error } = await aggiornaScheda(p.token!, p.path!, corpo, masks.join(","));
  if (!ok) return json({ error: error || "Mise à jour impossible" }, 502);
  return json({ ok: true });
};
