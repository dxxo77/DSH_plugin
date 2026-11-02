window.__ModuleLoader__.load({
  id: '@local/quota-balance',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    /** Route registered by the Host half of this bundle. */
    const ENDPOINT = '/plugin/quota-balance/status';

    /** Balance moves slowly; one minute keeps the chip current without polling pressure. */
    const REFRESH_MS = 60_000;

    const SYMBOLS = { CNY: '¥', USD: '$' };

    /** @param {{ currency: string, balance: string }} wallet */
    function amount(wallet) {
      const symbol = SYMBOLS[wallet.currency] ?? `${wallet.currency} `;
      const value = Number.parseFloat(wallet.balance);
      return Number.isFinite(value) ? `${symbol}${value.toFixed(2)}` : `${symbol}${wallet.balance}`;
    }

    /**
     * The account reports one wallet per currency bucket (normal and granted
     * balances are separate buckets of the same money), so the chip shows one
     * total per currency instead of a list of partial balances.
     *
     * @param {{ currency: string, balance: string }[]} wallets
     */
    function summarize(wallets) {
      const totals = new Map();
      for (const wallet of wallets) {
        const value = Number.parseFloat(wallet.balance);
        if (!Number.isFinite(value)) continue;
        totals.set(wallet.currency, (totals.get(wallet.currency) ?? 0) + value);
      }
      return [...totals].map(([currency, value]) => {
        const symbol = SYMBOLS[currency] ?? `${currency} `;
        return `${symbol}${value.toFixed(2)}`;
      });
    }

    /** "刚刚" / "3 分钟前" — coarse on purpose, the chip refreshes every minute. */
    function ago(at, t) {
      const seconds = Math.max(0, Math.round((Date.now() - at) / 1000));
      if (seconds < 10) return t('justNow');
      if (seconds < 60) return `${seconds} ${t('secondsAgo')}`;
      return `${Math.round(seconds / 60)} ${t('minutesAgo')}`;
    }

    const CHIP = {
      display: 'inline-flex',
      alignItems: 'center',
      padding: 0,
      border: 'none',
      background: 'transparent',
      fontFamily: 'inherit',
      fontSize: 12,
      fontWeight: 400,
      lineHeight: '18px',
      letterSpacing: 'normal',
      color: 'var(--dsw-alias-label-tertiary)',
      whiteSpace: 'nowrap',
      cursor: 'pointer',
    };

    /**
     * The panel is mounted on `document.body`, outside the app's React tree, so
     * its look lives in a stylesheet keyed to a stable id instead of inheriting
     * the composer's typography.
     *
     * Surface colours copy the app's own popover material, now told apart from
     * it by measurement: the official popover sits at roughly 42% of the glass
     * colour plus a wide blur, i.e. the wallpaper stays visible instead of a
     * solid card. `--we-glass-color` / `--we-saturate` come from the wallpaper
     * theme; `--dsw-alias-bg-base` is literally `transparent` under it, which is
     * why a hard-coded host surface left the panel see-through. The fallbacks
     * keep a plain dark panel when the wallpaper plugin is off.
     */
    const PANEL_CSS = `
.quota-balance-card{box-sizing:border-box;width:232px;max-height:320px;overflow-y:auto;display:flex;flex-direction:column;gap:7px;padding:12px 14px;border-radius:12px;background:var(--dsw-alias-bg-overlay, #26272b);-webkit-backdrop-filter:blur(var(--we-blur, 13px)) saturate(var(--we-saturate, 1.3));backdrop-filter:blur(var(--we-blur, 13px)) saturate(var(--we-saturate, 1.3));border:1px solid var(--dsw-alias-border-l2, rgba(255,255,255,.12));box-shadow:0 12px 32px rgba(0,0,0,.28);font-family:inherit;font-size:12px;line-height:18px;color:var(--dsw-alias-label-primary, #e9e9ec);text-align:left}
.quota-balance-head{display:flex;justify-content:space-between;align-items:baseline;gap:12px;color:var(--dsw-alias-label-tertiary, #a9a9b4)}
.quota-balance-head b{color:var(--dsw-alias-label-primary, #e9e9ec);font-weight:500}
.quota-balance-row{display:flex;justify-content:space-between;align-items:baseline;gap:12px}
.quota-balance-row span:first-child{color:var(--dsw-alias-label-tertiary, #a9a9b4)}
.quota-balance-divider{height:1px;background:rgba(180,180,180,calc(var(--we-border-alpha, 0.3) * 0.8));margin:2px 0}
.quota-balance-actions{display:flex;align-items:center;gap:10px;margin-top:2px}
.quota-balance-refresh{font-family:inherit;font-size:12px;padding:3px 8px;border-radius:6px;border:1px solid rgba(180,180,180,calc(var(--we-border-alpha, 0.35) * 1.3));background:transparent;color:var(--dsw-alias-label-secondary, #c9c9d1);cursor:pointer}
.quota-balance-refresh:hover{background:var(--dsw-alias-bg-overlay, rgba(255,255,255,.08))}
.quota-balance-link{font-size:12px;color:var(--we-accent, var(--dsw-alias-brand-primary, #7db3ff));text-decoration:none}
`;

    /**
     * Install the panel stylesheet once per page, but always refresh its text:
     * a hot reload keeps the old `<style>` node alive, so returning early here
     * would leave the page running the first version of these rules forever.
     */
    function injectPanelCss() {
      let style = document.getElementById('quota-balance-css');
      if (style === null) {
        style = document.createElement('style');
        style.id = 'quota-balance-css';
        document.head.append(style);
      }
      if (style.textContent !== PANEL_CSS) style.textContent = PANEL_CSS;
    }

    /** Small DOM builder for the body-level panel. */
    function el(tag, className, children) {
      const node = document.createElement(tag);
      if (className !== undefined) node.className = className;
      for (const child of children ?? []) node.append(child);
      return node;
    }

    function text(value) {
      return document.createTextNode(value);
    }

    /**
     * The chip sits beside the shipped usage cells, so it copies their caption
     * typography through inherited font metrics and theme label tokens. Clicking
     * it opens a small panel instead of leaving the page.
     */
    function BalanceChip({ t }) {
      const [state, setState] = React.useState(null);
      const [open, setOpen] = React.useState(false);
      const [pos, setPos] = React.useState(null);
      const buttonRef = React.useRef(null);
      const wrapRef = React.useRef(null);
      const panelRef = React.useRef(null);

      const load = React.useCallback(() => {
        fetch(ENDPOINT, { cache: 'no-store', headers: { accept: 'application/json' } })
          .then((response) => (response.ok ? response.json() : null))
          .then((body) => {
            if (body === null || body.ok !== true) return;
            setState({ data: body, at: Date.now() });
          })
          .catch(() => {});
      }, []);

      React.useEffect(() => {
        load();
        const timer = setInterval(load, REFRESH_MS);
        const onVisibility = () => {
          if (document.visibilityState === 'visible') load();
        };
        document.addEventListener('visibilitychange', onVisibility);
        return () => {
          clearInterval(timer);
          document.removeEventListener('visibilitychange', onVisibility);
        };
      }, [load]);

      /** Anchor the panel to the chip itself so it overlays the composer card. */
      React.useEffect(() => {
        if (!open || buttonRef.current === null) return undefined;
        const place = () => {
          const button = buttonRef.current;
          if (button === null) return;
          const chip = button.getBoundingClientRect();
          const left = Math.max(8, Math.min(chip.left, window.innerWidth - 244));
          setPos({ left, bottom: window.innerHeight - chip.top + 6 });
        };
        place();
        window.addEventListener('resize', place);
        return () => window.removeEventListener('resize', place);
      }, [open]);


      /**
       * The panel is mounted on `document.body`: the composer card paints above
       * its own dock and clips inside a stacking context, so anything rendered
       * from the slot would be covered or cut off.
       */
      React.useEffect(() => {
        if (!open || pos === null) return undefined;
        injectPanelCss();
        // A reload can leave a previous panel behind; keep exactly one on the page.
        for (const stale of document.querySelectorAll('[data-quota-panel]')) stale.remove();
        const host = el('div');
        host.dataset.quotaPanel = '1';
        Object.assign(host.style, {
          position: 'fixed',
          left: `${pos.left}px`,
          bottom: `${pos.bottom}px`,
          zIndex: '2147483647',
        });
        document.body.append(host);
        panelRef.current = host;

        const onPointer = (event) => {
          if (wrapRef.current?.contains(event.target)) return;
          if (host.contains(event.target)) return;
          setOpen(false);
        };
        const onKey = (event) => {
          if (event.key === 'Escape') setOpen(false);
        };
        document.addEventListener('pointerdown', onPointer);
        document.addEventListener('keydown', onKey);
        return () => {
          document.removeEventListener('pointerdown', onPointer);
          document.removeEventListener('keydown', onKey);
          panelRef.current = null;
          host.remove();
        };
      }, [open, pos]);

      /** Paint the card from the freshest data; re-runs after every refresh. */
      React.useEffect(() => {
        const host = panelRef.current;
        if (host === null || state === null) return;
        const data = state.data;
        const wallets = data.wallets ?? [];
        const normalList = data.normal ?? [];
        const bonusList = data.bonus ?? [];
        const card = el('div', 'quota-balance-card');
        card.setAttribute('aria-label', t('label'));

        const head = el('div', 'quota-balance-head', [
          el('span', undefined, [text(t('label'))]),
          el('b', undefined, [text(summarize(wallets).join(' · '))]),
        ]);
        card.append(head);
        card.append(el('div', 'quota-balance-divider'));

        const row = (label, value) => el('div', 'quota-balance-row', [
          el('span', undefined, [text(label)]),
          el('span', undefined, [text(value)]),
        ]);

        if (normalList.length > 0 && bonusList.length > 0) {
          card.append(row(t('normal'), normalList.map(amount).join(' · ')));
          card.append(row(t('bonus'), bonusList.map(amount).join(' · ')));
        } else {
          wallets.forEach((wallet, index) => {
            card.append(row(`${t('wallet')} ${index + 1}`, amount(wallet)));
          });
        }
        card.append(row(t('updated'), ago(state.at, t)));

        const actions = el('div', 'quota-balance-actions');
        const refresh = el('button', 'quota-balance-refresh', [text(t('refresh'))]);
        refresh.type = 'button';
        refresh.addEventListener('click', () => load());
        actions.append(refresh);
        if (data.links?.topUpUrl) {
          const topUp = el('a', 'quota-balance-link', [text(t('topUp'))]);
          topUp.href = data.links.topUpUrl;
          topUp.target = '_blank';
          topUp.rel = 'noreferrer';
          actions.append(topUp);
        }
        card.append(actions);

        host.textContent = '';
        host.append(card);
      }, [open, pos, state, t]);

      const wallets = state?.data?.wallets ?? [];
      const totals = summarize(wallets);
      if (totals.length === 0) return null;
      const label = totals.join(' · ');

      return h('span', { ref: wrapRef, style: { display: 'inline-flex' } },
        h('button', {
          ref: buttonRef,
          type: 'button',
          onClick: () => setOpen((value) => !value),
          'aria-haspopup': 'dialog',
          'aria-expanded': open,
          'aria-label': `${t('label')}：${label}`,
          title: t('label'),
          style: CHIP,
        }, label));
    }

    const ZH = {
      label: '账户余额',
      wallet: '钱包',
      normal: '普通余额',
      bonus: '赠送额度',
      updated: '更新于',
      refresh: '刷新',
      topUp: '去充值',
      justNow: '刚刚',
      secondsAgo: '秒前',
      minutesAgo: '分钟前',
    };
    const EN = {
      label: 'Account balance',
      wallet: 'Wallet',
      normal: 'Balance',
      bonus: 'Bonus credit',
      updated: 'Updated',
      refresh: 'Refresh',
      topUp: 'Top up',
      justNow: 'just now',
      secondsAgo: 's ago',
      minutesAgo: 'min ago',
    };

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        /** Register the dictionary under the locale the user actually runs. */
        const disposers = new Map();
        const ensure = (id) => {
          if (typeof id !== 'string' || id === '' || disposers.has(id)) return;
          const dict = id.toLowerCase().startsWith('zh') ? ZH : EN;
          try {
            disposers.set(id, ctx.locale.register('quota-balance', id, dict));
          } catch {
            disposers.set(id, () => {});
          }
        };
        ensure(ctx.locale.getSnapshot().active);
        ensure('zh-CN');
        ensure('en-US');
        ctx.on('locale/change', () => ensure(ctx.locale.getSnapshot().active));
        ctx.effect(() => () => {
          for (const dispose of disposers.values()) dispose();
          disposers.clear();
        });

        ctx.slots.inject('conversation.composer.dock', () => {
          const t = ctx.locale.bind('quota-balance');
          return ctx.slots.register({
            name: 'conversation.composer.dock',
            id: 'quota-balance',
            order: -10,
          }, () => h(BalanceChip, { t }));
        });
      },
    };
  },
});
