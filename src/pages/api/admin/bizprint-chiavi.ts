import type { APIRoute } from "astro";
import { msg } from "../../../lib/admin/msgApi";
import { json } from "../../../lib/rispostaJson";
import { verificaStaff, nonAutorizzato } from "../../../lib/admin/adminAuth";
import { isSuperUser } from "../../../lib/admin/superAdmin";
import { supabaseAdmin } from "../../../lib/db";
import { cifra, cifraturaPronta, decifra } from "../../../lib/segreti";
import {
  chiaviBizprint,
  chiaviDAmbiente,
  dimenticaChiaviBizprint,
  K_BIZPRINT_PUB,
  K_BIZPRINT_SEC,
} from "../../../lib/bizprint";

export const prerender = false;

// Super admin → Intégrations → Imprimantes: le CHIAVI dell'applicazione
// BizPrint (5/11/2026). SOLO super. Come la chiave Resend: si scrivono nella
// casella, cifrate in `brand_secrets` (#95), e il `.env` resta il ripiego.
//
// GET    → da dove vengono, e solo la coda mascherata (••••abcd). Mai il valore.
// PUT    { pub?, sec? } → scrive (cifrato).
// POST   { azione: "importa" } → copia nella casella le chiavi del `.env`.
// DELETE → toglie dalla casella: torna a valere il `.env`.

const maschera = (v: string) => (v ? `••••${v.length > 8 ? v.slice(-4) : ""}` : "");

async function proprie(): Promise<{ pub: string; sec: string; tabella: boolean }> {
  try {
    const { data, error } = await supabaseAdmin.from("brand_secrets").select("key, value").in("key", [K_BIZPRINT_PUB, K_BIZPRINT_SEC]);
    if (error) return { pub: "", sec: "", tabella: false };
    const per = new Map((data ?? []).map((r) => [String(r.key), decifra(String(r.value ?? "")).trim()]));
    return { pub: per.get(K_BIZPRINT_PUB) ?? "", sec: per.get(K_BIZPRINT_SEC) ?? "", tabella: true };
  } catch {
    return { pub: "", sec: "", tabella: false };
  }
}

async function stato() {
  dimenticaChiaviBizprint();
  const [p, uso] = await Promise.all([proprie(), chiaviBizprint()]);
  const env = chiaviDAmbiente();
  return {
    fonte: uso.fonte,
    pub: { propria: !!p.pub, mascherata: maschera(uso.pub) },
    sec: { propria: !!p.sec, mascherata: maschera(uso.sec) },
    env: { pub: !!env.pub, sec: !!env.sec },
    tabella: p.tabella,
    cifratura: cifraturaPronta(),
  };
}

async function scrivi(coppie: [string, string][]): Promise<string | null> {
  if (!cifraturaPronta()) return "itg.rs.noCrypto";
  const adesso = new Date().toISOString();
  const { error } = await supabaseAdmin
    .from("brand_secrets")
    .upsert(coppie.map(([key, v]) => ({ key, value: cifra(v), updated_at: adesso })), { onConflict: "key" });
  dimenticaChiaviBizprint();
  return error ? "itg.rs.noTable" : null;
}

const nudo = (v: unknown) => String(v ?? "").trim().replace(/^["']|["']$/g, "").trim();

export const GET: APIRoute = async ({ request }) => {
  const staff = await verificaStaff(request);
  if (!staff || !isSuperUser(staff)) return nonAutorizzato();
  return json(await stato());
};

export const PUT: APIRoute = async ({ request }) => {
  const staff = await verificaStaff(request);
  if (!staff || !isSuperUser(staff)) return nonAutorizzato();
  const body = (await request.json().catch(() => null)) as { pub?: unknown; sec?: unknown } | null;
  if (!body) return json({ error: await msg("err.body") }, 400);
  const coppie: [string, string][] = [];
  const pub = nudo(body.pub);
  const sec = nudo(body.sec);
  if (pub) coppie.push([K_BIZPRINT_PUB, pub.slice(0, 200)]);
  if (sec) coppie.push([K_BIZPRINT_SEC, sec.slice(0, 200)]);
  if (!coppie.length) return json({ error: await msg("itg.rs.errNothing") }, 400);
  const err = await scrivi(coppie);
  if (err) return json({ error: await msg(err) }, 500);
  return json(await stato());
};

export const POST: APIRoute = async ({ request }) => {
  const staff = await verificaStaff(request);
  if (!staff || !isSuperUser(staff)) return nonAutorizzato();
  const body = (await request.json().catch(() => null)) as { azione?: unknown } | null;
  if (body?.azione !== "importa") return json({ error: await msg("err.request") }, 400);
  const env = chiaviDAmbiente();
  if (!env.pub || !env.sec) return json({ error: await msg("itg.rs.errNothing") }, 400);
  const err = await scrivi([[K_BIZPRINT_PUB, env.pub], [K_BIZPRINT_SEC, env.sec]]);
  if (err) return json({ error: await msg(err) }, 500);
  return json(await stato());
};

export const DELETE: APIRoute = async ({ request }) => {
  const staff = await verificaStaff(request);
  if (!staff || !isSuperUser(staff)) return nonAutorizzato();
  const { error } = await supabaseAdmin.from("brand_secrets").delete().in("key", [K_BIZPRINT_PUB, K_BIZPRINT_SEC]);
  dimenticaChiaviBizprint();
  if (error) return json({ error: await msg("itg.rs.noTable") }, 500);
  return json(await stato());
};
