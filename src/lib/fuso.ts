/**
 * IL FUSO ORARIO DEL LOCALE — letto, non ereditato da una variabile globale.
 *
 * ⚠️ Fino al 21/09/2026 il fuso era `export let TIMEZONE` in `slots.ts`: una
 * variabile di modulo mutabile, riempita al primo accesso e condivisa da
 * tutte le richieste del processo. Con una sede sola non si vedeva. Con due
 * sedi in fusi diversi, la richiesta di una cambiava il valore sotto i piedi
 * a quella dell'altra gia' partita — e il risultato non era un errore, era un
 * orario sbagliato ma plausibile, che nessuno avrebbe collegato alla
 * richiesta di un'altra persona.
 *
 * Adesso il fuso si chiede, con l'ambito: `const tz = await fusoDi(ambito)`.
 *
 * Il costo e' zero: `appConfigEq` legge dalla cache di `app_config` (30s) e
 * sovrappone da sola `location_config` della sede. Era gia' la strada di
 * tutte le altre chiavi di configurazione — il fuso era l'unica che si era
 * fatta la sua.
 */
import { appConfigEq } from "./appConfigCache";
import { FUSO_DEFAULT, fusoValido } from "./slots";
import type { Ambito } from "./admin/sedeRegole";

export { FUSO_DEFAULT };

/**
 * Il fuso di questa sede, o quello dell'installazione se la sede non ne ha
 * uno suo. `Europe/Brussels` se non e' configurato o se il valore salvato non
 * e' un nome IANA valido.
 *
 * ⚠️ Il ripiego e' silenzioso APPOSTA, e solo qui: un fuso illeggibile non
 * deve impedire di prendere un ordine. Ma vuol dire anche che un valore
 * storto in `app_config` non si nota — per questo `settings.ts` lo valida
 * gia' in scrittura, che e' il momento in cui qualcuno sta guardando.
 */
export async function fusoDi(ambito: Ambito): Promise<string> {
  try {
    const { data } = await appConfigEq("timezone", ambito);
    return fusoValido(data?.value) ?? FUSO_DEFAULT;
  } catch {
    return FUSO_DEFAULT;
  }
}
