/**
 * One classifier for keyboard-interactive rounds, shared by every transport.
 *
 * It only decides what a round is. Answering is up to the transport: the
 * terminal asks over its socket, the file manager parks the connection, and
 * background work fills in the stored password and nothing else.
 */

import { listKeyboardInteractiveInterceptors } from "./auth-provider-registry.js";
import type {
  KeyboardInteractiveDecision,
  KeyboardInteractivePrompt,
  SshConnectHost,
  SshPromptChannel,
} from "./types.js";

const PASSWORD_PATTERN = /password/i;

// FortiToken asks for a code OR the word "push", so it needs a text field and
// must not be treated as a confirm-only push. Checked before the push pattern
// because its text also says "push notification".
const FORTI_TOKEN_PATTERN = /type\s+['"]?push['"]?/i;

// JumpCloud Protect / DUO: a menu choice, then an empty-answerable confirm.
// Checked before TOTP because "...or [2] TOTP:" would match that pattern.
export const PUSH_PROMPT_PATTERN =
  /choose.*push.*totp|press enter.*(push|send)|push notification|authentication by phone/i;

const TOTP_PATTERN =
  /verification code|verification_code|token|otp|2fa|authenticator|google.*auth/i;

export interface KeyboardInteractiveRound {
  name: string;
  instructions: string;
  prompts: KeyboardInteractivePrompt[];
}

/** Stored password for every password prompt, empty for the rest. */
export function autoResponses(
  prompts: KeyboardInteractivePrompt[],
  password: string | null | undefined,
): string[] {
  return prompts.map((p) =>
    PASSWORD_PATTERN.test(p.prompt) && password ? password : "",
  );
}

/** Puts the user's answer at one index and auto-fills the rest. */
export function responsesWithAnswer(
  prompts: KeyboardInteractivePrompt[],
  answerIndex: number,
  answer: string,
  password: string | null | undefined,
): string[] {
  return prompts.map((p, index) => {
    if (index === answerIndex) return answer;
    if (PASSWORD_PATTERN.test(p.prompt) && password) return password;
    return "";
  });
}

function shouldAutoAnswerPasswords(host: SshConnectHost): boolean {
  return listKeyboardInteractiveInterceptors().some(
    (interceptor) => interceptor.autoAnswerPasswords?.(host) === true,
  );
}

export function classifyKeyboardInteractive(
  round: KeyboardInteractiveRound,
  host: SshConnectHost,
): KeyboardInteractiveDecision {
  for (const interceptor of listKeyboardInteractiveInterceptors()) {
    const decision = interceptor.detect(round, host);
    if (decision) return decision;
  }

  const { prompts } = round;
  const texts = prompts.map((p) => p.prompt);
  const isFortiToken = texts.some((p) => FORTI_TOKEN_PATTERN.test(p));
  const isPush =
    !isFortiToken && texts.some((p) => PUSH_PROMPT_PATTERN.test(p));

  if (!isPush) {
    const totpIndex = prompts.findIndex((p) => TOTP_PATTERN.test(p.prompt));
    if (totpIndex !== -1) return { kind: "totp", promptIndex: totpIndex };
  }

  if (shouldAutoAnswerPasswords(host)) {
    return { kind: "auto", responses: autoResponses(prompts, host.password) };
  }

  const hasStoredPassword = !!host.password && host.authType !== "none";
  const passwordIndex = prompts.findIndex((p) =>
    PASSWORD_PATTERN.test(p.prompt),
  );
  // DUO/PAM challenges often don't say "password" at all.
  const firstUnanswered = prompts.findIndex(
    (p) => !(PASSWORD_PATTERN.test(p.prompt) && hasStoredPassword),
  );

  if (firstUnanswered === -1) {
    return { kind: "auto", responses: autoResponses(prompts, host.password) };
  }

  const promptIndex =
    passwordIndex !== -1 && !hasStoredPassword
      ? passwordIndex
      : firstUnanswered;
  return {
    kind: "input",
    promptIndex,
    isPush: PUSH_PROMPT_PATTERN.test(prompts[promptIndex].prompt),
  };
}

export type KeyboardInteractiveListener = (
  name: string,
  instructions: string,
  lang: string,
  prompts: KeyboardInteractivePrompt[],
  finish: (responses: string[]) => void,
) => void;

/**
 * The handler for connections with nobody to ask: the stored password goes
 * to password prompts, everything else gets an empty answer. That is what
 * every background path did before the pipeline.
 */
export function createAutoKeyboardInteractiveHandler(
  host: SshConnectHost,
): KeyboardInteractiveListener {
  return (_name, _instructions, _lang, prompts, finish) => {
    finish(autoResponses(prompts, host.password));
  };
}

/**
 * The handler for connections with a prompt channel. One question per round;
 * a second TOTP round means the last code was wrong.
 */
export function createPromptKeyboardInteractiveHandler(
  host: SshConnectHost,
  channel: SshPromptChannel,
): KeyboardInteractiveListener {
  let totpAsked = false;

  return (name, instructions, _lang, prompts, finish) => {
    const decision = classifyKeyboardInteractive(
      { name, instructions, prompts },
      host,
    );

    const ask = async (): Promise<string[]> => {
      switch (decision.kind) {
        case "auto":
          return decision.responses;
        case "warpgate": {
          await channel.ask({
            kind: "warpgate",
            url: decision.url,
            securityKey: decision.securityKey,
            instructions: decision.instructions,
          });
          return prompts.map(() => "");
        }
        case "totp": {
          const answer = await channel.ask({
            kind: "totp",
            prompt: prompts[decision.promptIndex].prompt,
            retry: totpAsked,
          });
          totpAsked = true;
          return responsesWithAnswer(
            prompts,
            decision.promptIndex,
            (answer ?? "").trim(),
            host.password,
          );
        }
        case "input": {
          const prompt = prompts[decision.promptIndex];
          const answer = await channel.ask({
            kind: "input",
            prompt: prompt.prompt,
            echo: prompt.echo,
            isPush: decision.isPush,
          });
          return responsesWithAnswer(
            prompts,
            decision.promptIndex,
            (answer ?? "").trim(),
            host.password,
          );
        }
      }
    };

    ask().then(finish, () => finish(prompts.map(() => "")));
  };
}
