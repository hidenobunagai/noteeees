// Pins `new Date()` / `Date.now()` so seeded timestamps and the demo's
// "today" stay reproducible no matter when the demo is regenerated.
// Only no-argument reads are faked; explicit `new Date(value)` passes through.

const RealDate = Date;
let nowMs = 0;

export function installFakeClock(startIso: string): void {
  nowMs = RealDate.parse(startIso);
  globalThis.Date = class extends RealDate {
    constructor(...args: unknown[]) {
      if (args.length === 0) {
        super(nowMs);
      } else {
        super(...(args as [number]));
      }
    }

    static now(): number {
      return nowMs;
    }
  };
}

export function setNow(iso: string): void {
  nowMs = RealDate.parse(iso);
}
