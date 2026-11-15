import './ScreenshotFrame.scss';

interface ScreenshotFrameProps {
  label: string;
  src?: string;
  ratio?: string;
}

/** Рамка браузера. Без src рисует схематичный макет интерфейса; реальный скриншот подключается через src. */
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
        <div className="shot__mock" role="img" aria-label={label}>
          <div className="shot__side" aria-hidden="true">
            <i /><i /><i /><i /><i />
          </div>
          <div className="shot__main" aria-hidden="true">
            <div className="shot__stats"><b /><b /><b /></div>
            <div className="shot__rows">
              <u /><u /><u /><u /><u />
            </div>
          </div>
        </div>
      )}
    </figure>
  );
}
