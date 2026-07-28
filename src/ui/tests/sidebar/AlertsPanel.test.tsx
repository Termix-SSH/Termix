import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  waitFor,
  cleanup,
  fireEvent,
} from "@testing-library/react";
import type { NotificationChannel } from "@/api/alerts-api";

const alertsApi = vi.hoisted(() => ({
  getAlertFirings: vi.fn(async () => []),
  acknowledgeAlertFiring: vi.fn(async () => {}),
  acknowledgeAllAlertFirings: vi.fn(async () => {}),
  getAlertRules: vi.fn(async () => []),
  getNotificationChannels: vi.fn(async () => [] as NotificationChannel[]),
  deleteAlertRule: vi.fn(async () => {}),
  deleteNotificationChannel: vi.fn(async () => {}),
  testNotificationChannel: vi.fn(async () => {}),
}));

vi.mock("@/api/alerts-api", () => alertsApi);

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}));

// A real (non-null) fake so tests can see what channels actually reach the
// rule dialog, instead of only asserting the API call count.
vi.mock("../../sidebar/AlertRuleDialog", () => ({
  AlertRuleDialog: ({
    open,
    channels,
  }: {
    open: boolean;
    channels: NotificationChannel[];
  }) =>
    open ? (
      <div data-testid="rule-dialog-channels">
        {channels.length === 0
          ? "no channels"
          : channels.map((c) => c.name).join(",")}
      </div>
    ) : null,
}));
vi.mock("../../sidebar/NotificationChannelDialog", () => ({
  NotificationChannelDialog: () => null,
}));

import { AlertsPanel } from "../../sidebar/AlertsPanel";

function channel(
  overrides: Partial<NotificationChannel> = {},
): NotificationChannel {
  return {
    id: 1,
    userId: "user-1",
    name: "ntfy",
    type: "ntfy",
    config: "{}",
    enabled: true,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

beforeEach(() => {
  alertsApi.getAlertFirings.mockReset().mockResolvedValue([]);
  alertsApi.getAlertRules.mockReset().mockResolvedValue([]);
  alertsApi.getNotificationChannels.mockReset().mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
});

describe("AlertsPanel - notification channels", () => {
  it("loads notification channels on mount, before the Channels tab is ever opened", async () => {
    alertsApi.getNotificationChannels.mockResolvedValue([channel()]);

    render(<AlertsPanel />);

    // Regression: channels used to only load once the user switched to the
    // "channels" tab, so editing a rule before ever visiting that tab showed
    // an empty channel picker even though channels existed.
    await waitFor(() => {
      expect(alertsApi.getNotificationChannels).toHaveBeenCalledTimes(1);
    });
  });

  it("populates the rule dialog's channel picker without ever visiting the Channels tab", async () => {
    alertsApi.getNotificationChannels.mockResolvedValue([
      channel({ id: 1, name: "ntfy-home" }),
      channel({ id: 2, name: "webhook-slack" }),
    ]);

    render(<AlertsPanel />);

    await waitFor(() => {
      expect(alertsApi.getNotificationChannels).toHaveBeenCalledTimes(1);
    });

    // Go straight to Rules and open the "new rule" dialog, skipping Channels
    // entirely, this is exactly the sequence the original bug broke.
    fireEvent.click(screen.getByText("Rules"));
    fireEvent.click(screen.getByText("Add"));

    expect(screen.getByTestId("rule-dialog-channels").textContent).toBe(
      "ntfy-home,webhook-slack",
    );
  });

  it("does not refetch channels again when switching to the Rules tab", async () => {
    render(<AlertsPanel />);

    await waitFor(() => {
      expect(alertsApi.getNotificationChannels).toHaveBeenCalledTimes(1);
    });

    // Switching tabs only reloads rules here, not channels, since channels
    // were already fetched on mount by the fix under test.
    fireEvent.click(screen.getByText("Rules"));

    await waitFor(() => {
      expect(alertsApi.getAlertRules).toHaveBeenCalledTimes(1);
    });
    expect(alertsApi.getNotificationChannels).toHaveBeenCalledTimes(1);
  });
});
