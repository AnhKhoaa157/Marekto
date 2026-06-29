import Image from "next/image";

type BrandLogoProps = Readonly<{
  /**
   * Sizing utilities for the transparent brand lockup wrapper.
   */
  className?: string;
  /** Prioritize loading when the logo is above the fold (e.g. the navbar). */
  priority?: boolean;
  /** Responsive `sizes` hint passed to next/image. */
  sizes?: string;
}>;

/**
 * Renders the official Marekto full logo lockup. The PNG has transparency, so
 * the wrapper stays transparent and only crops the source padding.
 */
export function BrandLogo({
  className = "h-10 w-28",
  priority = false,
  sizes = "128px",
}: BrandLogoProps) {
  return (
    <span
      className={`relative block overflow-hidden ${className}`}
    >
      <Image
        alt="Marekto logo"
        className="object-cover"
        fill
        priority={priority}
        sizes={sizes}
        src="/logo/full/full-logo-dark.png?v=dark"
        unoptimized
      />
    </span>
  );
}
