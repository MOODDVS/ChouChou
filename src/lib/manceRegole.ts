/**
 * LE MANCE (pourboires) — regole pure, nessun import.
 *
 * Réglages → Commandes en ligne → Paiements → «Pourboires», chiavi di sede:
 *   `orders_tips`         "1"/"0" — SPENTO di ripiego (sta in RIPIEGO_ORDINI);
 *   `orders_tips_type`    "percent" | "fixed";
 *   `orders_tips_values`  tre numeri separati da virgola: percentuali intere
 *                         ("5,10,15") oppure centesimi ("100,200,300").
 *
 * ⚠️ VALE PER TUTTI GLI ORDINI (ritiro, consegna, tavolo) MA SOLO CON LA
 * CARTA ONLINE. Chi paga sul posto la mancia la lascia di persona: metterla
 * dentro un «da incassare» vorrebbe dire una cassa che chiede una cifra che
 * il cliente non ricorda di aver scelto.
 *
 * ⚠️ «AUCUN» E' LA SCELTA DI RIPIEGO, sempre. Una mancia preselezionata la
 * paga chi non guarda, e il giorno che se ne accorge non torna.
 *
 * ⚠️ IL BROWSER MANDA SOLO QUALE BOTTONE (0, 1, 2), MAI UN IMPORTO: la cifra
 * la ricalcola il server con questi stessi numeri. Una mancia scritta dal
 * browser e' un modo di pagare meno — o di far pagare di piu' a qualcuno.
 */

export type TipoMance = "percent" | "fixed";

export const TIPI_MANCE: readonly TipoMance[] = ["percent", "fixed"] as const;

/** I tre valori di partenza, per tipo. */
export const MANCE_RIPIEGO: Record<TipoMance, [number, number, number]> = {
  percent: [5, 10, 15],
  fixed: [100, 200, 300],
};

/** I limiti: oltre, e' un errore di battitura (50 % o 100 € di mancia). */
const LIMITI: Record<TipoMance, [number, number]> = {
  percent: [1, 50],
  fixed: [1, 10_000],
};

/** Tipo illeggibile → percentuale, che e' la forma piu' comune. */
export function tipoMance(v: unknown): TipoMance {
  return String(v ?? "").trim() === "fixed" ? "fixed" : "percent";
}

/**
 * I tre valori salvati, riletti. Se uno solo e' storto si torna ai tre di
 * ripiego: tre bottoni di cui uno vuoto o assurdo sono peggio di tre valori
 * sensati che il ristoratore non ha scelto.
 */
export function valoriMance(tipo: TipoMance, raw: unknown): [number, number, number] {
  const parti = String(raw ?? "").split(",").map((x) => Math.round(Number(x.trim())));
  const [min, max] = LIMITI[tipo];
  if (parti.length !== 3 || parti.some((n) => !Number.isFinite(n) || n < min || n > max)) {
    return [...MANCE_RIPIEGO[tipo]];
  }
  return [parti[0], parti[1], parti[2]];
}

/**
 * I tre valori scritti dal ristoratore in Réglages: percentuali («10») o euro
 * («1,50»). `null` = uno illeggibile o fuori limite → il salvataggio si
 * rifiuta, mai sostituito di nascosto.
 */
export function valoriDaPagina(tipo: TipoMance, grezzi: unknown): [number, number, number] | null {
  if (!Array.isArray(grezzi) || grezzi.length !== 3) return null;
  const [min, max] = LIMITI[tipo];
  const out: number[] = [];
  for (const g of grezzi) {
    const t = String(g ?? "").trim().replace(",", ".");
    if (tipo === "percent" ? !/^\d{1,2}$/.test(t) : !/^\d+(\.\d{1,2})?$/.test(t)) return null;
    const n = tipo === "percent" ? Number(t) : Math.round(Number(t) * 100);
    if (n < min || n > max) return null;
    out.push(n);
  }
  return [out[0], out[1], out[2]];
}

/**
 * Quanto vale la mancia scelta. `scelta` = indice del bottone (0, 1, 2);
 * qualunque altra cosa = «Aucun» = 0.
 * ⚠️ La percentuale sui PIATTI dopo lo sconto, senza consegna: e' la stessa
 * base del minimo e della consegna gratuita, e la mancia e' per chi cucina e
 * serve, non sul costo del trasporto.
 */
export function importoMancia(scelta: unknown, tipo: TipoMance, valori: [number, number, number], piattiCents: number): number {
  const i = Number(scelta);
  if (!Number.isInteger(i) || i < 0 || i > 2) return 0;
  const v = valori[i];
  if (tipo === "fixed") return v;
  return Math.max(0, Math.round((Math.max(0, piattiCents) * v) / 100));
}
