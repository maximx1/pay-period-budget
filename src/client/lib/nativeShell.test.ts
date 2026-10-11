import { describe, expect, it, vi } from "vitest";

vi.mock("@capacitor/app", () => ({ App: {} }));
vi.mock("./sessionStore.ts", () => ({ isLocked: () => false, noteAppHidden: () => {}, noteAppShown: () => {} }));

const { dismissTopModal, isDarkTheme } = await import("./nativeShell.ts");

describe("isDarkTheme", () => {
  it.each([
    { choice: "dark", deviceIsDark: false, expected: true },
    { choice: "light", deviceIsDark: true, expected: false },
    { choice: null, deviceIsDark: true, expected: true },
    { choice: null, deviceIsDark: false, expected: false },
  ])("choice $choice on a device that is dark=$deviceIsDark → $expected", ({ choice, deviceIsDark, expected }) => {
    expect(isDarkTheme(choice, deviceIsDark)).toBe(expected);
  });
});

describe("dismissTopModal", () => {
  const dialog = () => ({ dispatchEvent: vi.fn<(event: Event) => boolean>() });
  const page = (...open: ReturnType<typeof dialog>[]) =>
    ({ querySelectorAll: () => open }) as unknown as ParentNode;

  it("reports that nothing was open", () => {
    expect(dismissTopModal(page())).toBe(false);
  });

  it("asks only the topmost open dialog to close, the way Escape does", () => {
    const drawer = dialog();
    const confirm = dialog();

    expect(dismissTopModal(page(drawer, confirm))).toBe(true);

    expect(drawer.dispatchEvent).not.toHaveBeenCalled();
    const event = confirm.dispatchEvent.mock.calls[0]![0];
    expect(event.type).toBe("cancel");
    expect(event.cancelable).toBe(true);
  });
});
