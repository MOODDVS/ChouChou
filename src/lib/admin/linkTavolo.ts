/**
 * IL LINK DELLA PAGINA DEL TAVOLO per questa sede — quello che va nei QR.
 *
 * Stava dentro `api/admin/settings.ts`; ora lo usano anche i cartoncini da
 * stampare (`api/admin/qr.ts`), e una regola scritta in due posti e' una
 * regola che prima o poi dice due cose diverse.
 *
 * ⚠️ IL LINK LO SCRIVE IL SERVER, CON LA SEDE DENTRO. Un QR stampato vive
 * anni su un tavolo: se puntasse a `/table` e basta, varrebbe per «la prima
 * sede attiva» — giusto finche' ne e' accesa una sola (successo il
 * 16/10/2026: tre sedi, una accesa).
 * ⚠️ COL NOME BREVE (`slug`), non con l'id: `?sede=schaerbeek` si legge e si
 * controlla a occhio. Senza slug resta l'id.
 * ⚠️ Con «tutte le sedi» il link NON esiste (stringa vuota): non e' un posto
 * dove ci si siede.
 */
import { elencoSedi, type Ambito } from "./sede";
import { indirizzoPubblico } from "../indirizzoPubblico";
import { urlConSede } from "../sedeUrl";

async function nomeBreveSede(id: string): Promise<string> {
  try {
    return (await elencoSedi()).find((s) => s.id === id)?.slug?.trim() || id;
  } catch {
    return id;
  }
}

export async function linkBaseTavolo(request: Request, ambito: Ambito): Promise<string> {
  if (ambito.modo === "tutte") return "";
  return urlConSede(
    `${indirizzoPubblico(request)}/table`,
    ambito.modo === "sede" ? await nomeBreveSede(ambito.id) : "",
  );
}
