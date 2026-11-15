export function BrandMark({ size = 24, color = '#176BFF', className }: { size?: number; color?: string; className?: string }) {
  return (
    <svg
      className={className}
      viewBox="10 16 191 148"
      width={Math.round((size * 191) / 148)}
      height={size}
      aria-hidden="true"
      focusable="false"
    >
      <path fill={color} d="M30 18h112c34 0 57 21 57 51 0 25-16 43-42 49l39 44h-69l-42-49h-9l-43 49H12l66-76h64c12 0 19-6 19-16s-7-16-19-16H62L30 18z" />
    </svg>
  );
}
