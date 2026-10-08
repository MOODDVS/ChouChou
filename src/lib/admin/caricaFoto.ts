/**
 * CARICARE UNA FOTO — un gesto, un posto solo.
 *
 * Lo fanno due schermi: la bibliotheque (pagina Assets) e la colonna «Photos»
 * della Accueil. E' una sequenza con quattro modi di fallire — la foto troppo
 * pesante, il file illeggibile, il server che rifiuta il formato, la rete che
 * non c'e' — e scritta due volte sarebbe una sequenza in cui una delle due
 * copie, prima o poi, dimentica un controllo. Quello del peso soprattutto: il
 * server lo rifiuterebbe comunque, ma dopo aver mandato quattro mega in salita
 * da un telefono in sala, per poi dire «troppo grande».
 *
 * ⚠️ LE PAROLE NON STANNO QUI. Questo modulo torna un MOTIVO
 * (`grande` / `illeggibile` / `rifiutata`), e chi chiama lo traduce con le sue
 * chiavi: un modulo che conosce le lingue e' un modulo che va aperto ogni
 * volta che se ne aggiunge una.
 */
import { comprimiFoto } from "./imageCompress";

/** Il tetto del bucket delle immagini: 4 Mo, lo stesso che controlla il
 *  server (`api/admin/upload`). Qui si controlla PRIMA di spedire. */
export const MAX_FOTO_BYTE = 4 * 1024 * 1024;

/** Il bucket delle immagini libere. ⚠️ `popups` e non `menu`: una foto
 *  caricata senza dire a cosa serve non e' una foto di un piatto, e il tag
 *  Menu/Marketing/Site arriva da solo quando (e se) la si monta da qualche
 *  parte. */
export const BUCKET_LIBERO = "popups";

export function troppoGrande(bytes: unknown): boolean {
  // ⚠️ `Number(null)` fa ZERO, non `NaN`: letto cosi', un peso mancante
  // passava il controllo come se il file fosse vuoto, e il file partiva lo
  // stesso. Un peso che non si legge si tratta come troppo grande — non si
  // spedisce al buio.
  if (bytes === null || bytes === undefined || bytes === "") return true;
  const n = Number(bytes);
  return !Number.isFinite(n) || n > MAX_FOTO_BYTE;
}

/** Il contenuto di un file in base64, senza il prefisso `data:`. */
export function base64Di(file: Blob): Promise<string> {
  return new Promise((risolvi, rifiuta) => {
    const r = new FileReader();
    r.onload = () => risolvi(String(r.result).split(",")[1] ?? "");
    r.onerror = () => rifiuta(new Error("illeggibile"));
    r.readAsDataURL(file);
  });
}

export type EsitoFoto =
  | { ok: true; url: string; nome: string }
  | { ok: false; motivo: "grande" | "illeggibile" | "rifiutata"; dettaglio?: string };

/**
 * Comprime, controlla il peso, spedisce. Non lancia: torna l'esito, perche'
 * chi chiama deve accendere e spegnere il suo bottone in ogni caso.
 */
export async function caricaFoto(
  file: File,
  opz: { headers: Record<string, string>; bucket?: string },
): Promise<EsitoFoto> {
  let foto: File;
  try {
    foto = await comprimiFoto(file);
  } catch {
    // La compressione passa dal canvas: un file che non e' un'immagine, o un
    // formato che il browser non apre, muore qui.
    return { ok: false, motivo: "illeggibile" };
  }
  // ⚠️ DOPO la compressione: e' quella che decide il peso vero. Controllarlo
  // prima vorrebbe dire rifiutare uno scatto da 8 Mo che, compresso, ne pesa
  // uno — cioe' quasi tutte le foto fatte col telefono.
  if (troppoGrande(foto.size)) return { ok: false, motivo: "grande" };
  let dati: string;
  try {
    dati = await base64Di(foto);
  } catch {
    return { ok: false, motivo: "illeggibile" };
  }
  if (!dati) return { ok: false, motivo: "illeggibile" };
  try {
    const res = await fetch("/api/admin/upload", {
      method: "POST",
      headers: { ...opz.headers, "Content-Type": "application/json" },
      body: JSON.stringify({ filename: foto.name, data: dati, bucket: opz.bucket ?? BUCKET_LIBERO }),
    });
    const j = (await res.json()) as { url?: string; error?: string };
    if (!res.ok || !j?.url) return { ok: false, motivo: "rifiutata", dettaglio: j?.error };
    return { ok: true, url: String(j.url), nome: foto.name };
  } catch {
    return { ok: false, motivo: "rifiutata" };
  }
}
