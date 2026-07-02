import { openDB, type IDBPDatabase } from 'idb';

const MEDIA_DB_NAME = 'fasp-media-assets';
const MEDIA_STORE_NAME = 'assets';

export interface MediaAssetRecord {
  id: string;
  kind: 'tile-image' | 'wallpaper' | 'generic';
  blob: Blob;
  mimeType: string;
  width: number;
  height: number;
  createdAt: number;
  originalBytes?: number;
}

export interface SaveImageAssetOptions {
  kind?: MediaAssetRecord['kind'];
  maxSide?: number;
  quality?: number;
  mimeType?: 'image/webp' | 'image/jpeg' | 'image/png';
}

let mediaDbPromise: Promise<IDBPDatabase> | null = null;

function getMediaDb(): Promise<IDBPDatabase> {
  if (!mediaDbPromise) {
    mediaDbPromise = openDB(MEDIA_DB_NAME, 1, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(MEDIA_STORE_NAME)) {
          db.createObjectStore(MEDIA_STORE_NAME, { keyPath: 'id' });
        }
      },
    });
  }
  return mediaDbPromise;
}

export function isImageDataUrl(value: unknown): value is string {
  return typeof value === 'string' && /^data:image\/[a-z0-9.+-]+;base64,/i.test(value);
}

function dataUrlToBlob(dataUrl: string): Blob {
  const [header, payload] = dataUrl.split(',');
  const mimeType = header.match(/^data:([^;]+);/i)?.[1] || 'application/octet-stream';
  const binary = atob(payload || '');
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes], { type: mimeType });
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('Failed to read blob'));
    reader.readAsDataURL(blob);
  });
}

function decodeImage(blob: Blob): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === 'function') {
    return createImageBitmap(blob);
  }

  return new Promise((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(blob);
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to decode image asset'));
    };
    image.src = url;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, mimeType: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Failed to encode image asset'));
    }, mimeType, quality);
  });
}

async function optimizeImageBlob(
  source: Blob,
  options: Required<Pick<SaveImageAssetOptions, 'maxSide' | 'quality' | 'mimeType'>>
): Promise<{ blob: Blob; width: number; height: number }> {
  const image = await decodeImage(source);
  const sourceWidth = 'width' in image ? image.width : 1;
  const sourceHeight = 'height' in image ? image.height : 1;
  const scale = Math.min(1, options.maxSide / Math.max(1, sourceWidth, sourceHeight));
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { alpha: true });
  if (!ctx) {
    if ('close' in image) image.close();
    return { blob: source, width: sourceWidth, height: sourceHeight };
  }

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(image, 0, 0, width, height);
  if ('close' in image) image.close();

  const blob = await canvasToBlob(canvas, options.mimeType, options.quality);
  canvas.width = 1;
  canvas.height = 1;
  return { blob, width, height };
}

export async function saveImageAssetFromBlob(
  source: Blob,
  options: SaveImageAssetOptions = {}
): Promise<MediaAssetRecord> {
  const kind = options.kind || 'generic';
  const mimeType = options.mimeType || 'image/webp';
  const maxSide = options.maxSide || (kind === 'wallpaper' ? 1920 : 768);
  const quality = options.quality ?? (kind === 'wallpaper' ? 0.86 : 0.82);
  const optimized = await optimizeImageBlob(source, { maxSide, quality, mimeType });
  const record: MediaAssetRecord = {
    id: `asset_${crypto.randomUUID()}`,
    kind,
    blob: optimized.blob,
    mimeType: optimized.blob.type || mimeType,
    width: optimized.width,
    height: optimized.height,
    createdAt: Date.now(),
    originalBytes: source.size,
  };

  const db = await getMediaDb();
  await db.put(MEDIA_STORE_NAME, record);
  return record;
}

export async function saveImageAssetFromDataUrl(
  dataUrl: string,
  options: SaveImageAssetOptions = {}
): Promise<MediaAssetRecord> {
  return saveImageAssetFromBlob(dataUrlToBlob(dataUrl), options);
}

export async function readMediaAsset(assetId: string | undefined): Promise<MediaAssetRecord | null> {
  if (!assetId) return null;
  try {
    const db = await getMediaDb();
    const record = await db.get(MEDIA_STORE_NAME, assetId);
    return record || null;
  } catch {
    return null;
  }
}

export async function readMediaAssetBlob(assetId: string | undefined): Promise<Blob | null> {
  const record = await readMediaAsset(assetId);
  return record?.blob || null;
}

export async function readMediaAssetAsDataUrl(assetId: string | undefined): Promise<string | null> {
  const blob = await readMediaAssetBlob(assetId);
  return blob ? blobToDataUrl(blob) : null;
}

export async function deleteMediaAsset(assetId: string | undefined): Promise<void> {
  if (!assetId) return;
  try {
    const db = await getMediaDb();
    await db.delete(MEDIA_STORE_NAME, assetId);
  } catch {
    // Best effort cleanup only.
  }
}
