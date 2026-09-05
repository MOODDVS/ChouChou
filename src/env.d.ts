/// <reference path="../.astro/types.d.ts" />

declare namespace App {
  interface Locals {
    /** Nonce CSP per-richiesta (script-src). Impostato dal middleware. */
    cspNonce?: string;
  }
}
