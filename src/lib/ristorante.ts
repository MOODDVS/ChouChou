import { cacheOr } from "./cache";
import { CLIENT } from "../config/client";
import { leggiConfig, type Ambito } from "./admin/sede";

/**
 * Dati "pubblici" del ristorante per email e template: telefono,
 * email e indirizzo letti da Réglages → Général, con fallback sul config
 * cliente. Il NOME resta quello commerciale del config (company_name in
 * Général è la ragione sociale, es. la SRL).
 * Cache 60s: le modifiche in Général arrivano nelle email entro 1 min.
 *
 * ⚠️⚠️ SONO I DATI DI UN PUNTO, NON DEL MARCHIO (dal 16/09/2026).
 *
 * Tre pizzerie a tre indirizzi diversi: un cliente che prenota a Stockel
 * riceveva la conferma con la via di Schaerbeek, e ci andava. E' l'errore
 * piu' concreto di tutto il multi-sede — non un numero sbagliato su uno
 * schermo, una persona che suona a un citofono sbagliato.
 *
 * `leggiConfig` sovrappone: quello che la sede ha scritto vince, il resto lo
 * eredita dall'installazione. Quindi un gruppo che non ha ancora compilato
 * il Général di una sede continua a vedere i dati del marchio, e i quattro
 * clienti a sede unica non si accorgono di niente.
 *
 * ⚠️ L'ambito e' OBBLIGATORIO. Facoltativo voleva dire dimenticato, e qui
 * dimenticarlo non da' nessun errore: da' l'indirizzo giusto di un altro.
 */
export interface DatiRistorante {
  nome: string;
  tel: string;
  telLink: string; // solo cifre e +, per href="tel:"
  email: string;
  indirizzo: string;
  logo: string;
  logoNeg: string;
  logoPos: string;
}

export async function datiRistorante(ambito: Ambito): Promise<DatiRistorante> {
  const fallback: DatiRistorante = {
    nome: CLIENT.nome,
    tel: CLIENT.telefono,
    telLink: CLIENT.telefono.replace(/[^+\d]/g, ""),
    email: CLIENT.email,
    indirizzo: CLIENT.indirizzo,
    logo: "",
    logoNeg: "",
    logoPos: "",
  };
  // ⚠️ Chiave di cache PER SEDE. Con una chiave sola, la prima email di un
  // punto riempiva la cache e per un minuto tutti gli altri mandavano il suo
  // indirizzo. Sessanta secondi di email sbagliate non si richiamano indietro.
  const chiaveCache = "ristorante:dati" + (ambito.modo === "sede" ? `:${ambito.id}` : "");
  try {
    return await cacheOr(chiaveCache, async () => {
      const { valori } = await leggiConfig(ambito, [
        "public_phone", "public_email", "company_street", "company_zip", "company_city",
        "restaurant_name", "brand_logo_negative", "brand_favicon", "brand_logo",
      ]);
      const m = new Map([...valori].map(([k, v]) => [k, String(v ?? "").trim()]));
      const via = m.get("company_street") ?? "";
      const cp = m.get("company_zip") ?? "";
      const citta = m.get("company_city") ?? "";
      const tel = m.get("public_phone") || fallback.tel;
      return {
        nome: m.get("restaurant_name") || CLIENT.nome,
        tel,
        telLink: tel.replace(/[^+\d]/g, ""),
        email: m.get("public_email") || fallback.email,
        indirizzo: via && citta ? `${via}, ${cp} ${citta}`.replace(/\s+/g, " ") : fallback.indirizzo,
        logo: m.get("brand_logo_negative") || m.get("brand_favicon") || m.get("brand_logo") || "",
        logoNeg: m.get("brand_logo_negative") || "",
        logoPos: m.get("brand_logo") || "",
      };
    });
  } catch {
    return fallback;
  }
}
