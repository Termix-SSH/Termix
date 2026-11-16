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
  KeyboardInteractiveInterceptor,
  KeyboardInteractivePrompt,
  SshConnectHost,
  SshPromptChannel,
} from "./types.js";

const PASSWORD_PATTERN = /password/i;

// FortiToken asks for a code OR the word "push", so it needs a text field and
// must not be treated as a confirm-only push. Checked before the push pattern
// because its text also says "push notification".
const FORTI_TOKEN_PATTERN = /type\s+['"]?push['"]?/i;

// JumpCloud Protect / DUO: a menu choice answered with a number, then an
// empty-answerable confirm. Checked before TOTP because "...or [2] TOTP:"
// would match that pattern. The menu needs a text field, so it is not a push.
const PUSH_MENU_PATTERN = /choose.*push.*totp/i;

const PUSH_PROMPT_PATTERN =
  /press enter.*(push|send)|push notification|authentication by phone/i;

const TOTP_PATTERN =
  /verification code|verification_code|token|otp|2fa|authenticator|google.*auth/i;

export interface KeyboardInteractiveRound {
  name: string;
  instructions: string;
  prompts: KeyboardInteractivePrompt[];
}

/** Stored password for every password prompt, empty for the rest. */
function autoResponses(
  prompts: KeyboardInteractivePrompt[],
  password: string | null | undefined,
): string[] {
  return prompts.map((p) =>
    PASSWORD_PATTERN.test(p.prompt) && password ? password : "",
  );
}

/** Puts the user's answer at one index and auto-fills the rest. */
function responsesWithAnswer(
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

type MaybePromise<T> = T | Promise<T>;

/** A handler in a plugin process gets this long to answer, then counts as no. */
const REMOTE_ANSWER_MS = 5000;

function isPromise<T>(value: MaybePromise<T>): value is Promise<T> {
  return !!value && typeof (value as Promise<T>).then === "function";
}

function bounded<T>(promise: Promise<T>, fallback: T): Promise<T> {
  return new Promise<T>((resolve) => {
    const timer = setTimeout(() => resolve(fallback), REMOTE_ANSWER_MS);
    timer.unref?.();
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(fallback);
      },
    );
  });
}

function shouldAutoAnswerPasswords(
  host: SshConnectHost,
  syncOnly: boolean,
): MaybePromise<boolean> {
  const pending: Promise<boolean>[] = [];
  for (const interceptor of listKeyboardInteractiveInterceptors()) {
    if (!interceptor.autoAnswerPasswords) continue;
    if (syncOnly && interceptor.remote) continue;
    const answer = interceptor.autoAnswerPasswords(host);
    if (isPromise(answer)) pending.push(bounded(answer, false));
    else if (answer === true) return true;
  }
  if (pending.length === 0) return false;
  return Promise.all(pending).then((answers) => answers.includes(true));
}

function builtinDecision(
  round: KeyboardInteractiveRound,
  host: SshConnectHost,
  syncOnly: boolean,
): MaybePromise<KeyboardInteractiveDecision> {
  const { prompts } = round;
  const texts = prompts.map((p) => p.prompt);
  const isFortiToken = texts.some((p) => FORTI_TOKEN_PATTERN.test(p));
  const isPushFlow =
    !isFortiToken &&
    texts.some((p) => PUSH_MENU_PATTERN.test(p) || PUSH_PROMPT_PATTERN.test(p));

  if (!isPushFlow) {
    const totpIndex = prompts.findIndex((p) => TOTP_PATTERN.test(p.prompt));
    if (totpIndex !== -1) return { kind: "totp", promptIndex: totpIndex };
  }

  const auto = shouldAutoAnswerPasswords(host, syncOnly);
  return isPromise(auto)
    ? auto.then((yes) => passwordDecision(prompts, host, yes))
    : passwordDecision(prompts, host, auto);
}

function passwordDecision(
  prompts: KeyboardInteractivePrompt[],
  host: SshConnectHost,
  autoAnswer: boolean,
): KeyboardInteractiveDecision {
  if (autoAnswer) {
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

function classifyFrom(
  interceptors: KeyboardInteractiveInterceptor[],
  index: number,
  round: KeyboardInteractiveRound,
  host: SshConnectHost,
  syncOnly: boolean,
): MaybePromise<KeyboardInteractiveDecision> {
  for (let i = index; i < interceptors.length; i++) {
    const interceptor = interceptors[i];
    if (syncOnly && interceptor.remote) continue;
    const decision = interceptor.detect(round, host);
    if (isPromise(decision)) {
      return bounded(decision, null).then(
        (found) =>
          found ?? classifyFrom(interceptors, i + 1, round, host, syncOnly),
      );
    }
    if (decision) return decision;
  }
  return builtinDecision(round, host, syncOnly);
}

/**
 * What a round is. A Promise when a handler in a plugin process has to be
 * asked; a plain value otherwise.
 */
export function classifyKeyboardInteractive(
  round: KeyboardInteractiveRound,
  host: SshConnectHost,
): MaybePromise<KeyboardInteractiveDecision> {
  return classifyFrom(
    listKeyboardInteractiveInterceptors(),
    0,
    round,
    host,
    false,
  );
}

/**
 * The same, answered at once by leaving out handlers in plugin processes.
 * For API 1 plugins that read the answer without awaiting it.
 */
export function classifyKeyboardInteractiveNow(
  round: KeyboardInteractiveRound,
  host: SshConnectHost,
): KeyboardInteractiveDecision {
  return classifyFrom(
    listKeyboardInteractiveInterceptors(),
    0,
    round,
    host,
    true,
  ) as KeyboardInteractiveDecision;
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
    const ask = async (): Promise<string[]> => {
      const decision = await classifyKeyboardInteractive(
        { name, instructions, prompts },
        host,
      );
      switch (decision.kind) {
        case "auto":
          return decision.responses;
        case "browser": {
          await channel.ask(decision);
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
