import Image from "next/image";
import Link from "next/link";
import { cn } from "@/lib/utils";

export const APP_LOGO_SRC = "/twentyfourseven-login-logo.png";

const sizeConfig = {
  sm: { className: "h-8 w-8 rounded-lg", pixels: 32 },
  md: { className: "h-12 w-12 rounded-xl", pixels: 48 },
  lg: { className: "h-24 w-24 rounded-2xl", pixels: 96 },
} as const;

export type AppLogoSize = keyof typeof sizeConfig;

interface AppLogoProps {
  size?: AppLogoSize;
  className?: string;
  href?: string;
  priority?: boolean;
}

export function AppLogo({
  size = "sm",
  className,
  href,
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
        config.className,
        "object-contain shadow-sm shadow-orange-500/20",
        className,
      )}
    />
  );

  if (href) {
    return (
      <Link href={href} className="shrink-0" aria-label="TwentyFour/Seven home">
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
}

export function AppBrandHeader({
  size = "lg",
  title = "TwentyFour/Seven",
  description = "Live TV from your media library",
  className,
}: AppBrandHeaderProps) {
  return (
    <div className={cn("text-center", className)}>
      <div className="mx-auto mb-5 flex justify-center">
        <AppLogo size={size} priority />
      </div>
      <h1 className="text-2xl font-bold tracking-tight text-foreground">{title}</h1>
      {description ? (
        <p className="mt-2 text-sm text-muted-foreground">{description}</p>
      ) : null}
    </div>
  );
}
