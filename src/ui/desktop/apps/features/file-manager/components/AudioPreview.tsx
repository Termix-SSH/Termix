import React from "react";
import AudioPlayer from "react-h5-audio-player";
import "react-h5-audio-player/lib/styles.css";
import { Music } from "lucide-react";
import { cn } from "@/lib/utils.ts";
import { useTranslation } from "react-i18next";

interface FileItem {
  name: string;
  size?: number;
}

interface AudioPreviewProps {
  file: FileItem;
  content: string;
  color: string;
  onMediaDimensionsChange?: (dimensions: {
    width: number;
    height: number;
  }) => void;
}

function formatFileSize(bytes?: number, t?: (key: string) => string): string {
  if (!bytes) return t ? t("fileManager.unknownSize") : "Unknown size";
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${sizes[i]}`;
}

function getAudioMimeType(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() || "";

  switch (ext) {
    case "mp3":
      return "audio/mpeg";
    case "wav":
      return "audio/wav";
    case "flac":
      return "audio/flac";
    case "ogg":
      return "audio/ogg";
    case "aac":
      return "audio/aac";
    case "m4a":
      return "audio/mp4";
    default:
      return "audio/mpeg";
  }
}

export function AudioPreview({
  file,
  content,
  color,
  onMediaDimensionsChange,
}: AudioPreviewProps) {
  const { t } = useTranslation();
  const ext = file.name.split(".").pop()?.toLowerCase() || "";
  const audioUrl = `data:${getAudioMimeType(file.name)};base64,${content}`;

  return (
    <div className="p-6 flex items-center justify-center h-full">
      <div className="w-full max-w-2xl">
        <div className="space-y-4">
          <div className="flex justify-center">
            <div
              className={cn(
                "w-32 h-32 rounded-lg bg-gradient-to-br from-pink-100 to-purple-100 flex items-center justify-center shadow-lg",
                color,
              )}
            >
              <Music className="w-16 h-16 text-pink-600" />
            </div>
          </div>

          <div className="text-center">
            <h3 className="font-semibold text-foreground text-lg mb-1">
              {file.name.replace(/\.[^/.]+$/, "")}
            </h3>
            <p className="text-sm text-muted-foreground">
              {ext.toUpperCase()} • {formatFileSize(file.size, t)}
            </p>
          </div>

          <div className="rounded-lg overflow-hidden">
            <AudioPlayer
              src={audioUrl}
              onLoadedMetadata={() => {
                onMediaDimensionsChange?.({
                  width: 600,
                  height: 400,
                });
              }}
              onError={(e) => {
                console.error("Audio playback error:", e);
              }}
              showJumpControls={false}
              showSkipControls={false}
              showDownloadProgress={true}
              customAdditionalControls={[]}
              customVolumeControls={[]}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
