import type { ReactNode } from 'react';
import type { ShellMode } from './shell-mode';

export interface DeviceFrameProps {
  readonly mode: ShellMode;
  readonly focus: boolean;
  readonly children: ReactNode;
}

/**
 * Mark I as the application perimeter: a cream frame that fills the
 * available viewport with a black glass screen inside. Everything visible
 * is ordinary HTML; the frame is CSS only.
 */
export function DeviceFrame({ mode, focus, children }: DeviceFrameProps) {
  return (
    <div className="markov-frame" data-mode={mode} data-focus={focus ? 'true' : 'false'}>
      <span className="markov-frame__sensor" aria-hidden="true" />
      <div className="markov-screen">{children}</div>
      <span className="markov-frame__wordmark" aria-hidden="true">
        markov
      </span>
    </div>
  );
}
