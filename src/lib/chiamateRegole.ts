/**
 * «APPELER LE SERVEUR» — le regole, senza database.
 *
 * Il tavolo tocca la campanella, sceglie il suo numero, e il tablet del
 * locale suona. Qui dentro ci sono solo le decisioni (si registra? e' un
 * doppione? sono troppe?), cosi' si provano senza Supabase: le rotte
 * (`api/table-call.ts`, `api/admin/table-calls.ts`) leggono e scrivono, e
 * chiedono a questo file cosa fare.
 */

/** Per quanti minuti una chiamata resta «da sbrigare» per i tablet.
 *  ⚠️ Non di piu': un tablet acceso a meta' servizio non deve suonare per
 *  un tavolo che ha chiamato un'ora fa e ha gia' avuto il suo caffe'. */
export const FINESTRA_CHIAMATE_MIN = 10;

/**
 * QUANTO SI ASPETTA PRIMA DI POTER RICHIAMARE, in minuti: la sceglie il
 * ristoratore nei Réglages (`orders_table_call_wait`), fra questi valori.
 *
 * ⚠️ Quattro valori fissi, non un campo libero: «0» vorrebbe dire un tablet
 * che suona a ogni tocco, «60» un cliente che non puo' piu' chiamare per
 * tutta la cena. ⚠️ Mai oltre `FINESTRA_CHIAMATE_MIN`: la rotta cerca il
 * doppione fra le chiamate di quella finestra, e un'attesa piu' lunga non
 * troverebbe piu' la chiamata da cui contare.
 *
 * ⚠️ Cinque di ripiego: chi ha chiamato e non ha visto nessuno deve poter
 * richiamare — e la seconda chiamata FA suonare di nuovo il tablet, ed e'
 * il promemoria che serve — ma non prima che un cameriere abbia avuto il
 * tempo di arrivare.
 */
export const ATTESE_CHIAMATA = [1, 3, 5, 10] as const;
export const ATTESA_PREDEFINITA = 5;

/** Il valore salvato, letto come minuti d'attesa. Qualunque cosa fuori
 *  dall'elenco (riga assente, valore storto) → il ripiego. */
export function attesaChiamata(valore: unknown): number {
  const n = Number(String(valore ?? "").trim());
  return (ATTESE_CHIAMATA as readonly number[]).includes(n) ? n : ATTESA_PREDEFINITA;
}

/** Oltre queste chiamate aperte insieme, la sede smette di registrarne.
 *  ⚠️ La rotta e' pubblica: senza un tetto, uno script potrebbe far suonare
 *  il tablet tutta la sera. Trenta tavoli che chiamano nello stesso quarto
 *  d'ora non esistono; trenta righe in dieci minuti sono un abuso. */
export const MASSIMO_APERTE = 30;

export interface ChiamataAperta {
  id: string;
  /** Il tavolo; `null` dove la sala non ha tavoli e si chiama col nome. */
  table_id: string | null;
  table_label: string;
  /** Il nome di chi chiama, dove la sala non ha tavoli. */
  caller_name?: string | null;
  /** 'open' | 'done'. Assente = aperta (le righe che la rotta admin legge
   *  sono gia' solo le aperte). */
  status?: string;
  created_at: string;
}

/** CHI chiama, per riconoscere il doppione: il tavolo se c'e', se no il
 *  nome (senza maiuscole: «marc» e «Marc» sono la stessa persona). */
export function chiaveChiamata(c: { table_id?: string | null; caller_name?: string | null }): string {
  if (c.table_id) return `t:${c.table_id}`;
  return `n:${String(c.caller_name ?? "").trim().toLowerCase()}`;
}

/** Cosa si legge sul tablet: il tavolo, o il nome. */
export function etichettaChiamata(c: { table_label?: string | null; caller_name?: string | null }): string {
  return String(c.table_label ?? "").trim() || String(c.caller_name ?? "").trim();
}

export type EsitoChiamata =
  | { tipo: "nuova" }
  /** `restanti`: i secondi che mancano prima di poter richiamare. */
  | { tipo: "gia"; id: string; restanti: number }
  | { tipo: "troppe" };

/** Le chiamate aperte ancora dentro la finestra, dalla piu' vecchia. */
export function aperteNellaFinestra(righe: ChiamataAperta[], adessoMs: number): ChiamataAperta[] {
  const limite = adessoMs - FINESTRA_CHIAMATE_MIN * 60_000;
  return righe
    .filter((r) => {
      const t = Date.parse(r.created_at);
      return Number.isFinite(t) && t >= limite && t <= adessoMs + 60_000;
    })
    .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
}

/**
 * Si registra una chiamata nuova?
 *
 * ⚠️ IL DOPPIONE NON E' UN ERRORE per chi l'ha fatto: il cliente ha toccato
 * due volte e il cameriere e' gia' avvisato. Gli si risponde «fatto» lo
 * stesso — dirgli «errore» lo farebbe toccare una terza volta.
 */
export function decidiChiamata(
  righe: ChiamataAperta[],
  chiave: string,
  adessoMs: number,
  attesaMin: number = ATTESA_PREDEFINITA,
): EsitoChiamata {
  const valide = aperteNellaFinestra(righe, adessoMs);
  /* ⚠️ Il doppione si cerca anche fra le chiamate GIA' SBRIGATE: il
     cameriere ha toccato «ci vado» dopo trenta secondi, ma l'attesa scelta
     dal ristoratore vale lo stesso — se no un tocco sul tablet azzererebbe
     il timer del cliente. */
  const attesaMs = attesaMin * 60_000;
  const recente = [...valide]
    .reverse()
    .find((c) => chiaveChiamata(c) === chiave && adessoMs - Date.parse(c.created_at) < attesaMs);
  if (recente) {
    const restanti = Math.max(1, Math.ceil((Date.parse(recente.created_at) + attesaMs - adessoMs) / 1000));
    return { tipo: "gia", id: recente.id, restanti };
  }
  // Il tetto conta solo quelle ancora da sbrigare.
  const aperte = valide.filter((c) => (c.status ?? "open") === "open");
  if (aperte.length >= MASSIMO_APERTE) return { tipo: "troppe" };
  return { tipo: "nuova" };
}
