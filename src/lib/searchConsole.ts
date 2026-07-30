import crypto from "node:crypto";
import { cacheGet, cacheSet } from "./cache";

// ---------------------------------------------------------------------------
// Google Search Console (livello « Visibilité »).
//
// Autenticazione con un SERVICE ACCOUNT (un "robot" Google), NON con OAuth:
// così non tocca la verifica dell'app in corso per Google Business, e non
// serve nessuna schermata di consenso. La chiave del service account sta in
// una sola variabile d'ambiente MOODD (GOOGLE_SA_KEY_B64 = base64 del file
// JSON scaricato da Google Cloud). Il robot va aggiunto come UTENTE nella
// Search Console di ogni cliente; il "sito" (sc-domain:… o https://…/) è
// per-cliente e sta in app_config (chiave gsc_site).
// ---------------------------------------------------------------------------

const SA_RAW = import.meta.env.GOOGLE_SA_KEY_B64 ?? process.env.GOOGLE_SA_KEY_B64;
const SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";

interface ServiceAccount {
  client_email: string;
  private_key: string;
}

function serviceAccount(): ServiceAccount | null {
  if (!SA_RAW) return null;
  try {
    const j = JSON.parse(Buffer.from(String(SA_RAW), "base64").toString("utf8"));
    if (j && typeof j.client_email === "string" && typeof j.private_key === "string") {
      return { client_email: j.client_email, private_key: j.private_key };
    }
  } catch {
    /* chiave malformata */
  }
  return null;
}

/** Email del robot da aggiungere nella Search Console di ogni cliente. */
export function serviceAccountEmail(): string {
  return serviceAccount()?.client_email ?? "";
}

/** true se la chiave del service account è configurata lato server. */
export function searchConsolePronto(): boolean {
  return serviceAccount() !== null;
}

const b64url = (b: Buffer | string) =>
  (Buffer.isBuffer(b) ? b : Buffer.from(b)).toString("base64url");

// Access token del service account: JWT firmato RS256 → scambiato con Google.
// In cache 55 min (dura 60): niente firma a ogni richiesta. I fallimenti NON
// vengono messi in cache, così un problema temporaneo si ritenta subito.
async function accessToken(): Promise<string | null> {
  const sa = serviceAccount();
  if (!sa) return null;
  const inCache = cacheGet<string>("gsc_token");
  if (inCache) return inCache;

  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(
    JSON.stringify({
      iss: sa.client_email,
      scope: SCOPE,
      aud: "https://oauth2.googleapis.com/token",
      exp: now + 3600,
      iat: now,
    })
  );
  const input = `${header}.${claims}`;
  let jwt: string;
  try {
    jwt = `${input}.${crypto.sign("RSA-SHA256", Buffer.from(input), sa.private_key).toString("base64url")}`;
  } catch {
    return null; // chiave privata illeggibile
  }

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  if (!res.ok) return null;
  const j = (await res.json()) as { access_token?: string };
  const tok = j.access_token ?? "";
  if (tok) cacheSet("gsc_token", tok, 55 * 60_000);
  return tok || null;
}

interface RigaSA {
  keys?: string[];
  clicks?: number;
  impressions?: number;
  ctr?: number;
  position?: number;
}

async function query(
  siteUrl: string,
  body: Record<string, unknown>
): Promise<RigaSA[] | { error: string }> {
  const tok = await accessToken();
  if (!tok) return { error: "Service account non configuré (clé manquante ou invalide)." };
  const res = await fetch(
    `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );
  if (!res.ok) {
    let msg = `Google (${res.status})`;
    try {
      const j = (await res.json()) as { error?: { message?: string } };
      if (j.error?.message) msg += " : " + j.error.message;
    } catch {
      /* corpo non JSON */
    }
    return { error: msg };
  }
  const j = (await res.json()) as { rows?: RigaSA[] };
  return j.rows ?? [];
}

const ymd = (d: Date) => d.toISOString().slice(0, 10);

export interface Visibilite {
  configured: boolean;
  clicks: number;
  impressions: number;
  ctr: number; // 0..1
  position: number;
  // variazione % dei clic vs i 28 giorni precedenti (null se non calcolabile)
  deltaClicks: number | null;
  periode: string; // "YYYY-MM-DD → YYYY-MM-DD"
  top: { query: string; clicks: number; impressions: number }[];
  error?: string;
}

/** Dati per la tile « Visibilité » : totali 28 gg, tendenza, top requêtes. */
export async function visibilite(siteUrl: string): Promise<Visibilite> {
  const vuoto: Visibilite = {
    configured: false, clicks: 0, impressions: 0, ctr: 0, position: 0,
    deltaClicks: null, periode: "", top: [],
  };
  if (!siteUrl) return vuoto;
  if (!searchConsolePronto()) return { ...vuoto, error: "Service account non configuré." };

  const chiave = "gsc_vis:" + siteUrl;
  const inCache = cacheGet<Visibilite>(chiave);
  if (inCache) return inCache;

  const calcola = async (): Promise<Visibilite> => {
      // Search Console ha ~3 giorni di ritardo sui dati.
      const fin = new Date(Date.now() - 3 * 86_400_000);
      const inizio = new Date(fin.getTime() - 27 * 86_400_000);
      const finPrec = new Date(inizio.getTime() - 1 * 86_400_000);
      const inizioPrec = new Date(finPrec.getTime() - 27 * 86_400_000);

      const [tot, prec, top] = await Promise.all([
        query(siteUrl, { startDate: ymd(inizio), endDate: ymd(fin) }),
        query(siteUrl, { startDate: ymd(inizioPrec), endDate: ymd(finPrec) }),
        query(siteUrl, { startDate: ymd(inizio), endDate: ymd(fin), dimensions: ["query"], rowLimit: 8 }),
      ]);

      if ("error" in tot) return { ...vuoto, error: tot.error };

      const r0 = Array.isArray(tot) ? tot[0] : undefined;
      const clicks = Math.round(r0?.clicks ?? 0);
      const impressions = Math.round(r0?.impressions ?? 0);
      const ctr = Number(r0?.ctr ?? 0);
      const position = Number(r0?.position ?? 0);

      let deltaClicks: number | null = null;
      if (Array.isArray(prec) && prec[0]) {
        const cPrec = Math.round(prec[0].clicks ?? 0);
        if (cPrec > 0) deltaClicks = Math.round(((clicks - cPrec) / cPrec) * 100);
        else if (clicks > 0) deltaClicks = 100;
      }

      const topList = (Array.isArray(top) ? top : [])
        .map((r) => ({
          query: (r.keys?.[0] ?? "").slice(0, 80),
          clicks: Math.round(r.clicks ?? 0),
          impressions: Math.round(r.impressions ?? 0),
        }))
        .filter((r) => r.query);

      return {
        configured: true,
        clicks, impressions, ctr, position,
        deltaClicks,
        periode: `${ymd(inizio)} → ${ymd(fin)}`,
        top: topList,
      };
  };

  const out = await calcola();
  // In cache solo i risultati riusciti (3 ore): gli errori si ritentano subito.
  if (out.configured && !out.error) cacheSet(chiave, out, 3 * 3_600_000);
  return out;
}

// ---------------------------------------------------------------------------
// Dati DETTAGLIATI per la pagina Statistiques → onglet Google.
// KPI (con periodo precedente per la variazione), serie temporale per il
// grafico, top requêtes e top pages. Periodo in giorni (7, 28, 90, 180, 365).
// ---------------------------------------------------------------------------

export interface LigneDim {
  key: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export interface VisiDetail {
  configured: boolean;
  error?: string;
  days: number;
  periode: string;
  kpi: {
    clicks: number; impressions: number; ctr: number; position: number;
    prev: { clicks: number; impressions: number; ctr: number; position: number };
  };
  serie: { date: string; clicks: number; impressions: number }[];
  topQueries: LigneDim[];
  topPages: LigneDim[];
}

const mapDim = (rows: RigaSA[] | { error: string }): LigneDim[] =>
  (Array.isArray(rows) ? rows : [])
    .map((r) => ({
      key: (r.keys?.[0] ?? "").slice(0, 120),
      clicks: Math.round(r.clicks ?? 0),
      impressions: Math.round(r.impressions ?? 0),
      ctr: Number(r.ctr ?? 0),
      position: Number(r.position ?? 0),
    }))
    .filter((r) => r.key);

export async function visibiliteDetail(siteUrl: string, days: number): Promise<VisiDetail> {
  const vuoto: VisiDetail = {
    configured: false, days, periode: "",
    kpi: { clicks: 0, impressions: 0, ctr: 0, position: 0, prev: { clicks: 0, impressions: 0, ctr: 0, position: 0 } },
    serie: [], topQueries: [], topPages: [],
  };
  if (!siteUrl) return vuoto;
  if (!searchConsolePronto()) return { ...vuoto, error: "Service account non configuré." };

  const chiave = `gsc_det:${siteUrl}:${days}`;
  const inCache = cacheGet<VisiDetail>(chiave);
  if (inCache) return inCache;

  // Search Console ha ~3 giorni di ritardo sui dati.
  const fin = new Date(Date.now() - 3 * 86_400_000);
  const inizio = new Date(fin.getTime() - (days - 1) * 86_400_000);
  const finPrec = new Date(inizio.getTime() - 1 * 86_400_000);
  const inizioPrec = new Date(finPrec.getTime() - (days - 1) * 86_400_000);
  const A = ymd(inizio), B = ymd(fin), PA = ymd(inizioPrec), PB = ymd(finPrec);

  const [tot, prec, serie, topQ, topP] = await Promise.all([
    query(siteUrl, { startDate: A, endDate: B }),
    query(siteUrl, { startDate: PA, endDate: PB }),
    query(siteUrl, { startDate: A, endDate: B, dimensions: ["date"], rowLimit: 400 }),
    query(siteUrl, { startDate: A, endDate: B, dimensions: ["query"], rowLimit: 15 }),
    query(siteUrl, { startDate: A, endDate: B, dimensions: ["page"], rowLimit: 15 }),
  ]);

  if ("error" in tot) return { ...vuoto, error: tot.error };

  const r0 = Array.isArray(tot) ? tot[0] : undefined;
  const p0 = Array.isArray(prec) ? prec[0] : undefined;

  const serieList = (Array.isArray(serie) ? serie : [])
    .map((r) => ({
      date: r.keys?.[0] ?? "",
      clicks: Math.round(r.clicks ?? 0),
      impressions: Math.round(r.impressions ?? 0),
    }))
    .filter((r) => r.date)
    .sort((a, b) => (a.date < b.date ? -1 : 1));

  const out: VisiDetail = {
    configured: true,
    days,
    periode: `${A} → ${B}`,
    kpi: {
      clicks: Math.round(r0?.clicks ?? 0),
      impressions: Math.round(r0?.impressions ?? 0),
      ctr: Number(r0?.ctr ?? 0),
      position: Number(r0?.position ?? 0),
      prev: {
        clicks: Math.round(p0?.clicks ?? 0),
        impressions: Math.round(p0?.impressions ?? 0),
        ctr: Number(p0?.ctr ?? 0),
        position: Number(p0?.position ?? 0),
      },
    },
    serie: serieList,
    topQueries: mapDim(topQ),
    topPages: mapDim(topP),
  };

  cacheSet(chiave, out, 3 * 3_600_000);
  return out;
}
