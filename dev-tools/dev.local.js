// LOCAL DEVELOPMENT ONLY — do not publish this file (it is not in the published build or the zip).
// Copy it to js/dev.local.js on your own machine and serve the game from localhost. Then press P ten times within
// ten seconds and sign in. The page only loads this file on localhost / 127.0.0.1.
// Only a SHA-256 hash of the developer password is kept here, and only on your machine.
(function(){
  const HASH='724a9c2eea99fbaac8b645eb0dba76f3caa5cf51609af9e7fca819c3671f64f9';
  const hex=buf=>Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('');
  window.OBLOCK_DEV = { verify: async pw => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(pw)))) === HASH };
})();
