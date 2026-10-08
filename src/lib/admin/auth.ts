import { supabaseBrowser } from "../supabaseBrowser";

/**
 * GLI HEADER DELL'AUTORIZZAZIONE, COL TOKEN DI ADESSO.
 *
 * ⚠️ Il token Supabase scade (di norma dopo un'ora) e supabase-js lo rinnova
 * da solo in background. Chi se lo copia una volta sola all'apertura della
 * pagina continua a mandare quello vecchio: su un pannello lasciato aperto
 * ogni salvataggio torna «Non autorisé», e in certi punti il campo sparisce
 * senza spiegazione. E' successo in dodici pagine, corrette una alla volta.
 *
 * Qui la sessione si CHIEDE al momento dell'uso: non c'e' nessuna copia da
 * tenere aggiornata, quindi non c'e' niente che possa restare indietro.
 * `getSession()` legge dalla memoria locale, non fa un giro di rete.
 *
 * Le pagine `google` e `agenda` avevano gia' questa funzione, scritta in
 * casa loro con questo nome; altre dieci ascoltano il rinnovo e riscrivono
 * un oggetto. Questo file e' la destinazione di tutte: si convertono quando
 * le si tocca, non tutte insieme.
 */
export async function authFresh(extra: Record<string, string> = {}): Promise<Record<string, string>> {
  const { data } = await supabaseBrowser.auth.getSession();
  return {
    Authorization: `Bearer ${data.session?.access_token ?? ""}`,
    "Content-Type": "application/json",
    ...extra,
  };
}
