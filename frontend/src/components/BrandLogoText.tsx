interface BrandLogoTextProps {
  size?: "sm" | "md" | "lg";
  variant?: "default" | "light"; // 'default' for light BG, 'light' for dark BG (white text)
  className?: string;
}

export function BrandLogoText({ size = "md", variant = "default", className = "" }: BrandLogoTextProps) {
  // Define styles based on size
  let arcClass = "w-16 h-3 mb-1";
  let betterForkClass = "text-xl";
  let letterSpacingClass = "ml-1.5";
  let dividerClass = "h-[1.5px] my-1";
  let subtextClass = "text-[8px] tracking-[0.22em]";

  if (size === "lg") {
    arcClass = "w-28 h-5 mb-1.5";
    betterForkClass = "text-3xl";
    letterSpacingClass = "ml-2.5";
    dividerClass = "h-[2px] my-1.5";
    subtextClass = "text-[11px] tracking-[0.22em]";
  } else if (size === "sm") {
    arcClass = "w-12 h-2.5 mb-0.5";
    betterForkClass = "text-sm";
    letterSpacingClass = "ml-1";
    dividerClass = "h-[1px] my-0.5";
    subtextClass = "text-[6px] tracking-[0.22em]";
  }

  // Define colors based on variant
  const isDefault = variant === "default";
  const arcColor = isDefault ? "text-[#134E4A]" : "text-teal-400";
  const betterColor = isDefault ? "text-[#0A9396]" : "text-teal-300";
  const forkColor = isDefault ? "text-[#134E4A]" : "text-white";
  const dividerBg = isDefault ? "bg-[#0A9396]" : "bg-teal-400/40";
  const subtextColor = isDefault ? "text-[#CCA758]" : "text-[#CCA758]"; // Keep gold for both

  return (
    <div className={`flex flex-col items-center select-none font-sans ${className}`}>
      {/* Top Arc accent */}
      <svg className={`${arcClass} ${arcColor} transition-colors duration-200`} viewBox="0 0 100 20" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M10 15 C 35 2, 65 2, 90 15" stroke="currentColor" strokeWidth="4" strokeLinecap="round" fill="none" />
      </svg>

      {/* BETTER FORK Text */}
      <div className={`flex font-black uppercase leading-none ${betterForkClass} tracking-tight`}>
        <span className={betterColor}>BETTER</span>
        <span className={`${forkColor} ${letterSpacingClass}`}>FORK</span>
      </div>

      {/* Thin divider line */}
      <div className={`w-full ${dividerBg} ${dividerClass} rounded-full`} />

      {/* RESTAURANT LIMITED Text */}
      <div className={`font-bold uppercase whitespace-nowrap ${subtextColor} ${subtextClass}`}>
        Restaurant Limited
      </div>
    </div>
  );
}

export default BrandLogoText;
