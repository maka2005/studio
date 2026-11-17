import type { ImgHTMLAttributes } from 'react';

type Props = Omit<ImgHTMLAttributes<HTMLImageElement>, 'src' | 'srcSet'> & {
  src: string;
  alt: string;
  width: number;
  height: number;
  /** Media condition for srcset, for example "(max-width: 600px) 100vw, 320px". */
  sizes?: string;
  /** Above-the-fold images skip lazy loading. */
  priority?: boolean;
};

/** Supabase public storage supports on-the-fly resizing; browsers get WebP automatically. */
function renderUrl(src: string, width: number): string | null {
  if (!/^https?:\/\//i.test(src) || !src.includes('/storage/v1/object/public/')) return null;
  try {
    const url = new URL(src);
    url.pathname = url.pathname.replace('/storage/v1/object/public/', '/storage/v1/render/image/public/');
    url.searchParams.set('width', String(Math.min(2500, Math.round(width))));
    url.searchParams.set('quality', '82');
    url.searchParams.set('resize', 'contain');
    return url.toString();
  } catch {
    return null;
  }
}

export function TenantImage({ src, alt, width, height, sizes = '100vw', priority = false, className, style, ...rest }: Props) {
  const srcSet = [...new Set([width, width * 2, width * 3].map((w) => Math.min(2500, Math.round(w))))]
    .map((w) => {
      const url = renderUrl(src, w);
      return url ? `${url} ${w}w` : '';
    })
    .filter(Boolean)
    .join(', ');

  return (
    <picture style={{ display: 'contents' }}>
      {srcSet && <source type="image/webp" srcSet={srcSet} sizes={sizes} />}
      <img
        {...rest}
        src={src}
        alt={alt}
        width={width}
        height={height}
        className={className}
        style={style}
        loading={priority ? 'eager' : 'lazy'}
        decoding="async"
      />
    </picture>
  );
}
