import { css } from 'lit';

/** Shared instrument-panel styling: rack modules, silkscreen labels, faders, chips. */
export const panelStyles = css`
  :host {
    font-family: var(--font-mono);
    color: var(--ink);
    font-size: 12px;
  }

  .module {
    background: linear-gradient(180deg, var(--panel-2), var(--panel));
    border: 1px solid var(--line);
    border-radius: var(--radius);
    box-shadow: inset 0 1px 0 rgba(125, 255, 155, 0.06), 0 8px 24px -18px #000;
  }

  .module + .module {
    margin-top: 10px;
  }

  .module-head {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 10px;
    border-bottom: 1px solid var(--line);
    background: linear-gradient(180deg, rgba(125, 255, 155, 0.05), transparent);
  }

  .module-head h2 {
    margin: 0;
    font-family: var(--font-display);
    font-variation-settings: 'wdth' 118, 'wght' 620;
    font-size: 11px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--ink);
  }

  .idx {
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--phosphor);
    background: rgba(125, 255, 155, 0.08);
    border: 1px solid var(--line-strong);
    border-radius: 2px;
    padding: 0 4px;
    letter-spacing: 0.08em;
  }

  .module-head .spacer {
    flex: 1;
  }

  .fold {
    appearance: none;
    border: 0;
    background: transparent;
    color: var(--ink-dim);
    padding: 2px 4px;
    font-size: 10px;
    line-height: 1;
    cursor: pointer;
    box-shadow: none;
    transition: transform 0.18s ease, color 0.15s;
  }

  .fold:hover {
    color: var(--phosphor);
    box-shadow: none;
  }

  .fold[aria-expanded='false'] {
    transform: rotate(-90deg);
  }

  .module-body {
    padding: 10px;
    display: flex;
    flex-direction: column;
    gap: 9px;
  }

  label,
  .label {
    display: block;
    font-family: var(--font-display);
    font-variation-settings: 'wdth' 112, 'wght' 560;
    font-size: 9.5px;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--ink-dim);
    margin-bottom: 4px;
  }

  .row {
    display: flex;
    gap: 8px;
  }

  .row > * {
    flex: 1;
    min-width: 0;
  }

  select,
  input[type='text'],
  input[type='number'] {
    width: 100%;
    appearance: none;
    background: var(--void-2);
    color: var(--ink);
    border: 1px solid var(--line);
    border-radius: 2px;
    font-family: var(--font-mono);
    font-size: 12px;
    padding: 5px 7px;
    transition: border-color 0.15s, box-shadow 0.15s;
  }

  select {
    padding-right: 22px;
    background-image: linear-gradient(45deg, transparent 50%, var(--phosphor-dim) 50%),
      linear-gradient(135deg, var(--phosphor-dim) 50%, transparent 50%);
    background-position: calc(100% - 12px) 12px, calc(100% - 8px) 12px;
    background-size: 4px 4px, 4px 4px;
    background-repeat: no-repeat;
    cursor: pointer;
  }

  select:hover,
  input:hover {
    border-color: var(--line-strong);
  }

  select:focus-visible,
  input:focus-visible,
  button:focus-visible {
    outline: none;
    border-color: var(--phosphor);
    box-shadow: 0 0 0 1px rgba(125, 255, 155, 0.35);
  }

  option {
    background: var(--panel);
    color: var(--ink);
  }

  button {
    appearance: none;
    font-family: var(--font-display);
    font-variation-settings: 'wdth' 110, 'wght' 600;
    font-size: 10px;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--ink);
    background: linear-gradient(180deg, var(--panel-3), var(--panel));
    border: 1px solid var(--line);
    border-radius: 2px;
    padding: 6px 9px;
    cursor: pointer;
    /* never break a label mid-word: toolbars wrap between buttons instead */
    white-space: nowrap;
    transition: color 0.15s, border-color 0.15s, background 0.15s, box-shadow 0.15s;
  }

  /* Narrow screens: keep only the leading icon, the accessible name lives on
     aria-label/title so the control stays identifiable. */
  .btn-label {
    margin-left: 4px;
  }

  @media (max-width: 700px) {
    .btn-label {
      display: none;
    }

    button {
      padding: 6px 7px;
      letter-spacing: 0.08em;
    }
  }

  button:hover {
    color: var(--phosphor);
    border-color: var(--line-strong);
    box-shadow: var(--glow);
  }

  button:active {
    transform: translateY(1px);
  }

  button[disabled] {
    opacity: 0.35;
    cursor: not-allowed;
    box-shadow: none;
  }

  button.primary {
    color: #04120a;
    background: linear-gradient(180deg, var(--phosphor), #4fc97a);
    border-color: var(--phosphor);
  }

  button.primary:hover {
    color: #04120a;
    filter: brightness(1.08);
  }

  button.ghost {
    background: transparent;
  }

  button.danger:hover {
    color: var(--danger);
    border-color: rgba(255, 107, 95, 0.5);
    box-shadow: 0 0 18px -6px rgba(255, 107, 95, 0.6);
  }

  .seg {
    display: flex;
    border: 1px solid var(--line);
    border-radius: 2px;
    overflow: hidden;
  }

  .seg button {
    flex: 1;
    border: 0;
    border-radius: 0;
    background: transparent;
    box-shadow: none;
  }

  .seg button + button {
    border-left: 1px solid var(--line);
  }

  .seg button[aria-pressed='true'] {
    background: rgba(125, 255, 155, 0.14);
    color: var(--phosphor);
    text-shadow: 0 0 12px rgba(125, 255, 155, 0.6);
  }

  input[type='range'] {
    appearance: none;
    width: 100%;
    height: 18px;
    background: transparent;
    cursor: ew-resize;
  }

  input[type='range']::-webkit-slider-runnable-track {
    height: 3px;
    background: linear-gradient(90deg, var(--phosphor-dim), rgba(125, 255, 155, 0.12));
    border-radius: 2px;
  }

  input[type='range']::-webkit-slider-thumb {
    appearance: none;
    width: 9px;
    height: 16px;
    margin-top: -6.5px;
    border-radius: 1px;
    background: linear-gradient(180deg, #eaffef, var(--phosphor));
    box-shadow: 0 0 10px rgba(125, 255, 155, 0.7);
    border: 1px solid #0b1a12;
  }

  input[type='range']::-moz-range-track {
    height: 3px;
    background: linear-gradient(90deg, var(--phosphor-dim), rgba(125, 255, 155, 0.12));
    border-radius: 2px;
  }

  input[type='range']::-moz-range-thumb {
    width: 9px;
    height: 16px;
    border-radius: 1px;
    background: linear-gradient(180deg, #eaffef, var(--phosphor));
    border: 1px solid #0b1a12;
    box-shadow: 0 0 10px rgba(125, 255, 155, 0.7);
  }

  .readout {
    font-variant-numeric: tabular-nums;
    color: var(--amber);
    font-size: 11px;
  }

  .chip {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-size: 10px;
    letter-spacing: 0.06em;
    color: var(--ink-dim);
    background: rgba(0, 0, 0, 0.35);
    border: 1px solid var(--line);
    border-radius: 2px;
    padding: 2px 6px;
    font-variant-numeric: tabular-nums;
  }

  .chip b {
    color: var(--phosphor);
    font-weight: 500;
  }

  .hint {
    color: var(--ink-faint);
    font-size: 10.5px;
    line-height: 1.45;
  }

  .divider {
    height: 1px;
    background: var(--line);
    margin: 2px 0;
  }
`;

/** Staggered boot reveal used by the top-level panels. */
export const bootStyles = css`
  @keyframes boot-in {
    from {
      opacity: 0;
      transform: translateY(6px);
    }
    to {
      opacity: 1;
      transform: none;
    }
  }

  .boot {
    animation: boot-in 0.45s cubic-bezier(0.2, 0.8, 0.2, 1) backwards;
  }
`;
