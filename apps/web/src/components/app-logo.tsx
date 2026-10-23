import Image from "next/image";
import Link from "next/link";
import { cn } from "@/lib/utils";

export const APP_LOGO_SRC = "/twentyfourseven-login-logo.png";

const sizeConfig = {
  sm: { className: "h-8 w-8 rounded-lg", pixels: 32 },
  md: { className: "h-12 w-12 rounded-xl", pixels: 48 },
  lg: { className: "h-24 w-24 rounded-2xl", pixels: 96 },
  /** ESPG login tile: 80px, rounded-2xl, shadow-md. */
  login: { className: "h-20 w-20 rounded-2xl object-cover shadow-md", pixels: 80 },
} as const;

export type AppLogoSize = keyof typeof sizeConfig;

interface AppLogoProps {
  size?: AppLogoSize;
  className?: string;
  href?: string;
  linkClassName?: string;
  priority?: boolean;
}

export function AppLogo({
  size = "sm",
  className,
  href,
  linkClassName,
  priority = false,
}: AppLogoProps) {
  const config = sizeConfig[size];
  const image = (
    <Image
      src={APP_LOGO_SRC}
      alt="TwentyFour/Seven"
      width={config.pixels}
      height={config.pixels}
      priority={priority}
      className={cn(
        "object-contain",
        config.className,
        className,
      )}
    />
  );

  if (href) {
    return (
      <Link href={href} className={cn("shrink-0", linkClassName)} aria-label="TwentyFour/Seven home">
        {image}
      </Link>
    );
  }

  return image;
}

interface AppBrandHeaderProps {
  size?: AppLogoSize;
  title?: string;
  description?: string;
  className?: string;
  titleClassName?: string;
}

export function AppBrandHeader({
  size = "lg",
  title = "TwentyFour/Seven",
  description = "Live TV from your media library",
  className,
  titleClassName = "text-2xl font-semibold tracking-[-0.03em]",
}: AppBrandHeaderProps) {
  return (
    <div className={cn("text-center", className)}>
      <div className="mx-auto flex justify-center">
        <AppLogo size={size} priority />
      </div>
      <h1 className={cn("mt-6 text-foreground", titleClassName)}>{title}</h1>
      {description ? (
        <p className="mt-2 text-sm text-muted-foreground">{description}</p>
      ) : null}
    </div>
  );
}
