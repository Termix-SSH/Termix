// Answers asked of plugin frames (a when, a label) that are not back yet.
let pending = 0;

export function answerAsked(): void {
  pending += 1;
}

export function answerDone(): void {
  pending = Math.max(0, pending - 1);
}

/** Whether some plugin still has to answer. */
export function answersPending(): boolean {
  return pending > 0;
}
