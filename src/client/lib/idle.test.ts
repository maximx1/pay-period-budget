import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearIdleSignOut,
  IDLE_CHECK_EVERY_MS,
  idleSignOutMinutes,
  isIdle,
  lastActivity,
  markActive,
  noteIdleSignOut,
  recheckIdle,
  resetIdleMemory,
  startIdleWatch,
} from "./idle.ts";

const MINUTE = 60 * 1000;
const LIMIT = 10 * MINUTE;
const START = Date.UTC(2026, 0, 15, 12);

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
  };
}

class FakeDocument extends EventTarget {
  visibilityState = "visible";
}

let storage: ReturnType<typeof memoryStorage>;
let target: EventTarget;
let doc: FakeDocument;
let onIdle: ReturnType<typeof vi.fn<() => void>>;
let onActive: ReturnType<typeof vi.fn<(now: number) => void>>;
let stop: () => void;

const watch = () => {
  stop = startIdleWatch({ limitMs: LIMIT, onIdle, onActive, storage, target, document: doc });
};
const input = (name = "pointerdown") => target.dispatchEvent(new Event(name));

beforeEach(() => {
  vi.useFakeTimers({ now: START });
  resetIdleMemory();
  storage = memoryStorage();
  target = new EventTarget();
  doc = new FakeDocument();
  onIdle = vi.fn<() => void>();
  onActive = vi.fn<(now: number) => void>();
  stop = () => {};
});
afterEach(() => {
  stop();
  vi.useRealTimers();
});

describe("the record of last activity", () => {
  it("is empty until something is recorded, and is never idle while empty", () => {
    expect(lastActivity(storage)).toBeNull();
    expect(isIdle(LIMIT, START + 100 * MINUTE, storage)).toBe(false);
  });

  it("is idle once the limit has passed, to the millisecond", () => {
    markActive(START, storage);
    expect(isIdle(LIMIT, START + LIMIT - 1, storage)).toBe(false);
    expect(isIdle(LIMIT, START + LIMIT, storage)).toBe(true);
  });

  it("takes the latest of what this tab remembers and what another tab wrote", () => {
    markActive(START, storage);
    storage.setItem("ppb.lastActivity", String(START + 5 * MINUTE));
    expect(lastActivity(storage)).toBe(START + 5 * MINUTE);
    storage.setItem("ppb.lastActivity", String(START - 5 * MINUTE));
    expect(lastActivity(storage)).toBe(START);
  });

  it("still works when the browser refuses storage", () => {
    const broken = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
      removeItem: () => {},
    };
    markActive(START, broken);
    expect(lastActivity(broken)).toBe(START);
    expect(isIdle(LIMIT, START + LIMIT, broken)).toBe(true);
    expect(isIdle(LIMIT, START, null)).toBe(false);
  });

  it("ignores rubbish in storage", () => {
    storage.setItem("ppb.lastActivity", "yesterday");
    expect(lastActivity(storage)).toBeNull();
  });
});

describe("the idle watch", () => {
  it("starts the clock when nothing was recorded, and fires once after the limit", () => {
    watch();
    expect(lastActivity(storage)).toBe(START);

    vi.advanceTimersByTime(LIMIT - IDLE_CHECK_EVERY_MS);
    expect(onIdle).not.toHaveBeenCalled();
    vi.advanceTimersByTime(IDLE_CHECK_EVERY_MS);
    expect(onIdle).toHaveBeenCalledTimes(1);

    // It has stopped: neither time nor input fires it again.
    vi.advanceTimersByTime(LIMIT * 3);
    input();
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it("keeps going for as long as there is input of any kind", () => {
    watch();
    for (const name of ["pointerdown", "pointermove", "keydown", "wheel", "touchstart", "scroll", "keydown"]) {
      vi.advanceTimersByTime(9 * MINUTE);
      input(name);
    }
    expect(onIdle).not.toHaveBeenCalled();

    vi.advanceTimersByTime(LIMIT);
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it("treats the first input after the limit as someone finding it idle, not as use", () => {
    watch();
    // A sleeping laptop: the clock jumps and no timer has run yet.
    vi.setSystemTime(START + LIMIT + 1);
    input();
    expect(onIdle).toHaveBeenCalledTimes(1);
    expect(lastActivity(storage)).toBe(START);
    expect(onActive).not.toHaveBeenCalled();
  });

  it("fires at once if the app is opened after too long away", () => {
    markActive(START - LIMIT, storage);
    watch();
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it("is kept alive by another tab, and goes idle with it", () => {
    watch();
    vi.advanceTimersByTime(9 * MINUTE);
    // Another tab of the same site was used a moment ago.
    storage.setItem("ppb.lastActivity", String(Date.now()));
    vi.advanceTimersByTime(9 * MINUTE);
    expect(onIdle).not.toHaveBeenCalled();
    vi.advanceTimersByTime(MINUTE);
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it("checks when the page is shown again and when asked to", () => {
    watch();
    vi.setSystemTime(START + LIMIT);
    doc.dispatchEvent(new Event("visibilitychange"));
    expect(onIdle).toHaveBeenCalledTimes(1);

    resetIdleMemory();
    storage = memoryStorage();
    onIdle = vi.fn<() => void>();
    watch();
    vi.setSystemTime(START + 3 * LIMIT);
    recheckIdle();
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it("writes activity down, and reports it, at most every five seconds", () => {
    watch();
    vi.advanceTimersByTime(MINUTE);
    for (let i = 0; i < 50; i++) {
      input("pointermove");
      vi.advanceTimersByTime(100);
    }
    expect(onActive).toHaveBeenCalledTimes(1);
    expect(lastActivity(storage)).toBe(START + MINUTE);

    vi.advanceTimersByTime(1);
    input();
    expect(onActive).toHaveBeenCalledTimes(2);
    expect(onActive).toHaveBeenLastCalledWith(START + MINUTE + 5001);
  });

  it("does nothing once stopped, and a later asking finds no watch", () => {
    watch();
    stop();
    vi.advanceTimersByTime(LIMIT * 2);
    input();
    recheckIdle();
    expect(onIdle).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("the note for the sign-in page", () => {
  it("is kept until cleared", () => {
    expect(idleSignOutMinutes(storage)).toBeNull();
    noteIdleSignOut(10, storage);
    expect(idleSignOutMinutes(storage)).toBe(10);
    clearIdleSignOut(storage);
    expect(idleSignOutMinutes(storage)).toBeNull();
  });
});
