/**
 * Terminal sound effects boundary.
 *
 * The Terminal component supports key/enter sounds through a sprite or a
 * single audio file. DYNIX TRACE ships without audio assets and the console
 * runs with sound disabled, so this implementation is a deliberately silent
 * no-op: the API stays stable, nothing is fetched and nothing can fail.
 */
export type TerminalSpriteSfxOptions = {
  soundUrl?: string;
  configUrl?: string;
  simpleMode?: boolean;
};

export type TerminalSpriteSfx = {
  resume(): Promise<void>;
  setMuted(muted: boolean): void;
  ensureLoaded(): Promise<void>;
  tick(event: { kind: "key" | "enter"; ch?: string }): void;
};

export function createTerminalSpriteSfx(_options: TerminalSpriteSfxOptions = {}): TerminalSpriteSfx {
  return {
    async resume() {
      /* silent by design */
    },
    setMuted() {
      /* silent by design */
    },
    async ensureLoaded() {
      /* silent by design */
    },
    tick() {
      /* silent by design */
    },
  };
}
