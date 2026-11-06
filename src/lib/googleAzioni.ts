/**
 * I BOTTONI DELLA SCHEDA GOOGLE — le chiamate (6/11/2026).
 * My Business Place Actions API. Le regole stanno in `admin/googleAzioniRegole.ts`.
 *
 * ⚠️ Va ATTIVATA nel progetto Google Cloud di MOODD («My Business Place
 * Actions API»): finche' e' spenta, Google risponde 403 e la pagina lo dice.
 * Il permesso e' lo stesso di tutto il resto (`business.manage`): i clienti
 * gia' collegati non devono ricollegarsi.
 */
import { BASE_AZIONI, codiceErrore, normalizza, ordina, type AzioneG } from "./admin/googleAzioniRegole";

/** `codice`: l'ErrorCode di Google dai `details`, se c'e' (vedi codiceErrore). */
type Esito<T> = { ok: true; dati: T } | { ok: false; errore: string; codice: string };

async function chiama<T>(token: string, url: string, init: RequestInit = {}): Promise<Esito<T>> {
  try {
    const r = await fetch(url, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, ...(init.body ? { "Content-Type": "application/json" } : {}) },
      signal: AbortSignal.timeout(15_000),
    });
    const txt = await r.text();
    let j: unknown = null;
    try { j = txt ? JSON.parse(txt) : null; } catch { j = null; }
    if (!r.ok) {
      const m = String((j as { error?: { message?: unknown } } | null)?.error?.message ?? "");
      return { ok: false, errore: m || `HTTP ${r.status}`, codice: codiceErrore(txt) };
    }
    return { ok: true, dati: (j ?? {}) as T };
  } catch {
    return { ok: false, errore: "Connexion à Google impossible", codice: "" };
  }
}

/** Tutti i link d'azione della scheda (`location` = `locations/{id}`). */
export async function listaAzioni(token: string, location: string): Promise<Esito<AzioneG[]>> {
  const tutte: AzioneG[] = [];
  let pagina = "";
  for (let i = 0; i < 10; i++) {
    const url = `${BASE_AZIONI}/${location}/placeActionLinks?pageSize=100` + (pagina ? `&pageToken=${encodeURIComponent(pagina)}` : "");
    const r = await chiama<{ placeActionLinks?: Record<string, unknown>[]; nextPageToken?: string }>(token, url);
    if (!r.ok) return r;
    for (const x of r.dati.placeActionLinks ?? []) tutte.push(normalizza(x));
    pagina = String(r.dati.nextPageToken ?? "");
    if (!pagina) break;
  }
  return { ok: true, dati: ordina(tutte) };
}

export async function creaAzione(token: string, location: string, tipo: string, uri: string, preferito: boolean): Promise<Esito<AzioneG>> {
  const r = await chiama<Record<string, unknown>>(token, `${BASE_AZIONI}/${location}/placeActionLinks`, {
    method: "POST",
    body: JSON.stringify({ placeActionType: tipo, uri, isPreferred: preferito }),
  });
  return r.ok ? { ok: true, dati: normalizza(r.dati) } : r;
}

/**
 * Rende preferito (o no) un link. Google toglie da solo il preferito di prima
 * dello stesso tipo: «If a future request marks a different link as preferred
 * for the same place action type, then the current preferred link will lose
 * its preference» (riferimento PlaceActionLink).
 */
export async function preferisciAzione(token: string, name: string, preferito: boolean): Promise<Esito<AzioneG>> {
  const r = await chiama<Record<string, unknown>>(token, `${BASE_AZIONI}/${name}?updateMask=isPreferred`, {
    method: "PATCH",
    body: JSON.stringify({ isPreferred: preferito }),
  });
  return r.ok ? { ok: true, dati: normalizza(r.dati) } : r;
}

/** Cambia l'indirizzo di un link (e se e' preferito): stesso link, niente secondo link dello stesso sito. */
export async function aggiornaAzione(token: string, name: string, uri: string, preferito: boolean): Promise<Esito<AzioneG>> {
  const r = await chiama<Record<string, unknown>>(token, `${BASE_AZIONI}/${name}?updateMask=uri,isPreferred`, {
    method: "PATCH",
    body: JSON.stringify({ uri, isPreferred: preferito }),
  });
  return r.ok ? { ok: true, dati: normalizza(r.dati) } : r;
}

export async function togliAzione(token: string, name: string): Promise<Esito<null>> {
  const r = await chiama<unknown>(token, `${BASE_AZIONI}/${name}`, { method: "DELETE" });
  return r.ok ? { ok: true, dati: null } : r;
}
