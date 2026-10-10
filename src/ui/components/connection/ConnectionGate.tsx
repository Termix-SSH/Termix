/* eslint-disable react-refresh/only-export-components */
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";
import type React from "react";
import { useConnectionRetry } from "@termix-ssh/plugin-sdk/frontend";
import {
  ConnectionLogProvider,
  useConnectionLog,
} from "@/ssh/connection-log/ConnectionLogContext";
import {
  ConnectionScreen,
  type ConnectionUnavailable,
} from "@/components/connection/ConnectionScreen";
import type { ConnectionStatus } from "@/components/connection/connection-status";
import type { ConnectionStage } from "@/types/connection-log";
import { getErrorMessage } from "@/lib/error-message";

function messageOf(err: unknown): string {
  return typeof err === "string" ? err : getErrorMessage(err);
}

type LogFn = (message: string, stage?: ConnectionStage) => void;

export interface ConnectionGateController {
  status: ConnectionStatus;
  attempt: number;
  maxAttempts: number;
  nextRetryInMs: number | null;
  error: string | null;
  unavailable: ConnectionUnavailable | null;
  log: { info: LogFn; success: LogFn; warning: LogFn; error: LogFn };
  markConnected: () => void;
  /** It did not come up. Logs the reason and schedules a retry. */
  markFailed: (error?: unknown) => void;
  /** It was up and dropped. No automatic retry. */
  markDisconnected: (error?: unknown) => void;
  /** It cannot run here, like a feature that is off for this host. */
  markUnavailable: (info: ConnectionUnavailable) => void;
  retryNow: () => void;
  reset: () => void;
}

export interface ConnectionGateProps {
  /** Opens the connection. Throwing or rejecting counts as a failure. */
  connect: (gate: ConnectionGateController) => void | Promise<void>;
  message: string;
  detail?: string;
  disconnectedMessage?: string;
  retry?: {
    maxAttempts?: number;
    baseDelayMs?: number;
    maxDelayMs?: number;
    autoStart?: boolean;
    enabled?: boolean;
  };
  /** Keep children mounted under the screen, for a terminal or display. */
  keepMounted?: boolean;
  backgroundColor?: string;
  extraActions?: React.ReactNode;
  className?: string;
  children:
    React.ReactNode | ((gate: ConnectionGateController) => React.ReactNode);
}

const GateContext = createContext<ConnectionGateController | null>(null);

/** The controller of the ConnectionGate this renders inside. */
export function useConnectionGate(): ConnectionGateController {
  const gate = useContext(GateContext);
  if (!gate) {
    throw new Error("useConnectionGate must be used inside a ConnectionGate");
  }
  return gate;
}

/**
 * One connection lifecycle for every tab: connecting, failed with retry and
 * a log, dropped, or unavailable. Children render once it is up.
 */
export function ConnectionGate(props: ConnectionGateProps) {
  return (
    <ConnectionLogProvider>
      <Gate {...props} />
    </ConnectionLogProvider>
  );
}

function Gate({
  connect,
  message,
  detail,
  disconnectedMessage,
  retry,
  keepMounted,
  backgroundColor,
  extraActions,
  className,
  children,
}: ConnectionGateProps) {
  const { addLog, clearLogs } = useConnectionLog();
  const [error, setError] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState<ConnectionUnavailable | null>(
    null,
  );
  const [dropped, setDropped] = useState(false);
  const maxAttempts = retry?.maxAttempts ?? 8;
  const gateRef = useRef<ConnectionGateController | null>(null);

  const write = useCallback(
    (type: "info" | "success" | "warning" | "error"): LogFn =>
      (text, stage = "connection") =>
        addLog({ type, stage, message: text }),
    [addLog],
  );

  const retryState = useConnectionRetry({
    connect: async () => {
      setError(null);
      setUnavailable(null);
      setDropped(false);
      try {
        await connect(gateRef.current!);
      } catch (err) {
        gateRef.current?.markFailed(err);
      }
    },
    maxAttempts,
    baseDelayMs: retry?.baseDelayMs,
    maxDelayMs: retry?.maxDelayMs,
    autoStart: retry?.autoStart,
    enabled: retry?.enabled,
  });

  const {
    markConnected: retryConnected,
    markFailed: retryFailed,
    retryNow: retryAgain,
    reset: retryReset,
  } = retryState;

  const log = useMemo(
    () => ({
      info: write("info"),
      success: write("success"),
      warning: write("warning"),
      error: write("error"),
    }),
    [write],
  );

  const markFailed = useCallback(
    (err?: unknown) => {
      if (err !== undefined) {
        const text = messageOf(err);
        setError(text);
        log.error(text, "error");
      }
      retryFailed();
    },
    [log, retryFailed],
  );

  const markDisconnected = useCallback(
    (err?: unknown) => {
      if (err !== undefined) {
        const text = messageOf(err);
        setError(text);
        log.warning(text, "connection");
      }
      setDropped(true);
    },
    [log],
  );

  const markUnavailable = useCallback((info: ConnectionUnavailable) => {
    setUnavailable(info);
  }, []);

  const retryNow = useCallback(() => {
    clearLogs();
    setError(null);
    setUnavailable(null);
    setDropped(false);
    retryAgain();
  }, [clearLogs, retryAgain]);

  const reset = useCallback(() => {
    setError(null);
    setUnavailable(null);
    setDropped(false);
    retryReset();
  }, [retryReset]);

  let status: ConnectionStatus = retryState.status;
  if (dropped) status = "disconnected";

  const controller = useMemo<ConnectionGateController>(
    () => ({
      status,
      attempt: retryState.attempt,
      maxAttempts,
      nextRetryInMs: retryState.nextRetryInMs,
      error,
      unavailable,
      log,
      markConnected: () => {
        setDropped(false);
        setError(null);
        retryConnected();
      },
      markFailed,
      markDisconnected,
      markUnavailable,
      retryNow,
      reset,
    }),
    [
      status,
      retryState.attempt,
      retryState.nextRetryInMs,
      maxAttempts,
      error,
      unavailable,
      log,
      retryConnected,
      markFailed,
      markDisconnected,
      markUnavailable,
      retryNow,
      reset,
    ],
  );
  gateRef.current = controller;

  const up = status === "connected" && !unavailable;
  const content =
    typeof children === "function" ? children(controller) : children;

  return (
    <GateContext.Provider value={controller}>
      <div className={`relative h-full w-full ${className ?? ""}`}>
        {(up || keepMounted) && content}
        <ConnectionScreen
          status={status}
          message={message}
          detail={detail}
          errorDetail={error}
          unavailable={unavailable}
          disconnectedMessage={disconnectedMessage}
          attempt={retryState.attempt}
          maxAttempts={maxAttempts}
          nextRetryInMs={retryState.nextRetryInMs}
          onManualRetry={retryNow}
          extraActions={extraActions}
          backgroundColor={backgroundColor}
          logPosition={status === "connecting" ? "bottom" : "top"}
        />
      </div>
    </GateContext.Provider>
  );
}
