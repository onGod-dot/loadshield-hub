import logo from "@/assets/logo.png";

export function BrandMark({ size = 48, className = "" }: { size?: number; className?: string }) {
  return (
    <img
      src={logo}
      alt="TTU-LoadShield"
      width={size}
      height={size}
      className={className}
      style={{ width: size, height: size, objectFit: "contain" }}
    />
  );
}

export function BrandLockup({ size = 56 }: { size?: number }) {
  return (
    <div className="flex items-center gap-3">
      <BrandMark size={size} />
      <div className="flex flex-col leading-none">
        <span className="text-[0.7em] font-medium tracking-[0.18em] text-muted-foreground" style={{ fontSize: size * 0.28 }}>
          TTU
        </span>
        <span className="font-extrabold tracking-tight text-foreground" style={{ fontSize: size * 0.42, lineHeight: 1 }}>
          LoadShield
        </span>
      </div>
    </div>
  );
}
