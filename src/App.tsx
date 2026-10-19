import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import Hero from "@/components/ui/hero";
import ConsoleView from "@/components/console/console-view";
import EvidenceView from "@/components/evidence/evidence-view";
import DocsView from "@/components/docs/docs-view";
import { SceneBackground, SceneBoostContext } from "@/components/ui/scene-background";

const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];

type Route =
  | { view: "hero" }
  | { view: "console" }
  | { view: "evidence"; scanId: string | null }
  | { view: "docs" };

function parseScanId(raw: string): string {
  if (raw.length === 0) return "";
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function routeFromHash(hash: string): Route {
  if (hash === "#console") return { view: "console" };
  if (hash === "#evidence") return { view: "evidence", scanId: null };
  if (hash.startsWith("#evidence/")) {
    const scanId = parseScanId(hash.slice("#evidence/".length));
    return { view: "evidence", scanId: scanId.length === 0 ? null : scanId };
  }
  if (hash.startsWith("#docs/")) {
    // Legacy report links (#docs/<scanId>) now live under #evidence.
    const scanId = parseScanId(hash.slice("#docs/".length));
    return { view: "evidence", scanId: scanId.length === 0 ? null : scanId };
  }
  if (hash === "#docs") return { view: "docs" };
  return { view: "hero" };
}

export default function App() {
  const [route, setRoute] = useState<Route>(() => routeFromHash(window.location.hash));
  const [boost, setBoost] = useState(false);
  const reduced = useReducedMotion() ?? false;

  useEffect(() => {
    const onHashChange = () => {
      const next = routeFromHash(window.location.hash);
      window.scrollTo(0, 0);
      setRoute(next);
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  // Page-to-page switches animate; picking another scan inside the evidence
  // browser swaps content in place (the glass window stays put).
  const routeKey = route.view;

  return (
    <SceneBoostContext.Provider value={setBoost}>
      {/* Mounted once, outside the router: switching pages never reloads the scene. */}
      <SceneBackground boost={boost} />

      {/* Clips the sliding page while it animates, so the offset never
          stretches the document and flashes a scrollbar. */}
      <div className="relative h-svh w-full overflow-hidden">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={routeKey}
            initial={{ opacity: 0, y: reduced ? 0 : 26 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{
              opacity: 0,
              y: reduced ? 0 : -18,
              transition: { duration: reduced ? 0 : 0.45, ease: "easeIn" },
            }}
            transition={{ duration: reduced ? 0 : 0.75, ease: EASE }}
            className="relative z-10"
          >
            {route.view === "console" && <ConsoleView />}
            {route.view === "evidence" && (
              <EvidenceView key={route.scanId ?? "list"} scanId={route.scanId} />
            )}
            {route.view === "docs" && <DocsView />}
            {route.view === "hero" && <Hero />}
          </motion.div>
        </AnimatePresence>
      </div>
    </SceneBoostContext.Provider>
  );
}
