import React, { useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import { AlertCircle, Download } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { useTranslation } from "react-i18next";

pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.js";

interface PdfPreviewProps {
  content: string;
  onDownload?: () => void;
  onMediaDimensionsChange?: (dimensions: {
    width: number;
    height: number;
  }) => void;
}

export function PdfPreview({
  content,
  onDownload,
  onMediaDimensionsChange,
}: PdfPreviewProps) {
  const { t } = useTranslation();
  const [numPages, setNumPages] = useState<number | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [pdfScale, setPdfScale] = useState(1.2);
  const [pdfError, setPdfError] = useState(false);

  return (
    <div className="h-full flex flex-col bg-background">
      <div className="flex-shrink-0 bg-muted/30 border-b border-border p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPageNumber(Math.max(1, pageNumber - 1))}
                disabled={pageNumber <= 1}
              >
                {t("fileManager.previous")}
              </Button>
              <span className="text-sm text-foreground px-3 py-1 bg-background rounded border">
                {t("fileManager.pageXOfY", {
                  current: pageNumber,
                  total: numPages || 0,
                })}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  setPageNumber(Math.min(numPages || 1, pageNumber + 1))
                }
                disabled={!numPages || pageNumber >= numPages}
              >
                {t("fileManager.next")}
              </Button>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPdfScale(Math.max(0.5, pdfScale - 0.2))}
              >
                {t("fileManager.zoomOut")}
              </Button>
              <span className="text-sm text-foreground px-3 py-1 bg-background rounded border min-w-[80px] text-center">
                {Math.round(pdfScale * 100)}%
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPdfScale(Math.min(3.0, pdfScale + 0.2))}
              >
                {t("fileManager.zoomIn")}
              </Button>
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto thin-scrollbar p-6 bg-surface">
        <div className="flex justify-center">
          {pdfError ? (
            <div className="text-center text-muted-foreground p-8">
              <AlertCircle className="w-16 h-16 mx-auto mb-4 text-muted-foreground/50" />
              <h3 className="text-lg font-medium mb-2">Cannot load PDF</h3>
              <p className="text-sm mb-4">
                There was an error loading this PDF file.
              </p>
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
            <Document
              file={`data:application/pdf;base64,${content}`}
              onLoadSuccess={({ numPages }) => {
                setNumPages(numPages);
                setPdfError(false);

                onMediaDimensionsChange?.({
                  width: 800,
                  height: 600,
                });
              }}
              onLoadError={(error) => {
                console.error("PDF load error:", error);
                setPdfError(true);
              }}
              loading={
                <div className="text-center p-8">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500 mx-auto mb-2"></div>
                  <p className="text-sm text-muted-foreground">
                    Loading PDF...
                  </p>
                </div>
              }
            >
              <Page
                pageNumber={pageNumber}
                scale={pdfScale}
                className="shadow-lg"
                loading={
                  <div className="text-center p-4">
                    <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-500 mx-auto mb-2"></div>
                    <p className="text-xs text-muted-foreground">
                      Loading page...
                    </p>
                  </div>
                }
              />
            </Document>
          )}
        </div>
      </div>
    </div>
  );
}
