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

/* ==================================================================
   I TAVOLI GIA' APERTI DAL QR — quali non si possono piu' scegliere
   ================================================================== */

/** "HH:MM" o "HH:MM:SS" (le colonne `time` tornano coi secondi) → minuti. */
function minutiDi(v: unknown): number | null {
  const m = /^(\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/.exec(String(v ?? "").trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  return h > 23 || mi > 59 ? null : h * 60 + mi;
}

/** Quanto dura un servizio, per chiave, e il ripiego. */
export interface DurateServizio {
  perServizio: Record<string, number>;
  ripiego: number;
}

/**
 * LE DURATE DEI SERVIZI, dai Reglages — le stesse del piano sala.
 *
 * ⚠️ Stesse regole di `planSalle.ts` (fra 15 e 360 minuti, 90 se manca): un
 * tavolo deve risultare occupato per il QR quanto lo e' per le prenotazioni,
 * o il piano direbbe «libero» un tavolo che il QR dice «preso».
 */
export function durateDelServizio(servizi: unknown, tenutaMinuti: unknown): DurateServizio {
  const n = Math.floor(Number(tenutaMinuti));
  const ripiego = Number.isFinite(n) && String(tenutaMinuti ?? "").trim() !== "" ? Math.min(360, Math.max(15, n)) : 90;
  const perServizio: Record<string, number> = {};
  try {
    const arr = typeof servizi === "string" ? JSON.parse(servizi || "[]") : servizi;
    if (Array.isArray(arr)) {
      for (const sv of arr as { key?: unknown; hold?: unknown }[]) {
        const k = String(sv?.key ?? "").trim();
        const h = Math.floor(Number(sv?.hold));
        if (k) perServizio[k] = Number.isFinite(h) ? Math.min(360, Math.max(15, h)) : ripiego;
      }
    }
  } catch { /* servizi illeggibili: vale il ripiego */ }
  return { perServizio, ripiego };
}

/**
 * I TAVOLI CHE QUALCUNO HA GIA' APERTO DAL QR, adesso.
 *
 * ⚠️ SOLO QUELLI APERTI DAL QR (`source = "qr"`), MAI QUELLI DELLE
 * PRENOTAZIONI. Chi ha prenotato e ha avuto T7 si siede a T7 e inquadra il
 * QR: se T7 fosse bloccato perche' «e' di una prenotazione», non potrebbe
 * ordinare dal proprio tavolo. Deciso il 16/10/2026.
 *
 * ⚠️ E SCADONO DA SOLI. Una sessione dal QR resta «seated» finche' qualcuno
 * non la chiude, e senza una fine il tavolo resterebbe bloccato per tutta la
 * sera ai clienti dopo. Vale la stessa finestra del piano sala: dall'ora di
 * apertura per la durata del servizio, piu' i minuti aggiunti a mano. La sala
 * puo' liberarlo prima chiudendo la prenotazione nell'admin.
 *
 * ⚠️ Una sessione aperta prima di mezzanotte e guardata dopo: l'ora di adesso
 * si sposta di un giorno, se no un tavolo aperto alle 23:30 risulterebbe
 * libero alle 00:15.
 */
interface SessioneQr {
  id?: unknown; heure?: unknown; tables?: unknown; service_key?: unknown;
  extra_minutes?: unknown; source?: unknown; status?: unknown; first_name?: unknown;
}

/** Le sessioni aperte dal QR ancora dentro la loro finestra, adesso. */
function sessioniApertiAlQr(righe: unknown, adesso: string, durate: DurateServizio): SessioneQr[] {
  const ora = minutiDi(adesso);
  if (ora === null) return [];
  const valide: SessioneQr[] = [];
  for (const r of Array.isArray(righe) ? righe : []) {
    const x = (r ?? {}) as SessioneQr;
    if (x.status !== "seated" || x.source !== "qr") continue;
    const inizio = minutiDi(x.heure);
    if (inizio === null) continue;
    const durata = (durate.perServizio[String(x.service_key ?? "")] ?? durate.ripiego)
      + Math.max(0, Math.floor(Number(x.extra_minutes)) || 0);
    const adessoRelativo = ora < inizio ? ora + 1440 : ora;
    if (adessoRelativo >= inizio + durata) continue;
    valide.push(x);
  }
  return valide;
}

export function tavoliPresiAlQr(righe: unknown, adesso: string, durate: DurateServizio): string[] {
  const presi = new Set<string>();
  for (const x of sessioniApertiAlQr(righe, adesso, durate)) {
    for (const t of Array.isArray(x.tables) ? x.tables : []) presi.add(String(t));
  }
  return [...presi];
}

/** L'iniziale di un nome, maiuscola: «marc» → «M», «Élodie» → «É». */
export function inizialeDi(nome: unknown): string {
  const n = String(nome ?? "").trim();
  if (!n) return "";
  return [...n][0].toLocaleUpperCase("fr");
}

/** Un tavolo aperto dal QR, con le iniziali di chi c'e' seduto. */
export interface TavoloAperto {
  id: string;
  iniziali: string[];
}

/**
 * I TAVOLI APERTI ADESSO, e CHI ci e' seduto — solo le iniziali.
 *
 * ⚠️ Non si spengono piu' (16/10/2026): il caso normale al tavolo sono
 * amici seduti insieme, ognuno col suo telefono e il suo conto. Spegnere il
 * tavolo aperto impediva al secondo di ordinare dal SUO tavolo. Il server
 * aggancia gia' la stessa sessione; la pagina ora accende il tavolo e mostra
 * chi c'e', cosi' chi lo sceglie vede «ah, Marc e' gia' qui».
 *
 * ⚠️ SOLO LE INIZIALI, MAI I NOMI: questa lista arriva al telefono di
 * chiunque inquadri il QR, anche a chi siede a un altro tavolo. «M» basta a
 * riconoscere l'amico; «Marc Dupont» sarebbe il nome di uno sconosciuto
 * servito a chiunque.
 *
 * ⚠️ CONTA SOLO CHI HA ORDINATO DAVVERO (16/10/2026). La sessione nasce
 * quando si preme «Payer et commander», cioe' PRIMA di Stripe: chi poi torna
 * indietro senza pagare accendeva il tavolo per tutta la sera, col suo nome.
 * Quindi: un tavolo e' «aperto» solo se sulla sua sessione c'e' almeno un
 * ordine CONFERMATO (`ordini`, gia' filtrati da chi legge: pagati, o da
 * pagare in cassa), e le iniziali sono quelle dei nomi su quegli ordini —
 * non di chi ha aperto la sessione, che magari non ha mai pagato.
 * Senza doppioni, al massimo quattro.
 */
export function tavoliApertiAlQr(
  righe: unknown,
  adesso: string,
  durate: DurateServizio,
  ordini: { reservation_id?: unknown; customer_name?: unknown }[] = [],
): TavoloAperto[] {
  const perTavolo = new Map<string, string[]>();
  for (const x of sessioniApertiAlQr(righe, adesso, durate)) {
    const suoi = ordini.filter((o) => String(o.reservation_id ?? "") === String(x.id ?? ""));
    if (suoi.length === 0) continue; // aperta ma senza un ordine confermato: non conta
    const nomi = suoi.map((o) => o.customer_name);
    for (const t of Array.isArray(x.tables) ? x.tables : []) {
      const lista = perTavolo.get(String(t)) ?? [];
      for (const n of nomi) {
        const i = inizialeDi(n);
        if (i && !lista.includes(i) && lista.length < 4) lista.push(i);
      }
      perTavolo.set(String(t), lista);
    }
  }
  return [...perTavolo].map(([id, iniziali]) => ({ id, iniziali }));
}
