import type { APIRoute } from "astro";
import { msg } from "../../../lib/admin/msgApi";
import { json } from "../../../lib/rispostaJson";
import { verificaStaff, nonAutorizzato } from "../../../lib/admin/adminAuth";
import { haLaPagina } from "../../../lib/admin/permessi";
import {
  ambitoDiRichiesta,
  contiDi,
  contoAttivo,
  leggiConfig,
  scriviConfig,
  scordaSegreti,
  K_CONTO_ATTIVO,
  PRINCIPALE,
} from "../../../lib/admin/sede";
import { nomeContoStripe } from "../../../lib/stripe";
import { modoChiave } from "../../../lib/admin/stripeRegole";

export const prerender = false;

// Réglages → Commandes → «Encaisser sur» (5/11/2026). SOLO l'admin del
// ristorante (pagina «settings») e il super admin.
//
// GET → i conti Stripe di QUESTA sede (quella dell'header) e quale e'
//       attivo. Mai una chiave: nome, LIVE/TEST, pronto o no.
// PUT { conto } → lo rende attivo. Solo un conto PRONTO (chiave e webhook):
//       uno a meta' incasserebbe soldi che nessun ordine registra.
//
// ⚠️ Lo switch vale per i pagamenti NUOVI. Rimborsi e verifiche dei
// pagamenti gia' fatti restano sul conto che li ha incassati
// (`stripePerSessione` in lib/stripe.ts).

const K_CAMBIO = "stripe_conto_cambio";

async function puo(request: Request) {
  const staff = await verificaStaff(request);
  if (!staff || !(await haLaPagina(staff, "settings"))) return null;
  return staff;
}

async function stato(request: Request, staff: NonNullable<Awaited<ReturnType<typeof puo>>>) {
  const ambito = await ambitoDiRichiesta(request, staff);
  if (ambito.modo === "tutte") return { tutte: true, conti: [], attivo: PRINCIPALE, cambio: null };
  const [conti, attivo, cfg] = await Promise.all([contiDi(ambito), contoAttivo(ambito), leggiConfig(ambito, [K_CAMBIO])]);
  const nomi = await Promise.all(conti.map((c) => (c.id === PRINCIPALE || !c.nome ? nomeContoStripe(c.chiave) : Promise.resolve(""))));
  let cambio: { da: string; il: string } | null = null;
  try { cambio = JSON.parse(cfg.valori.get(K_CAMBIO) || "null"); } catch { cambio = null; }
  return {
    tutte: false,
    conti: conti
      .map((c, i) => ({ id: c.id, nome: c.nome || nomi[i] || "", pronto: c.pronto, modo: modoChiave(c.chiave), principale: c.id === PRINCIPALE, haChiave: !!c.chiave }))
      .filter((c) => c.haChiave)
      .map(({ haChiave: _, ...c }) => c),
    attivo: attivo.id,
    cambio,
  };
}

export const GET: APIRoute = async ({ request }) => {
  const staff = await puo(request);
  if (!staff) return nonAutorizzato();
  return json(await stato(request, staff));
};

export const PUT: APIRoute = async ({ request }) => {
  const staff = await puo(request);
  if (!staff) return nonAutorizzato();
  let body: { conto?: unknown };
  try { body = await request.json(); } catch { return json({ error: await msg("err.body") }, 400); }
  const ambito = await ambitoDiRichiesta(request, staff);
  if (ambito.modo === "tutte") return json({ error: await msg("err.request") }, 400);
  const id = String(body.conto ?? "").trim();
  const conto = (await contiDi(ambito)).find((c) => c.id === id);
  if (!conto) return json({ error: await msg("err.request") }, 400);
  if (!conto.pronto) return json({ error: await msg("set.ord.accountNotReady") }, 409);
  const err = await scriviConfig(ambito, {
    [K_CONTO_ATTIVO]: id,
    [K_CAMBIO]: JSON.stringify({ da: staff.email ?? "", il: new Date().toISOString() }),
  });
  if (err) return json({ error: await msg("err.save") }, 500);
  // La scelta e' in cache con i segreti: deve valere SUBITO, non fra un minuto.
  scordaSegreti();
  console.log(`[stripe] conto attivo -> ${id} (da ${staff.email ?? staff.id})`);
  return json(await stato(request, staff));
};
