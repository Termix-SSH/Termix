/**
 * The parts of login methods and second factors the login screen draws by
 * itself: fields, second factor prompts and WebAuthn options. They come from
 * plugins, so each one is rebuilt from known fields and bounded before the
 * public login screen or the shell sees it.
 */

import type {
  PluginLoginField,
  PluginSecondFactorPrompt,
  PluginWebAuthnOptions,
} from "@termix-ssh/plugin-sdk/backend";

const MAX_FIELDS = 6;
const NAME = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const KEY = /^[A-Za-z0-9_.-]{1,128}$/;
const AUTOCOMPLETE = /^[a-z -]{1,64}$/;
const FIELD_TYPES = new Set(["text", "password", "code"]);
const MAX_JSON = 64 * 1024;

function isPlain(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** Fields the login screen can draw, or undefined when there are none. */
export function checkLoginFields(
  value: unknown,
): PluginLoginField[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const fields: PluginLoginField[] = [];
  const seen = new Set<string>();
  for (const raw of value.slice(0, MAX_FIELDS)) {
    if (!isPlain(raw)) continue;
    const { name, type, labelKey, autocomplete } = raw;
    if (typeof name !== "string" || !NAME.test(name) || seen.has(name)) {
      continue;
    }
    if (typeof type !== "string" || !FIELD_TYPES.has(type)) continue;
    if (typeof labelKey !== "string" || !KEY.test(labelKey)) continue;
    seen.add(name);
    fields.push({
      name,
      type: type as PluginLoginField["type"],
      labelKey,
      ...(typeof autocomplete === "string" && AUTOCOMPLETE.test(autocomplete)
        ? { autocomplete }
        : {}),
    });
  }
  return fields.length > 0 ? fields : undefined;
}

/** A second factor prompt the login screen can draw. */
export function checkSecondFactorPrompt(
  value: unknown,
): PluginSecondFactorPrompt | undefined {
  if (!isPlain(value)) return undefined;
  if (value.kind === "webauthn") return { kind: "webauthn" };
  if (value.kind === "code") {
    const length = Number(value.length);
    return {
      kind: "code",
      ...(typeof value.field === "string" && NAME.test(value.field)
        ? { field: value.field }
        : {}),
      ...(typeof value.labelKey === "string" && KEY.test(value.labelKey)
        ? { labelKey: value.labelKey }
        : {}),
      ...(Number.isInteger(length) && length >= 4 && length <= 12
        ? { length }
        : {}),
    };
  }
  if (value.kind === "fields") {
    const fields = checkLoginFields(value.fields);
    return fields ? { kind: "fields", fields } : undefined;
  }
  return undefined;
}

function plainJson(value: unknown): Record<string, unknown> | null {
  if (!isPlain(value)) return null;
  try {
    const text = JSON.stringify(value);
    if (text.length > MAX_JSON) return null;
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * WebAuthn options from a plugin as plain JSON. A bare options object (the
 * old second factor shape) is taken as `publicKey`. Null when unusable.
 */
export function checkWebAuthnOptions(
  value: unknown,
): PluginWebAuthnOptions | null {
  const raw = plainJson(value);
  if (!raw) return null;
  const wrapped = isPlain(raw.publicKey);
  const publicKey = (wrapped ? raw.publicKey : raw) as Record<string, unknown>;
  if (typeof publicKey.challenge !== "string" || !publicKey.challenge) {
    return null;
  }
  const context = wrapped && isPlain(raw.context) ? raw.context : undefined;
  return { publicKey, ...(context ? { context } : {}) };
}
