import type { APIRoute } from "astro";
import { msg } from "../../../../lib/admin/msgApi";
import { json } from "../../../../lib/rispostaJson";
import { verificaStaff, nonAutorizzato } from "../../../../lib/admin/adminAuth";
import { tokenGoogle, erroreGoogle, locationSalvata } from "../../../../lib/googleBusiness";
import { ambitoDiRichiesta } from "../../../../lib/admin/sede";
import { listaAzioni, creaAzione, aggiornaAzione, preferisciAzione, togliAzione } from "../../../../lib/googleAzioni";
import { apiSpenta, linkDaAggiornare, locationDi, nomeDellaScheda, tipoValido, uriValido } from "../../../../lib/admin/googleAzioniRegole";

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

/** L'errore di Google in chiaro: API spenta, il motivo dai `details`, o il messaggio. */
async function errore(e: { errore: string; codice: string }) {
  if (apiSpenta(e.errore)) return json({ error: await msg("err.googleActionsOff"), spenta: true }, 502);
  if (e.codice) {
    const spiegato = await msg(`err.gaz.${e.codice}`);
    // Una chiave senza traduzione torna uguale: si mostra il codice di Google.
    return json({ error: spiegato !== `err.gaz.${e.codice}` ? spiegato : `${e.errore} (${e.codice})`, codice: e.codice }, 502);
  }
  return json({ error: e.errore }, 502);
}

export const GET: APIRoute = async ({ request }) => {
  const p = await preludio(request);
  if (p.err) return p.err;
  const r = await listaAzioni(p.token!, p.location!);
  if (!r.ok) return errore(r);
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
    // ⚠️ UN LINK PER DOMINIO PER TIPO (regola di Google): se c'e' gia' un
    // nostro link dello stesso sito, si aggiorna lui. Crearne un secondo
    // finirebbe in SCALABLE_DEEP_LINK_INVALID_MULTIPLICITY.
    // Il preferito di prima lo toglie Google da solo (uno per tipo).
    const lista = await listaAzioni(token, location);
    if (!lista.ok) return errore(lista);
    const gia = linkDaAggiornare(lista.dati, String(b.tipo), uri);
    // Stesso indirizzo identico: non c'e' niente da cambiare se non, forse,
    // il preferito (un PATCH con lo stesso uri Google lo prende per un doppione).
    if (gia && gia.uri === uri) {
      if (!preferito || gia.preferito) return json({ ok: true, aggiornato: true });
      const r = await preferisciAzione(token, gia.name, true);
      if (!r.ok) return errore(r);
      return json({ ok: true, aggiornato: true });
    }
    const r = gia
      ? await aggiornaAzione(token, gia.name, uri, preferito || gia.preferito)
      : await creaAzione(token, location, String(b.tipo), uri, preferito);
    if (!r.ok) return errore(r);
    return json({ ok: true, aggiornato: !!gia });
  }

  if (azione === "preferito" || azione === "togli") {
    const name = String(b.name ?? "");
    if (!nomeDellaScheda(name, location)) return json({ error: await msg("err.request") }, 400);
    const lista = await listaAzioni(token, location);
    if (!lista.ok) return errore(lista);
    const questa = lista.dati.find((a) => a.name === name);
    if (!questa) return json({ error: await msg("err.request") }, 404);
    // I link dei fornitori non si toccano da qui: Google non lo permette.
    if (!questa.modificabile) return json({ error: await msg("err.googleActionProvider") }, 409);
    if (azione === "togli") {
      const r = await togliAzione(token, name);
      if (!r.ok) return errore(r);
      return json({ ok: true });
    }
    const r = await preferisciAzione(token, name, b.preferito === true);
    if (!r.ok) return errore(r);
    return json({ ok: true });
  }

  return json({ error: await msg("err.request") }, 400);
};
