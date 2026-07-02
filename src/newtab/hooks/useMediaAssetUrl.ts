import { useEffect, useState } from 'react';
import { readMediaAssetBlob } from '../media/mediaAssets';

export function useMediaAssetUrl(assetId: string | undefined): string | undefined {
  const [url, setUrl] = useState<string | undefined>();

  useEffect(() => {
    let disposed = false;
    let objectUrl: string | undefined;

    setUrl(undefined);
    if (!assetId) return undefined;

    void readMediaAssetBlob(assetId).then((blob) => {
      if (!blob || disposed) return;
      objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
    });

    return () => {
      disposed = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [assetId]);

  return url;
}
