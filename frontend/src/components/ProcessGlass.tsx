import React, { useEffect, useState } from 'react';

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
  actionButton?: {
    label: string;
    onClick: () => void;
    disabled?: boolean;
  } | null;
}

const SUBS: Record<string, string[]> = {
  minting: ['faucet call', 'waiting on Sepolia', 'balance update'],
  approving: ['checking allowance', 'exact amount', 'confirm in wallet'],
  locking: ['escrow transfer', 'reading lock id', 'Sepolia confirmed'],
  attesting: ['watching the block', 'USC prover', 'continuity proof'],
  verifying: ['openPosition', 'mint tvUSD', 'position opened'],
  switching: ['Creditcoin 3', 'wallet confirm', 'network ready'],
  repay: ['burn tvUSD', 'mark repaid', 'position closed'],
  switching_sepolia: ['switch to Sepolia', 'wallet prompt', 'Ethereum testnet'],
  unlocking: ['CollateralLock.unlock', 'reclaiming mWETH', 'funds to wallet'],
};

export const ProcessGlass: React.FC<ProcessGlassProps> = ({
  open,
  title,
  steps,
  currentId,
  status,
  message,
  error,
  onDismiss,
  actionButton,
}) => {
  const currentIndex = Math.max(0, steps.findIndex((step) => step.id === currentId));
  const subs = SUBS[currentId] || SUBS.attesting;
  const [sub, setSub] = useState(0);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  useEffect(() => {
    setSub(0);
    if (!open || status !== 'running') return;
    const id = window.setInterval(() => {
      setSub((n) => (n + 1) % subs.length);
    }, 900);
    return () => window.clearInterval(id);
  }, [open, status, currentId, subs.length]);

  if (!open) return null;

  const progress =
    status === 'success'
      ? 100
      : ((currentIndex + (sub + 1) / subs.length) / Math.max(steps.length, 1)) * 100;
  const stage =
    status === 'success' || currentId === 'verifying' || currentId === 'repay'
      ? 'publish'
      : currentId === 'attesting'
        ? 'synth'
        : 'radar';

  return (
    <div className="xr-scrim" role="presentation">
      <div
        className={`xr-bezel${status === 'running' ? ' is-live' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="xr-title"
        aria-busy={status === 'running'}
      >
        <div className="xr-well">
          <header className="xr-head">
            <p className="xr-kicker">CrossVault</p>
            <h2 id="xr-title">{title}</h2>
            <p className="xr-message">{status === 'error' ? error || message : message}</p>
          </header>

          {status === 'running' && (
            <div className="xr-stage" aria-hidden="true">
              {stage === 'radar' ? <RadarStage /> : null}
              {stage === 'synth' ? <SynthStage /> : null}
              {stage === 'publish' ? <PublishStage /> : null}
            </div>
          )}

          {status === 'running' && (
            <p className="xr-sub" aria-live="polite">
              {subs[sub]}
            </p>
          )}

          <div className="xr-bar" aria-hidden="true">
            <span className="xr-bar-fill" style={{ width: `${Math.min(96, progress)}%` }} />
          </div>

          <ol className="xr-steps">
            {steps.map((step, index) => {
              const done =
                status === 'success' ||
                (currentIndex >= 0 && index < currentIndex);
              const active = status !== 'success' && step.id === currentId;
              const failed = status === 'error' && active;
              return (
                <li
                  key={step.id}
                  className={`xr-step${done ? ' is-done' : ''}${active ? ' is-active' : ''}${failed ? ' is-failed' : ''}`}
                >
                  <span className="xr-mark" aria-hidden="true">
                    {failed ? 'x' : done ? 'ok' : active ? 'go' : ''}
                  </span>
                  <span>
                    <strong>{step.label}</strong>
                    <span className="xr-hint">{step.hint}</span>
                  </span>
                </li>
              );
            })}
          </ol>

          {(status === 'success' || status === 'error') && (
            <div className="xr-actions">
              {actionButton && status === 'success' ? (
                <>
                  <button
                    type="button"
                    className="btn-primary btn-block"
                    onClick={actionButton.onClick}
                    disabled={actionButton.disabled}
                  >
                    {actionButton.label}
                  </button>
                  <button type="button" className="btn-ghost btn-block" onClick={onDismiss}>
                    Close
                  </button>
                </>
              ) : (
                <button type="button" className="btn-primary btn-block" onClick={onDismiss}>
                  {status === 'success' ? 'Done' : 'Close'}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

function RadarStage() {
  return (
    <div className="xr-radar">
      <span className="xr-ring xr-ring-a" />
      <span className="xr-ring xr-ring-b" />
      <span className="xr-ring xr-ring-c" />
      <span className="xr-hair xr-hair-h" />
      <span className="xr-hair xr-hair-v" />
      <span className="xr-sweep" />
      <span className="xr-blip" style={{ left: '68%', top: '28%' }} />
      <span className="xr-blip" style={{ left: '30%', top: '62%', animationDelay: '0.35s' }} />
      <span className="xr-blip" style={{ left: '74%', top: '70%', animationDelay: '0.7s' }} />
      <span className="xr-bit" style={{ left: '10%', top: '18%' }}>SEP</span>
      <span className="xr-bit" style={{ left: '78%', top: '16%', animationDelay: '0.4s' }}>LOCK</span>
      <span className="xr-bit" style={{ left: '8%', top: '80%', animationDelay: '0.8s' }}>CC3</span>
      <span className="xr-bit" style={{ left: '76%', top: '78%', animationDelay: '1.1s' }}>PYTH</span>
    </div>
  );
}

function SynthStage() {
  return (
    <div className="xr-synth">
      <div className="xr-pad">
        <span className="xr-pad-rule" />
        <span className="xr-write" />
        <span className="xr-write" style={{ animationDelay: '0.18s' }} />
        <span className="xr-write" style={{ animationDelay: '0.36s' }} />
        <span className="xr-write is-short" style={{ animationDelay: '0.54s' }} />
        <div className="xr-flags">
          <span>lock</span>
          <span>proof</span>
          <span>vault</span>
        </div>
      </div>
    </div>
  );
}

function PublishStage() {
  return (
    <div className="xr-publish">
      <span className="xr-pulse" />
      <span className="xr-pulse" style={{ animationDelay: '0.4s' }} />
      <span className="xr-pulse" style={{ animationDelay: '0.8s' }} />
      <span className="xr-seal">tv</span>
    </div>
  );
}
