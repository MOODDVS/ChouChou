/**
 * LE REGOLE DELLA SALA — pure, senza database.
 *
 * Stesso principio di `admin/sedeRegole.ts`: questo file NON IMPORTA NIENTE.
 * Cosi' i test girano sulla funzione vera invece che su una copia che puo'
 * divergere, e non si tirano dietro il client Supabase per provare che due
 * tavoli da due fanno quattro posti.
 *
 * Qui dentro c'e' l'unico punto del progetto dove un errore non diventa un
 * numero storto su uno schermo: diventa gente in piedi sulla porta il sabato
 * sera, o un tavolo tenuto vuoto per qualcuno che non arrivera'.
 */

export type TavoliAssegnati = { ids: string[]; names: string[]; zone: string };

export function minutiDi(hhmm: string): number {
  const m = /^(\d{2}):(\d{2})/.exec(hhmm);
  return m ? Number(m[1]) * 60 + Number(m[2]) : -1;
}

/**
 * ⚠️ IL MULTI-SEDE NON C'ENTRA, apposta: questa funzione non sa che le sedi
 * esistono. Riceve i tavoli che `assegnaTavoli` ha gia' letto con il filtro,
 * e il giorno che quel filtro sparisse combinerebbe felicemente un tavolo di
 * Stockel con uno di Jourdan — e la prenotazione risulterebbe seduta in due
 * quartieri. La separazione sta LI', in una riga sola, e c'e' una rete che la
 * guarda. Metterne una seconda qui vorrebbe dire due verita' sullo stesso
 * fatto, che e' il modo in cui si smette di sapere quale vale.
 */
export function scegliCombinazione(
  tavoli: { id: string; zone: string; name: string; seats: number }[],
  legami: Record<string, unknown>,
  occupati: Set<string>,
  zonaPref: string | null,
  zoneChiuse: string[],
  people: number,
  priorita: string[]
): TavoliAssegnati | null {
  const perId = new Map(tavoli.map((t) => [t.id, t]));
  let zone = zonaPref
    ? [zonaPref]
    : [...new Set(tavoli.map((t) => t.zone))].filter((z) => !zoneChiuse.includes(z));
  // Priorità di riempimento (modale Sections): con "Indifférent" si prova
  // PRIMA la section in cima alla lista; senza priorità configurata vince la
  // combinazione globale con meno posti sprecati.
  const conPrio = !zonaPref && priorita.length > 0;
  if (conPrio) {
    const idx = (z: string) => { const i = priorita.indexOf(z); return i === -1 ? 999 : i; };
    zone = [...zone].sort((a, b) => idx(a) - idx(b));
  }

  let best: { ids: string[]; somma: number; zone: string } | null = null;
  const prova = (ids: string[], z: string) => {
    if (ids.some((id) => occupati.has(id) || !perId.has(id))) return;
    const somma = ids.reduce((t, id) => t + (perId.get(id)?.seats ?? 0), 0);
    if (somma < people) return;
    if (!best || somma < best.somma || (somma === best.somma && ids.length < best.ids.length)) {
      best = { ids, somma, zone: z };
    }
  };

  for (const z of zone) {
    for (const t of tavoli) if (t.zone === z) prova([t.id], z);
    const gruppi = Array.isArray(legami[z]) ? (legami[z] as unknown[]) : [];
    for (const g of gruppi) {
      if (!Array.isArray(g)) continue;
      const catena = (g as unknown[]).map(String);
      for (let da = 0; da < catena.length; da++) {
        for (let a = da + 2; a <= catena.length; a++) prova(catena.slice(da, a), z);
      }
    }
    // Con priorità: appena una section (in ordine) ha una combinazione, stop
    if (conPrio && best) break;
  }
  if (!best) return null;
  const b = best as { ids: string[]; somma: number; zone: string };
  return { ids: b.ids, names: b.ids.map((id) => perId.get(id)?.name ?? "?"), zone: b.zone };
}

/** Una sezione della sala e quanti posti vale QUI. */
export interface ZonaPosti {
  name: string;
  seats: number;
}

/**
 * LA CAPIENZA DELLE SEZIONI — da dove vengono i posti.
 *
 * ⚠️ Era scritta DUE VOLTE, in `caricaResaGiorno.ts` e in `api/reservation.ts`,
 * e le due copie erano gia' divergenti: una faceva `trim()` sul nome della
 * sezione e l'altra no, quindi una sezione salvata come «Terrasse » aveva i
 * posti nel pannello e zero nel widget. Nessun errore, solo un widget che
 * rifiutava prenotazioni per una sala vuota.
 *
 * Due sorgenti, e la differenza conta nel multi-sede:
 *
 *   `postiDalPiano` presente (plan de salle acceso) = i posti si contano dai
 *   TAVOLI DISEGNATI di questa sede. Una sezione ereditata dal marchio che
 *   qui non ha tavoli vale zero e sparisce da sola: il conto e' sempre quello
 *   vero del punto.
 *
 *   `postiDalPiano` null (plan spento) = i posti sono quelli scritti nella
 *   configurazione, che una sede EREDITA dal marchio finche' non scrive la
 *   sua. Per un ristorante solo e' esatto. Per un gruppo vuol dire che una
 *   sede non ancora configurata accetta i coperti di un'altra — e la capienza
 *   non e' un dettaglio estetico, decide se una prenotazione entra.
 *
 * Non si "corregge" qui: e' l'ereditarieta', ed e' la stessa di tutto il
 * resto. Si configura la sede. Ma va saputo, e sta scritto.
 */
export function capienzaDelleZone(
  zoneConfig: unknown,
  postiDalPiano: Map<string, number> | null,
): { zones: ZonaPosti[]; capienza: number } {
  const zones: ZonaPosti[] = [];
  let capienza = 0;
  const righe = Array.isArray(zoneConfig) ? zoneConfig : [];
  for (const z of righe as { name?: unknown; seats?: unknown }[]) {
    // ⚠️ `trim()` SEMPRE, e in un posto solo: e' la divergenza che ha reso
    // necessaria questa funzione.
    const name = String(z?.name ?? "").trim();
    if (!name) continue;
    const grezzi = postiDalPiano ? postiDalPiano.get(name) : Number(z?.seats);
    const seats = Math.floor(Number(grezzi));
    if (!Number.isFinite(seats) || seats <= 0) continue;
    zones.push({ name, seats });
    capienza += seats;
  }
  return { zones, capienza };
}

/** Il JSON di `reservation_zones` non e' sempre valido: puo' mancare, essere
 *  vuoto, o essere stato scritto a mano. Rende `[]`, mai un'eccezione. */
export function zoneDaConfig(valore: string | undefined): unknown {
  try {
    return JSON.parse(valore || "[]");
  } catch {
    return [];
  }
}
