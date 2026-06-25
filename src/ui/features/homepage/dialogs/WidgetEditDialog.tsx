import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/dialog";
import { Button } from "@/components/button";
import { Input } from "@/components/input";
import type {
  CanvasWidget,
  ServiceLinkConfig,
  FolderConfig,
  NotesConfig,
  BookmarkListConfig,
  ClockConfig,
  HostStatusConfig,
  WeatherConfig,
  IframeConfig,
  RssFeedConfig,
  MetricsChartConfig,
  HostGridConfig,
  AlertFeedConfig,
  PingStatusConfig,
  RecentActivityConfig,
  TermixUptimeConfig,
  SystemOverviewConfig,
  SshTerminalConfig,
  QuickConnectConfig,
  FileManagerWidgetConfig,
  DockerWidgetConfig,
  TunnelWidgetConfig,
  CalendarConfig,
  CountdownConfig,
  SearchBarConfig,
  TextBannerConfig,
  ImageWidgetConfig,
  MarkdownNotesConfig,
  CustomApiConfig,
  ServiceGridConfig,
  DashboardLinksConfig,
  SearchLinksConfig,
  LinkTreeConfig,
} from "@/types/homepage-types";
import { ServiceLinkEditForm } from "./ServiceLinkEditForm";
import { FolderEditForm } from "./FolderEditForm";
import { NotesEditForm } from "./NotesEditForm";
import { BookmarkListEditForm } from "./BookmarkListEditForm";
import { ClockEditForm } from "./ClockEditForm";
import { HostStatusEditForm } from "./HostStatusEditForm";
import { WeatherEditForm } from "./WeatherEditForm";
import { IframeEditForm } from "./IframeEditForm";
import { RssFeedEditForm } from "./RssFeedEditForm";
import { MetricsChartEditForm } from "./MetricsChartEditForm";
import { HostGridEditForm } from "./HostGridEditForm";
import { AlertFeedEditForm } from "./AlertFeedEditForm";
import { PingStatusEditForm } from "./PingStatusEditForm";
import { RecentActivityEditForm } from "./RecentActivityEditForm";
import { TermixUptimeEditForm } from "./TermixUptimeEditForm";
import { SystemOverviewEditForm } from "./SystemOverviewEditForm";
import { SshTerminalEditForm } from "./SshTerminalEditForm";
import { QuickConnectEditForm } from "./QuickConnectEditForm";
import { FileManagerWidgetEditForm } from "./FileManagerWidgetEditForm";
import { DockerWidgetEditForm } from "./DockerWidgetEditForm";
import { TunnelWidgetEditForm } from "./TunnelWidgetEditForm";
import { CalendarEditForm } from "./CalendarEditForm";
import { CountdownEditForm } from "./CountdownEditForm";
import { SearchBarEditForm } from "./SearchBarEditForm";
import { TextBannerEditForm } from "./TextBannerEditForm";
import { ImageWidgetEditForm } from "./ImageWidgetEditForm";
import { MarkdownNotesEditForm } from "./MarkdownNotesEditForm";
import { CustomApiEditForm } from "./CustomApiEditForm";
import { ServiceGridEditForm } from "./ServiceGridEditForm";
import { DashboardLinksEditForm } from "./DashboardLinksEditForm";
import { SearchLinksEditForm } from "./SearchLinksEditForm";
import { LinkTreeEditForm } from "./LinkTreeEditForm";

interface WidgetEditDialogProps {
  widget: CanvasWidget | null;
  onSave: (
    id: number,
    title: string | null,
    config: Record<string, unknown>,
  ) => void;
  onClose: () => void;
}

export function WidgetEditDialog({
  widget,
  onSave,
  onClose,
}: WidgetEditDialogProps) {
  const { t } = useTranslation();
  const [title, setTitle] = useState(widget?.title ?? "");
  const [config, setConfig] = useState<Record<string, unknown>>(
    widget?.config ?? {},
  );

  if (!widget) return null;

  const handleSave = () => {
    onSave(widget.id, title || null, config);
    onClose();
  };

  const renderForm = () => {
    switch (widget.typeId) {
      case "service_link":
        return (
          <ServiceLinkEditForm
            config={config as ServiceLinkConfig}
            onChange={(c) => setConfig(c as unknown as Record<string, unknown>)}
          />
        );
      case "folder":
        return (
          <FolderEditForm
            config={config as FolderConfig}
            onChange={(c) => setConfig(c as unknown as Record<string, unknown>)}
          />
        );
      case "notes":
        return (
          <NotesEditForm
            config={config as NotesConfig}
            onChange={(c) => setConfig(c as unknown as Record<string, unknown>)}
          />
        );
      case "bookmark_list":
        return (
          <BookmarkListEditForm
            config={config as BookmarkListConfig}
            onChange={(c) => setConfig(c as unknown as Record<string, unknown>)}
          />
        );
      case "clock":
        return (
          <ClockEditForm
            config={config as ClockConfig}
            onChange={(c) => setConfig(c as unknown as Record<string, unknown>)}
          />
        );
      case "host_status":
        return (
          <HostStatusEditForm
            config={config as HostStatusConfig}
            onChange={(c) => setConfig(c as unknown as Record<string, unknown>)}
          />
        );
      case "weather":
        return (
          <WeatherEditForm
            config={config as WeatherConfig}
            onChange={(c) => setConfig(c as unknown as Record<string, unknown>)}
          />
        );
      case "iframe_embed":
        return (
          <IframeEditForm
            config={config as IframeConfig}
            onChange={(c) => setConfig(c as unknown as Record<string, unknown>)}
          />
        );
      case "rss_feed":
        return (
          <RssFeedEditForm
            config={config as RssFeedConfig}
            onChange={(c) => setConfig(c as unknown as Record<string, unknown>)}
          />
        );
      case "metrics_chart":
        return (
          <MetricsChartEditForm
            config={config as MetricsChartConfig}
            onChange={(c) => setConfig(c as unknown as Record<string, unknown>)}
          />
        );
      case "host_grid":
        return (
          <HostGridEditForm
            config={config as HostGridConfig}
            onChange={(c) => setConfig(c as unknown as Record<string, unknown>)}
          />
        );
      case "alert_feed":
        return (
          <AlertFeedEditForm
            config={config as AlertFeedConfig}
            onChange={(c) => setConfig(c as unknown as Record<string, unknown>)}
          />
        );
      case "ping_status":
        return (
          <PingStatusEditForm
            config={config as PingStatusConfig}
            onChange={(c) => setConfig(c as unknown as Record<string, unknown>)}
          />
        );
      case "recent_activity":
        return (
          <RecentActivityEditForm
            config={config as RecentActivityConfig}
            onChange={(c) => setConfig(c as unknown as Record<string, unknown>)}
          />
        );
      case "termix_uptime":
        return (
          <TermixUptimeEditForm
            config={config as TermixUptimeConfig}
            onChange={(c) => setConfig(c as unknown as Record<string, unknown>)}
          />
        );
      case "system_overview":
        return (
          <SystemOverviewEditForm
            config={config as SystemOverviewConfig}
            onChange={(c) => setConfig(c as unknown as Record<string, unknown>)}
          />
        );
      case "ssh_terminal":
        return (
          <SshTerminalEditForm
            config={config as SshTerminalConfig}
            onChange={(c) => setConfig(c as unknown as Record<string, unknown>)}
          />
        );
      case "quick_connect":
        return (
          <QuickConnectEditForm
            config={config as QuickConnectConfig}
            onChange={(c) => setConfig(c as unknown as Record<string, unknown>)}
          />
        );
      case "file_manager_widget":
        return (
          <FileManagerWidgetEditForm
            config={config as FileManagerWidgetConfig}
            onChange={(c) => setConfig(c as unknown as Record<string, unknown>)}
          />
        );
      case "docker_widget":
        return (
          <DockerWidgetEditForm
            config={config as DockerWidgetConfig}
            onChange={(c) => setConfig(c as unknown as Record<string, unknown>)}
          />
        );
      case "tunnel_widget":
        return (
          <TunnelWidgetEditForm
            config={config as TunnelWidgetConfig}
            onChange={(c) => setConfig(c as unknown as Record<string, unknown>)}
          />
        );
      case "calendar":
        return (
          <CalendarEditForm
            config={config as CalendarConfig}
            onChange={(c) => setConfig(c as unknown as Record<string, unknown>)}
          />
        );
      case "countdown":
        return (
          <CountdownEditForm
            config={config as CountdownConfig}
            onChange={(c) => setConfig(c as unknown as Record<string, unknown>)}
          />
        );
      case "search_bar":
        return (
          <SearchBarEditForm
            config={config as SearchBarConfig}
            onChange={(c) => setConfig(c as unknown as Record<string, unknown>)}
          />
        );
      case "text_banner":
        return (
          <TextBannerEditForm
            config={config as TextBannerConfig}
            onChange={(c) => setConfig(c as unknown as Record<string, unknown>)}
          />
        );
      case "image_widget":
        return (
          <ImageWidgetEditForm
            config={config as ImageWidgetConfig}
            onChange={(c) => setConfig(c as unknown as Record<string, unknown>)}
          />
        );
      case "markdown_notes":
        return (
          <MarkdownNotesEditForm
            config={config as MarkdownNotesConfig}
            onChange={(c) => setConfig(c as unknown as Record<string, unknown>)}
          />
        );
      case "custom_api":
        return (
          <CustomApiEditForm
            config={config as CustomApiConfig}
            onChange={(c) => setConfig(c as unknown as Record<string, unknown>)}
          />
        );
      case "service_grid":
        return (
          <ServiceGridEditForm
            config={config as ServiceGridConfig}
            onChange={(c) => setConfig(c as unknown as Record<string, unknown>)}
          />
        );
      case "dashboard_links":
        return (
          <DashboardLinksEditForm
            config={config as DashboardLinksConfig}
            onChange={(c) => setConfig(c as unknown as Record<string, unknown>)}
          />
        );
      case "search_links":
        return (
          <SearchLinksEditForm
            config={config as SearchLinksConfig}
            onChange={(c) => setConfig(c as unknown as Record<string, unknown>)}
          />
        );
      case "link_tree":
        return (
          <LinkTreeEditForm
            config={config as LinkTreeConfig}
            onChange={(c) => setConfig(c as unknown as Record<string, unknown>)}
          />
        );
      default:
        return null;
    }
  };

  return (
    <Dialog
      open={!!widget}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        className="max-w-sm"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <DialogHeader>
          <DialogTitle>{t("homepage.editWidget")}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-muted-foreground">
              {t("homepage.title_label")}
            </label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t("homepage.widgetTitlePlaceholder")}
              className="h-8 text-sm"
            />
          </div>
          {renderForm()}
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>
            {t("homepage.cancel")}
          </Button>
          <Button size="sm" onClick={handleSave}>
            {t("homepage.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
