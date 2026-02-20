import React from "react";
import { Button } from "@/components/ui/button.tsx";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert.tsx";
import { Input } from "@/components/ui/input.tsx";
import { PasswordInput } from "@/components/ui/password-input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useConfirmation } from "@/hooks/use-confirmation.ts";
import { Textarea } from "@/components/ui/textarea.tsx";
import { updateOIDCConfig, disableOIDCConfig } from "@/ui/main-axios.ts";

interface OIDCSettingsTabProps {
  allowPasswordLogin: boolean;
  oidcConfig: {
    client_id: string;
    client_secret: string;
    issuer_url: string;
    authorization_url: string;
    token_url: string;
    identifier_path: string;
    name_path: string;
    scopes: string;
    userinfo_url: string;
    allowed_users: string;
  };
  setOidcConfig: React.Dispatch<
    React.SetStateAction<{
      client_id: string;
      client_secret: string;
      issuer_url: string;
      authorization_url: string;
      token_url: string;
      identifier_path: string;
      name_path: string;
      scopes: string;
      userinfo_url: string;
      allowed_users: string;
    }>
  >;
}

export function OIDCSettingsTab({
  allowPasswordLogin,
  oidcConfig,
  setOidcConfig,
}: OIDCSettingsTabProps): React.ReactElement {
  const { t } = useTranslation();
  const { confirmWithToast } = useConfirmation();

  const [oidcLoading, setOidcLoading] = React.useState(false);
  const [oidcError, setOidcError] = React.useState<string | null>(null);

  const handleOIDCConfigSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setOidcLoading(true);
    setOidcError(null);

    const required = [
      "client_id",
      "client_secret",
      "issuer_url",
      "authorization_url",
      "token_url",
    ];
    const missing = required.filter(
      (f) => !oidcConfig[f as keyof typeof oidcConfig],
    );
    if (missing.length > 0) {
      setOidcError(
        t("admin.missingRequiredFields", { fields: missing.join(", ") }),
      );
      setOidcLoading(false);
      return;
    }

    try {
      await updateOIDCConfig(oidcConfig);
      toast.success(t("admin.oidcConfigurationUpdated"));
    } catch (err: unknown) {
      setOidcError(
        (err as { response?: { data?: { error?: string } } })?.response?.data
          ?.error || t("admin.failedToUpdateOidcConfig"),
      );
    } finally {
      setOidcLoading(false);
    }
  };

  const handleOIDCConfigChange = (field: string, value: string) => {
    setOidcConfig((prev) => ({ ...prev, [field]: value }));
  };

  const handleResetConfig = async () => {
    if (!allowPasswordLogin) {
      confirmWithToast(
        t("admin.confirmDisableOIDCWarning"),
        async () => {
          const emptyConfig = {
            client_id: "",
            client_secret: "",
            issuer_url: "",
            authorization_url: "",
            token_url: "",
            identifier_path: "",
            name_path: "",
            scopes: "",
            userinfo_url: "",
            allowed_users: "",
          };
          setOidcConfig(emptyConfig);
          setOidcError(null);
          setOidcLoading(true);
          try {
            await disableOIDCConfig();
            toast.success(t("admin.oidcConfigurationDisabled"));
          } catch (err: unknown) {
            setOidcError(
              (
                err as {
                  response?: { data?: { error?: string } };
                }
              )?.response?.data?.error || t("admin.failedToDisableOidcConfig"),
            );
          } finally {
            setOidcLoading(false);
          }
        },
        "destructive",
      );
      return;
    }

    const emptyConfig = {
      client_id: "",
      client_secret: "",
      issuer_url: "",
      authorization_url: "",
      token_url: "",
      identifier_path: "",
      name_path: "",
      scopes: "",
      userinfo_url: "",
    };
    setOidcConfig(emptyConfig);
    setOidcError(null);
    setOidcLoading(true);
    try {
      await disableOIDCConfig();
      toast.success(t("admin.oidcConfigurationDisabled"));
    } catch (err: unknown) {
      setOidcError(
        (
          err as {
            response?: { data?: { error?: string } };
          }
        )?.response?.data?.error || t("admin.failedToDisableOidcConfig"),
      );
    } finally {
      setOidcLoading(false);
    }
  };

  return (
    <div className="rounded-lg border-2 border-border bg-card p-4 space-y-3">
      <h3 className="text-lg font-semibold">
        {t("admin.externalAuthentication")}
      </h3>
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">
          {t("admin.configureExternalProvider")}
        </p>
        <Button
          variant="outline"
          size="sm"
          className="h-8 px-3 text-xs"
          onClick={() => window.open("https://docs.termix.site/oidc", "_blank")}
        >
          {t("common.documentation")}
        </Button>
      </div>

      {!allowPasswordLogin && (
        <Alert variant="destructive">
          <AlertTitle>{t("admin.criticalWarning")}</AlertTitle>
          <AlertDescription>{t("admin.oidcRequiredWarning")}</AlertDescription>
        </Alert>
      )}

      {oidcError && (
        <Alert variant="destructive">
          <AlertTitle>{t("common.error")}</AlertTitle>
          <AlertDescription>{oidcError}</AlertDescription>
        </Alert>
      )}

      <form onSubmit={handleOIDCConfigSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="client_id">{t("admin.clientId")}</Label>
          <Input
            id="client_id"
            value={oidcConfig.client_id}
            onChange={(e) =>
              handleOIDCConfigChange("client_id", e.target.value)
            }
            placeholder={t("placeholders.clientId")}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="client_secret">{t("admin.clientSecret")}</Label>
          <PasswordInput
            id="client_secret"
            value={oidcConfig.client_secret}
            onChange={(e) =>
              handleOIDCConfigChange("client_secret", e.target.value)
            }
            placeholder={t("placeholders.clientSecret")}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="authorization_url">
            {t("admin.authorizationUrl")}
          </Label>
          <Input
            id="authorization_url"
            value={oidcConfig.authorization_url}
            onChange={(e) =>
              handleOIDCConfigChange("authorization_url", e.target.value)
            }
            placeholder={t("placeholders.authUrl")}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="issuer_url">{t("admin.issuerUrl")}</Label>
          <Input
            id="issuer_url"
            value={oidcConfig.issuer_url}
            onChange={(e) =>
              handleOIDCConfigChange("issuer_url", e.target.value)
            }
            placeholder={t("placeholders.redirectUrl")}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="token_url">{t("admin.tokenUrl")}</Label>
          <Input
            id="token_url"
            value={oidcConfig.token_url}
            onChange={(e) =>
              handleOIDCConfigChange("token_url", e.target.value)
            }
            placeholder={t("placeholders.tokenUrl")}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="identifier_path">
            {t("admin.userIdentifierPath")}
          </Label>
          <Input
            id="identifier_path"
            value={oidcConfig.identifier_path}
            onChange={(e) =>
              handleOIDCConfigChange("identifier_path", e.target.value)
            }
            placeholder={t("placeholders.userIdField")}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="name_path">{t("admin.displayNamePath")}</Label>
          <Input
            id="name_path"
            value={oidcConfig.name_path}
            onChange={(e) =>
              handleOIDCConfigChange("name_path", e.target.value)
            }
            placeholder={t("placeholders.usernameField")}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="scopes">{t("admin.scopes")}</Label>
          <Input
            id="scopes"
            value={oidcConfig.scopes}
            onChange={(e) => handleOIDCConfigChange("scopes", e.target.value)}
            placeholder={t("placeholders.scopes")}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="userinfo_url">{t("admin.overrideUserInfoUrl")}</Label>
          <Input
            id="userinfo_url"
            value={oidcConfig.userinfo_url}
            onChange={(e) =>
              handleOIDCConfigChange("userinfo_url", e.target.value)
            }
            placeholder="https://your-provider.com/application/o/userinfo/"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="allowed_users">{t("admin.allowedUsers")}</Label>
          <p className="text-xs text-muted-foreground">
            {t("admin.allowedUsersDescription")}
          </p>
          <Textarea
            id="allowed_users"
            value={oidcConfig.allowed_users}
            onChange={(e) =>
              handleOIDCConfigChange("allowed_users", e.target.value)
            }
            placeholder={t("placeholders.allowedUsers")}
            rows={3}
          />
        </div>
        <div className="flex gap-2 pt-2">
          <Button type="submit" className="flex-1" disabled={oidcLoading}>
            {oidcLoading ? t("admin.saving") : t("admin.saveConfiguration")}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={handleResetConfig}
            disabled={oidcLoading}
          >
            {t("admin.reset")}
          </Button>
        </div>
      </form>
    </div>
  );
}
