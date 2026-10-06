import { scriviConfig } from "./admin/sede";
import type { Ambito } from "./admin/sedeRegole";
import { CHIAVE_DESTINAZIONI, categorieDoppie, idStampante, leggiDestinazioni } from "./stampaRegole";

/**
 * SALVARE LA CONFIGURAZIONE DELLA STAMPA — da un posto solo.
 *
 * ⚠️ Le stesse tre chiavi si scrivono da DUE pannelli: la scheda della sede
 * (multi-sede) e Intégrations (installazione a sede unica, dove la scheda non
 * esiste). Due copie della validazione vorrebbero dire che un giorno una
 * delle due accetta una categoria doppia, e il guasto esce da una sola porta —
 * cioe' sarebbe anche difficile da credere.
 */
export interface CorpoStampa {
  printer_id?: unknown;
  print_auto?: unknown;
  destinazioni?: unknown;
}

/** Rende `null` se e' andata bene, altrimenti la CHIAVE del messaggio da
 *  tradurre (il server sa in che lingua parla l'admin, questo file no). */
export async function salvaConfigStampa(ambito: Ambito, body: CorpoStampa): Promise<{ errore: string | null; doppie: string[] }> {
  const campi: Record<string, string> = {};

  if (body.printer_id !== undefined) {
    // ⚠️ `idStampante` e non una regex scritta qui: e' lo stesso dato delle
    // stampanti dentro le destinazioni, e due regole per lo stesso dato
    // vogliono dire che un giorno una delle due accetta quello che l'altra
    // rifiuta. Vuoto vuol dire «nessuna stampante», ed e' legittimo.
    const grezzo = String(body.printer_id).trim();
    const n = idStampante(grezzo);
    if (grezzo && !n) return { errore: "loc.err.printer", doppie: [] };
    campi.print_printer_id = n;
  }
  if (body.print_auto !== undefined) campi.print_auto = body.print_auto ? "1" : "0";

  if (body.destinazioni !== undefined) {
    // ⚠️ Si rilegge con le regole pure: quello che arriva dal browser e' una
    // proposta, non un dato. `leggiDestinazioni` butta via le righe senza
    // stampante o senza categorie, che non sono destinazioni ma buone
    // intenzioni.
    const righe = leggiDestinazioni(body.destinazioni);
    // ⚠️ Una categoria in due righe vuol dire DUE comande, cioe' due pizze.
    // Il pannello lo impedisce, ma la regola vive anche qui: una scheda
    // aperta da ieri non la conoscerebbe.
    const doppie = categorieDoppie(righe);
    if (doppie.length) return { errore: "loc.err.destDoppia", doppie };
    campi[CHIAVE_DESTINAZIONI] = JSON.stringify(righe);
  }

  if (Object.keys(campi).length === 0) return { errore: null, doppie: [] };
  const err = await scriviConfig(ambito, campi);
  return { errore: err ? "common.saveErr" : null, doppie: [] };
}
