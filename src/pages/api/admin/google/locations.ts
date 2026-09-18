import type { APIRoute } from "astro";
import { verificaStaff, nonAutorizzato } from "../../../../lib/admin/adminAuth";
import { tokenGoogle, erroreGoogle, listaSedi, salvaLocation, locationSalvata, sincronizzaRecensioni, sedeConLaScheda } from "../../../../lib/googleBusiness";
import { schedaValida, schedaLibera } from "../../../../lib/googleRegole";
import { ambitoDiRiga, elencoSedi } from "../../../../lib/admin/sede";

/**
 * QUALE PUNTO sta scegliendo la sua scheda.
 *
 * ⚠️ NON si usa `ambitoDiRichiesta`. Questa API la chiama il modale della
 * sede, nel super admin: si sta modificando la sede X mentre il selettore
 * dell'header puo' essere su Y. La sede quindi arriva ESPLICITA, e va
 * verificata — altrimenti un id qualunque scriverebbe la configurazione di
 * un punto a caso.
 *
 * Senza parametro: installazione a sede unica, com'e' sempre stato.
 */
async function sedeChiesta(v: unknown): Promise<{ ambito: ReturnType<typeof ambitoDiRiga>; errore?: string }> {
  const id = String(v ?? "").trim();
  if (!id) return { ambito: ambitoDiRiga(null) };
  const esiste = (await elencoSedi()).some((s) => s.id === id);
  if (!esiste) return { ambito: ambitoDiRiga(null), errore: "Établissement inconnu" };
  return { ambito: ambitoDiRiga(id) };
}

export const prerender = false;

// GET  /api/admin/google/locations  -> elenca tutte le schede (account × location)
//                                       accessibili col token + la sede attuale.
// POST /api/admin/google/locations  body { path, title } -> salva la sede scelta
//                                       e sincronizza subito le recensioni.

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export const GET: APIRoute = async ({ request, url }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();

  // Qui `connected:false` non basta piu': la pagina deve poter dire «scaduto,
  // ricollega» invece di «non collegato», che manda a cercare un pulsante gia'
  // premuto una settimana fa.
  const { token, stato } = await tokenGoogle();
  if (!token) return json({ connected: false, stato, sedi: [], current: null, error: stato === "mai" ? "" : await erroreGoogle(stato) });

  const { ambito, errore } = await sedeChiesta(url.searchParams.get("sede"));
  if (errore) return json({ error: errore }, 400);

  const [{ sedi, error }, current] = await Promise.all([listaSedi(token), locationSalvata(ambito)]);
  return json({ connected: true, sedi, current, error });
};

export const POST: APIRoute = async ({ request }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();

  let body: { path?: unknown; title?: unknown; sede?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: "Corps invalide" }, 400);
  }
  const path = String(body.path ?? "").trim();
  const title = String(body.title ?? "").trim();
  // formato v4 atteso: accounts/{id}/locations/{id}
  if (!schedaValida(path)) {
    return json({ error: "Fiche invalide" }, 400);
  }

  const { token: token, stato: sttoken } = await tokenGoogle();
  if (!token) return json({ error: await erroreGoogle(sttoken) }, 400);

  const { ambito, errore } = await sedeChiesta(body.sede);
  if (errore) return json({ error: errore }, 400);

  // ⚠️ UNA SCHEDA, UNA SEDE. Due punti sullo stesso percorso scaricano le
  // stesse recensioni, e siccome `review_id` e' la chiave primaria ogni
  // sincronizzazione riscrive l'attribuzione: le stesse recensioni
  // rimbalzano fra un punto e l'altro a ogni giro, i conteggi diventano
  // casuali, e chi prova a rispondere a una recensione sua si sente dire
  // che non e' sua — a volte. Le tre schede si scelgono a mano da un elenco
  // in cui i nomi si assomigliano tutti: e' un errore che si fa.
  if (!schedaLibera({ giaDi: await sedeConLaScheda(path), ambito })) {
    return json({ error: "Cette fiche est déjà liée à un autre établissement" }, 409);
  }

  await salvaLocation(path, title, ambito);
  const r = await sincronizzaRecensioni(ambito);
  return json({
    ok: true,
    location: r.location ?? title,
    synced: r.synced ?? 0,
    rating: r.average,
    count: r.total,
    reviewError: r.reviewError ?? "",
  });
};
