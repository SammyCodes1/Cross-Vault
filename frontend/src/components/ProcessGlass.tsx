import React, { useEffect } from 'react';

export interface ProcessStep {
  id: string;
  label: string;
  hint: string;
}

interface ProcessGlassProps {
  open: boolean;
  title: string;
  steps: ProcessStep[];
  currentId: string;
  status: 'running' | 'success' | 'error';
  message: string;
  error?: string | null;
  onDismiss: () => void;
}

export const ProcessGlass: React.FC<ProcessGlassProps> = ({
  open,
  title,
  steps,
  currentId,
  status,
  message,
  error,
  onDismiss,
}) => {
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!open) return null;

  const currentIndex = steps.findIndex((step) => step.id === currentId);

  return (
    <div className="glass-scrim" role="dialog" aria-modal="true" aria-labelledby="glass-title">
      <div className="glass-sheet">
        <div className="glass-handle" aria-hidden="true" />
        <header className="glass-head">
          <p className="glass-kicker">CrossVault</p>
          <h2 id="glass-title">{title}</h2>
          <p className="glass-message">{status === 'error' ? error || message : message}</p>
        </header>

        <ol className="glass-steps">
          {steps.map((step, index) => {
            const done =
              status === 'success' ||
              (currentIndex >= 0 && index < currentIndex) ||
              (status === 'error' && index < currentIndex);
            const active =
              status !== 'success' &&
              ((currentId === 'error' && index === Math.max(currentIndex, 0)) ||
                step.id === currentId);
            const failed = status === 'error' && active;
            return (
              <li
                key={step.id}
                className={`glass-step${done ? ' is-done' : ''}${active ? ' is-active' : ''}${failed ? ' is-failed' : ''}`}
              >
                <span className="glass-glyph" aria-hidden="true">
                  {failed ? <span className="glass-x" /> : done ? <span className="glass-check" /> : active ? <span className="glass-spin" /> : <span className="glass-dot" />}
                </span>
                <span>
                  <strong>{step.label}</strong>
                  <span className="glass-hint">{step.hint}</span>
                </span>
              </li>
            );
          })}
        </ol>

        {(status === 'success' || status === 'error') && (
          <div className="glass-actions">
            <button type="button" className="btn-primary btn-block" onClick={onDismiss}>
              {status === 'success' ? 'Done' : 'Close'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
