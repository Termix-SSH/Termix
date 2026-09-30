import { useEffect, useState } from "react";
import { useTranslation } from "@termix/plugin-sdk/frontend";
import {
  ParticipantsBadge,
  type SessionParticipantInfo,
} from "./SharedSessionView";

interface ParticipantsOverlayProps {
  subscribe: (
    listener: (message: { type: string; [key: string]: unknown }) => void,
  ) => () => void;
}

export function ParticipantsOverlay({ subscribe }: ParticipantsOverlayProps) {
  const { t } = useTranslation();
  const [participants, setParticipants] = useState<SessionParticipantInfo[]>(
    [],
  );

  useEffect(
    () =>
      subscribe((message) => {
        if (
          message.type === "participants" &&
          Array.isArray(message.participants)
        ) {
          setParticipants(message.participants as SessionParticipantInfo[]);
        } else if (message.type === "session_closed") {
          setParticipants([]);
        }
      }),
    [subscribe],
  );

  return (
    <ParticipantsBadge
      participants={participants}
      ownerLabel={t("sessionSharing.guestView.ownerLabel")}
    />
  );
}
