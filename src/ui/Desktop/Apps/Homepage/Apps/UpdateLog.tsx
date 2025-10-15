import React, { useEffect, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert.tsx";
import { Separator } from "@/components/ui/separator.tsx";
import { Button } from "@/components/ui/button.tsx";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet.tsx";
import { getReleasesRSS, getVersionInfo } from "@/ui/main-axios.ts";
import { useTranslation } from "react-i18next";
import { BookOpen, X } from "lucide-react";

interface HomepageUpdateLogProps extends React.ComponentProps<"div"> {
  loggedIn: boolean;
}

interface ReleaseItem {
  id: number;
  title: string;
  description: string;
  link: string;
  pubDate: string;
  version: string;
  isPrerelease: boolean;
  isDraft: boolean;
  assets: Array<{
    name: string;
    size: number;
    download_count: number;
    download_url: string;
  }>;
}

interface RSSResponse {
  feed: {
    title: string;
    description: string;
    link: string;
    updated: string;
  };
  items: ReleaseItem[];
  total_count: number;
  cached: boolean;
  cache_age?: number;
}

interface VersionResponse {
  status: "up_to_date" | "requires_update";
  version: string;
  latest_release: {
    name: string;
    published_at: string;
    html_url: string;
  };
  cached: boolean;
  cache_age?: number;
}

export function HomepageUpdateLog({ loggedIn }: HomepageUpdateLogProps) {
  const { t } = useTranslation();
  const [releases, setReleases] = useState<RSSResponse | null>(null);
  const [versionInfo, setVersionInfo] = useState<VersionResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    if (loggedIn && isOpen) {
      setLoading(true);
      Promise.all([getReleasesRSS(100), getVersionInfo()])
        .then(([releasesRes, versionRes]) => {
          setReleases(releasesRes);
          setVersionInfo(versionRes);
          setError(null);
        })
        .catch(() => {
          setError(t("common.failedToFetchUpdateInfo"));
        })
        .finally(() => setLoading(false));
    }
  }, [loggedIn, isOpen]);

  if (!loggedIn) {
    return null;
  }

  const formatDescription = (description: string) => {
    const firstLine = description.split("\n")[0];
    return firstLine.replace(/[#*`]/g, "").replace(/\s+/g, " ").trim();
  };

  return (
    <>
      <Button
        variant="outline"
        size="lg"
        className="text-sm border-2 border-dark-border text-gray-300 hover:text-white hover:bg-dark-bg-darker transition-colors"
        onClick={() => setIsOpen(true)}
      >
        <BookOpen className="w-4 h-4 mr-2" />
        {t("common.updatesAndReleases")}
      </Button>

      <Sheet open={isOpen} onOpenChange={setIsOpen}>
        <SheetContent
          side="right"
          className="w-[500px] bg-dark-bg border-l-2 border-dark-border text-white sm:max-w-[500px] p-0 flex flex-col [&>button]:hidden"
        >
          {/* Header */}
          <div className="flex items-center justify-between p-4 border-b border-dark-border">
            <h2 className="text-lg font-semibold text-white">
              {t("common.updatesAndReleases")}
            </h2>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsOpen(false)}
              className="h-8 w-8 p-0 hover:bg-red-500 hover:text-white transition-colors flex items-center justify-center"
              title={t("common.close")}
            >
              <X />
            </Button>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-4">
            {versionInfo && versionInfo.status === "requires_update" && (
              <Alert className="bg-dark-bg-darker border-dark-border text-white mb-3">
                <AlertTitle className="text-white">
                  {t("common.updateAvailable")}
                </AlertTitle>
                <AlertDescription className="text-gray-300">
                  {t("common.newVersionAvailable", {
                    version: versionInfo.version,
                  })}
                </AlertDescription>
              </Alert>
            )}

            {loading && (
              <div className="flex items-center justify-center h-32">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
              </div>
            )}

            {error && (
              <Alert
                variant="destructive"
                className="bg-red-900/20 border-red-500 text-red-300 mb-3"
              >
                <AlertTitle className="text-red-300">
                  {t("common.error")}
                </AlertTitle>
                <AlertDescription className="text-red-300">
                  {error}
                </AlertDescription>
              </Alert>
            )}

            <div className="space-y-3">
              {releases?.items.map((release) => (
                <div
                  key={release.id}
                  className="border border-dark-border rounded-lg p-3 hover:bg-dark-bg-darker transition-colors cursor-pointer bg-dark-bg-darker/50"
                  onClick={() => window.open(release.link, "_blank")}
                >
                  <div className="flex items-start justify-between mb-2">
                    <h4 className="font-semibold text-sm leading-tight flex-1 text-white">
                      {release.title}
                    </h4>
                    {release.isPrerelease && (
                      <span className="text-xs bg-yellow-600 text-yellow-100 px-2 py-1 rounded ml-2 flex-shrink-0 font-medium">
                        {t("common.preRelease")}
                      </span>
                    )}
                  </div>

                  <p className="text-xs text-gray-300 mb-2 leading-relaxed">
                    {formatDescription(release.description)}
                  </p>

                  <div className="flex items-center text-xs text-gray-400">
                    <span>
                      {new Date(release.pubDate).toLocaleDateString()}
                    </span>
                    {release.assets.length > 0 && (
                      <>
                        <span className="mx-2">•</span>
                        <span>
                          {release.assets.length} asset
                          {release.assets.length !== 1 ? "s" : ""}
                        </span>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {releases && releases.items.length === 0 && !loading && (
              <Alert className="bg-dark-bg-darker border-dark-border text-gray-300">
                <AlertTitle className="text-gray-300">
                  {t("common.noReleases")}
                </AlertTitle>
                <AlertDescription className="text-gray-400">
                  {t("common.noReleasesFound")}
                </AlertDescription>
              </Alert>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
