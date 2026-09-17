/**
 * FESTIVITA' — calcolo puro delle feste nazionali, per paese e per anno.
 *
 * Questo file non importa NIENTE: e' una tabella e un po' di aritmetica.
 * Si prova con `node --test`, senza database e senza browser.
 *
 * ⚠️ COSA SONO E COSA NON SONO.
 * Le festivita' qui dentro sono un PROMEMORIA, non un orario. Non chiudono
 * niente: il motore continua a leggere solo `special_days` per sapere se il
 * ristorante e' aperto. Una pizzeria lavora il 1° maggio e a Ferragosto —
 * dedurre la chiusura dalla festa sarebbe rifiutare prenotazioni in un
 * giorno di lavoro, cioe' un guasto invisibile finche' non e' troppo tardi.
 * Chi vuole chiudere crea il giorno speciale a mano, come sempre.
 *
 * ⚠️ SONO FESTE NAZIONALI. In Germania e in Spagna quasi ogni regione ne
 * aggiunge di sue (Baviera, Catalogna…), e in Svizzera la festa federale e'
 * una sola: per questo la Svizzera non c'e'. Un elenco incompleto spacciato
 * per completo e' peggio di nessun elenco, quindi i paesi che non sappiamo
 * fare non li facciamo: `festivita()` rende [] e l'admin lo dice.
 */

export type NomiFesta = { fr: string; en: string; it: string; nl: string; es: string };
export type Festa = { data: string; chiave: string; nome: NomiFesta };

/** Regola di una festa: data fissa (m/g) oppure scarto dalla Pasqua (p). */
type Regola = {
  k: string;
  m?: number;
  g?: number;
  /** Giorni dopo la domenica di Pasqua (0 = Pasqua stessa). */
  p?: number;
  /** Se cade di domenica, si sposta al giorno prima (Koningsdag). */
  sePomDomenicaIndietro?: boolean;
};

// ============================================================
// I nomi, una volta sola: le feste si ripetono da un paese all'altro.
// ============================================================
const NOMI: Record<string, NomiFesta> = {
  capodanno:   { fr: "Nouvel An",              en: "New Year's Day",      it: "Capodanno",            nl: "Nieuwjaarsdag",      es: "Año Nuevo" },
  epifania:    { fr: "Épiphanie",              en: "Epiphany",            it: "Epifania",             nl: "Driekoningen",       es: "Reyes" },
  venerdiSanto:{ fr: "Vendredi saint",         en: "Good Friday",         it: "Venerdì santo",        nl: "Goede Vrijdag",      es: "Viernes Santo" },
  pasqua:      { fr: "Pâques",                 en: "Easter Sunday",       it: "Pasqua",               nl: "Eerste Paasdag",     es: "Pascua" },
  pasquetta:   { fr: "Lundi de Pâques",        en: "Easter Monday",       it: "Lunedì dell'Angelo",   nl: "Tweede Paasdag",     es: "Lunes de Pascua" },
  lavoro:      { fr: "Fête du Travail",        en: "Labour Day",          it: "Festa del Lavoro",     nl: "Dag van de Arbeid",  es: "Día del Trabajo" },
  ascensione:  { fr: "Ascension",              en: "Ascension Day",       it: "Ascensione",           nl: "Hemelvaartsdag",     es: "Ascensión" },
  pentecoste:  { fr: "Pentecôte",              en: "Whit Sunday",         it: "Pentecoste",           nl: "Eerste Pinksterdag", es: "Pentecostés" },
  pentecoste2: { fr: "Lundi de Pentecôte",     en: "Whit Monday",         it: "Lunedì di Pentecoste", nl: "Tweede Pinksterdag", es: "Lunes de Pentecostés" },
  corpusDomini:{ fr: "Fête-Dieu",              en: "Corpus Christi",      it: "Corpus Domini",        nl: "Sacramentsdag",      es: "Corpus Christi" },
  assunzione:  { fr: "Assomption",             en: "Assumption",          it: "Ferragosto",           nl: "Maria-Hemelvaart",   es: "Asunción" },
  ognissanti:  { fr: "Toussaint",              en: "All Saints' Day",     it: "Ognissanti",           nl: "Allerheiligen",      es: "Todos los Santos" },
  natale:      { fr: "Noël",                   en: "Christmas Day",       it: "Natale",               nl: "Eerste Kerstdag",    es: "Navidad" },
  santoStefano:{ fr: "Deuxième jour de Noël",  en: "Boxing Day",          it: "Santo Stefano",        nl: "Tweede Kerstdag",    es: "San Esteban" },
  immacolata:  { fr: "Immaculée Conception",   en: "Immaculate Conception", it: "Immacolata",         nl: "Onbevlekte Ontvangenis", es: "Inmaculada Concepción" },

  // Feste di un paese solo
  festaNazBE:  { fr: "Fête nationale belge",   en: "Belgian National Day", it: "Festa nazionale belga", nl: "Nationale feestdag", es: "Fiesta Nacional de Bélgica" },
  armistizio:  { fr: "Armistice 1918",         en: "Armistice Day",       it: "Armistizio 1918",      nl: "Wapenstilstand",     es: "Armisticio de 1918" },
  vittoria45:  { fr: "Victoire 1945",          en: "Victory in Europe Day", it: "Vittoria 1945",      nl: "Bevrijdingsdag 1945", es: "Día de la Victoria" },
  festaNazFR:  { fr: "Fête nationale française", en: "Bastille Day",      it: "Festa nazionale francese", nl: "Quatorze Juillet", es: "Fiesta Nacional de Francia" },
  europa:      { fr: "Journée de l'Europe",    en: "Europe Day",          it: "Giornata dell'Europa", nl: "Dag van Europa",     es: "Día de Europa" },
  festaNazLU:  { fr: "Fête nationale luxembourgeoise", en: "Luxembourg National Day", it: "Festa nazionale lussemburghese", nl: "Nationale feestdag Luxemburg", es: "Fiesta Nacional de Luxemburgo" },
  liberazione: { fr: "Fête de la Libération",  en: "Liberation Day",      it: "Festa della Liberazione", nl: "Bevrijdingsdag",  es: "Día de la Liberación" },
  repubblicaIT:{ fr: "Fête de la République",  en: "Republic Day",        it: "Festa della Repubblica", nl: "Dag van de Republiek", es: "Día de la República" },
  koningsdag:  { fr: "Jour du Roi",            en: "King's Day",          it: "Festa del Re",         nl: "Koningsdag",         es: "Día del Rey" },
  bevrijdingNL:{ fr: "Jour de la Libération",  en: "Liberation Day",      it: "Giorno della Liberazione", nl: "Bevrijdingsdag", es: "Día de la Liberación" },
  unitaDE:     { fr: "Jour de l'Unité allemande", en: "German Unity Day", it: "Giorno dell'Unità tedesca", nl: "Dag van de Duitse Eenheid", es: "Día de la Unidad Alemana" },
  hispanidad:  { fr: "Fête nationale espagnole", en: "National Day of Spain", it: "Festa nazionale spagnola", nl: "Nationale feestdag Spanje", es: "Fiesta Nacional de España" },
  costituzES:  { fr: "Jour de la Constitution", en: "Constitution Day",   it: "Giorno della Costituzione", nl: "Dag van de Grondwet", es: "Día de la Constitución" },
  liberdadePT: { fr: "Jour de la Liberté",     en: "Freedom Day",         it: "Giorno della Libertà", nl: "Dag van de Vrijheid", es: "Día de la Libertad" },
  portugalPT:  { fr: "Jour du Portugal",       en: "Portugal Day",        it: "Festa del Portogallo", nl: "Dag van Portugal",   es: "Día de Portugal" },
  repubblicaPT:{ fr: "Implantation de la République", en: "Republic Day", it: "Proclamazione della Repubblica", nl: "Dag van de Republiek", es: "Implantación de la República" },
  restauracaoPT:{ fr: "Restauration de l'Indépendance", en: "Restoration of Independence", it: "Restaurazione dell'Indipendenza", nl: "Herstel van de Onafhankelijkheid", es: "Restauración de la Independencia" },
};

// ============================================================
// Le tabelle per paese. Feste NAZIONALI, niente regioni.
// ============================================================
const TABELLE: Record<string, Regola[]> = {
  BE: [
    { k: "capodanno", m: 1, g: 1 },
    { k: "pasquetta", p: 1 },
    { k: "lavoro", m: 5, g: 1 },
    { k: "ascensione", p: 39 },
    { k: "pentecoste2", p: 50 },
    { k: "festaNazBE", m: 7, g: 21 },
    { k: "assunzione", m: 8, g: 15 },
    { k: "ognissanti", m: 11, g: 1 },
    { k: "armistizio", m: 11, g: 11 },
    { k: "natale", m: 12, g: 25 },
  ],
  FR: [
    { k: "capodanno", m: 1, g: 1 },
    { k: "pasquetta", p: 1 },
    { k: "lavoro", m: 5, g: 1 },
    { k: "vittoria45", m: 5, g: 8 },
    { k: "ascensione", p: 39 },
    { k: "pentecoste2", p: 50 },
    { k: "festaNazFR", m: 7, g: 14 },
    { k: "assunzione", m: 8, g: 15 },
    { k: "ognissanti", m: 11, g: 1 },
    { k: "armistizio", m: 11, g: 11 },
    { k: "natale", m: 12, g: 25 },
  ],
  LU: [
    { k: "capodanno", m: 1, g: 1 },
    { k: "pasquetta", p: 1 },
    { k: "lavoro", m: 5, g: 1 },
    { k: "europa", m: 5, g: 9 },
    { k: "ascensione", p: 39 },
    { k: "pentecoste2", p: 50 },
    { k: "festaNazLU", m: 6, g: 23 },
    { k: "assunzione", m: 8, g: 15 },
    { k: "ognissanti", m: 11, g: 1 },
    { k: "natale", m: 12, g: 25 },
    { k: "santoStefano", m: 12, g: 26 },
  ],
  NL: [
    { k: "capodanno", m: 1, g: 1 },
    { k: "venerdiSanto", p: -2 },
    { k: "pasqua", p: 0 },
    { k: "pasquetta", p: 1 },
    // Koningsdag: 27 aprile, ma se cade di domenica si festeggia il 26.
    { k: "koningsdag", m: 4, g: 27, sePomDomenicaIndietro: true },
    { k: "bevrijdingNL", m: 5, g: 5 },
    { k: "ascensione", p: 39 },
    { k: "pentecoste", p: 49 },
    { k: "pentecoste2", p: 50 },
    { k: "natale", m: 12, g: 25 },
    { k: "santoStefano", m: 12, g: 26 },
  ],
  DE: [
    { k: "capodanno", m: 1, g: 1 },
    { k: "venerdiSanto", p: -2 },
    { k: "pasquetta", p: 1 },
    { k: "lavoro", m: 5, g: 1 },
    { k: "ascensione", p: 39 },
    { k: "pentecoste2", p: 50 },
    { k: "unitaDE", m: 10, g: 3 },
    { k: "natale", m: 12, g: 25 },
    { k: "santoStefano", m: 12, g: 26 },
  ],
  IT: [
    { k: "capodanno", m: 1, g: 1 },
    { k: "epifania", m: 1, g: 6 },
    { k: "pasqua", p: 0 },
    { k: "pasquetta", p: 1 },
    { k: "liberazione", m: 4, g: 25 },
    { k: "lavoro", m: 5, g: 1 },
    { k: "repubblicaIT", m: 6, g: 2 },
    { k: "assunzione", m: 8, g: 15 },
    { k: "ognissanti", m: 11, g: 1 },
    { k: "immacolata", m: 12, g: 8 },
    { k: "natale", m: 12, g: 25 },
    { k: "santoStefano", m: 12, g: 26 },
  ],
  ES: [
    { k: "capodanno", m: 1, g: 1 },
    { k: "epifania", m: 1, g: 6 },
    { k: "venerdiSanto", p: -2 },
    { k: "lavoro", m: 5, g: 1 },
    { k: "assunzione", m: 8, g: 15 },
    { k: "hispanidad", m: 10, g: 12 },
    { k: "ognissanti", m: 11, g: 1 },
    { k: "costituzES", m: 12, g: 6 },
    { k: "immacolata", m: 12, g: 8 },
    { k: "natale", m: 12, g: 25 },
  ],
  PT: [
    { k: "capodanno", m: 1, g: 1 },
    { k: "venerdiSanto", p: -2 },
    { k: "pasqua", p: 0 },
    { k: "liberdadePT", m: 4, g: 25 },
    { k: "lavoro", m: 5, g: 1 },
    { k: "corpusDomini", p: 60 },
    { k: "portugalPT", m: 6, g: 10 },
    { k: "assunzione", m: 8, g: 15 },
    { k: "repubblicaPT", m: 10, g: 5 },
    { k: "ognissanti", m: 11, g: 1 },
    { k: "restauracaoPT", m: 12, g: 1 },
    { k: "immacolata", m: 12, g: 8 },
    { k: "natale", m: 12, g: 25 },
  ],
};

/** I paesi di cui sappiamo le feste. Gli altri rendono [] — e l'admin lo dice. */
export const PAESI_CON_FESTIVITA: string[] = Object.keys(TABELLE).sort();

export function paeseHaFestivita(paese: string): boolean {
  return Object.prototype.hasOwnProperty.call(TABELLE, (paese || "").toUpperCase());
}

// ============================================================
// Date: aritmetica pura, nessun fuso orario.
// Si lavora in UTC apposta: `new Date(2026, 3, 5)` dipende dal fuso della
// macchina e a Bruxelles darebbe il giorno prima a mezzanotte.
// ============================================================

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Domenica di Pasqua (algoritmo di Meeus/Jones/Butcher, calendario gregoriano). */
export function pasqua(anno: number): string {
  const a = anno % 19;
  const b = Math.floor(anno / 100);
  const c = anno % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mese = Math.floor((h + l - 7 * m + 114) / 31);      // 3 = marzo, 4 = aprile
  const giorno = ((h + l - 7 * m + 114) % 31) + 1;
  return iso(new Date(Date.UTC(anno, mese - 1, giorno)));
}

function piuGiorni(isoData: string, giorni: number): string {
  const [y, m, d] = isoData.split("-").map((n) => parseInt(n, 10));
  return iso(new Date(Date.UTC(y, m - 1, d + giorni)));
}

/**
 * Le feste nazionali di `paese` nell'anno `anno`, in ordine di data.
 * Paese sconosciuto o senza tabella → [] (mai un'eccezione: questa e' una
 * comodita' della home, non deve poter rompere la pagina).
 */
export function festivita(paese: string, anno: number): Festa[] {
  const tab = TABELLE[(paese || "").toUpperCase()];
  if (!tab || !Number.isInteger(anno)) return [];
  const dom = pasqua(anno);
  const out: Festa[] = tab.map((r) => {
    let data: string;
    if (typeof r.p === "number") {
      data = piuGiorni(dom, r.p);
    } else {
      data = iso(new Date(Date.UTC(anno, (r.m as number) - 1, r.g as number)));
      if (r.sePomDomenicaIndietro) {
        const [y, mm, dd] = data.split("-").map((n) => parseInt(n, 10));
        if (new Date(Date.UTC(y, mm - 1, dd)).getUTCDay() === 0) data = piuGiorni(data, -1);
      }
    }
    return { data, chiave: r.k, nome: NOMI[r.k] };
  });
  return out.sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : 0));
}

/**
 * Le prossime `quante` feste a partire da `oggi` (compreso).
 * Guarda l'anno corrente E il successivo: a dicembre le prossime feste sono
 * quasi tutte dell'anno dopo, e una lista vuota dal 26 dicembre al 1° gennaio
 * sarebbe un difetto che si vede una settimana l'anno.
 */
export function prossimeFestivita(paese: string, oggi: string, quante = 4): Festa[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(oggi)) return [];
  const anno = parseInt(oggi.slice(0, 4), 10);
  return [...festivita(paese, anno), ...festivita(paese, anno + 1)]
    .filter((f) => f.data >= oggi)
    .slice(0, Math.max(0, quante));
}

// ============================================================
// Il campo «Paese» era libero: qui si recupera cio' che c'e' gia' scritto.
// ============================================================

/** Nomi gia' visti nel campo libero, per paese. Minuscoli e senza accenti. */
const ALIAS: Record<string, string[]> = {
  BE: ["belgique", "belgium", "belgio", "belgie", "belgien", "belgica"],
  FR: ["france", "francia", "frankrijk", "francie"],
  LU: ["luxembourg", "lussemburgo", "luxemburg", "luxemburgo"],
  NL: ["pays-bas", "pays bas", "netherlands", "paesi bassi", "nederland", "olanda", "holland", "paises bajos"],
  DE: ["allemagne", "germany", "germania", "duitsland", "deutschland", "alemania"],
  IT: ["italie", "italy", "italia", "italie", "italien"],
  ES: ["espagne", "spain", "spagna", "spanje", "espana", "spanien"],
  PT: ["portugal", "portogallo", "portugalia"],
};

function senzaAccenti(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

/**
 * Da quel che c'e' scritto nel campo al codice ISO. Rende "" se non si
 * riconosce — e "" e' giusto: meglio «non impostato» che un paese a caso,
 * perche' un paese sbagliato mostrerebbe le feste di un altro senza che
 * nessuno se ne accorga.
 */
export function codicePaese(grezzo: string): string {
  const s = senzaAccenti(String(grezzo ?? ""));
  if (!s) return "";
  if (/^[a-z]{2}$/.test(s)) return s.toUpperCase();
  for (const [code, nomi] of Object.entries(ALIAS)) {
    if (nomi.includes(s)) return code;
  }
  return "";
}
