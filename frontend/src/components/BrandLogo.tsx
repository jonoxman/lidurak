/**
 * T-90-2 ITEM-8a: the LIDURAK brand mark and wordmark as one scalable vector.
 *
 * The header, the large logo and the Wave-2 lobby mosaic all render this exact
 * geometry, so there is a single source of truth for the brand.
 */

export type BrandLogoSize = 'header' | 'large';

export interface BrandLogoProps {
  /** `header` is the compact top-left mark; `large` is the scalable hero mark. */
  size?: BrandLogoSize;
  className?: string;
}

/** The wordmark rendered next to the mark. */
export const BRAND_NAME = 'LIDURAK';

/** The brand mark: two fanned playing cards with a trump diamond. */
function BrandMark({ className }: { className: string }) {
  return (
    <svg
      class={className}
      data-testid="header-logo"
      viewBox="0 0 32 32"
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
      focusable="false"
    >
      <rect
        x="4"
        y="8"
        width="15"
        height="20"
        rx="2.5"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        opacity="0.55"
        transform="rotate(-10 11.5 18)"
      />
      <rect
        x="12"
        y="4"
        width="16"
        height="23"
        rx="2.5"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
      />
      <path d="M20 9 24.5 15 20 21 15.5 15z" fill="currentColor" />
    </svg>
  );
}

/**
 * The brand lockup: the mark immediately left of the wordmark, exactly as the
 * top-left of the site header has always rendered it.
 */
export function BrandLogo({ size = 'header', className }: BrandLogoProps) {
  return (
    <span
      class={`brand-logo brand-logo--${size}${className ? ` ${className}` : ''}`}
      data-testid="brand-logo"
      data-size={size}
    >
      <BrandMark className="header-logo" />
      <span class="header-brand-text">{BRAND_NAME}</span>
    </span>
  );
}

/** Theme-appropriate contrast for the faded lobby mosaic watermark. */
const MOSAIC_PALETTE: Record<'dark' | 'light', { mark: string; markSoft: string; text: string }> = {
  dark: { mark: '#7f8f86', markSoft: '#5d6b63', text: '#a8b6ad' },
  light: { mark: '#6b7a72', markSoft: '#93a29a', text: '#4a5851' },
};

/**
 * T-90-2 ITEM-8a: the same brand lockup as a CSS `background-image` value, so
 * Wave 2's Quick Pairing tiles can paint one faded logo across the mosaic.
 *
 * The SVG uses `preserveAspectRatio="xMidYMid meet"`, so a tile of any shape
 * keeps the mark undistorted and centred.
 */
export function getBrandLogoMosaicDataUri(theme: 'dark' | 'light'): string {
  const palette = MOSAIC_PALETTE[theme] ?? MOSAIC_PALETTE.dark;
  const svg = [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 260 64"',
    ' preserveAspectRatio="xMidYMid meet">',
    '<g fill="none" stroke="' + palette.mark + '" stroke-width="3">',
    '<rect x="6" y="18" width="26" height="36" rx="4" opacity="0.55"',
    ' transform="rotate(-10 19 36)"/>',
    '<rect x="20" y="10" width="28" height="42" rx="4"/>',
    '</g>',
    '<path d="M34 21 42 32 34 43 26 32z" fill="' + palette.markSoft + '"/>',
    '<text x="64" y="42" fill="' + palette.text + '"',
    ' font-family="Segoe UI, system-ui, sans-serif" font-size="30"',
    ' font-weight="800" letter-spacing="4">' + BRAND_NAME + '</text>',
    '</svg>',
  ].join('');
  // Parentheses stay unescaped in `encodeURIComponent`, and a CSS `url()`
  // parser may reject them inside the data payload, so encode them explicitly.
  const data = encodeURIComponent(svg).replace(/\(/g, '%28').replace(/\)/g, '%29');
  return `url("data:image/svg+xml,${data}")`;
}

export default BrandLogo;
