/**
 * IL PIANO DI SALA — le regole, senza database.
 *
 * ⚠️ Questo file non importa niente. Vive qui e non dentro `planSalle.ts`
 * perche' quello arriva a `db.ts`, che in vitest lancia all'import: le
 * regole che si possono provare davvero devono restare raggiungibili.
 *
 * La domanda a cui risponde e' una sola, da due lati: QUALI RIGHE DI
 * `restaurant_tables` SONO TAVOLI VERI. Le sections vivono in `app_config`
 * (`reservation_zones`), i tavoli in una tabella: niente tiene insieme le
 * due cose, quindi cancellare o rinominare una section lascia i suoi tavoli
 * nel database, agganciati a una zona che non esiste piu'.
 */

/**
 * I NOMI DELLE SECTIONS, da `reservation_zones` — `[{ name, seats }]`.
 *
 * ⚠️ Elenco VUOTO vuol dire due cose diverse e qui non si distinguono:
 * «non ne ha mai configurate» e «la configurazione e' illeggibile». Chi
 * chiama deve trattarle allo stesso modo — tenere tutto, non cancellare
 * niente — perche' sbagliare dalla parte opposta svuota una sala vera.
 */
function nomiDelleSezioni(sezioniConfigurate: unknown): string[] {
  try {
    const zs = typeof sezioniConfigurate === "string"
      ? JSON.parse(sezioniConfigurate || "[]")
      : sezioniConfigurate;
    if (!Array.isArray(zs)) return [];
    return (zs as { name?: unknown }[])
      .map((z) => String(z?.name ?? "").trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

/** Un tavolo come lo vede chi e' seduto: il nome sul cartoncino e la zona. */
export interface TavoloDiSala {
  id: string;
  name: string;
  zone: string;
}

/**
 * I TAVOLI CHE ESISTONO DAVVERO, dalle righe grezze di `restaurant_tables`.
 *
 * ⚠️ UNA RIGA NON E' UN TAVOLO. Quando il ristoratore rinomina o cancella una
 * section nei Réglages, i tavoli che ci stavano dentro RESTANO nel database
 * con il nome vecchio della zona. Il piano di sala non li mostra piu' (li
 * chiede sempre per zona), quindi nessuno se ne accorge — ma una lettura
 * senza filtro li ripesca tutti. Nel selettore del QR si vedevano due «T1»:
 * uno vero e uno fantasma, e chi toccava quello sbagliato mandava i piatti
 * a un tavolo che non esiste piu'.
 * E' la stessa regola che `planSalle.ts` applica da sempre per assegnare i
 * tavoli alle prenotazioni: qui si e' solo smesso di essere l'eccezione.
 *
 * ⚠️ Nessuna section configurata → si tiene tutto. Un locale che non ha mai
 * aperto i Réglages delle sections non deve ritrovarsi la sala vuota.
 *
 * ⚠️ L'ordine e' quello delle SECTIONS come le ha messe lui, non l'alfabeto:
 * «Interno, Terrazzo, Strada» e' come gira il cameriere. Dentro la zona i
 * nomi si confrontano in modo numerico, cosi' «T10» viene dopo «T2» e non
 * prima come farebbe un ordinamento per testo.
 */
export function tavoliDelPiano(righe: unknown, sezioniConfigurate: unknown): TavoloDiSala[] {
  const nomiSezioni = nomiDelleSezioni(sezioniConfigurate);
  const valide = new Set(nomiSezioni);
  const posto = new Map(nomiSezioni.map((n, i) => [n, i]));
  const lista = Array.isArray(righe) ? righe : [];

  return lista
    .map((r) => {
      const t = (r ?? {}) as { id?: unknown; name?: unknown; zone?: unknown };
      return {
        id: String(t.id ?? ""),
        name: String(t.name ?? "").trim(),
        zone: String(t.zone ?? "").trim(),
      };
    })
    .filter((t) => t.id && t.name && t.zone && (valide.size === 0 || valide.has(t.zone)))
    .sort((a, b) =>
      (posto.get(a.zone) ?? Number.MAX_SAFE_INTEGER) - (posto.get(b.zone) ?? Number.MAX_SAFE_INTEGER) ||
      a.zone.localeCompare(b.zone) ||
      a.name.localeCompare(b.name, undefined, { numeric: true })
    );
}

/** Una section sparita e i tavoli che si e' lasciata dietro. */
export interface SezioneOrfana {
  zone: string;
  tavoli: number;
}

/**
 * I TAVOLI RIMASTI SENZA SECTION, raggruppati per zona.
 *
 * ⚠️ E' l'immagine allo specchio di `tavoliDelPiano`, e serve a dirlo al
 * ristoratore invece di lasciarglielo scoprire da un selettore con due «T1».
 * Si calcola contro le sections ATTUALI, non contro quelle di prima: cosi'
 * il primo salvataggio dopo questo cambiamento fa emergere anche i fantasmi
 * che si erano gia' accumulati, che nessuno aveva mai contato.
 *
 * ⚠️ Nessuna section configurata → NESSUN orfano. Non e' una svista: senza
 * un elenco di sections non esiste il concetto di «fuori dall'elenco», e
 * rispondere altrimenti vorrebbe dire proporre di cancellare tutta la sala
 * di un locale che non ha mai aperto quei Réglages.
 */
export function orfaniDelPiano(righe: unknown, sezioniConfigurate: unknown): SezioneOrfana[] {
  const valide = new Set(nomiDelleSezioni(sezioniConfigurate));
  if (valide.size === 0) return [];
  const conteggio = new Map<string, number>();
  for (const r of Array.isArray(righe) ? righe : []) {
    const zone = String((r as { zone?: unknown })?.zone ?? "").trim();
    if (!zone || valide.has(zone)) continue;
    conteggio.set(zone, (conteggio.get(zone) ?? 0) + 1);
  }
  return [...conteggio.entries()]
    .map(([zone, tavoli]) => ({ zone, tavoli }))
    .sort((a, b) => a.zone.localeCompare(b.zone));
}
