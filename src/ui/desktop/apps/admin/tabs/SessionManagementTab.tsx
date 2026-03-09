import React from "react";
import { Button } from "@/components/ui/button.tsx";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table.tsx";
import { Monitor, Smartphone, Globe, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useConfirmation } from "@/hooks/use-confirmation.ts";
import {
  getCookie,
  revokeSession,
  revokeAllUserSessions,
} from "@/ui/main-axios.ts";

interface Session {
  id: string;
  userId: string;
  username?: string;
  deviceType: string;
  deviceInfo: string;
  createdAt: string;
  expiresAt: string;
  lastActiveAt: string;
  jwtToken: string;
  isRevoked?: boolean;
}

interface SessionManagementTabProps {
  sessions: Session[];
  sessionsLoading: boolean;
  fetchSessions: () => void;
}

export function SessionManagementTab({
  sessions,
  sessionsLoading,
  fetchSessions,
}: SessionManagementTabProps): React.ReactElement {
  const { t } = useTranslation();
  const { confirmWithToast } = useConfirmation();

  const handleRevokeSession = async (sessionId: string) => {
    const currentJWT = getCookie("jwt");
    const currentSession = sessions.find((s) => s.jwtToken === currentJWT);
    const isCurrentSession = currentSession?.id === sessionId;

    confirmWithToast(
      t("admin.confirmRevokeSession"),
      async () => {
        try {
          await revokeSession(sessionId);
          toast.success(t("admin.sessionRevokedSuccessfully"));

          if (isCurrentSession) {
            setTimeout(() => {
              window.location.reload();
            }, 1000);
          } else {
            fetchSessions();
          }
        } catch {
          toast.error(t("admin.failedToRevokeSession"));
        }
      },
      "destructive",
    );
  };

  const handleRevokeAllUserSessions = async (userId: string) => {
    confirmWithToast(
      t("admin.confirmRevokeAllSessions"),
      async () => {
        try {
          const data = await revokeAllUserSessions(userId);
          toast.success(data.message || t("admin.sessionsRevokedSuccessfully"));
          fetchSessions();
        } catch {
          toast.error(t("admin.failedToRevokeSessions"));
        }
      },
      "destructive",
    );
  };

  const formatDate = (date: Date) =>
    date.toLocaleDateString() +
    " " +
    date.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });

  return (
    <div className="rounded-lg border-2 border-border bg-card p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">
          {t("admin.sessionManagement")}
        </h3>
        <Button
          onClick={fetchSessions}
          disabled={sessionsLoading}
          variant="outline"
          size="sm"
        >
          {sessionsLoading ? t("admin.loading") : t("admin.refresh")}
        </Button>
      </div>
      {sessionsLoading ? (
        <div className="text-center py-8 text-muted-foreground">
          {t("admin.loadingSessions")}
        </div>
      ) : sessions.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground">
          {t("admin.noActiveSessions")}
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("admin.device")}</TableHead>
              <TableHead>{t("admin.user")}</TableHead>
              <TableHead>{t("admin.created")}</TableHead>
              <TableHead>{t("admin.lastActive")}</TableHead>
              <TableHead>{t("admin.expires")}</TableHead>
              <TableHead>{t("admin.actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sessions.map((session) => {
              const DeviceIcon =
                session.deviceType === "desktop"
                  ? Monitor
                  : session.deviceType === "mobile"
                    ? Smartphone
                    : Globe;

              const createdDate = new Date(session.createdAt);
              const lastActiveDate = new Date(session.lastActiveAt);
              const expiresDate = new Date(session.expiresAt);

              return (
                <TableRow
                  key={session.id}
                  className={session.isRevoked ? "opacity-50" : undefined}
                >
                  <TableCell className="px-4">
                    <div className="flex items-center gap-2">
                      <DeviceIcon className="h-4 w-4" />
                      <div className="flex flex-col">
                        <span className="font-medium text-sm">
                          {session.deviceInfo}
                        </span>
                        {session.isRevoked && (
                          <span className="text-xs text-red-600">
                            {t("admin.revoked")}
                          </span>
                        )}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="px-4">
                    {session.username || session.userId}
                  </TableCell>
                  <TableCell className="px-4 text-sm text-muted-foreground">
                    {formatDate(createdDate)}
                  </TableCell>
                  <TableCell className="px-4 text-sm text-muted-foreground">
                    {formatDate(lastActiveDate)}
                  </TableCell>
                  <TableCell className="px-4 text-sm text-muted-foreground">
                    {formatDate(expiresDate)}
                  </TableCell>
                  <TableCell className="px-4">
                    <div className="flex gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleRevokeSession(session.id)}
                        className="text-red-600 hover:text-red-700 hover:bg-red-50"
                        disabled={session.isRevoked}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                      {session.username && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            handleRevokeAllUserSessions(session.userId)
                          }
                          className="text-orange-600 hover:text-orange-700 hover:bg-orange-50 text-xs"
                          title={t("admin.revokeAllUserSessionsTitle")}
                        >
                          {t("admin.revokeAll")}
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
