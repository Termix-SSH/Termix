/**
 * Import forms `termix-plugin build` understands beyond plain modules. Picked
 * up through tsconfig.plugin.json.
 */

/** A script copied next to the bundle; the import is its URL. */
declare module "*?url" {
  const url: string;
  export default url;
}

/** A stylesheet imported for its side effect; the build emits frontend.css. */
declare module "*.css";
