/**
 * I BUONI REGALO — le regole, pure, senza database.
 *
 * Stesso patto di `sedeRegole.ts`, `salaRegole.ts`, `clientiRegole.ts`,
 * `menuRegole.ts`, `statsRegole.ts` e `googleRegole.ts`: qui dentro non si
 * legge niente, quindi i test girano sulla funzione vera e non su una copia.
 *
 * ------------------------------------------------------------------
 * IL MODELLO, in tre righe, perche' e' l'unico punto del motore in cui il
 * DENARO attraversa il confine fra due societa':
 *
 *   il BUONO e' del marchio     — si compra ovunque e si spende ovunque
 *   la VENDITA e' di un punto   — una societa' precisa ha incassato
 *   l'USO e' di un punto        — un'altra societa' serve il cliente
 *
 * Il buono non ha un proprietario: ha un venditore e uno o piu' utilizzatori.
 * Sono tre cose diverse, e confonderle costa in due modi opposti.
 *
 * ⚠️ `gift_cards` resta «marchio» in CLASSIFICA, e NON si filtra mai per
 * sede. `sold_at_location` dice CHI HA INCASSATO, non a chi appartiene la
 * riga — per questo si chiama cosi' e non `location_id`. Il giorno che
 * qualcuno "sistemasse" la tabella in «sede», un buono comprato a Jourdan
 * risulterebbe inesistente a Stockel: il cliente si sentirebbe dire che il
 * suo codice non esiste, e nessun errore comparirebbe da nessuna parte.
 * Una rete in `tests/buoni.test.mjs` difende esattamente questo.
 *
 * L'errore nell'altra direzione — non registrare dove si e' venduto — non
 * si vede per mesi e poi non e' piu' ricostruibile: a fine anno nessuno sa
 * quanto Jourdan deve a Stockel, e non c'e' query che possa dirlo.
 * ------------------------------------------------------------------
 */
import type { Ambito } from "./admin/sedeRegole";

/**
 * CHI INCASSA questo buono.
 *
 * E' il gemello opposto di `sedeDaScrivere()`: quella dice a chi APPARTIENE
 * una riga e per una tabella del marchio rende sempre NULL; questa dice chi
 * ha preso i soldi, e per un buono e' sempre un punto preciso — anche se la
 * riga e' del marchio. La sede e' quella di chi sta creando il buono: e'
 * la stessa da cui esce il link di pagamento Stripe, quindi il conto e la
 * cassa non possono divergere.
 *
 * `tutte` lancia, come in scrittura: l'aggregato e' di sola lettura, e un
 * incasso attribuito a "tutte le sedi" non sarebbe attribuito a nessuna.
 */
export function sedeDiVendita(ambito: Ambito): string | null {
  if (ambito.modo === "tutte") {
    throw new Error('Vendita di un buono senza una sede: "tutte" e\' un ambito di sola lettura.');
  }
  if (ambito.modo === "unica") return null; // un punto solo: NULL e' la verita'
  return ambito.id;
}

/** Un buono, per il conto. `paid: false` = link di pagamento ancora in
 *  attesa: il cartoncino esiste, i soldi no. */
export type BuonoVenduto = {
  id: string;
  code?: string | null;
  initial_cents: number;
  paid?: boolean | null;
  sold_at_location?: string | null;
};

/** Una riga del registro. `location_id` = DOVE e' stato speso. */
export type RiscattoRiga = {
  gift_card_id: string;
  amount_cents: number | null;
  location_id?: string | null;
};

/** Quanto ha incassato e quanto ha servito un punto.
 *  `saldo` positivo = ha incassato piu' di quanto ha servito, quindi deve
 *  agli altri. `id` null = riga senza sede (storico, o punto unico). */
export type QuotaSede = { id: string | null; venduto: number; speso: number; saldo: number };

export type ContoBuoni = {
  quote: QuotaSede[];
  venduto: number;
  speso: number;
  /** Valore ancora da onorare: il debito del gruppo verso i clienti. */
  aperto: number;
  /** Buoni spesi per piu' di quanto valgono: non deve succedere mai. Si
   *  RIPORTANO invece di lanciare — questo conto finisce in una pagina, e
   *  una pagina bianca non aiuta nessuno a capire cos'e' andato storto. */
  incoerenti: string[];
};

/**
 * IL CONTO FRA LE SOCIETA'.
 *
 * ⚠️ Vuole le DUE liste INTERE, non filtrate per sede. E' l'unico modo di
 * avere un conto che torna: filtrando i riscatti, il punto che ha venduto
 * risulterebbe creditore di soldi che ha gia' visto spendere altrove.
 * E' la stessa ragione per cui il registro, nella scheda del buono, si
 * legge senza filtro.
 */
export function contoDeiBuoni(dati: {
  buoni: BuonoVenduto[];
  riscatti: RiscattoRiga[];
}): ContoBuoni {
  const per = new Map<string | null, QuotaSede>();
  const quota = (id: string | null): QuotaSede => {
    const c = per.get(id) ?? { id, venduto: 0, speso: 0, saldo: 0 };
    per.set(id, c);
    return c;
  };

  let venduto = 0;
  const valore = new Map<string, number>();
  const nome = new Map<string, string>();
  for (const b of dati.buoni) {
    const cents = Math.max(0, Math.floor(Number(b.initial_cents) || 0));
    valore.set(b.id, cents);
    nome.set(b.id, b.code || b.id);
    // Un buono non pagato non e' un incasso: esiste il cartoncino, non i soldi.
    if (b.paid === false) continue;
    quota(b.sold_at_location ?? null).venduto += cents;
    venduto += cents;
  }

  let speso = 0;
  const spesoPerBuono = new Map<string, number>();
  for (const r of dati.riscatti) {
    const cents = Math.max(0, Math.floor(Number(r.amount_cents) || 0));
    if (!cents) continue;
    quota(r.location_id ?? null).speso += cents;
    speso += cents;
    spesoPerBuono.set(r.gift_card_id, (spesoPerBuono.get(r.gift_card_id) ?? 0) + cents);
  }

  const incoerenti: string[] = [];
  for (const [id, usato] of spesoPerBuono) {
    const vale = valore.get(id);
    if (vale === undefined || usato > vale) incoerenti.push(nome.get(id) ?? id);
  }

  const quote = [...per.values()]
    .map((q) => ({ ...q, saldo: q.venduto - q.speso }))
    .sort((a, b) => b.saldo - a.saldo);

  return { quote, venduto, speso, aperto: venduto - speso, incoerenti };
}

/* ============================================================
   IL RELEVE' PER IL CONTABILE
   ============================================================ */

/**
 * IL GIORNO in cui una cosa e' successa, visto dal ristorante.
 *
 * ⚠️ `created_at` e' un istante UTC. Una vendita del 31 dicembre alle 23:30
 * a Bruxelles e' gia' il 1° gennaio in UTC: tagliando la stringa ISO
 * finirebbe nell'esercizio sbagliato. Su un documento contabile non e' un
 * dettaglio — e' l'unico errore che qualcuno poi deve spiegare.
 *
 * `en-CA` rende gia' AAAA-MM-GG, quindi niente ricomposizione a mano.
 */
export function giornoLocale(iso: string | null | undefined, fuso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: fuso,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(d);
  } catch {
    return d.toISOString().slice(0, 10); // fuso ignoto: meglio UTC che niente
  }
}

export type BuonoDelReleve = BuonoVenduto & {
  created_at?: string | null;
  payment_method?: string | null;
};
export type RiscattoDelReleve = RiscattoRiga & {
  created_at?: string | null;
  kind?: string | null;
};

export type RigaVendita = {
  codice: string;
  giorno: string;
  valore: number;
  pagato: boolean;
  metodo: string;
};
export type RigaUso = {
  codice: string;
  giorno: string;
  importo: number;
  kind: string;
  /** La sede che aveva VENDUTO quel buono. */
  vendutoDa: string | null;
  /** La sede dove e' stato SPESO. Sono due domande diverse, e su un
   *  documento contabile devono restare due colonne diverse: era una sola,
   *  riusata per entrambe, e chi legge non poteva sapere quale delle due
   *  stava guardando. */
  usatoA: string | null;
};

export type Releve = {
  vendite: RigaVendita[];
  /** Riscatti avvenuti DA NOI nel periodo. */
  usi: RigaUso[];
  /** Nostri buoni onorati ALTROVE nel periodo. */
  altrove: RigaUso[];
  totali: {
    venduto: number;
    /** Solo i buoni effettivamente pagati: un link in attesa non e' cassa. */
    incassato: number;
    usatoQui: number;
    usatoQuiNostri: number;
    usatoQuiAltrui: number;
    altrove: number;
    /** Per ogni altra sede: positivo = ci deve, negativo = le dobbiamo. */
    versoAltre: { id: string; saldo: number }[];
    /** Alla data di fine: valore dei buoni venduti da noi e non ancora
     *  speso. E' un debito verso i clienti, non un ricavo. */
    daOnorare: number;
  };
};

/**
 * IL RELEVE' DI UN PUNTO fra due date, comprese.
 *
 * ⚠️ Vuole le DUE liste INTERE, come `contoDeiBuoni`: la meta' interessante
 * del documento e' proprio quello che e' successo ALTROVE — i nostri buoni
 * onorati da un'altra societa'. Passando i riscatti gia' filtrati sul punto,
 * quella riga sarebbe sempre zero e nessuno si insospettirebbe.
 *
 * `punto` null = installazione a sede unica: il documento resta valido, e la
 * parte fra societa' semplicemente non compare perche' non c'e' un confine.
 */
export function relevePunto(dati: {
  buoni: BuonoDelReleve[];
  riscatti: RiscattoDelReleve[];
  punto: string | null;
  da: string;
  a: string;
  fuso: string;
}): Releve {
  const { da, a, fuso, punto } = dati;
  const nelPeriodo = (iso: string | null | undefined): boolean => {
    const g = giornoLocale(iso, fuso);
    return !!g && g >= da && g <= a;
  };
  const cents = (v: unknown): number => Math.max(0, Math.floor(Number(v) || 0));

  const carta = new Map<string, BuonoDelReleve>();
  for (const b of dati.buoni) carta.set(b.id, b);
  const nomeDi = (id: string): string => carta.get(id)?.code || id;
  const nostro = (b: BuonoDelReleve | undefined): boolean =>
    !!b && (b.sold_at_location ?? null) === punto;

  const vendite: RigaVendita[] = [];
  let venduto = 0;
  let incassato = 0;
  for (const b of dati.buoni) {
    if (!nostro(b) || !nelPeriodo(b.created_at)) continue;
    const valore = cents(b.initial_cents);
    const pagato = b.paid !== false;
    vendite.push({
      codice: b.code || b.id,
      giorno: giornoLocale(b.created_at, fuso),
      valore,
      pagato,
      metodo: b.payment_method || "",
    });
    venduto += valore;
    if (pagato) incassato += valore;
  }

  const usi: RigaUso[] = [];
  const altrove: RigaUso[] = [];
  let usatoQui = 0;
  let usatoQuiNostri = 0;
  let usatoQuiAltrui = 0;
  let altroveTot = 0;
  // Saldo verso ogni altra sede. Positivo = abbiamo servito i suoi clienti,
  // quindi ci deve; negativo = ha servito i nostri, e le dobbiamo.
  const verso = new Map<string, number>();
  const muovi = (id: string | null, delta: number): void => {
    if (!id || id === punto) return;
    verso.set(id, (verso.get(id) ?? 0) + delta);
  };

  for (const r of dati.riscatti) {
    const importo = cents(r.amount_cents);
    if (!importo || !nelPeriodo(r.created_at)) continue;
    const dove = r.location_id ?? null;
    const b = carta.get(r.gift_card_id);
    const emesso = b?.sold_at_location ?? null;
    const riga: RigaUso = {
      codice: nomeDi(r.gift_card_id),
      giorno: giornoLocale(r.created_at, fuso),
      importo,
      kind: r.kind || "",
      vendutoDa: emesso,
      usatoA: dove,
    };

    if (dove === punto) {
      usi.push(riga);
      usatoQui += importo;
      if (nostro(b)) usatoQuiNostri += importo;
      else {
        usatoQuiAltrui += importo;
        muovi(emesso, importo); // abbiamo servito per conto loro
      }
    } else if (nostro(b)) {
      altrove.push(riga);
      altroveTot += importo;
      muovi(dove, -importo); // hanno servito per conto nostro
    }
  }

  // QUANTO RESTA DA ONORARE alla data di fine, sui buoni venduti da noi.
  // Non dipende dal periodo: e' una fotografia, e conta tutto quello che e'
  // stato speso fino a quel giorno, ovunque.
  const spesoPerBuono = new Map<string, number>();
  for (const r of dati.riscatti) {
    const g = giornoLocale(r.created_at, fuso);
    if (!g || g > a) continue;
    spesoPerBuono.set(r.gift_card_id, (spesoPerBuono.get(r.gift_card_id) ?? 0) + cents(r.amount_cents));
  }
  let daOnorare = 0;
  for (const b of dati.buoni) {
    if (!nostro(b) || b.paid === false) continue;
    if (giornoLocale(b.created_at, fuso) > a) continue; // non ancora venduto
    daOnorare += Math.max(0, cents(b.initial_cents) - (spesoPerBuono.get(b.id) ?? 0));
  }

  return {
    vendite,
    usi,
    altrove,
    totali: {
      venduto,
      incassato,
      usatoQui,
      usatoQuiNostri,
      usatoQuiAltrui,
      altrove: altroveTot,
      versoAltre: [...verso.entries()]
        .filter(([, s]) => s !== 0)
        .map(([id, saldo]) => ({ id, saldo }))
        .sort((x, y) => y.saldo - x.saldo),
      daOnorare,
    },
  };
}
