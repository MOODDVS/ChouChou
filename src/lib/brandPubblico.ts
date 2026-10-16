import { leggiConfig, type Ambito } from "./admin/sede";
import { CHIAVI_BRAND } from "./brandRegole";

/* Le regole pure si riesportano da qui: chi veste una pagina importa un file
   solo, e chi deve PROVARLE importa `brandRegole` senza passare da `db.ts`. */
export { CHIAVI_BRAND, coloreTema } from "./brandRegole";

/**
 * IL BRAND DEL CLIENTE, per una pagina PUBBLICA.
 *
 * Nome, logo, icona e colori come li ha messi il ristoratore nei Reglages.
 *
 * ⚠️ ESISTE PERCHE' UNA PAGINA DEL MOTORE NON HA UN DESIGN SUO, e non deve
 * averne uno. Il motore da' le porte ai dati; il vestito e' del cliente. Senza
 * questa lettura una pagina nuova esce in Times New Roman su fondo bianco —
 * tecnicamente giusta, e per chi inquadra un QR al tavolo e' il sito di
 * nessuno.
 *
 * ⚠️ PASSA DA `leggiConfig(ambito)`, non da `supabaseAdmin` a mano: in un
 * gruppo con piu' punti il logo e i colori possono essere diversi per sede, e
 * una lettura senza ambito darebbe il marchio del primo. (La home
 * `index.astro` legge ancora a mano: e' una pagina del CLIENTE, ognuno ha la
 * sua, e non si tocca dal motore.)
 *
 * ⚠️ NON LANCIA MAI. Un database muto deve dare una pagina sobria, non una
 * pagina rotta: chi e' seduto al tavolo vuole ordinare.
 */
export interface BrandPubblico {
  nome: string;
  logo: string;
  favicon: string;
  tema: Record<string, string>;
}

export async function brandPubblico(ambito: Ambito): Promise<BrandPubblico> {
  try {
    const { valori } = await leggiConfig(ambito, CHIAVI_BRAND);
    let tema: Record<string, string> = {};
    try {
      tema = JSON.parse(valori.get("admin_theme") ?? "{}") ?? {};
    } catch {
      tema = {};
    }
    /* ⚠️ Il logo NEGATIVO per primo: queste pagine hanno il fondo del tema, che
       nei nove clienti di oggi e' scuro. Col logo normale si vedrebbe un
       rettangolo nero su fondo nero — un logo che non si vede e' peggio di
       nessun logo, perche' lascia un buco in cima. */
    const logo =
      (valori.get("brand_logo_negative") ?? "").trim() ||
      (valori.get("brand_logo") ?? "").trim();
    return {
      nome: (valori.get("restaurant_name") ?? "").trim(),
      logo,
      favicon: (valori.get("brand_favicon") ?? "").trim() || "/favicon.svg",
      tema,
    };
  } catch {
    return { nome: "", logo: "", favicon: "/favicon.svg", tema: {} };
  }
}
