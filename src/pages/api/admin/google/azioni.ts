import type { APIRoute } from "astro";
import { msg } from "../../../../lib/admin/msgApi";
import { json } from "../../../../lib/rispostaJson";
import { verificaStaff, nonAutorizzato } from "../../../../lib/admin/adminAuth";
import { tokenGoogle, erroreGoogle, locationSalvata } from "../../../../lib/googleBusiness";
import { ambitoDiRichiesta } from "../../../../lib/admin/sede";
import { listaAzioni, creaAzione, preferisciAzione, togliAzione } from "../../../../lib/googleAzioni";
import { apiSpenta, locationDi, nomeDellaScheda, tipoValido, uriValido } from "../../../../lib/admin/googleAzioniRegole";

export const prerender = false;

// I BOTTONI DELLA SCHEDA GOOGLE (6/11/2026) — «Prenota», «Ordina»…
// Pagina Google → Scheda → Links / Azioni. Vedi `googleAzioniRegole.ts`.
//
// GET  → { azioni[], pagina: "/reservation" | "/reservation-embed" }
// POST { azione: "crea", tipo, uri, preferito }
//      { azione: "preferito", name, preferito }
//      { azione: "togli", name }
// Tutto in POST: il WAF di Hostinger blocca DELETE e PATCH dai browser.

// Il sito ha una pagina prenotazioni intera? Si sa alla build.
const PAGINE_PRENOTA = import.meta.glob(["/src/pages/reservation.astro", "/src/pages/reservation/index.astro"]);
const PAGINA = Object.keys(PAGINE_PRENOTA).length ? "/reservation" : "/reservation-embed";

async function preludio(request: Request) {
  const staff = await verificaStaff(request);
  if (!staff) return { err: nonAutorizzato() };
  const { token, stato } = await tokenGoogle();
  if (!token) return { err: json({ error: await erroreGoogle(stato) }, 400) };
  const loc = await locationSalvata(await ambitoDiRichiesta(request, staff));
  const location = locationDi(loc?.path ?? "");
  if (!location) return { err: json({ error: await msg("err.googleNotLinked") }, 400) };
  return { token, location };
}

/** L'errore di Google, o quello che dice di attivare l'API. */
async function errore(e: string) {
  return json({ error: apiSpenta(e) ? await msg("err.googleActionsOff") : e, spenta: apiSpenta(e) }, 502);
}

export const GET: APIRoute = async ({ request }) => {
  const p = await preludio(request);
  if (p.err) return p.err;
  const r = await listaAzioni(p.token!, p.location!);
  if (!r.ok) return errore(r.errore);
  return json({ azioni: r.dati, pagina: PAGINA });
};

export const POST: APIRoute = async ({ request }) => {
  const p = await preludio(request);
  if (p.err) return p.err;
  let b: Record<string, unknown>;
  try { b = (await request.json()) as Record<string, unknown>; } catch { return json({ error: await msg("err.body") }, 400); }
  const azione = String(b?.azione ?? "");
  const token = p.token!, location = p.location!;

  if (azione === "crea") {
    if (!tipoValido(b.tipo)) return json({ error: await msg("err.request") }, 400);
    const uri = String(b.uri ?? "").trim();
    if (!uriValido(uri)) return json({ error: await msg("err.googleActionUrl") }, 400);
    const preferito = b.preferito === true;
    // Il preferito di prima (se e' nostro) si toglie PRIMA: uno solo per tipo.
    if (preferito) {
      const prima = await listaAzioni(token, location);
      if (!prima.ok) return errore(prima.errore);
      for (const a of prima.dati) {
        if (a.tipo === b.tipo && a.preferito && a.modificabile) await preferisciAzione(token, a.name, false);
      }
    }
    const r = await creaAzione(token, location, String(b.tipo), uri, preferito);
    if (!r.ok) return errore(r.errore);
    return json({ ok: true });
  }

  if (azione === "preferito" || azione === "togli") {
    const name = String(b.name ?? "");
    if (!nomeDellaScheda(name, location)) return json({ error: await msg("err.request") }, 400);
    const lista = await listaAzioni(token, location);
    if (!lista.ok) return errore(lista.errore);
    const questa = lista.dati.find((a) => a.name === name);
    if (!questa) return json({ error: await msg("err.request") }, 404);
    // I link dei fornitori non si toccano da qui: Google non lo permette.
    if (!questa.modificabile) return json({ error: await msg("err.googleActionProvider") }, 409);
    if (azione === "togli") {
      const r = await togliAzione(token, name);
      if (!r.ok) return errore(r.errore);
      return json({ ok: true });
    }
    const vuole = b.preferito === true;
    if (vuole) {
      for (const a of lista.dati) {
        if (a.tipo === questa.tipo && a.preferito && a.modificabile && a.name !== name) await preferisciAzione(token, a.name, false);
      }
    }
    const r = await preferisciAzione(token, name, vuole);
    if (!r.ok) return errore(r.errore);
    return json({ ok: true });
  }

  return json({ error: await msg("err.request") }, 400);
};
