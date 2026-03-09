import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button.tsx";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import { Separator } from "@/components/ui/separator.tsx";
import { ScrollArea } from "@/components/ui/scroll-area.tsx";
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet.tsx";
import {
  Key,
  User,
  Calendar,
  Hash,
  Folder,
  Edit3,
  Copy,
  Shield,
  Clock,
  Server,
  Eye,
  EyeOff,
  AlertTriangle,
  CheckCircle,
  FileText,
} from "lucide-react";
import { getCredentialDetails, getCredentialHosts } from "@/ui/main-axios.ts";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import type {
  Credential,
  HostInfo,
  CredentialViewerProps,
} from "../../../types/index.js";

const CredentialViewer: React.FC<CredentialViewerProps> = ({
  credential,
  onClose,
  onEdit,
}) => {
  const { t } = useTranslation();
  const [credentialDetails, setCredentialDetails] = useState<Credential | null>(
    null,
  );
  const [hostsUsing, setHostsUsing] = useState<HostInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [showSensitive, setShowSensitive] = useState<Record<string, boolean>>(
    {},
  );
  const [activeTab, setActiveTab] = useState<"overview" | "security" | "usage">(
    "overview",
  );

  useEffect(() => {
    fetchCredentialDetails();
    fetchHostsUsing();
  }, [credential.id]);

  const fetchCredentialDetails = async () => {
    try {
      const response = await getCredentialDetails(credential.id);
      setCredentialDetails(response);
    } catch {
      toast.error(t("credentials.failedToFetchCredentialDetails"));
    }
  };

  const fetchHostsUsing = async () => {
    try {
      const response = await getCredentialHosts(credential.id);
      setHostsUsing(response);
    } catch {
      toast.error(t("credentials.failedToFetchHostsUsing"));
    } finally {
      setLoading(false);
    }
  };

  const toggleSensitiveVisibility = (field: string) => {
    setShowSensitive((prev) => ({
      ...prev,
      [field]: !prev[field],
    }));
  };

  const copyToClipboard = async (text: string, fieldName: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(t("copiedToClipboard", { field: fieldName }));
    } catch {
      toast.error(t("credentials.failedToCopy"));
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString();
  };

  const getAuthIcon = (authType: string) => {
    return authType === "password" ? (
      <Key className="h-5 w-5 text-foreground-subtle" />
    ) : (
      <Shield className="h-5 w-5 text-foreground-subtle" />
    );
  };

  const renderSensitiveField = (
    value: string | undefined,
    fieldName: string,
    label: string,
    isMultiline = false,
  ) => {
    if (!value) return null;

    const isVisible = showSensitive[fieldName];

    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium text-foreground-secondary">
            {label}
          </label>
          <div className="flex items-center space-x-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => toggleSensitiveVisibility(fieldName)}
            >
              {isVisible ? (
                <EyeOff className="h-4 w-4" />
              ) : (
                <Eye className="h-4 w-4" />
              )}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => copyToClipboard(value, label)}
            >
              <Copy className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <div
          className={`p-3 rounded-md bg-surface ${isMultiline ? "" : "min-h-[2.5rem]"}`}
        >
          {isVisible ? (
            <pre
              className={`text-sm ${isMultiline ? "whitespace-pre-wrap" : "whitespace-nowrap"} font-mono`}
            >
              {value}
            </pre>
          ) : (
            <div className="text-sm text-foreground-subtle">
              {"•".repeat(isMultiline ? 50 : 20)}
            </div>
          )}
        </div>
      </div>
    );
  };

  if (loading || !credentialDetails) {
    return (
      <Sheet open={true} onOpenChange={onClose}>
        <SheetContent className="w-[600px] max-w-[50vw]">
          <div className="flex items-center justify-center h-64">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-foreground-subtle"></div>
          </div>
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Sheet open={true} onOpenChange={onClose}>
      <SheetContent className="w-[600px] max-w-[50vw] overflow-y-auto thin-scrollbar">
        <SheetHeader className="space-y-6 pb-8">
          <SheetTitle className="flex items-center space-x-4">
            <div className="p-2 rounded-lg bg-surface">
              {getAuthIcon(credentialDetails.authType)}
            </div>
            <div className="flex-1">
              <div className="text-xl font-semibold">
                {credentialDetails.name}
              </div>
              <div className="text-sm font-normal text-foreground-subtle mt-1">
                {credentialDetails.description}
              </div>
            </div>
            <div className="flex items-center space-x-2">
              <Badge variant="outline" className="text-foreground-subtle">
                {credentialDetails.authType}
              </Badge>
              {credentialDetails.keyType && (
                <Badge
                  variant="secondary"
                  className="bg-surface text-foreground-secondary"
                >
                  {credentialDetails.keyType}
                </Badge>
              )}
            </div>
          </SheetTitle>
        </SheetHeader>

        <div className="space-y-10">
          <div className="flex space-x-2 p-2 bg-surface border border-border rounded-lg">
            <Button
              variant={activeTab === "overview" ? "default" : "ghost"}
              size="sm"
              onClick={() => setActiveTab("overview")}
              className="flex-1 h-10"
            >
              <FileText className="h-4 w-4 mr-2" />
              {t("credentials.overview")}
            </Button>
            <Button
              variant={activeTab === "security" ? "default" : "ghost"}
              size="sm"
              onClick={() => setActiveTab("security")}
              className="flex-1 h-10"
            >
              <Shield className="h-4 w-4 mr-2" />
              {t("credentials.security")}
            </Button>
            <Button
              variant={activeTab === "usage" ? "default" : "ghost"}
              size="sm"
              onClick={() => setActiveTab("usage")}
              className="flex-1 h-10"
            >
              <Server className="h-4 w-4 mr-2" />
              {t("credentials.usage")}
            </Button>
          </div>

          {activeTab === "overview" && (
            <div className="grid gap-10 lg:grid-cols-2">
              <Card className="border-border">
                <CardHeader className="pb-8">
                  <CardTitle className="text-lg font-semibold">
                    {t("credentials.basicInformation")}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-8">
                  <div className="flex items-center space-x-5">
                    <div className="p-2 rounded-lg bg-surface">
                      <User className="h-4 w-4 text-foreground-subtle" />
                    </div>
                    <div>
                      <div className="text-sm text-foreground-subtle">
                        {t("common.username")}
                      </div>
                      <div className="font-medium text-foreground">
                        {credentialDetails.username}
                      </div>
                    </div>
                  </div>

                  {credentialDetails.folder && (
                    <div className="flex items-center space-x-4">
                      <Folder className="h-4 w-4 text-foreground-subtle" />
                      <div>
                        <div className="text-sm text-foreground-subtle">
                          {t("common.folder")}
                        </div>
                        <div className="font-medium">
                          {credentialDetails.folder}
                        </div>
                      </div>
                    </div>
                  )}

                  {credentialDetails.tags.length > 0 && (
                    <div className="flex items-start space-x-4">
                      <Hash className="h-4 w-4 text-foreground-subtle mt-1" />
                      <div className="flex-1">
                        <div className="text-sm text-foreground-subtle mb-3">
                          {t("hosts.tags")}
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {credentialDetails.tags.map((tag, index) => (
                            <Badge
                              key={index}
                              variant="outline"
                              className="text-xs"
                            >
                              {tag}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}

                  <Separator />

                  <div className="flex items-center space-x-4">
                    <Calendar className="h-4 w-4 text-foreground-subtle" />
                    <div>
                      <div className="text-sm text-foreground-subtle">
                        {t("credentials.created")}
                      </div>
                      <div className="font-medium">
                        {formatDate(credentialDetails.createdAt)}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center space-x-4">
                    <Calendar className="h-4 w-4 text-foreground-subtle" />
                    <div>
                      <div className="text-sm text-foreground-subtle">
                        {t("credentials.lastModified")}
                      </div>
                      <div className="font-medium">
                        {formatDate(credentialDetails.updatedAt)}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">
                    {t("credentials.usageStatistics")}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="text-center p-6 bg-surface rounded-lg">
                    <div className="text-3xl font-bold text-foreground-subtle">
                      {credentialDetails.usageCount}
                    </div>
                    <div className="text-sm text-foreground-subtle">
                      {t("credentials.timesUsed")}
                    </div>
                  </div>

                  {credentialDetails.lastUsed && (
                    <div className="flex items-center space-x-4 p-4 bg-surface rounded-lg">
                      <Clock className="h-5 w-5 text-foreground-subtle" />
                      <div>
                        <div className="text-sm text-foreground-subtle">
                          {t("credentials.lastUsed")}
                        </div>
                        <div className="font-medium">
                          {formatDate(credentialDetails.lastUsed)}
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="flex items-center space-x-4 p-4 bg-surface rounded-lg">
                    <Server className="h-5 w-5 text-foreground-subtle" />
                    <div>
                      <div className="text-sm text-foreground-subtle">
                        {t("credentials.connectedHosts")}
                      </div>
                      <div className="font-medium">{hostsUsing.length}</div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {activeTab === "security" && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center space-x-2">
                  <Shield className="h-5 w-5 text-foreground-subtle" />
                  <span>{t("credentials.securityDetails")}</span>
                </CardTitle>
                <CardDescription>
                  {t("credentials.securityDetailsDescription")}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="flex items-center space-x-4 p-6 bg-surface rounded-lg">
                  <CheckCircle className="h-6 w-6 text-foreground-subtle" />
                  <div>
                    <div className="font-medium text-foreground">
                      {t("credentials.credentialSecured")}
                    </div>
                    <div className="text-sm text-foreground-secondary">
                      {t("credentials.credentialSecuredDescription")}
                    </div>
                  </div>
                </div>

                {credentialDetails.authType === "password" && (
                  <div>
                    <h3 className="font-semibold mb-4">
                      {t("credentials.passwordAuthentication")}
                    </h3>
                    {renderSensitiveField(
                      credentialDetails.password,
                      "password",
                      t("common.password"),
                    )}
                  </div>
                )}

                {credentialDetails.authType === "key" && (
                  <div className="space-y-6">
                    <h3 className="font-semibold mb-2">
                      {t("credentials.keyAuthentication")}
                    </h3>

                    <div className="grid gap-6 md:grid-cols-2">
                      <div>
                        <div className="text-sm font-medium text-foreground-secondary mb-3">
                          {t("credentials.keyType")}
                        </div>
                        <Badge variant="outline" className="text-sm">
                          {credentialDetails.keyType?.toUpperCase() ||
                            t("unknown").toUpperCase()}
                        </Badge>
                      </div>
                    </div>

                    {renderSensitiveField(
                      credentialDetails.key,
                      "key",
                      t("credentials.privateKey"),
                      true,
                    )}

                    {credentialDetails.keyPassword &&
                      renderSensitiveField(
                        credentialDetails.keyPassword,
                        "keyPassword",
                        t("credentials.keyPassphrase"),
                      )}
                  </div>
                )}

                <div className="flex items-start space-x-4 p-6 bg-surface rounded-lg">
                  <AlertTriangle className="h-5 w-5 text-foreground-subtle mt-0.5" />
                  <div className="text-sm">
                    <div className="font-medium text-foreground mb-2">
                      {t("credentials.securityReminder")}
                    </div>
                    <div className="text-foreground-secondary">
                      {t("credentials.securityReminderText")}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {activeTab === "usage" && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center space-x-2">
                  <Server className="h-5 w-5 text-foreground-subtle" />
                  <span>{t("credentials.hostsUsingCredential")}</span>
                  <Badge variant="secondary">{hostsUsing.length}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent>
                {hostsUsing.length === 0 ? (
                  <div className="text-center py-10 text-foreground-subtle">
                    <Server className="h-12 w-12 mx-auto mb-6 text-foreground-subtle" />
                    <p>{t("credentials.noHostsUsingCredential")}</p>
                  </div>
                ) : (
                  <ScrollArea className="h-64">
                    <div className="space-y-3">
                      {hostsUsing.map((host) => (
                        <div
                          key={host.id}
                          className="flex items-center justify-between p-4 border rounded-lg hover:bg-surface"
                        >
                          <div className="flex items-center space-x-3">
                            <div className="p-2 bg-surface rounded">
                              <Server className="h-4 w-4 text-foreground-subtle" />
                            </div>
                            <div>
                              <div className="font-medium">
                                {host.name || `${host.ip}:${host.port}`}
                              </div>
                              <div className="text-sm text-foreground-subtle">
                                {host.ip}:{host.port}
                              </div>
                            </div>
                          </div>
                          <div className="text-right text-sm text-foreground-subtle">
                            {formatDate(host.createdAt)}
                          </div>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                )}
              </CardContent>
            </Card>
          )}
        </div>

        <SheetFooter>
          <Button variant="outline" onClick={onClose}>
            {t("common.close")}
          </Button>
          <Button onClick={onEdit}>
            <Edit3 className="h-4 w-4 mr-2" />
            {t("credentials.editCredential")}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
};

export default CredentialViewer;
