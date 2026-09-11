import React from 'react';
import { CONTRACT_ADDRESSES } from './contracts/config';
import './App.css';
import './Landing.css';

const Landing: React.FC = () => {
  return (
    <div className="lp">
      <a className="skip-link" href="#main">
        Skip to content
      </a>

      <header className="lp-nav">
        <a className="brand" href="/">
          <svg className="vault-mark" viewBox="0 0 32 32" aria-hidden="true">
            <rect x="7" y="7" width="18" height="18" rx="2" fill="none" stroke="#c8e06a" strokeWidth="1.6" />
            <rect x="12" y="12" width="8" height="8" fill="#c8e06a" />
          </svg>
          <div>
            <h1>CrossVault</h1>
            <span className="subtitle">Sepolia to Creditcoin</span>
          </div>
        </a>
        <a className="btn-outline" href="/app">
          Console
        </a>
      </header>

      <main id="main">
        <section
          className="lp-hero"
          style={{ backgroundImage: 'url(/landing/hero.jpg)' }}
          aria-label="CrossVault"
        >
          <div className="lp-hero-copy">
            <h1>Lock on Sepolia. Borrow on Creditcoin.</h1>
            <p>
              CrossVault proves a Sepolia collateral lock with Attestcoin, then mints tvUSD
              against live Pyth ETH/USD.
            </p>
            <div className="lp-hero-actions">
              <a className="btn-primary" href="/app">
                Open vault
              </a>
              <a className="lp-link" href="#how">
                How it works
              </a>
            </div>
          </div>
        </section>

        <section className="lp-section" id="how">
          <div className="lp-split">
            <div className="lp-copy">
              <p className="lp-kicker">Mechanism</p>
              <h2>Three steps. Two chains. One proof.</h2>
              <div className="lp-steps">
                <div className="lp-step">
                  <span className="lp-step-n">01</span>
                  <div>
                    <strong>Lock mWETH on Sepolia</strong>
                    <span>CollateralLock escrows the token and emits a lock id.</span>
                  </div>
                </div>
                <div className="lp-step">
                  <span className="lp-step-n">02</span>
                  <div>
                    <strong>Attestcoin verifies the lock</strong>
                    <span>Creditcoin checks inclusion of that Sepolia transaction.</span>
                  </div>
                </div>
                <div className="lp-step">
                  <span className="lp-step-n">03</span>
                  <div>
                    <strong>Borrow tvUSD</strong>
                    <span>CrossVault mints debt at a 150% collateral ratio.</span>
                  </div>
                </div>
              </div>
            </div>
            <figure className="lp-figure">
              <img src="/landing/lock.jpg" alt="Steel lock on a carbon plate" />
            </figure>
          </div>
        </section>

        <section className="lp-section">
          <div className="lp-split lp-split-invert">
            <div className="lp-copy">
              <p className="lp-kicker">Oracle</p>
              <h2>Pyth ETH/USD is the vault price.</h2>
              <p>
                The console attests the latest Sepolia PriceFeedUpdate. There is no mock
                feed in the product path.
              </p>
            </div>
            <figure className="lp-figure">
              <img src="/landing/ticker.jpg" alt="Dim lime ticker board" />
            </figure>
          </div>
        </section>

        <section className="lp-section lp-stack">
          <div className="lp-copy">
            <h2>Escrow on Sepolia. Debt on Creditcoin.</h2>
            <p>
              Collateral never leaves Ethereum Sepolia. tvUSD lives on Creditcoin 3.
              The two sides stay linked by a verified lock event, not a bridge of funds.
            </p>
          </div>
          <figure className="lp-figure lp-figure-wide">
            <img src="/landing/plates.jpg" alt="Two steel plates on a vault wall" />
          </figure>
        </section>

        <section className="lp-section">
          <div className="lp-split lp-split-invert">
            <div className="lp-copy">
              <h2>Escrow does not reverse.</h2>
              <p>
                Sepolia collateral stays locked. Attestcoin proofs do not send it back.
                Repay burns tvUSD and closes the Creditcoin position. Faucet mints are
                capped at 10 mWETH per address.
              </p>
            </div>
            <figure className="lp-figure">
              <img src="/landing/box.jpg" alt="Sealed steel deposit box" />
            </figure>
          </div>
        </section>

        <section
          className="lp-close"
          style={{ backgroundImage: 'url(/landing/corridor.jpg)' }}
        >
          <div className="lp-close-copy">
            <h2>Open the vault.</h2>
            <p>Connect a wallet, lock collateral, and borrow against a live Pyth price.</p>
            <a className="btn-primary" href="/app">
              Open vault
            </a>
          </div>
        </section>
      </main>

      <footer className="lp-foot">
        <span>
          CollateralLock <code>{CONTRACT_ADDRESSES.COLLATERAL_LOCK}</code>
        </span>
        <span>
          CrossVault <code>{CONTRACT_ADDRESSES.CROSS_VAULT}</code>
        </span>
        <span>
          <a href="https://github.com/SammyCodes1/Cross-Vault">GitHub</a>
        </span>
      </footer>
    </div>
  );
};

export default Landing;
