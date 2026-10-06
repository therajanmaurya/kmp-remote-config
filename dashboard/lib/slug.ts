/**
 * Produce a slug satisfying migration 002's app_slug_shape: ^[a-z0-9][a-z0-9-]*[a-z0-9]$
 *
 * Lives here rather than in app/apps/actions.ts because that file is `"use server"`, and
 * Next 14 permits only ASYNC exports from a server-actions module — a sync export there is
 * a build error. A pure string function has no business in an actions module anyway.
 *
 * Returns "" when nothing usable remains rather than inventing a slug: a generated slug
 * the operator never typed silently becomes part of every key prefix and log line for that
 * app, and they would have no idea where it came from.
 */
export function slugify(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // strip combining marks: Café → Cafe
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")    // any run of non-alphanumerics → one dash
    .replace(/^-+|-+$/g, "")        // trim the anchors the CHECK forbids
}
