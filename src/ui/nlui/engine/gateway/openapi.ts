/**
 * Lightweight OpenAPI spec loader.
 * Accepts a URL string or an inline spec object.
 */
export async function loadSpec(spec: string | Record<string, unknown>): Promise<Record<string, unknown>> {
  if (typeof spec !== 'string') return spec;

  const resp = await fetch(spec);
  if (!resp.ok) throw new Error(`Failed to fetch spec: ${resp.status}`);

  const text = await resp.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('Spec must be JSON (YAML not supported in browser runtime)');
  }
}
