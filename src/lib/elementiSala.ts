/**
 * GLI ELEMENTI DEL PIANO DELLA SALA (2/11/2026) — piante, muri, colonne,
 * scale, porte, finestre, divani, banconi, bar, forno, lavandino.
 *
 * Regole e disegni in un posto solo: li usano l'editor (Réglages →
 * Réservations), l'API dei tavoli e il palmare. Mockup approvato da Enzo:
 * progetto, `claude/elementi-sala-schede.html`.
 *
 * ⚠️ Nessun import: si usa nel browser e in vitest.
 *
 * I DATI stanno in `app_config.reservation_plan_decor` (un JSON per
 * section, nessuna migrazione): { id, type, color, label, rotation, x, y,
 * w, h }. Prima del 2/11/2026 c'erano solo `plant` e `wall`, coi colori
 * white / black / brown: restano validi cosi' come sono.
 *
 * ⚠️ LA PIANTA «NATURALE»: l'API dava a ogni decoro il colore `brown` di
 * ripiego, quindi le piante di prima sono salvate «brown». Una pianta
 * `brown` (o senza colore, o `natural`) resta col suo verde: per questo la
 * pianta non si tinge di marrone.
 */

/** I colori: un nome nel JSON, un esadecimale nel disegno. */
export const COLORI_ELEMENTO: Record<string, string> = {
  white: "#e8e4de",
  black: "#1c1c1c",
  brown: "#4a4038",
  wood: "#8a6545",
  sand: "#c9b18f",
  grey: "#8f877e",
  green: "#4c9a2a",
  purple: "#6b4f6e",
  blue: "#3e7fb0",
  terracotta: "#b5583a",
  coral: "#cb534d",
};

/**
 * IL «VUOTO» (2/11/2026): l'elemento sbiadito, solo le linee e un velo
 * bianco quasi trasparente, per far risaltare i tavoli. Non e' un
 * esadecimale: `coloreElemento` lo restituisce cosi', e il disegno lo sa.
 */
export const VUOTO = "ghost";
const VUOTO_LINEA = "rgba(255,255,255,0.5)";
const VUOTO_FONDO = `fill="#ffffff" fill-opacity="0.06" stroke="${VUOTO_LINEA}" stroke-width="1.5"`;

/** I tipi, nell'ordine del menu «+ Elemento», con misura e colore di partenza. */
export const TIPI_ELEMENTO = [
  { k: "plant", w: 70, h: 70, colore: "natural" },
  { k: "wall", w: 200, h: 20, colore: "white" },
  { k: "wallCorner", w: 150, h: 150, colore: "white" },
  { k: "wallRound", w: 150, h: 150, colore: "white" },
  { k: "column", w: 50, h: 50, colore: "grey" },
  { k: "columnRound", w: 50, h: 50, colore: "grey" },
  { k: "stairs", w: 160, h: 80, colore: "grey" },
  { k: "stairsCorner", w: 150, h: 150, colore: "grey" },
  { k: "stairsSpiral", w: 110, h: 110, colore: "grey" },
  { k: "door", w: 80, h: 80, colore: "wood" },
  { k: "window", w: 120, h: 14, colore: "white" },
  { k: "sofa", w: 180, h: 70, colore: "purple" },
  { k: "sofaCorner", w: 170, h: 170, colore: "purple" },
  { k: "counter", w: 220, h: 60, colore: "wood" },
  { k: "bar", w: 240, h: 90, colore: "brown" },
  { k: "oven", w: 100, h: 100, colore: "terracotta" },
  { k: "sink", w: 80, h: 60, colore: "white" },
] as const;
export type TipoElemento = (typeof TIPI_ELEMENTO)[number]["k"];
const TIPI = new Set<string>(TIPI_ELEMENTO.map((t) => t.k));
export const tipoElemento = (k: string) => TIPI_ELEMENTO.find((t) => t.k === k);

export interface Elemento {
  id: string;
  type: TipoElemento;
  color: string;
  /** Un nome corto che si legge sulla mappa («Ingresso», «Bar»…). */
  label: string;
  /** Gradi in senso orario attorno al centro, a passi di 15. */
  rotation: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export const ETICHETTA_MAX = 24;
export const ELEMENTI_MAX = 60;

const numero = (v: unknown, min: number, max: number, ripiego: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : ripiego;
};
const rotazione = (v: unknown) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return (((Math.round(n / 15) * 15) % 360) + 360) % 360;
};

/**
 * Un elemento come arriva (dal browser o dal JSON), pulito; null se il tipo
 * non esiste. `limiti` = la tela (le coordinate).
 */
export function normalizzaElemento(
  grezzo: unknown,
  i = 0,
  limiti = { x0: -1000, y0: -600, x1: 2000, y1: 1200 },
): Elemento | null {
  const o = (grezzo ?? {}) as Record<string, unknown>;
  const type = String(o.type ?? "");
  if (!TIPI.has(type)) return null;
  const c = String(o.color ?? "");
  const color = c in COLORI_ELEMENTO || c === "natural" || c === VUOTO ? c : (tipoElemento(type)?.colore ?? "white");
  return {
    id: String(o.id ?? "").slice(0, 40) || "d" + i,
    type: type as TipoElemento,
    color,
    label: String(o.label ?? "").replace(/\s+/g, " ").trim().slice(0, ETICHETTA_MAX),
    rotation: rotazione(o.rotation),
    x: numero(o.x, limiti.x0, limiti.x1, 0),
    y: numero(o.y, limiti.y0, limiti.y1, 0),
    w: numero(o.w, 4, limiti.x1 - limiti.x0, 40),
    h: numero(o.h, 4, limiti.y1 - limiti.y0, 40),
  };
}

/** Il colore da disegnare; null = la pianta coi suoi colori. */
export function coloreElemento(e: { type: string; color?: string }): string | null {
  if (e.color === VUOTO) return VUOTO;
  if (e.type === "plant" && (!e.color || e.color === "natural" || e.color === "brown")) return null;
  return COLORI_ELEMENTO[e.color ?? ""] ?? COLORI_ELEMENTO[tipoElemento(e.type)?.colore ?? "white"] ?? COLORI_ELEMENTO.white;
}

// ---- le sfumature: un colore solo, il resto si ricava ----
const hex = (c: string) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
const mix = (c: string, verso: string, k: number) => {
  const a = hex(c), b = hex(verso);
  return "#" + a.map((v, i) => Math.round(v + (b[i] - v) * k).toString(16).padStart(2, "0")).join("");
};
const chiaro = (c: string, k = 0.25) => mix(c, "#ffffff", k);
const scuro = (c: string, k = 0.25) => mix(c, "#000000", k);
const luce = (c: string) => { const [r, g, b] = hex(c); return (r * 299 + g * 587 + b * 114) / 1000; };
/** Le righe (gradini, bordi interni): sempre leggibili sul colore. */
const linea = (c: string) => (luce(c) > 140 ? scuro(c, 0.45) : chiaro(c, 0.45));
/** Una parte piu' scura su un colore chiaro, piu' chiara su uno scuro. */
const contrasto = (c: string, k: number) => (luce(c) > 90 ? scuro(c, k) : chiaro(c, k));
const r1 = (v: number) => Math.round(v * 10) / 10;

/** Il filtro che tinge la pianta (luminosita' × colore). */
function filtroTinta(c: string): { id: string; def: string } {
  const id = "el-tinta-" + c.slice(1);
  const [r, g, b] = hex(c).map((v) => v / 255);
  const riga = (k: number) => `${r1(k * 0.6 * 100) / 100} ${r1(k * 1.2 * 100) / 100} ${r1(k * 0.4 * 100) / 100} 0 ${r1(k * 0.15 * 100) / 100}`;
  return { id, def: `<filter id="${id}" color-interpolation-filters="sRGB"><feColorMatrix type="matrix" values="${riga(r)}  ${riga(g)}  ${riga(b)}  0 0 0 1 0"/></filter>` };
}

/**
 * IL DISEGNO di un elemento, visto dall'alto, nel riquadro (0,0)–(w,h):
 * `svg` va dentro un <g> o un <svg viewBox="0 0 w h">, `defs` (il filtro
 * della pianta tinta) dentro un <defs>.
 */
export function disegnoElemento(
  type: string,
  w: number,
  h: number,
  c: string | null,
  pianta = "/restohub/plant.svg",
): { svg: string; defs: string } {
  const vuoto = c === VUOTO;
  const C = !c || vuoto ? COLORI_ELEMENTO.grey : c;
  /** Il riempimento di una forma (e gli attributi in piu', come un bordo);
   *  nel «vuoto» solo il contorno e il velo bianco. */
  const pieno = (col: string, extra = "") => (vuoto ? VUOTO_FONDO : `fill="${col}"${extra}`);
  /** Il colore di una riga (gradini, bordi interni, frecce). */
  const tratto = (col: string) => (vuoto ? VUOTO_LINEA : col);
  const l = tratto(linea(C));
  let svg = "";
  let defs = "";
  switch (type) {
    case "plant": {
      let filtro = "";
      if (c && !vuoto) { const f = filtroTinta(c); defs = f.def; filtro = ` filter="url(#${f.id})"`; }
      svg = `<image href="${pianta}" width="${w}" height="${h}" preserveAspectRatio="xMidYMid meet"${filtro}${vuoto ? ' opacity="0.3"' : ""}/>`;
      break;
    }
    case "wall":
      svg = `<rect width="${w}" height="${h}" rx="2" ${pieno(C)}/>`;
      break;
    case "wallCorner": {
      const t = Math.min(20, w / 3, h / 3);
      svg = `<path d="M0 0H${w}V${t}H${t}V${h}H0Z" ${pieno(C)}/>`;
      break;
    }
    case "wallRound": {
      const t = Math.min(20, w / 3, h / 3);
      svg = `<path d="M0 ${h}A${w} ${h} 0 0 1 ${w} 0V${t}A${w - t} ${h - t} 0 0 0 ${t} ${h}Z" ${pieno(C)}/>`;
      break;
    }
    case "column":
      svg = `<rect width="${w}" height="${h}" rx="3" ${pieno(C)}/><rect x="${r1(w * 0.2)}" y="${r1(h * 0.2)}" width="${r1(w * 0.6)}" height="${r1(h * 0.6)}" rx="2" fill="none" stroke="${l}" stroke-width="2"/>`;
      break;
    case "columnRound":
      svg = `<ellipse cx="${w / 2}" cy="${h / 2}" rx="${w / 2}" ry="${h / 2}" ${pieno(C)}/><ellipse cx="${w / 2}" cy="${h / 2}" rx="${r1(w * 0.3)}" ry="${r1(h * 0.3)}" fill="none" stroke="${l}" stroke-width="2"/>`;
      break;
    case "stairs": {
      svg = `<rect width="${w}" height="${h}" rx="3" ${pieno(C)}/>`;
      for (let i = 1; i < 8; i++) svg += `<line x1="${r1((w * i) / 8)}" y1="0" x2="${r1((w * i) / 8)}" y2="${h}" stroke="${l}" stroke-width="2"/>`;
      svg += `<path d="M${r1(w * 0.06)} ${h / 2}H${r1(w * 0.9)}M${r1(w * 0.8)} ${r1(h * 0.3)}L${r1(w * 0.92)} ${h / 2}L${r1(w * 0.8)} ${r1(h * 0.7)}" fill="none" stroke="${l}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`;
      break;
    }
    case "stairsCorner": {
      const f = Math.min(w, h) * 0.45;
      svg = `<path d="M0 0H${w}V${h}H${r1(w - f)}V${r1(f)}H0Z" ${pieno(C)}/>`;
      for (let i = 1; i < 5; i++) svg += `<line x1="${r1(((w - f) * i) / 5)}" y1="0" x2="${r1(((w - f) * i) / 5)}" y2="${r1(f)}" stroke="${l}" stroke-width="2"/>`;
      for (let i = 1; i < 5; i++) svg += `<line x1="${r1(w - f)}" y1="${r1(f + ((h - f) * i) / 5)}" x2="${w}" y2="${r1(f + ((h - f) * i) / 5)}" stroke="${l}" stroke-width="2"/>`;
      svg += `<path d="M${r1(w - f)} 0V${r1(f)}H${w}" fill="none" stroke="${l}" stroke-width="2"/>`;
      svg += `<path d="M${r1(f * 0.15)} ${r1(f / 2)}H${r1(w - f / 2)}V${r1(h - f * 0.25)}M${r1(w - f * 0.75)} ${r1(h - f * 0.5)}L${r1(w - f / 2)} ${r1(h - f * 0.2)}L${r1(w - f * 0.25)} ${r1(h - f * 0.5)}" fill="none" stroke="${l}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`;
      break;
    }
    case "stairsSpiral": {
      const cx = w / 2, cy = h / 2, r = Math.min(w, h) / 2;
      svg = `<circle cx="${cx}" cy="${cy}" r="${r}" ${pieno(C)}/>`;
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        svg += `<line x1="${r1(cx + Math.cos(a) * r * 0.18)}" y1="${r1(cy + Math.sin(a) * r * 0.18)}" x2="${r1(cx + Math.cos(a) * r)}" y2="${r1(cy + Math.sin(a) * r)}" stroke="${l}" stroke-width="2"/>`;
      }
      const ra = r * 0.62;
      svg += `<circle cx="${cx}" cy="${cy}" r="${r1(r * 0.18)}" fill="${l}"/>`;
      svg += `<path d="M${r1(cx + ra)} ${cy}A${r1(ra)} ${r1(ra)} 0 1 1 ${cx} ${r1(cy - ra)}" fill="none" stroke="${l}" stroke-width="3" stroke-linecap="round"/>`;
      svg += `<path d="M${r1(cx - r * 0.12)} ${r1(cy - ra - r * 0.12)}L${cx} ${r1(cy - ra)}L${r1(cx - r * 0.12)} ${r1(cy - ra + r * 0.12)}" fill="none" stroke="${l}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`;
      break;
    }
    case "door":
      svg = `<path d="M0 ${h}A${w} ${h} 0 0 1 ${w} 0" fill="${vuoto ? "#ffffff" : C}" fill-opacity="${vuoto ? 0.04 : 0.12}" stroke="${tratto(chiaro(C, 0.3))}" stroke-width="1.5" stroke-dasharray="5 4"/><rect x="${w - 6}" y="0" width="6" height="${h}" ${pieno(C)}/><circle cx="${w - 3}" cy="${h}" r="4" fill="${tratto(chiaro(C, 0.5))}"/>`;
      break;
    case "window":
      svg = `<rect width="${w}" height="${h}" ${pieno("#bfe3f2")}/><rect width="${w}" height="${h}" fill="none" stroke="${tratto(C)}" stroke-width="3"/><line x1="0" y1="${h / 2}" x2="${w}" y2="${h / 2}" stroke="${tratto("#5aa9cf")}" stroke-width="2"/><line x1="${w / 2}" y1="0" x2="${w / 2}" y2="${h}" stroke="${tratto(C)}" stroke-width="2"/>`;
      break;
    case "sofa": {
      const d = scuro(C, 0.22);
      svg = `<rect width="${w}" height="${h}" rx="10" ${pieno(C)}/><rect width="${w}" height="${r1(h * 0.32)}" rx="8" ${pieno(d)}/><rect width="${r1(w * 0.11)}" height="${h}" rx="8" ${pieno(d)}/><rect x="${r1(w * 0.89)}" width="${r1(w * 0.11)}" height="${h}" rx="8" ${pieno(d)}/><line x1="${w / 2}" y1="${r1(h * 0.38)}" x2="${w / 2}" y2="${r1(h * 0.92)}" stroke="${tratto(d)}" stroke-width="2"/>`;
      break;
    }
    case "sofaCorner": {
      const d = scuro(C, 0.22), p = Math.min(w, h) * 0.42;
      svg = `<path d="M0 0H${w}V${r1(p)}H${r1(p)}V${h}H0Z" ${pieno(C)}/><path d="M0 0H${w}V${r1(p * 0.38)}H${r1(p * 0.38)}V${h}H0Z" ${pieno(d)}/><rect x="${r1(w - p * 0.3)}" width="${r1(p * 0.3)}" height="${r1(p)}" rx="6" ${pieno(d)}/><rect y="${r1(h - p * 0.3)}" width="${r1(p)}" height="${r1(p * 0.3)}" rx="6" ${pieno(d)}/><line x1="${r1(w * 0.6)}" y1="${r1(p * 0.42)}" x2="${r1(w * 0.6)}" y2="${r1(p * 0.95)}" stroke="${tratto(d)}" stroke-width="2"/><line x1="${r1(p * 0.42)}" y1="${r1(h * 0.6)}" x2="${r1(p * 0.95)}" y2="${r1(h * 0.6)}" stroke="${tratto(d)}" stroke-width="2"/>`;
      break;
    }
    case "counter":
      svg = `<rect width="${w}" height="${h}" rx="4" ${pieno(C)}/><rect width="${w}" height="${r1(h * 0.3)}" rx="4" ${pieno(chiaro(C, 0.22))}/>`;
      break;
    case "bar": {
      svg = `<rect width="${w}" height="${r1(h * 0.55)}" rx="5" ${pieno(C)}/><rect width="${w}" height="${r1(h * 0.16)}" rx="5" ${pieno(chiaro(C, 0.22))}/>`;
      const n = Math.max(2, Math.round(w / 55));
      for (let i = 0; i < n; i++) svg += `<circle cx="${r1((w * (i + 0.5)) / n)}" cy="${r1(h * 0.8)}" r="${r1(Math.min(h * 0.14, 13))}" ${pieno(scuro(C, 0.2), ` stroke="${chiaro(C, 0.35)}" stroke-width="1.5"`)}/>`;
      break;
    }
    case "oven":
      svg = `<ellipse cx="${w / 2}" cy="${h / 2}" rx="${w / 2}" ry="${h / 2}" ${pieno(C)}/><rect x="${r1(w * 0.32)}" y="${r1(h * 0.78)}" width="${r1(w * 0.36)}" height="${r1(h * 0.22)}" rx="${r1(w * 0.05)}" ${pieno(contrasto(C, 0.45))}/>`;
      break;
    case "sink":
      svg = `<rect width="${w}" height="${h}" rx="5" ${pieno(C)}/><rect x="${r1(w * 0.14)}" y="${r1(h * 0.2)}" width="${r1(w * 0.72)}" height="${r1(h * 0.62)}" rx="${r1(Math.min(w, h) * 0.18)}" ${pieno(contrasto(C, 0.2))}/><circle cx="${w / 2}" cy="${r1(h * 0.52)}" r="${r1(Math.min(w, h) * 0.07)}" ${pieno(contrasto(C, 0.5))}/><rect x="${r1(w * 0.46)}" y="${r1(h * 0.03)}" width="${r1(w * 0.08)}" height="${r1(h * 0.2)}" rx="2" ${pieno(contrasto(C, 0.45))}/>`;
      break;
    default:
      svg = `<rect width="${w}" height="${h}" ${pieno(C)}/>`;
  }
  return { svg, defs };
}
