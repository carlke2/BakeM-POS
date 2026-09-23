interface BrandLogoTextProps {
  size?: "sm" | "md" | "lg";
  variant?: "default" | "light";
  className?: string;
}

export function BrandLogoText({ size = "md", variant = "default", className = "" }: BrandLogoTextProps) {
  let arcClass = "w-16 h-3 mb-1";
  let brandClass = "text-xl";
  let dividerClass = "h-[1.5px] my-1";
  let subtextClass = "text-[8px] tracking-[0.22em]";

  if (size === "lg") {
    arcClass = "w-28 h-5 mb-1.5";
    brandClass = "text-3xl";
    dividerClass = "h-[2px] my-1.5";
    subtextClass = "text-[11px] tracking-[0.22em]";
  } else if (size === "sm") {
    arcClass = "w-12 h-2.5 mb-0.5";
    brandClass = "text-sm";
    dividerClass = "h-[1px] my-0.5";
    subtextClass = "text-[6px] tracking-[0.22em]";
  }

  const isDefault = variant === "default";
  const arcColor = isDefault ? "text-[#B91D2D]" : "text-white";
  const brandColor = isDefault ? "text-[#5C0101]" : "text-white";
  const dividerBg = isDefault ? "bg-[#B91D2D]" : "bg-white/50";
  const subtextColor = isDefault ? "text-[#5C0101]" : "text-white/80";

  return (
    <div className={`flex flex-col items-center select-none font-sans ${className}`}>
      <svg className={`${arcClass} ${arcColor} transition-colors duration-200`} viewBox="0 0 100 20" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M10 15 C 35 2, 65 2, 90 15" stroke="currentColor" strokeWidth="4" strokeLinecap="round" fill="none" />
      </svg>

      <div className={`flex font-black uppercase leading-none ${brandClass} tracking-tight ${brandColor}`}>
        Slow Rise Co
      </div>

      <div className={`w-full ${dividerBg} ${dividerClass} rounded-full`} />

      <div className={`font-bold uppercase whitespace-nowrap ${subtextColor} ${subtextClass}`}>
        Bakery
      </div>
    </div>
  );
}

export default BrandLogoText;
