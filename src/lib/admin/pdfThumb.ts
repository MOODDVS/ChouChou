/**
 * MINIATURA DELLA PRIMA PAGINA DI UN PDF — una funzione sola per tutto l'admin.
 *
 * La usano la pagina Assets (tab Documenti) e Impostazioni (tab Documenti).
 * Prima ce n'erano DUE copie: quella di Assets e' stata corretta il 11/09,
 * quella di Impostazioni no, e l'anteprima li' ha continuato a non generarsi
 * per giorni senza che nessuno potesse accorgersene. Da qui in poi si corregge
 * in un posto solo.
 *
 * ⚠️ pdf.js STA NEL PROGETTO, non su un CDN. Prima arrivava da cdnjs con un
 * <script> creato a runtime, e la CSP dell'admin (`script-src 'self'
 * 'nonce-...'`, middleware.ts) lo rifiutava: origine esterna e niente nonce.
 * `import()` dinamico: Vite ne fa un pezzo a parte servito da 'self' — la CSP
 * resta stretta — e si scarica solo quando si carica davvero un PDF.
 */

let pdfjsPromise: Promise<any> | null = null;

export function caricaPdfjs(): Promise<any> {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      const lib: any = await import("pdfjs-dist");
      // Anche il worker deve venire da 'self': Vite lo trasforma in un
      // asset del progetto con `?url`.
      const worker = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
      lib.GlobalWorkerOptions.workerSrc = worker;
      return lib;
    })();
  }
  return pdfjsPromise;
}

/**
 * Miniatura della prima pagina, in WebP, come base64 senza prefisso.
 * Se non riesce si ripiega sull'icona: il documento e' comunque caricato,
 * l'anteprima e' un di piu'.
 *
 * ⚠️ Ma il motivo del fallimento va SCRITTO. Per settimane qui c'era un
 * `catch {}` muto: pdf.js era bloccato dalla CSP e nessuno poteva saperlo,
 * perche' l'unica traccia era un'icona grigia identica a quella di un PDF
 * protetto. Un ripiego silenzioso nasconde il guasto.
 *
 * @param file    il PDF scelto dall'utente
 * @param origine da dove arriva la chiamata, per riconoscere il log
 */
export async function generaAnteprimaPdf(file: File, origine = "admin"): Promise<string | null> {
  let passo = "caricamento di pdf.js";
  try {
    const lib = await caricaPdfjs();
    passo = "lettura del PDF";
    const buf = await file.arrayBuffer();
    const pdf = await lib.getDocument({ data: buf }).promise;
    passo = "apertura della prima pagina";
    const page = await pdf.getPage(1);
    const vp1 = page.getViewport({ scale: 1 });
    const vp = page.getViewport({ scale: 480 / vp1.width });
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(vp.width);
    canvas.height = Math.round(vp.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      console.error(`[${origine}] anteprima: canvas 2D non disponibile`);
      return null;
    }
    passo = "disegno della pagina";
    // pdf.js 5+ vuole anche `canvas`: con il solo contesto alcune versioni
    // non disegnano nulla e non protestano.
    await page.render({ canvasContext: ctx, canvas, viewport: vp }).promise;
    passo = "conversione in WebP";
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/webp", 0.7));
    if (!blob) {
      console.error(`[${origine}] anteprima: toBlob ha reso null`);
      return null;
    }
    if (blob.size > 512 * 1024) {
      console.error(`[${origine}] anteprima troppo pesante: ${Math.round(blob.size / 1024)} KB (max 512)`);
      return null;
    }
    return await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
      r.onerror = () => reject(new Error("FileReader"));
      r.readAsDataURL(blob);
    });
  } catch (err) {
    console.error(`[${origine}] anteprima PDF fallita durante: ${passo}`, err);
    return null;
  }
}
