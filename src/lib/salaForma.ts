/**
 * LA FORMA DELLA SALA — il perimetro disegnato in Réglages → Réservations
 * (1/11/2026). Regole pure: niente import, si provano in vitest.
 *
 * Il perimetro e' una lista di punti `[x, y]` o `[x, y, curva]`, in senso
 * qualsiasi. Ogni punto apre il MURO che va al punto dopo (l'ultimo torna al
 * primo). `curva` dice di quanto quel muro si piega: 0 (o assente) = dritto,
 * >0 = la pancia verso FUORI della sala, <0 = verso dentro. E' la distanza,
 * in unita' della tela, fra il centro del muro dritto e il centro dell'arco.
 *
 * ⚠️ I piani salvati prima (solo `[x, y]`, quattro angoli di un rettangolo)
 * restano validi cosi' come sono: un punto senza curva e' un muro dritto.
 *
 * LA TELA: unita' astratte. Fino al 1/11/2026 era 1000×600 e nient'altro;
 * ora una sala puo' uscirne da ogni lato, fino a questi limiti. Il riquadro
 * 1000×600 resta la sala di chi non ne ha disegnata una.
 */

export type PuntoSala = [number, number] | [number, number, number];

export const TELA = { x0: -1000, y0: -600, x1: 2000, y1: 1200 } as const;

/** Da 3 a 80 angoli: sotto non e' una sala, sopra e' un errore. */
export const PUNTI_MIN = 3;
export const PUNTI_MAX = 80;

const finito = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const entro = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

/**
 * Il perimetro come arriva (dal browser o dal database), pulito: numeri
 * interi, dentro la tela, curva solo se c'e'. null se non e' una sala.
 */
export function normalizzaArea(grezza: unknown): PuntoSala[] | null {
  if (!Array.isArray(grezza)) return null;
  if (grezza.length < PUNTI_MIN || grezza.length > PUNTI_MAX) return null;
  const punti: PuntoSala[] = [];
  for (const p of grezza) {
    if (!Array.isArray(p)) return null;
    const x = finito(p[0]), y = finito(p[1]);
    if (x === null || y === null) return null;
    const px = Math.round(entro(x, TELA.x0, TELA.x1));
    const py = Math.round(entro(y, TELA.y0, TELA.y1));
    const c = Math.round(entro(finito(p[2]) ?? 0, -(TELA.x1 - TELA.x0), TELA.x1 - TELA.x0));
    punti.push(c ? [px, py, c] : [px, py]);
  }
  return punti;
}

/** Il segno dell'area: dice in che verso girano i punti. */
function areaFirmata(punti: PuntoSala[]): number {
  let a = 0;
  for (let i = 0; i < punti.length; i++) {
    const p = punti[i], q = punti[(i + 1) % punti.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

export interface Muro {
  /** Gli estremi. */
  ax: number; ay: number; bx: number; by: number;
  /** Il centro del muro dritto. */
  mx: number; my: number;
  /** La normale verso FUORI della sala (lunghezza 1). */
  nx: number; ny: number;
  /** La curva (0 = dritto). */
  s: number;
  /** Il punto di controllo della curva (Bézier quadratica). */
  cx: number; cy: number;
  /** Il centro dell'arco: e' anche il punto piu' lontano dal muro dritto. */
  px: number; py: number;
}

/** Il muro che parte dal punto i. */
export function muroSala(punti: PuntoSala[], i: number): Muro {
  const a = punti[i], b = punti[(i + 1) % punti.length];
  const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len = Math.hypot(dx, dy) || 1;
  // Con y verso il basso (SVG), un giro in senso orario ha area positiva e
  // la normale (dy, -dx) guarda fuori; nell'altro verso si gira.
  const verso = areaFirmata(punti) >= 0 ? 1 : -1;
  const nx = (dy / len) * verso, ny = (-dx / len) * verso;
  const s = a[2] ?? 0;
  // Una quadratica passa a meta' strada fra il centro del muro e il punto
  // di controllo: per un arco alto `s` il controllo sta a 2s.
  return { ax: a[0], ay: a[1], bx: b[0], by: b[1], mx, my, nx, ny, s, cx: mx + nx * 2 * s, cy: my + ny * 2 * s, px: mx + nx * s, py: my + ny * s };
}

const r1 = (v: number) => Math.round(v * 10) / 10;

/** Il tracciato SVG (`d`) della sala, muri curvi compresi. */
export function tracciatoSala(punti: PuntoSala[]): string {
  if (punti.length < PUNTI_MIN) return "";
  let d = `M${r1(punti[0][0])} ${r1(punti[0][1])}`;
  for (let i = 0; i < punti.length; i++) {
    const m = muroSala(punti, i);
    d += m.s ? ` Q${r1(m.cx)} ${r1(m.cy)} ${r1(m.bx)} ${r1(m.by)}` : ` L${r1(m.bx)} ${r1(m.by)}`;
  }
  return d + " Z";
}

/** Il tracciato di un muro solo (per sceglierlo nell'editor). */
export function tracciatoMuro(punti: PuntoSala[], i: number): string {
  const m = muroSala(punti, i);
  return `M${r1(m.ax)} ${r1(m.ay)} ` + (m.s ? `Q${r1(m.cx)} ${r1(m.cy)} ${r1(m.bx)} ${r1(m.by)}` : `L${r1(m.bx)} ${r1(m.by)}`);
}

/** I punti che delimitano la sala: gli angoli e la pancia di ogni arco. */
export function puntiIngombro(punti: PuntoSala[]): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < punti.length; i++) {
    out.push([punti[i][0], punti[i][1]]);
    const m = muroSala(punti, i);
    if (m.s) out.push([m.px, m.py]);
  }
  return out;
}

/**
 * Un angolo nuovo a meta' del muro i (sull'arco, se il muro e' curvo). La
 * curva si divide fra i due pezzi, cosi' la forma resta quasi la stessa.
 * Restituisce la lista nuova e l'indice del punto aggiunto.
 */
export function aggiungiAngolo(punti: PuntoSala[], i: number): { punti: PuntoSala[]; nuovo: number } {
  if (punti.length >= PUNTI_MAX) return { punti, nuovo: -1 };
  const m = muroSala(punti, i);
  const meta = Math.round(m.s / 2);
  const copia = punti.map((p) => [...p] as PuntoSala);
  const a = copia[i];
  copia[i] = meta ? [a[0], a[1], meta] : [a[0], a[1]];
  const nuovo: PuntoSala = meta ? [Math.round(m.px), Math.round(m.py), meta] : [Math.round(m.px), Math.round(m.py)];
  copia.splice(i + 1, 0, nuovo);
  return { punti: copia, nuovo: i + 1 };
}

/** Il rettangolo di una sala senza perimetro: la tela di prima. */
export const SALA_DI_SEMPRE: PuntoSala[] = [[0, 0], [1000, 0], [1000, 600], [0, 600]];

// ---------------------------------------------------------------------------
// I TAVOLI: FORME E ROTAZIONE (2/11/2026, migrazione #92)
// ---------------------------------------------------------------------------

/** Le forme di un tavolo. `pentagon` e la rotazione vogliono la #92. */
export const FORME_TAVOLO = ["round", "square", "rect", "pentagon"] as const;
export type FormaTavolo = (typeof FORME_TAVOLO)[number];

/** La rotazione di un tavolo: gradi in senso orario, a passi di 15, 0–345. */
export const PASSO_ROTAZIONE = 15;
export function normalizzaRotazione(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  const passi = Math.round(n / PASSO_ROTAZIONE);
  return (((passi * PASSO_ROTAZIONE) % 360) + 360) % 360;
}

/** Il pentagono nel suo riquadro, in frazioni (0–1): una punta in alto. */
export const PENTAGONO: [number, number][] = [[0.5, 0], [1, 0.38], [0.82, 1], [0.18, 1], [0, 0.38]];

/**
 * I punti (attributo `points` di un <polygon>) di un pentagono largo `w` e
 * alto `h`, centrato in (cx, cy) e girato di `gradi` in senso orario.
 */
export function puntiPentagono(cx: number, cy: number, w: number, h: number, gradi = 0): string {
  const a = (gradi * Math.PI) / 180, cos = Math.cos(a), sin = Math.sin(a);
  return PENTAGONO.map(([u, v]) => {
    const dx = (u - 0.5) * w, dy = (v - 0.5) * h;
    return `${r1(cx + dx * cos - dy * sin)},${r1(cy + dx * sin + dy * cos)}`;
  }).join(" ");
}

/**
 * Il database non ha ancora la #92? Postgres risponde «colonna che non
 * esiste» (42703) se si chiede `rotation`, o «controllo violato» (23514) se
 * si scrive un pentagono col vecchio controllo.
 */
export function manca92(e: { code?: string; message?: string } | null | undefined): boolean {
  if (!e) return false;
  return e.code === "42703" || e.code === "23514" || /rotation|shape_check/i.test(e.message ?? "");
}
