/**
 * I DOCUMENTI DELL'ADMIN IN UN BUCKET PRIVATO (audit 3/11/2026, punto 5).
 *
 * Contratti, fatture e ricevute (Réglages → Documents) stavano nel bucket
 * `documents`, che e' PUBBLICO perche' serve anche i PDF del sito (Assets →
 * Documents: menu, volantini). Un link a un contratto, una volta uscito,
 * restava aperto per sempre a chiunque.
 *
 * Con la migrazione #93 nasce `admin_docs`, privato: si legge solo con un
 * link firmato che scade (`DURATA_LINK`). I percorsi sono GLI STESSI
 * (`<radice><cat>/<nome>`), cosi' i metadati (`admin_docs_meta.path`) non
 * cambiano. I file gia' caricati si spostano da soli alla prima lettura
 * della lista (`spostaNelPrivato`).
 *
 * ⚠️ Senza la #93 tutto resta come prima: bucket `documents`, link pubblici.
 */
import { supabaseAdmin } from "../db";

export const BUCKET_PUBBLICO = "documents";
export const BUCKET_PRIVATO = "admin_docs";
/** Un'ora: il tempo di aprire, leggere, scaricare. La lista si rilegge. */
export const DURATA_LINK = 3600;

let privato: boolean | null = null;
let ricontrolla = 0;

/** Il bucket da usare: il privato se la #93 e' lanciata. */
export async function bucketDocs(): Promise<string> {
  if (privato !== true && Date.now() >= ricontrolla) {
    try {
      const { data, error } = await supabaseAdmin.storage.getBucket(BUCKET_PRIVATO);
      privato = !error && !!data;
    } catch {
      privato = false;
    }
    // Trovato: non si chiede piu'. Assente: si richiede tra un minuto, cosi'
    // la #93 lanciata a server acceso vale subito, senza un riavvio.
    ricontrolla = Date.now() + 60_000;
  }
  return privato ? BUCKET_PRIVATO : BUCKET_PUBBLICO;
}

/** I link per una lista di percorsi, nell'ordine dato ("" se non riesce). */
export async function linkDocs(bucket: string, percorsi: string[]): Promise<string[]> {
  if (!percorsi.length) return [];
  if (bucket === BUCKET_PUBBLICO) {
    return percorsi.map((p) => supabaseAdmin.storage.from(bucket).getPublicUrl(p).data.publicUrl);
  }
  const { data } = await supabaseAdmin.storage.from(bucket).createSignedUrls(percorsi, DURATA_LINK);
  const per = new Map((data ?? []).map((d) => [d.path ?? "", d.signedUrl ?? ""]));
  return percorsi.map((p) => per.get(p) ?? "");
}

const giaVuote = new Set<string>();

/**
 * Sposta nel privato i file rimasti nel pubblico, sotto queste cartelle.
 * Prima la copia, poi la cancellazione: se si ferma a meta', il file c'e'
 * in tutti e due i bucket e il giro dopo lo finisce. Mai bloccante.
 */
export async function spostaNelPrivato(cartelle: string[]): Promise<number> {
  if ((await bucketDocs()) !== BUCKET_PRIVATO) return 0;
  let spostati = 0;
  for (const cartella of cartelle) {
    if (giaVuote.has(cartella)) continue;
    try {
      const { data, error } = await supabaseAdmin.storage.from(BUCKET_PUBBLICO).list(cartella, { limit: 1000 });
      if (error) continue;
      // `list()` rende anche le sottocartelle: hanno `id` nullo.
      const file = (data ?? []).filter((f) => f.name && f.id !== null);
      if (!file.length) { giaVuote.add(cartella); continue; }
      for (const f of file) {
        const percorso = `${cartella}/${f.name}`;
        const { data: blob, error: e1 } = await supabaseAdmin.storage.from(BUCKET_PUBBLICO).download(percorso);
        if (e1 || !blob) continue;
        const tipo = String((f.metadata as Record<string, unknown> | null)?.mimetype ?? blob.type ?? "application/octet-stream");
        const { error: e2 } = await supabaseAdmin.storage
          .from(BUCKET_PRIVATO)
          .upload(percorso, blob, { contentType: tipo, upsert: true });
        if (e2) continue;
        const { error: e3 } = await supabaseAdmin.storage.from(BUCKET_PUBBLICO).remove([percorso]);
        if (!e3) spostati++;
      }
    } catch {
      /* rete o bucket: si riprova alla prossima lettura */
    }
  }
  return spostati;
}
