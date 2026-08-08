/* Cross-browser namespace shim.
   Safari exposes both `browser` (promise-based) and `chrome`. Chrome exposes only
   `chrome`, whose MV3 APIs are also promise-based. Preferring `browser` keeps us on
   the standard surface in Safari and falls back cleanly everywhere else. */
var api = (typeof browser !== 'undefined' && browser.runtime) ? browser : chrome;
globalThis.api = api;
