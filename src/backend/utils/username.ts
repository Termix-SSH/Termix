const MAX_USERNAME_LENGTH = 64;

/** Slashes and control characters have no place in a login name. */
export function isAcceptableUsername(username: string): boolean {
  return (
    username.length <= MAX_USERNAME_LENGTH &&
    !/[/\\\u0000-\u001f\u007f]/.test(username)
  );
}

export const USERNAME_RULE_ERROR =
  "Usernames can be at most 64 characters and can't contain slashes or control characters";
