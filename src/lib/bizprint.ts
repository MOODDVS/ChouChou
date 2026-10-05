/**
 * IL SERVIZIO DI STAMPA — l'unico posto che parla con BizPrint.
 *
 * ⚠️ LE CHIAVI NON ESCONO DA QUI. Stanno nell'ambiente del cliente e non
 * devono mai arrivare al browser: il pannello chiede l'elenco al SERVER, e il
 * server risponde con nomi e numeri. E' la stessa lezione del 04/10, quando
 * uno script mascherava solo le chiavi che conosceva e ha stampato in chiaro
 * quelle delle station: la maschera si scrive sul NOME del campo.
 *
 * ⚠️ La firma di un POST si calcola sul corpo INTERO, publicKey e time
 * compresi. Firmare solo i campi nostri da' 401 senza spiegazioni.
 */
import { createHash } from "node:crypto";

const BASE = "https://print.bizswoop.app/api/connect-application/v1";

/** ⚠️ Scritte per esteso, non con un accesso calcolato: Vite sostituisce
 *  `import.meta.env.X` guardando il testo, e `import.meta.env[nome]` non lo
 *  sostituisce affatto — sarebbe `undefined` nel build, cioe' una stampa che
 *  funziona in sviluppo e non in produzione. `process.env` fa da rete. */
function chiavi(): { pub: string; sec: string } {
  const pub = String(import.meta.env.BIZPRINT_PUBLIC_KEY ?? process.env.BIZPRINT_PUBLIC_KEY ?? "").trim();
  const sec = String(import.meta.env.BIZPRINT_SECRET_KEY ?? process.env.BIZPRINT_SECRET_KEY ?? "").trim();
  return { pub, sec };
}

/** Questo cliente ha un servizio di stampa configurato? */
export function stampaConfigurata(): boolean {
  const { pub, sec } = chiavi();
  return pub !== "" && sec !== "";
}

export interface Stampante {
  id: number;
  nome: string;
  /** Quello che dice il servizio: `online`, `offline`… Si mostra com'e'. */
  stato: string;
  /** Il punto dove e' collegata, per riconoscerla nell'elenco. */
  station: string;
}

/** L'elenco delle stampanti dell'applicazione di QUESTO cliente.
 *  ⚠️ Rende solo id, nome, stato e station: la risposta vera contiene anche
 *  le chiavi delle station, e non devono uscire di qui. */
export async function elencoStampanti(): Promise<{ ok: boolean; stampanti: Stampante[]; errore?: string }> {
  const { pub, sec } = chiavi();
  if (!pub || !sec) return { ok: false, stampanti: [], errore: "chiavi mancanti" };
  const q = new URLSearchParams({ publicKey: pub, time: String(Math.floor(Date.now() / 1000)) });
  q.set("hash", createHash("sha256").update(`${q.toString()}:${sec}`).digest("hex"));
  try {
    const r = await fetch(`${BASE}/printers?${q}`, { signal: AbortSignal.timeout(10_000) });
    if (!r.ok) return { ok: false, stampanti: [], errore: `HTTP ${r.status}` };
    const j = (await r.json()) as { data?: unknown[] };
    const righe = Array.isArray(j?.data) ? j.data : [];
    return {
      ok: true,
      stampanti: righe.map((x) => {
        const r2 = x as { id?: number; name?: string; status?: string; station?: { name?: string } };
        return {
          id: Number(r2?.id ?? 0),
          nome: String(r2?.name ?? "").trim(),
          stato: String(r2?.status ?? "").trim(),
          station: String(r2?.station?.name ?? "").trim(),
        };
      }).filter((s) => s.id > 0),
    };
  } catch (e) {
    // ⚠️ Il messaggio dell'errore, non un «impossibile»: rete caduta, chiavi
    // rifiutate e servizio fermo si curano in tre modi diversi.
    return { ok: false, stampanti: [], errore: String((e as Error)?.message ?? e) };
  }
}

/**
 * Mette in stampa l'indirizzo di una pagina.
 *
 * ⚠️ `ok` vuol dire SPEDITO, non stampato. Il lavoro passa per il cloud, per
 * il tablet e per la stampante e puo' morire in ognuno dei tre: «stampato» lo
 * dice la conferma di ritorno, mai noi.
 */
export async function mandaStampa(
  printerId: number,
  url: string,
  descrizione: string,
): Promise<{ ok: boolean; jobId?: string; errore?: string }> {
  const { pub, sec } = chiavi();
  if (!pub || !sec) return { ok: false, errore: "chiavi mancanti" };
  if (!Number.isFinite(printerId) || printerId <= 0) return { ok: false, errore: "stampante non indicata" };
  const corpo = { printerId, url, description: descrizione, publicKey: pub, time: Math.floor(Date.now() / 1000) };
  const hash = createHash("sha256").update(`${JSON.stringify(corpo)}:${sec}`).digest("hex");
  try {
    const r = await fetch(`${BASE}/jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...corpo, hash }),
      signal: AbortSignal.timeout(15_000),
    });
    const testo = await r.text();
    if (!r.ok) {
      // Il corpo dell'errore puo' contenere l'eco delle chiavi: si taglia e
      // si maschera sul nome del campo, non sul valore atteso.
      const pulito = testo.replace(/"(secretKey|publicKey|key|token|apiKey|hash)"\s*:\s*"[^"]*"/gi, '"$1":"***"');
      return { ok: false, errore: `HTTP ${r.status} ${pulito.slice(0, 200)}` };
    }
    let jobId: string | undefined;
    try {
      const j = JSON.parse(testo) as { data?: { id?: unknown }; id?: unknown };
      const n = j?.data?.id ?? j?.id;
      if (n !== undefined && n !== null) jobId = String(n);
    } catch { /* risposta non JSON: il lavoro e' partito lo stesso */ }
    return { ok: true, jobId };
  } catch (e) {
    return { ok: false, errore: String((e as Error)?.message ?? e) };
  }
}
