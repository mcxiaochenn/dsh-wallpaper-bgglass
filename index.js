/**
 * Host half of the wallpaper bundle.
 *
 * It owns one read-only route that serves the bundled default wallpaper, so a
 * fresh profile shows a fitting background without the user having to pick a
 * file first. The Client stores a user-picked image in the browser; this route
 * is only the fallback.
 */
import { readFile } from 'node:fs/promises';

/** Route the Client fetches for the bundled wallpaper. */
const DEFAULT_ROUTE = '/api/dsh-wallpaper-bgglass/default';
/** Bundled artwork, resolved from this module's own package directory. */
const DEFAULT_ASSET = new URL('./assets/default-wallpaper.webp', import.meta.url);
/** Media type of {@link DEFAULT_ASSET}. */
const DEFAULT_TYPE = 'image/webp';

export const inject = ['webServer'];

/**
 * Register the default-wallpaper route for this plugin's lifetime.
 * @param ctx - host plugin context.
 */
export function apply(ctx) {
  /** Read-once cache; a failed read is not cached so the next request retries. */
  let asset = null;
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: DEFAULT_ROUTE,
    // A resource answers GET and HEAD (other methods get 405 from the server),
    // which is all this immutable image needs.
    resource: async () => {
      if (asset === null) asset = await readFile(DEFAULT_ASSET).catch(() => undefined);
      if (asset === undefined) {
        asset = null;
        return new Response(null, { status: 404, headers: { 'cache-control': 'no-store' } });
      }
      return new Response(asset, {
        headers: {
          'content-type': DEFAULT_TYPE,
          'content-length': String(asset.byteLength),
          // Content-addressed by package version; a new release ships a new file.
          'cache-control': 'public, max-age=31536000, immutable',
        },
      });
    },
  }), 'dsh-wallpaper-bgglass: default wallpaper route');
}
