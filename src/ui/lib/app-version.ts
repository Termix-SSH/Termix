/** The version of this build, empty in a dev build. */
export const APP_VERSION: string | undefined =
  import.meta.env.VITE_APP_VERSION || undefined;
