import { createContext } from "react";
import { motion, useReducedMotion } from "motion/react";
import { MeshGradient } from "@paper-design/shaders-react";

/**
 * Always-mounted app background: the hero's mesh gradient field, atmosphere
 * layers and drifting sparks live here once, outside the router — switching
 * pages never remounts, reloads or re-seeds the background. Pages only tell
 * the scene when to accelerate (Hero while tracing, Console while a scan is
 * running) through this context.
 */
export const SceneBoostContext = createContext<(boost: boolean) => void>(() => {});

const SPARKS = [
  { left: "6%", size: 2.5, delay: 0, duration: 8, drift: 34, ember: false },
  { left: "13%", size: 1.5, delay: 1.4, duration: 10, drift: -22, ember: false },
  { left: "21%", size: 2, delay: 2.8, duration: 9, drift: 18, ember: true },
  { left: "29%", size: 1.5, delay: 0.7, duration: 11, drift: -30, ember: false },
  { left: "38%", size: 2.5, delay: 3.6, duration: 8.5, drift: 26, ember: false },
  { left: "46%", size: 1.5, delay: 1.9, duration: 10.5, drift: -16, ember: false },
  { left: "54%", size: 2, delay: 4.4, duration: 9.5, drift: 22, ember: true },
  { left: "61%", size: 1.5, delay: 0.4, duration: 11.5, drift: -26, ember: false },
  { left: "69%", size: 2.5, delay: 2.4, duration: 8, drift: 30, ember: false },
  { left: "77%", size: 1.5, delay: 5.2, duration: 10, drift: -18, ember: false },
  { left: "84%", size: 2, delay: 1.1, duration: 9, drift: 24, ember: true },
  { left: "92%", size: 1.5, delay: 3.1, duration: 11, drift: -28, ember: false },
] as const;

export function SceneBackground({ boost }: { boost: boolean }) {
  const reduced = useReducedMotion() ?? false;

  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-0 overflow-hidden bg-black">
      <MeshGradient
        className="absolute inset-0 size-full"
        colors={["#000000", "#06b6d4", "#0891b2", "#164e63", "#f97316"]}
        speed={reduced ? 0 : boost ? 0.45 : 0.3}
      />
      <MeshGradient
        className="absolute inset-0 size-full opacity-60"
        colors={["#000000", "#ffffff", "#06b6d4", "#f97316"]}
        speed={reduced ? 0 : boost ? 0.3 : 0.2}
      />

      <div className="vignette" />
      <div className="scanlines" />
      <div className="grain" />

      {!reduced && (
        <div className="absolute inset-0 overflow-hidden">
          {SPARKS.map((spark, i) => (
            <motion.span
              key={i}
              className={`absolute bottom-[-4%] rounded-full ${
                spark.ember ? "bg-orange-400" : "bg-cyan-300"
              }`}
              style={{
                left: spark.left,
                width: spark.size,
                height: spark.size,
                boxShadow: spark.ember
                  ? "0 0 14px rgba(251, 146, 60, 0.75)"
                  : "0 0 14px rgba(34, 211, 238, 0.75)",
              }}
              animate={{
                y: [0, -400 - i * 8, -760 - i * 16],
                x: [0, spark.drift / 2, spark.drift],
                opacity: [0, 0.85, 0],
              }}
              transition={{
                duration: spark.duration,
                delay: spark.delay,
                repeat: Infinity,
                ease: "linear",
                times: [0, 0.16, 1],
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
