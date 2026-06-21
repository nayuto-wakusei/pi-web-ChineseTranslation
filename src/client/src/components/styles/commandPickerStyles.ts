import { css } from "lit";

export const commandPickerStyles = css`
  :host { position: fixed; inset: 0; z-index: 10; color: var(--pi-text); font: 14px system-ui, sans-serif; }
  .backdrop { display: grid; place-items: center; width: 100%; height: 100%; background: var(--pi-overlay); }
  section { width: min(720px, calc(100vw - 40px)); max-height: min(640px, calc(100vh - 40px)); display: flex; flex-direction: column; border: 1px solid var(--pi-border); border-radius: 12px; background: var(--pi-bg); box-shadow: 0 20px 60px var(--pi-shadow-strong); overflow: hidden; }
  header { display: flex; align-items: center; justify-content: space-between; padding: 12px; border-bottom: 1px solid var(--pi-border); }
  .options { min-height: 0; overflow: auto; outline: none; }
  button { border: 0; background: transparent; color: var(--pi-text); cursor: pointer; }
  header button { font-size: 20px; color: var(--pi-muted); }
  input { margin: 10px 12px; border: 1px solid var(--pi-border); border-radius: 8px; background: var(--pi-bg); color: var(--pi-text); font: 14px system-ui, sans-serif; padding: 8px 10px; outline: none; }
  input:focus { border-color: var(--pi-accent); }
  .options button { display: block; width: 100%; padding: 10px 12px; border-bottom: 1px solid var(--pi-border-muted); text-align: left; }
  .options button.selected, .options button:hover { background: var(--pi-selection-bg); }
  small { display: block; margin-top: 4px; color: var(--pi-muted); }
  .empty { padding: 24px; color: var(--pi-muted); text-align: center; }
`;
