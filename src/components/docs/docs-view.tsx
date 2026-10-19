import type { ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";
import { ArrowLeft, ArrowUpRight, BookOpenText, ExternalLink } from "lucide-react";
import { BRAND, BRAND_SUB, DOCS, VERSION } from "@/data";
import { Monogram, MonogramDefs } from "@/components/ui/monogram";

const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];

const BAND_DOTS: Record<string, string> = {
  Low: "bg-emerald-400",
  Moderate: "bg-amber-400",
  Elevated: "bg-orange-400",
  High: "bg-red-400",
};

const SEVERITY_CHIPS: Record<string, string> = {
  High: "border-red-400/35 bg-red-500/10 text-red-200/90",
  Medium: "border-amber-300/30 bg-amber-400/10 text-amber-100/90",
};

function Section({
  label,
  aside,
  children,
}: {
  label: string;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="border-t border-white/[0.07] pt-6 first:border-t-0 first:pt-0">
      <div className="mb-3.5 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-mono text-[10px] font-semibold uppercase tracking-[0.22em] text-cyan-100/60">
          {label}
        </h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

export default function DocsView() {
  const reduced = useReducedMotion() ?? false;

  return (
    <section className="relative flex h-svh w-full flex-col overflow-hidden text-white">
      <MonogramDefs />

      <motion.header
        initial={{ opacity: 0, y: reduced ? 0 : -14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: reduced ? 0 : 0.7, ease: EASE }}
        className="relative z-20 flex shrink-0 items-center justify-between gap-4 px-6 py-5 lg:px-10"
      >
        <a
          href="#"
          className="inline-flex items-center gap-2.5 rounded-xl text-[13px] font-medium text-white/55 transition hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60 focus-visible:ring-offset-2 focus-visible:ring-offset-black"
        >
          <ArrowLeft aria-hidden className="size-4" />
          {DOCS.back}
        </a>
        <div className="absolute left-1/2 hidden -translate-x-1/2 items-center gap-3 md:flex">
          <span className="grid size-8 place-items-center rounded-xl border border-cyan-300/25 bg-cyan-400/5 backdrop-blur">
            <Monogram className="size-4.5" />
          </span>
          <span className="text-sm font-semibold tracking-[0.35em]">
            {BRAND} <span className="font-light text-white/55">{BRAND_SUB}</span>
          </span>
        </div>
        <a
          href="#console"
          className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] py-1.5 pr-3 pl-3 font-mono text-[10px] uppercase tracking-[0.2em] text-white/60 backdrop-blur transition hover:border-white/25 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60"
        >
          {DOCS.openConsole}
          <ArrowUpRight aria-hidden className="size-3.5" />
        </a>
      </motion.header>

      <motion.main
        initial={{ opacity: 0, y: reduced ? 0 : 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: reduced ? 0 : 0.8, delay: reduced ? 0 : 0.1, ease: EASE }}
        className="relative z-10 mx-auto flex min-h-0 w-full max-w-4xl flex-1 flex-col px-6 pb-10 lg:px-10"
      >
        <div className="shrink-0 pb-4">
          <p className="prism-text font-mono text-[10px] font-semibold uppercase tracking-[0.3em]">
            {DOCS.kicker}
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">{DOCS.title}</h1>
          <p className="mt-2 max-w-2xl text-[13px] leading-6 text-white/55">{DOCS.subtitle}</p>
        </div>

        <div
          data-testid="docs-window"
          className="liquid-glass relative flex min-h-[240px] w-full min-w-0 flex-1 flex-col overflow-hidden rounded-[22px]"
        >
          <header className="relative z-10 flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-white/[0.08] px-5 py-4">
            <div className="flex min-w-0 items-center gap-2.5">
              <BookOpenText aria-hidden className="size-4 text-cyan-200/75" />
              <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/45">
                {DOCS.readmeLabel}
              </p>
            </div>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-white/50">
              {VERSION}
            </span>
          </header>

          <div className="no-scrollbar relative z-10 min-h-0 flex-1 overflow-y-auto px-6 py-6 sm:px-7">
            <div className="mx-auto flex w-full max-w-3xl flex-col gap-7 pb-2">
              <Section label={DOCS.overviewLabel}>
                <div className="flex flex-col gap-3">
                  {DOCS.overview.map((paragraph) => (
                    <p key={paragraph.slice(0, 24)} className="text-[13px] leading-6 text-white/65">
                      {paragraph}
                    </p>
                  ))}
                </div>
              </Section>

              <Section
                label={DOCS.flowLabel}
                aside={
                  <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-white/35">
                    {DOCS.flowNote}
                  </span>
                }
              >
                <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {DOCS.flow.map((step, index) => (
                    <li
                      key={step.title}
                      className="group relative overflow-hidden rounded-xl border border-white/[0.08] bg-white/[0.02] p-4 transition hover:border-white/[0.16] hover:bg-white/[0.04]"
                    >
                      <span className="font-mono text-[10px] font-semibold tracking-[0.2em] text-cyan-200/70">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <p className="mt-2 text-[12.5px] font-semibold text-white/85">{step.title}</p>
                      <p className="mt-1.5 text-[11.5px] leading-5 text-white/50">{step.body}</p>
                    </li>
                  ))}
                </ol>
              </Section>

              <Section label={DOCS.rulesLabel}>
                <ul className="flex flex-col gap-2.5">
                  {DOCS.rules.map((rule) => (
                    <li
                      key={rule.id}
                      className="flex flex-col gap-2 rounded-xl border border-white/[0.08] bg-white/[0.02] px-4 py-3.5 sm:flex-row sm:items-start sm:gap-4"
                    >
                      <span className="inline-flex h-7 shrink-0 items-center rounded-lg border border-cyan-300/25 bg-cyan-400/[0.07] px-2.5 font-mono text-[11px] font-semibold text-cyan-100/85">
                        {rule.id}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                          <p className="text-[12.5px] font-semibold text-white/85">{rule.name}</p>
                          <span
                            className={`inline-flex rounded-full border px-2.5 py-0.5 font-mono text-[9.5px] font-semibold uppercase tracking-[0.16em] ${SEVERITY_CHIPS[rule.severity] ?? "border-white/15 bg-white/[0.04] text-white/60"}`}
                          >
                            {rule.severity}
                          </span>
                          <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-white/40">
                            {rule.points}
                          </span>
                        </div>
                        <p className="mt-1.5 text-[11.5px] leading-5 text-white/50">{rule.body}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              </Section>

              <div className="grid gap-7 sm:grid-cols-2">
                <Section label={DOCS.bandsLabel}>
                  <ul className="flex flex-col gap-2">
                    {DOCS.bands.map((band) => (
                      <li key={band.label} className="flex items-center justify-between gap-3 py-0.5">
                        <span className="inline-flex items-center gap-2 text-[12px] text-white/70">
                          <span aria-hidden className={`size-1.5 rounded-full ${BAND_DOTS[band.label] ?? "bg-white/40"}`} />
                          {band.label}
                        </span>
                        <span className="font-mono text-[11px] tabular-nums text-white/50">{band.range}</span>
                      </li>
                    ))}
                  </ul>
                </Section>

                <Section label={DOCS.stackLabel}>
                  <p className="text-[12px] leading-6 text-white/60">{DOCS.stack}</p>
                </Section>
              </div>

              <Section label={DOCS.apiLabel}>
                <ul className="flex flex-col gap-2">
                  {DOCS.api.map((entry) => (
                    <li
                      key={entry.path}
                      className="flex flex-col gap-1 rounded-lg border border-white/[0.07] bg-white/[0.015] px-3.5 py-2.5 sm:flex-row sm:items-center sm:gap-3"
                    >
                      <span className="inline-flex w-10 shrink-0 font-mono text-[10px] font-semibold text-emerald-300/90">
                        {entry.method}
                      </span>
                      <code className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-white/75">{entry.path}</code>
                      <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-white/35">{entry.note}</span>
                    </li>
                  ))}
                </ul>
              </Section>

              <Section label={DOCS.limitsLabel}>
                <ul className="flex flex-col gap-2">
                  {DOCS.limits.map((limit) => (
                    <li key={limit} className="flex items-start gap-2.5 text-[12px] leading-5 text-white/60">
                      <span aria-hidden className="mt-[7px] size-1 shrink-0 rounded-full bg-white/30" />
                      {limit}
                    </li>
                  ))}
                </ul>
              </Section>

              <p className="flex items-center gap-2 border-t border-white/[0.07] pt-5 font-mono text-[10px] uppercase tracking-[0.14em] text-white/35">
                <ExternalLink aria-hidden className="size-3.5" />
                {DOCS.footer}
              </p>
            </div>
          </div>
        </div>
      </motion.main>
    </section>
  );
}
