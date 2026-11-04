import type { APIRoute } from "astro";
import { msg } from "../../../lib/admin/msgApi";
import { json } from "../../../lib/rispostaJson";
import {
  ambitoDiRichiesta, leggi, inserisci, aggiorna, cancella, leggiConfig, scriviConfig, type Ambito,
} from "../../../lib/admin/sede";
import { invalidaAppConfig } from "../../../lib/appConfigCache";
import { assegnaTavoli } from "../../../lib/planSalle";
import { orfaniDelPiano } from "../../../lib/pianoSalaRegole";
import { normalizzaArea, TELA, FORME_TAVOLO, normalizzaRotazione, manca92 } from "../../../lib/salaForma";
import { normalizzaElemento, ELEMENTI_MAX, type Elemento } from "../../../lib/elementiSala";
import { verificaStaff, nonAutorizzato } from "../../../lib/admin/adminAuth";
import { haLaPagina } from "../../../lib/admin/permessi";

export const prerender = false;



/** Tavoli massimi in UNA combinazione (liaison) e combinazioni per section.
 *  Erano 8 e 40, applicati scartando in silenzio: con tavoli da 2 il tetto
 *  reale era 16 posti, e chi provava a fare una catena da 22 vedeva la
 *  combinazione sparire senza capire perché. */
const MAX_TAVOLI_LIAISON = 16;
const MAX_LIAISONS = 40;

// Plan de salle — tavoli disegnati per ogni section (Réglages → Réservations).
// Coordinate in unità astratte: la sala di sempre e' 1000×600, ma dal
// 1/11/2026 si puo' uscirne fino ai limiti di `TELA` (salaForma.ts). Lo snap
// e' lato client.
// L'AREA della sala (da 3 a 80 angoli, muri anche diagonali o curvi: vedi
// salaForma.ts) vive in app_config, chiave "reservation_plan_areas":
// { "<zone>": [[x,y] o [x,y,curva], …] }.
// Le LIAISONS (gruppi di tavoli unibili) in "reservation_plan_links":
// { "<zone>": [["id1","id2"], …] }.
// GET ?zone=  → { tables, area, links }
// POST        → crea { zone, name, seats, shape, x, y, w, h }
// PATCH       → aggiorna { id, ...campi }
// DELETE ?id= → elimina (il client invia POST + X-Method-Override: il
//               middleware lo ritrasforma — il WAF blocca DELETE dai mobili)

const SELECT = "id, zone, name, seats, shape, x, y, w, h";
/* Con la migrazione #92 anche la rotazione (e il pentagono tra le forme).
   Senza, si legge come prima: ogni lettura prova la colonna nuova e, se il
   database risponde che non c'e', riprova senza (`manca92`). */
const SELECT_92 = SELECT + ", rotation";
const FORME: readonly string[] = FORME_TAVOLO;
async function conRotazione<T>(fai: (sel: string) => PromiseLike<{ data: T | null; error: { code?: string; message?: string } | null }>) {
  const r = await fai(SELECT_92);
  if (r.error && manca92(r.error)) return { ...(await fai(SELECT)), rotazione: false };
  return { ...r, rotazione: true };
}


function num(v: unknown, min: number, max: number, fallback: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

export const GET: APIRoute = async ({ request, url }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();
  const ambito = await ambitoDiRichiesta(request, staff);

  // ?assign=1 -> ANTEPRIMA assegnazione per il modale admin: quali tavoli
  // riceverebbe una prenotazione a questi date/heure/people/zone (dry-run,
  // niente viene salvato). proposal = null se nessuna combinazione libera.
  if (url.searchParams.get("assign") === "1") {
    const date = url.searchParams.get("date") ?? "";
    const heure = url.searchParams.get("heure") ?? "";
    const people = Math.floor(Number(url.searchParams.get("people")));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(heure) || !Number.isFinite(people) || people < 1) {
      return json({ error: await msg("err.params") }, 400);
    }
    const exclude = url.searchParams.get("exclude") ?? "";
    const proposal = await assegnaTavoli({
      date,
      heure,
      service_key: (url.searchParams.get("service") ?? "").trim() || null,
      zone: (url.searchParams.get("zone") ?? "").trim() || null,
      people,
      excludeId: /^[0-9a-f-]{36}$/i.test(exclude) ? exclude : undefined,
    }, ambito);
    return json({ proposal });
  }

  const zone = (url.searchParams.get("zone") ?? "").trim();
  const { data, error, rotazione } = await conRotazione((sel) => {
    let q = leggi("restaurant_tables", ambito, sel).order("created_at", { ascending: true });
    if (zone) q = q.eq("zone", zone);
    return q;
  });
  if (error) return json({ error: await msg("err.read") }, 500);

  let area: number[][] | null = null;
  let links: unknown = [];
  let decor: unknown[] = [];
  let planMode = false;
  let autoTables = true;
  let priority: string[] = [];
  try {
    const { valori: m } = await leggiConfig(ambito, ["reservation_plan_areas", "reservation_plan_links", "reservation_plan_decor", "reservation_plan_mode", "reservation_zone_priority", "reservation_auto_tables"]);
    planMode = m.get("reservation_plan_mode") === "1";
    autoTables = (m.get("reservation_auto_tables") ?? "1") !== "0";
    const aree = JSON.parse(m.get("reservation_plan_areas") || "{}") as Record<string, unknown>;
    const legami = JSON.parse(m.get("reservation_plan_links") || "{}") as Record<string, unknown>;
    const decori = JSON.parse(m.get("reservation_plan_decor") || "{}") as Record<string, unknown>;
    if (zone) {
      if (Array.isArray(aree[zone])) area = aree[zone] as number[][];
      links = Array.isArray(legami[zone]) ? (legami[zone] as unknown[]).filter(Array.isArray) : [];
      if (Array.isArray(decori[zone])) decor = decori[zone] as unknown[];
    } else {
      links = legami; // mappa completa { zone: [[id,…], …] }
    }
    const pr = JSON.parse(m.get("reservation_zone_priority") || "[]");
    if (Array.isArray(pr)) priority = pr.map(String).filter(Boolean);
  } catch { /* nessuna area/liaison/priorità */ }
  // `forme_92`: il database ha la #92 — l'editor mostra pentagono e rotazione.
  return json({ tables: data ?? [], area, links, decor, plan_mode: planMode, auto_tables: autoTables, priority, forme_92: rotazione });
};

/** Aggiorna una mappa { zone: valore } in app_config. */
async function salvaMappa(chiave: string, zone: string, valore: unknown | null, ambito: Ambito): Promise<boolean> {
  let mappa: Record<string, unknown> = {};
  try {
    const { valori } = await leggiConfig(ambito, [chiave]);
    mappa = JSON.parse(valori.get(chiave) || "{}") as Record<string, unknown>;
  } catch { mappa = {}; }
  if (valore !== null) mappa[zone] = valore;
  else delete mappa[zone];
  const err = await scriviConfig(ambito, { [chiave]: JSON.stringify(mappa) });
  if (!err) invalidaAppConfig();
  return !err;
}

// PUT — salva/cancella l'AREA (perimetro) di una section: { zone, area | null }
export const PUT: APIRoute = async ({ request }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();
  const ambito = await ambitoDiRichiesta(request, staff);

  let body: { zone?: unknown; area?: unknown; priority?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: await msg("err.body") }, 400);
  }
  // ⚠️ Audit 3/11/2026: da Réservations si cambia SOLO la priorita' di
  // riempimento; il piano e le liaisons restano di Réglages.
  if (!("priority" in body) && !(await haLaPagina(staff, "settings"))) {
    return json({ error: await msg("err.forbidden") }, 403);
  }
  // Priorità di riempimento: { priority: ["Interieur", "Terrasse", …] }.
  // Ordine con cui l'assegnazione tavoli riempie le sections quando il
  // cliente sceglie "Indifférent" (1° = si riempie prima).
  if ("priority" in body) {
    const grezzi = Array.isArray((body as { priority?: unknown }).priority)
      ? ((body as { priority: unknown[] }).priority)
      : null;
    if (!grezzi || grezzi.length > 20) return json({ error: await msg("err.priority") }, 400);
    const priority = grezzi.map((z) => String(z).trim().slice(0, 60)).filter(Boolean);
    const err = await scriviConfig(ambito, { reservation_zone_priority: JSON.stringify(priority) });
    if (err) return json({ error: await msg("err.save") }, 500);
    invalidaAppConfig();
    return json({ ok: true, priority });
  }

  const zone = String(body.zone ?? "").trim().slice(0, 60);
  if (!zone) return json({ error: await msg("err.sectionRequired") }, 400);

  // Liaisons: { zone, links: [["id","id"], …] } (validate e salvate a parte).
  // I limiti sono una difesa contro valori assurdi, non una regola di sala:
  // 16 tavoli coprono qualsiasi catena reale (con tavoli da 2 sono 32 posti).
  // Una combinazione fuori limite viene RIFIUTATA con un messaggio, mai
  // scartata in silenzio: prima spariva e sembrava che l'admin non salvasse.
  if ("links" in body) {
    const grezzi = Array.isArray((body as { links?: unknown }).links) ? ((body as { links: unknown[] }).links) : [];
    if (grezzi.length > MAX_LIAISONS) {
      return json({ error: (await msg("err.linksMax")).replace("{n}", String(MAX_LIAISONS)) }, 400);
    }
    const links: string[][] = [];
    for (const g of grezzi) {
      if (!Array.isArray(g)) return json({ error: await msg("err.linkBad") }, 400);
      const ids = g.map((x) => String(x)).filter((x) => /^[0-9a-f-]{36}$/i.test(x));
      if (ids.length !== g.length) return json({ error: await msg("err.linkBad") }, 400);
      if (ids.length < 2) {
        return json({ error: await msg("err.link2") }, 400);
      }
      if (ids.length > MAX_TAVOLI_LIAISON) {
        return json({ error: `${await msg("err.linkMax")} (${MAX_TAVOLI_LIAISON})` }, 400);
      }
      links.push(ids);
    }
    const ok = await salvaMappa("reservation_plan_links", zone, links.length ? links : null, ambito);
    if (!ok) return json({ error: await msg("err.save") }, 500);
    return json({ ok: true, links });
  }

  // Gli elementi (piante, muri, scale, porte…, elementiSala.ts):
  // { zone, decor: [{ id, type, color, label, rotation, x, y, w, h }, …] }
  if ("decor" in body) {
    const grezzi = Array.isArray((body as { decor?: unknown }).decor) ? ((body as { decor: unknown[] }).decor) : [];
    const decor: Elemento[] = [];
    for (const d of grezzi.slice(0, ELEMENTI_MAX)) {
      const e = normalizzaElemento(d, decor.length, TELA);
      if (e) decor.push(e);
    }
    const ok = await salvaMappa("reservation_plan_decor", zone, decor.length ? decor : null, ambito);
    if (!ok) return json({ error: await msg("err.save") }, 500);
    return json({ ok: true, decor });
  }

  let area: number[][] | null = null;
  if (Array.isArray(body.area)) {
    area = normalizzaArea(body.area);
    if (!area) return json({ error: await msg("err.zonePoints") }, 400);
  }

  const ok = await salvaMappa("reservation_plan_areas", zone, area, ambito);
  if (!ok) return json({ error: await msg("err.save") }, 500);
  return json({ ok: true, area });
};

export const POST: APIRoute = async ({ request }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();
  const ambito = await ambitoDiRichiesta(request, staff);

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json({ error: await msg("err.body") }, 400);
  }

  const zone = String(body.zone ?? "").trim().slice(0, 60);
  const name = String(body.name ?? "").trim().slice(0, 12);
  if (!zone || !name) return json({ error: await msg("err.sectionAndName") }, 400);
  const shape = FORME.includes(String(body.shape)) ? String(body.shape) : "square";

  const riga = {
    zone,
    name,
    seats: num(body.seats, 1, 30, 4),
    shape,
    x: num(body.x, TELA.x0, TELA.x1, 40),
    y: num(body.y, TELA.y0, TELA.y1, 40),
    w: num(body.w, 20, 600, 100),
    h: num(body.h, 20, 500, 100),
  };
  const { data, error } = await conRotazione((sel) => inserisci("restaurant_tables", ambito, riga).select(sel).single());
  if (error && manca92(error)) return json({ error: await msg("err.tables92") }, 400);
  if (error || !data) return json({ error: await msg("err.create") }, 500);
  return json({ table: data }, 201);
};

export const PATCH: APIRoute = async ({ request }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();
  const ambito = await ambitoDiRichiesta(request, staff);

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json({ error: await msg("err.body") }, 400);
  }

  const id = String(body.id ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ error: await msg("err.id") }, 400);

  const campi: Record<string, unknown> = {};
  if ("name" in body) {
    const nome = String(body.name ?? "").trim().slice(0, 12);
    if (!nome) return json({ error: await msg("err.nameRequired") }, 400);
    campi.name = nome;
  }
  if ("seats" in body) campi.seats = num(body.seats, 1, 30, 4);
  if ("shape" in body) {
    if (!FORME.includes(String(body.shape))) return json({ error: await msg("err.shape") }, 400);
    campi.shape = String(body.shape);
  }
  if ("x" in body) campi.x = num(body.x, TELA.x0, TELA.x1, 0);
  if ("y" in body) campi.y = num(body.y, TELA.y0, TELA.y1, 0);
  if ("w" in body) campi.w = num(body.w, 20, 600, 100);
  if ("h" in body) campi.h = num(body.h, 20, 500, 100);
  if ("rotation" in body) campi.rotation = normalizzaRotazione(body.rotation);
  if (Object.keys(campi).length === 0) return json({ error: await msg("err.nothing") }, 400);

  const { data, error } = await conRotazione((sel) => aggiorna("restaurant_tables", ambito, campi)
    .eq("id", id)
    .select(sel)
    .single());
  // Pentagono o rotazione su un database senza la #92: lo si dice.
  if (error && manca92(error)) return json({ error: await msg("err.tables92") }, 400);
  if (error || !data) return json({ error: await msg("err.update") }, 500);
  return json({ table: data });
};

export const DELETE: APIRoute = async ({ request, url }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();
  const ambito = await ambitoDiRichiesta(request, staff);

  /* I TAVOLI DELLE SECTIONS SPARITE — la pulizia proposta dai Réglages.
     ⚠️ Quali siano lo RICALCOLA il server, adesso. Il client manda solo
     «fallo»: una lista di id costruita dalla pagina sarebbe vecchia di
     qualche secondo, e in quei secondi una section puo' essere tornata —
     si cancellerebbero tavoli vivi, senza cestino da cui ripescarli.
     ⚠️ Nessuna section configurata → `orfaniDelPiano` torna vuoto e qui non
     si cancella niente. E' la protezione per il locale che non ha mai aperto
     quei Réglages: per lui «fuori dall'elenco» non vuol dire niente. */
  if (url.searchParams.get("orphans") === "1") {
    const [righe, cfg] = await Promise.all([
      leggi("restaurant_tables", ambito, "id, zone"),
      leggiConfig(ambito, ["reservation_zones"]),
    ]);
    if (righe.error) return json({ error: await msg("err.read") }, 500);
    const orfani = orfaniDelPiano(righe.data ?? [], cfg.valori.get("reservation_zones") ?? "");
    if (orfani.length === 0) return json({ ok: true, cancellati: 0 });
    const zone = orfani.map((o) => o.zone);
    const { error: errCanc } = await cancella("restaurant_tables", ambito).in("zone", zone);
    if (errCanc) return json({ error: await msg("err.delete") }, 500);
    /* ⚠️ Area, liaisons e decori sono mappe { zona: … }: cancellare i tavoli
       e lasciare le loro chiavi vuol dire che il giorno in cui qualcuno
       ricrea una section con lo stesso nome si ritrova il perimetro e le
       unioni di tavoli che non esistono piu'. */
    for (const z of zone) {
      await salvaMappa("reservation_plan_areas", z, null, ambito);
      await salvaMappa("reservation_plan_links", z, null, ambito);
      await salvaMappa("reservation_plan_decor", z, null, ambito);
    }
    return json({ ok: true, cancellati: orfani.reduce((n, o) => n + o.tavoli, 0) });
  }

  const id = url.searchParams.get("id") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ error: await msg("err.id") }, 400);

  const { error } = await cancella("restaurant_tables", ambito).eq("id", id);
  if (error) return json({ error: await msg("err.delete") }, 500);
  return json({ ok: true });
};
