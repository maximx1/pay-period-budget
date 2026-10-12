import { useEffect, useRef, useState } from "react";
import { Outlet, useLocation } from "react-router";
import { Drawer } from "../../components/ui/Drawer.tsx";
import { FabSlotContext } from "../../components/ui/Fab.tsx";
import { navItemForPath } from "./navItems.ts";
import { SidePanel } from "./SidePanel.tsx";
import { TopBar } from "./TopBar.tsx";

// Tailwind's `lg` breakpoint: from here up the side panel is always visible.
const WIDE_LAYOUT = "(min-width: 64rem)";

/**
 * Frame for every signed-in screen: side panel (a drawer below `lg`), top bar on small
 * screens, and a scrolling page column capped in width so it doesn't sprawl on ultrawides.
 * Pages render as direct children of a flex column, which is what lets <Fab> pin itself.
 */
export function AppShell() {
  const { pathname } = useLocation();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const scrollRoot = useRef<HTMLElement>(null);
  const [fabSlot, setFabSlot] = useState<HTMLElement | null>(null);

  // A new screen starts at the top with the drawer out of the way.
  useEffect(() => {
    setDrawerOpen(false);
    scrollRoot.current?.scrollTo(0, 0);
  }, [pathname]);

  // The drawer is modal; don't leave it open (and the page inert) once the fixed panel appears.
  useEffect(() => {
    const wide = window.matchMedia(WIDE_LAYOUT);
    const closeWhenWide = () => {
      if (wide.matches) setDrawerOpen(false);
    };
    wide.addEventListener("change", closeWhenWide);
    return () => wide.removeEventListener("change", closeWhenWide);
  }, []);

  return (
    <div className="flex h-full">
      <aside className="hidden w-64 shrink-0 border-r border-border bg-surface lg:flex">
        <SidePanel />
      </aside>

      <Drawer open={drawerOpen} onClose={() => setDrawerOpen(false)} label="Menu">
        <SidePanel onNavigate={() => setDrawerOpen(false)} />
      </Drawer>

      <div className="relative flex min-w-0 flex-1 flex-col">
        <TopBar title={navItemForPath(pathname).label} menuOpen={drawerOpen} onMenu={() => setDrawerOpen(true)} />
        <main
          ref={scrollRoot}
          data-scroll-root
          className="flex-1 overflow-y-auto pr-[env(safe-area-inset-right)] [scrollbar-gutter:stable]"
        >
          <div className="mx-auto flex min-h-full w-full max-w-6xl flex-col px-4 pt-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:px-6 lg:px-8">
            <FabSlotContext value={fabSlot}>
              <Outlet />
            </FabSlotContext>
          </div>
        </main>
        {/* Floating buttons live here, outside the scroller, so they never move with the page. */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 pr-[env(safe-area-inset-right)]">
          <div
            ref={setFabSlot}
            className="mx-auto flex w-full max-w-6xl justify-end px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:px-6 lg:px-8"
          />
        </div>
      </div>
    </div>
  );
}
