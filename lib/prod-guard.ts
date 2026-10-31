// The production Supabase project, named so that tools which may touch a
// hosted database (seed on Preview, the mail dry run, the link redirect) can
// refuse production specifically. Not a secret: it's in every API URL. Pure;
// imports nothing, so scripts and node --test can use it.

export const PRODUCTION_PROJECT_REF = "jgetndieacanzhrzmyiz";

/** True when `url` is the production project's API (https://<ref>.supabase.co). */
export function isProductionSupabase(url: string | undefined): boolean {
  if (!url) return false;
  try {
    return new URL(url).hostname.split(".")[0] === PRODUCTION_PROJECT_REF;
  } catch {
    return false;
  }
}
