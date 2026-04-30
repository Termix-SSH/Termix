import React, { useState } from "react";
import { PhotoProvider, PhotoView } from "react-photo-view";
import "react-photo-view/dist/react-photo-view.css";
import { AlertCircle, Download } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { useTranslation } from "react-i18next";

interface ImagePreviewProps {
  content: string;
  fileName: string;
  onDownload?: () => void;
  onMediaDimensionsChange?: (dimensions: {
    width: number;
    height: number;
  }) => void;
}

function getImageDataUrl(content: string, fileName: string): string {
  const ext = fileName.split(".").pop()?.toLowerCase() || "";

  const mimeTypes: Record<string, string> = {
    svg: "image/svg+xml",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    bmp: "image/bmp",
    ico: "image/x-icon",
    tiff: "image/tiff",
    tif: "image/tiff",
  };

  const mimeType = mimeTypes[ext] || "image/png";
  return `data:${mimeType};base64,${content}`;
}

export function ImagePreview({
  content,
  fileName,
  onDownload,
  onMediaDimensionsChange,
}: ImagePreviewProps) {
  const { t } = useTranslation();
  const [imageLoadError, setImageLoadError] = useState(false);
  const [imageLoading, setImageLoading] = useState(true);
  const imageUrl = getImageDataUrl(content, fileName);

  return (
    <div className="p-6 flex items-center justify-center h-full relative">
      {imageLoadError ? (
        <div className="text-center text-muted-foreground">
          <AlertCircle className="w-16 h-16 mx-auto mb-4 text-muted-foreground/50" />
          <h3 className="text-lg font-medium mb-2">
            {t("fileManager.imageLoadError")}
          </h3>
          <p className="text-sm mb-4">{fileName}</p>
          {onDownload && (
            <Button
              variant="outline"
              onClick={onDownload}
              className="flex items-center gap-2 mx-auto"
            >
              <Download className="w-4 h-4" />
              {t("fileManager.download")}
            </Button>
          )}
        </div>
      ) : (
        <PhotoProvider maskOpacity={0.7}>
          <PhotoView src={imageUrl}>
            <img
              src={imageUrl}
              alt={fileName}
              className="max-w-full max-h-full object-contain rounded-lg shadow-sm cursor-pointer hover:shadow-lg transition-shadow"
              style={{ maxHeight: "calc(100vh - 200px)" }}
              onLoad={(e) => {
                setImageLoading(false);
                setImageLoadError(false);

                const img = e.currentTarget;
                if (
                  onMediaDimensionsChange &&
                  img.naturalWidth &&
                  img.naturalHeight
                ) {
                  onMediaDimensionsChange({
                    width: img.naturalWidth,
                    height: img.naturalHeight,
                  });
                }
              }}
              onError={() => {
                setImageLoading(false);
                setImageLoadError(true);
              }}
            />
          </PhotoView>
        </PhotoProvider>
      )}

      {imageLoading && !imageLoadError && (
        <div className="absolute inset-0 flex items-center justify-center bg-background/80">
          <div className="text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500 mx-auto mb-2"></div>
            <p className="text-sm text-muted-foreground">Loading image...</p>
          </div>
        </div>
      )}
    </div>
  );
}
