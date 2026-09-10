/**
 * Compressione client-side delle foto prima dell'upload (admin):
 * ridimensiona a max 1600 px sul lato lungo e converte in WebP
 * a qualità 60%. Una foto da 4 Mo scende tipicamente a 100-250 KB.
 * GIF e SVG passano invariati (animazione / vettoriale).
 * Se il browser non sa codificare WebP (vecchi Safari) ripiega su JPEG.
 * Se il risultato fosse più pesante dell'originale, tiene l'originale.
 */

const LATO_MAX = 1600;
const QUALITA = 0.6;

function toBlob(canvas: HTMLCanvasElement, tipo: string, qualita: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, tipo, qualita));
}

async function caricaImmagine(file: File): Promise<ImageBitmap | HTMLImageElement> {
  try {
    // Rispetta l'orientamento EXIF delle foto scattate col telefono
    return await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Image illisible")); };
      img.src = url;
    });
  }
}

export async function comprimiFoto(file: File): Promise<File> {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "gif" || ext === "svg") return file;

  let img: ImageBitmap | HTMLImageElement;
  try {
    img = await caricaImmagine(file);
  } catch {
    return file; // formato non decodificabile dal browser: passa l'originale
  }
  const w0 = img instanceof HTMLImageElement ? img.naturalWidth : img.width;
  const h0 = img instanceof HTMLImageElement ? img.naturalHeight : img.height;
  if (!w0 || !h0) return file;

  const scala = Math.min(1, LATO_MAX / Math.max(w0, h0));
  const w = Math.max(1, Math.round(w0 * scala));
  const h = Math.max(1, Math.round(h0 * scala));

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return file;
  ctx.drawImage(img, 0, 0, w, h);

  let blob = await toBlob(canvas, "image/webp", QUALITA);
  let nuovaExt = "webp";
  if (!blob || blob.type !== "image/webp") {
    blob = await toBlob(canvas, "image/jpeg", QUALITA);
    nuovaExt = "jpg";
  }
  if (!blob || blob.size >= file.size) return file;

  const base = file.name.replace(/\.[^.]+$/, "") || "photo";
  return new File([blob], `${base}.${nuovaExt}`, { type: blob.type });
}

/* ------------------------------------------------------------------------
 * Variante per le foto della SCHEDA GOOGLE.
 * Google Business Profile accetta SOLO JPG e PNG: comprimiFoto() converte in
 * WebP, e Google rifiutava il file (tipico: il logo PNG del ristorante).
 * Qui il formato non cambia mai — si ridimensiona soltanto, e solo se il lato
 * lungo supera LATO_MAX. Ritorna anche le dimensioni, perche Google chiede
 * almeno 250x250 px e vale la pena dirlo prima di fare il giro di rete.
 * ---------------------------------------------------------------------- */

export const GOOGLE_LATO_MIN = 250;

export type FotoGoogle = { file: File; larghezza: number; altezza: number };

/** null = formato che Google non accetta, o immagine non decodificabile. */
export async function preparaFotoGoogle(file: File): Promise<FotoGoogle | null> {
  const tipo = file.type === "image/png" ? "image/png" : file.type === "image/jpeg" ? "image/jpeg" : "";
  if (!tipo) return null;

  let img: ImageBitmap | HTMLImageElement;
  try {
    img = await caricaImmagine(file);
  } catch {
    return null;
  }
  const w0 = img instanceof HTMLImageElement ? img.naturalWidth : img.width;
  const h0 = img instanceof HTMLImageElement ? img.naturalHeight : img.height;
  if (!w0 || !h0) return null;
  if (Math.max(w0, h0) <= LATO_MAX) return { file, larghezza: w0, altezza: h0 };

  const scala = LATO_MAX / Math.max(w0, h0);
  const w = Math.max(1, Math.round(w0 * scala));
  const h = Math.max(1, Math.round(h0 * scala));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return { file, larghezza: w0, altezza: h0 };
  ctx.drawImage(img, 0, 0, w, h);

  // PNG ignora il parametro qualita: resta senza perdite, trasparenza inclusa.
  const blob = await toBlob(canvas, tipo, tipo === "image/jpeg" ? 0.85 : 1);
  if (!blob || blob.type !== tipo) return { file, larghezza: w0, altezza: h0 };
  const base = file.name.replace(/\.[^.]+$/, "") || "photo";
  const ext = tipo === "image/png" ? "png" : "jpg";
  return { file: new File([blob], `${base}.${ext}`, { type: tipo }), larghezza: w, altezza: h };
}

/* ------------------------------------------------------------------------
 * ICONA dell'app installata (PWA).
 * Requisiti veri, non nostri: Android/Chrome vogliono un PNG QUADRATO di
 * almeno 192px per considerare l'app installabile, e 512 e' la misura che
 * copre anche la schermata di avvio. Un favicon da 32px o un SVG NON vanno:
 * l'icona esce sfocata o l'installazione viene rifiutata.
 *
 * Qui l'immagine viene messa dentro un quadrato 512 SENZA tagliarla
 * («contain», sfondo trasparente): un logo largo resta intero, con aria
 * sopra e sotto. Meglio un logo centrato che un logo decapitato.
 * ---------------------------------------------------------------------- */

export const PWA_ICONA_LATO = 512;

export type IconaPWA = {
  file: File;
  /** Lato lungo dell'immagine di partenza: sotto 512 l'icona sara' sgranata. */
  latoSorgente: number;
};

/** null = formato non utilizzabile (SVG compreso) o immagine non decodificabile. */
export async function generaIconaPWA(file: File): Promise<IconaPWA | null> {
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) return null;

  let img: ImageBitmap | HTMLImageElement;
  try {
    img = await caricaImmagine(file);
  } catch {
    return null;
  }
  const w0 = img instanceof HTMLImageElement ? img.naturalWidth : img.width;
  const h0 = img instanceof HTMLImageElement ? img.naturalHeight : img.height;
  if (!w0 || !h0) return null;

  const L = PWA_ICONA_LATO;
  const canvas = document.createElement("canvas");
  canvas.width = L;
  canvas.height = L;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  const scala = Math.min(L / w0, L / h0);
  const w = Math.round(w0 * scala);
  const h = Math.round(h0 * scala);
  ctx.drawImage(img, Math.round((L - w) / 2), Math.round((L - h) / 2), w, h);

  const blob = await toBlob(canvas, "image/png", 1);
  if (!blob) return null;
  const base = file.name.replace(/\.[^.]+$/, "") || "app-icon";
  return {
    file: new File([blob], `${base}-512.png`, { type: "image/png" }),
    latoSorgente: Math.max(w0, h0),
  };
}
