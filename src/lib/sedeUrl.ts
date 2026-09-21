/**
 * IL PUNTO VIAGGIA CON LA CHIAMATA — lato browser.
 *
 * ⚠️ Il fronte pubblico non puo' PIU' tacere. `ambitoPubblicoChiesto()`
 * legge `x-sede` o `?sede=`, e chi non dice niente ripiega sulla PRIMA sede:
 * a 450 Gradi sbaglia due volte su tre. Per un menu e' un'informazione
 * falsa; per `/api/checkout` e' un ordine che nasce nella cucina sbagliata e
 * si paga sulla cassa di un'altra societa'.
 *
 * Vuoto = installazione a punto unico — il caso dei quattro clienti di oggi:
 * il parametro non si aggiunge nemmeno, e l'URL resta quello di sempre.
 *
 * ⚠️ La REGOLA sta qui, in un posto solo (quale parametro, come si attacca).
 * Ogni componente si tiene la sua piccola `conSede(u)` legata alla PROPRIA
 * sede: quella e' un'associazione, non una copia della regola.
 */
import { PARAM_SEDE } from "./admin/sedeRegole";

export function urlConSede(url: string, sede: string | null | undefined): string {
  if (!sede) return url;
  return `${url}${url.includes("?") ? "&" : "?"}${PARAM_SEDE}=${encodeURIComponent(sede)}`;
}
