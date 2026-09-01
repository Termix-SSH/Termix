export interface ServerSentEvent {
  event: string;
  data: string;
}

export async function streamServerSentEvents(
  url: string,
  init: RequestInit,
  onEvent: (event: ServerSentEvent) => void,
): Promise<void> {
  const response = await fetch(url, init);
  if (!response.ok) {
    throw new Error(`SSE request failed with status ${response.status}`);
  }
  if (!response.body) throw new Error("SSE response has no body");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let eventName = "message";
  let data: string[] = [];

  const dispatch = () => {
    if (data.length > 0) onEvent({ event: eventName, data: data.join("\n") });
    eventName = "message";
    data = [];
  };

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const lines = buffer.split(/\r?\n/);
    buffer = done ? "" : (lines.pop() ?? "");

    for (const line of lines) {
      if (line === "") dispatch();
      else if (line.startsWith("event:")) eventName = line.slice(6).trimStart();
      else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
    }

    if (done) {
      dispatch();
      return;
    }
  }
}
