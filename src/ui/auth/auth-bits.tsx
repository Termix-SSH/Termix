/** The left half of the sign-in screen: brand mark, tagline, a rule. */
export function BrandPanel({
  logo,
  appName,
  tagline,
}: {
  logo?: string | null;
  appName: string;
  tagline: string;
}) {
  return (
    <div className="relative hidden w-[46%] max-w-[560px] shrink-0 select-none flex-col justify-between overflow-hidden border-r border-border bg-sidebar p-10 lg:flex">
      <div
        className="absolute inset-0 opacity-70"
        style={{
          backgroundImage:
            "radial-gradient(circle, color-mix(in oklch, var(--border) 80%, transparent) 1px, transparent 1px)",
          backgroundSize: "22px 22px",
        }}
      />
      <div className="absolute inset-x-0 top-0 h-px bg-accent-brand/60" />

      <div className="relative flex items-center gap-3">
        {logo && <img src={logo} alt="" className="size-8 object-contain" />}
        <span className="font-mono text-lg font-bold uppercase tracking-[0.35em]">
          {appName}
        </span>
      </div>

      <div className="relative max-w-[380px]">
        <h2 className="text-2xl font-semibold leading-tight tracking-tight">
          {tagline}
        </h2>
        <div className="mt-4 h-px w-10 bg-accent-brand" />
      </div>

      <div className="relative h-3" />
    </div>
  );
}

/** The brand line shown above the form when the brand panel is hidden. */
export function CompactBrand({
  logo,
  appName,
}: {
  logo?: string | null;
  appName: string;
}) {
  return (
    <div className="flex items-center gap-2.5 lg:hidden">
      {logo && <img src={logo} alt="" className="size-7 object-contain" />}
      <span className="font-mono text-sm font-bold uppercase tracking-[0.3em]">
        {appName}
      </span>
    </div>
  );
}
