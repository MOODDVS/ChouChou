/**
 * LA PIANTINA SUL PALMARE — le regole, senza database (22/10/2026).
 *
 * ⚠️ Questo file non importa niente, come `pianoSalaRegole.ts`: le regole che
 * si provano davvero non devono arrivare a `db.ts`, che in vitest lancia
 * all'import.
 *
 * Due domande:
 *  1. QUALI SALE si mostrano, e in che ordine (`saleDelPalmare`);
 *  2. COME si disegna una sala su un telefono tenuto in verticale
 *     (`pianoVerticale`): il lato lungo della sala sul lato lungo del
 *     telefono, sempre (deciso con Enzo il 22/10/2026).
 *
 * I dati sono quelli del piano di Réglages → Réservations: tavoli in
 * `restaurant_tables`, perimetro in `reservation_plan_areas`, muri e piante in
 * `reservation_plan_decor`, tutto in unita' astratte di una tela 1000×600.
 */

export interface TavoloPiano {
  id: string;
  name: string;
  seats: number;
  shape: "round" | "square" | "rect";
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface DecoroPiano {
  type: "wall" | "plant";
  color: "white" | "black" | "brown";
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SalaPalmare {
  zona: string;
  tavoli: TavoloPiano[];
  /** Il perimetro disegnato, o null se la section non ne ha. */
  area: [number, number][] | null;
  decor: DecoroPiano[];
}

/** Un numero finito, o il ripiego. */
function n(v: unknown, ripiego = 0): number {
  const x = Number(v);
  return Number.isFinite(x) ? x : ripiego;
}

function nomiSezioni(sezioniConfigurate: unknown): string[] {
  try {
    const zs = typeof sezioniConfigurate === "string"
      ? JSON.parse(sezioniConfigurate || "[]")
      : sezioniConfigurate;
    if (!Array.isArray(zs)) return [];
    return (zs as { name?: unknown }[]).map((z) => String(z?.name ?? "").trim()).filter(Boolean);
  } catch {
    return [];
  }
}

function mappa(grezzo: unknown): Record<string, unknown> {
  try {
    const m = typeof grezzo === "string" ? JSON.parse(grezzo || "{}") : grezzo;
    return m && typeof m === "object" && !Array.isArray(m) ? (m as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/**
 * LE SALE DEL PALMARE, nell'ordine delle sections.
 *
 * ⚠️ La stessa regola di `tavoliDelPiano`: un tavolo agganciato a una section
 * che non esiste piu' e' un fantasma e non si disegna. Nessuna section
 * configurata → si tiene tutto, raggruppato per zona.
 * ⚠️ Una section SENZA tavoli non compare: sul palmare una sala vuota e' una
 * pillola che non porta a niente. Il perimetro da solo non basta.
 */
export function saleDelPalmare(opz: {
  righe: unknown;
  sezioni: unknown;
  aree?: unknown;
  decori?: unknown;
}): SalaPalmare[] {
  const nomi = nomiSezioni(opz.sezioni);
  const valide = new Set(nomi);
  const aree = mappa(opz.aree);
  const decori = mappa(opz.decori);

  const perZona = new Map<string, TavoloPiano[]>();
  for (const r of Array.isArray(opz.righe) ? opz.righe : []) {
    const t = (r ?? {}) as Record<string, unknown>;
    const zona = String(t.zone ?? "").trim();
    const id = String(t.id ?? "");
    const name = String(t.name ?? "").trim();
    if (!zona || !id || !name) continue;
    if (valide.size > 0 && !valide.has(zona)) continue;
    const forma = t.shape === "round" || t.shape === "rect" ? t.shape : "square";
    const lista = perZona.get(zona) ?? [];
    lista.push({
      id, name, seats: Math.max(0, Math.floor(n(t.seats))), shape: forma,
      x: n(t.x), y: n(t.y), w: Math.max(1, n(t.w, 100)), h: Math.max(1, n(t.h, 100)),
    });
    perZona.set(zona, lista);
  }

  // L'ordine delle sections come le ha messe il ristoratore; senza sections,
  // l'alfabeto.
  const ordine = nomi.length ? nomi : [...perZona.keys()].sort((a, b) => a.localeCompare(b));
  return ordine
    .filter((z) => (perZona.get(z)?.length ?? 0) > 0)
    .map((zona) => {
      const a = aree[zona];
      const area = Array.isArray(a) && a.length >= 3
        ? (a as unknown[]).map((p) => {
            const q = Array.isArray(p) ? p : [0, 0];
            return [n(q[0]), n(q[1])] as [number, number];
          })
        : null;
      const d = decori[zona];
      const decor: DecoroPiano[] = (Array.isArray(d) ? d : [])
        .map((x) => (x ?? {}) as Record<string, unknown>)
        .filter((x) => x.type === "wall" || x.type === "plant")
        .map((x) => ({
          type: x.type as "wall" | "plant",
          color: x.color === "white" || x.color === "black" ? x.color : "brown",
          x: n(x.x), y: n(x.y), w: Math.max(1, n(x.w, 40)), h: Math.max(1, n(x.h, 40)),
        }));
      const tavoli = (perZona.get(zona) ?? []).sort((a2, b2) => a2.name.localeCompare(b2.name, undefined, { numeric: true }));
      return { zona, tavoli, area, decor };
    });
}

/** Una sala pronta da disegnare: coordinate gia' girate, tela gia' tagliata. */
export interface PianoDisegnato {
  larghezza: number;
  altezza: number;
  /** Vero se la sala e' stata girata di 90° per stare in verticale. */
  ruotata: boolean;
  tavoli: TavoloPiano[];
  area: [number, number][] | null;
  decor: DecoroPiano[];
}

/**
 * LA SALA IN VERTICALE.
 *
 * 1. Si taglia la tela 1000×600 attorno a quello che c'e' davvero (perimetro,
 *    tavoli, decori), con un margine: una sala disegnata in un angolo non deve
 *    finire minuscola in mezzo al vuoto.
 * 2. Se e' piu' larga che alta si gira di 90° in senso orario, cosi' il lato
 *    lungo sta sul lato lungo del telefono.
 *
 * 3. La tela non scende sotto una misura minima (`minLarghezza` ×
 *    `minAltezza`, gia' in verticale): una terrazza con un tavolo solo
 *    diventerebbe un tavolo grande quanto lo schermo. Sotto la misura minima
 *    la sala resta al centro, con aria attorno.
 *
 * ⚠️ Si girano le COORDINATE, non il disegno: con un `rotate()` sull'SVG
 * anche i nomi dei tavoli finirebbero di traverso. Un tavolo girato scambia
 * larghezza e altezza, e il suo nome resta dritto.
 */
export function pianoVerticale(
  sala: SalaPalmare,
  opz: { margine?: number; minLarghezza?: number; minAltezza?: number } = {},
): PianoDisegnato {
  const margine = opz.margine ?? 24;
  const minLarghezza = opz.minLarghezza ?? 360;
  const minAltezza = opz.minAltezza ?? 600;
  const xs: number[] = [];
  const ys: number[] = [];
  for (const t of [...sala.tavoli, ...sala.decor]) {
    xs.push(t.x, t.x + t.w);
    ys.push(t.y, t.y + t.h);
  }
  for (const [x, y] of sala.area ?? []) {
    xs.push(x);
    ys.push(y);
  }
  if (!xs.length) return { larghezza: 1, altezza: 1, ruotata: false, tavoli: [], area: null, decor: [] };

  const x0 = Math.min(...xs);
  const y0 = Math.min(...ys);
  const x1 = Math.max(...xs);
  const y1 = Math.max(...ys);
  const ruotata = x1 - x0 > y1 - y0;

  const larghezzaSala = ruotata ? y1 - y0 : x1 - x0;
  const altezzaSala = ruotata ? x1 - x0 : y1 - y0;
  const larghezza = Math.max(larghezzaSala + margine * 2, minLarghezza);
  const altezza = Math.max(altezzaSala + margine * 2, minAltezza);
  // Lo spostamento: il margine, piu' meta' dell'aria aggiunta per la misura
  // minima, cosi' la sala resta al centro.
  const dx = (larghezza - larghezzaSala) / 2;
  const dy = (altezza - altezzaSala) / 2;

  // Un punto: spostato e, se serve, girato in senso orario.
  const punto = (x: number, y: number): [number, number] =>
    ruotata ? [y1 - y + dx, x - x0 + dy] : [x - x0 + dx, y - y0 + dy];
  // Un rettangolo: l'angolo in alto a sinistra DOPO la rotazione e' quello
  // che prima stava in basso a sinistra.
  const rett = <T extends { x: number; y: number; w: number; h: number }>(r: T): T => {
    if (!ruotata) {
      const [x, y] = punto(r.x, r.y);
      return { ...r, x, y };
    }
    const [x, y] = punto(r.x, r.y + r.h);
    return { ...r, x, y, w: r.h, h: r.w };
  };

  return {
    larghezza,
    altezza,
    ruotata,
    tavoli: sala.tavoli.map(rett),
    area: sala.area ? sala.area.map(([x, y]) => punto(x, y)) : null,
    decor: sala.decor.map(rett),
  };
}
