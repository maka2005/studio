import './ScreenshotFrame.scss';

interface ScreenshotFrameProps {
  label: string;
  src?: string;
  ratio?: string;
}

/** Рамка браузера для скриншота интерфейса. Без src показывает место под реальный скриншот. */
export function ScreenshotFrame({ label, src, ratio = '16 / 10' }: ScreenshotFrameProps) {
  return (
    <figure className="shot" style={{ aspectRatio: ratio }}>
      <div className="shot__bar" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      {src ? (
        <img src={src} alt={label} loading="lazy" />
      ) : (
        <div className="shot__placeholder">
          <span>Место для скриншота</span>
          <small>{label}</small>
        </div>
      )}
    </figure>
  );
}
