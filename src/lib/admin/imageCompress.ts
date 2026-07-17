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
