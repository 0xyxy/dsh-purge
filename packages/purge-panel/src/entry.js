// UI derived from YuJunZhiXue/dsh-purge 1.1.71 (MIT). See LICENSE.
import { h, react } from "./shared/react.js";
import { PURGE_CSS } from "./styles/index.js";
import {
  useDock,
  startGrantSync,
  setNativeSidebar,
  clearNativeSidebar,
} from "./state/dock.js";
import { AuthGate } from "./components/auth.js";
import { NS, setTranslate, zh, en } from "./shared/locale.js";
import { SettingsRoot } from "./components/settings-shell.js";
import { bindSessionContext } from "./state/session-context.js";

export const name = "dsh-purge-panel";

export const inject = ["slots", "locale"];

export function PurgeIcon({ size = 20 } = {}) {
  return h(
    "svg",
    {
      width: size,
      height: size,
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: "currentColor",
      strokeWidth: 1.6,
      "aria-hidden": true,
    },
    h("path", { d: "M4 7h16M4 17h16" }),
    h("circle", { cx: 9, cy: 7, r: 3, fill: "none" }),
    h("circle", { cx: 15, cy: 17, r: 3, fill: "none" }),
  );
}

export const ENTRY_CSS =
  ".dshp-launch,.dshp-hero-chip,.dshp-tab-chip{display:none!important}";

export function PanelOverlays() {
  const st = useDock();
  return h(
    react.Fragment,
    null,
    h("style", null, ENTRY_CSS + PURGE_CSS),
    st.authOpen ? h(AuthGate, { pending: st.pending }) : null,
  );
}

export function apply(ctx) {
  ctx.inject(["sessions", "uiWorkspace"], (host) => {
    host.effect(() => bindSessionContext(host), "panel session context");
  });
  ctx.effect(startGrantSync, "panel grant sync");
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), "panel locale");
  const t = ctx.locale.bind(NS);
  setTranslate(t);
  ctx.slots.inject("shell.overlay", () =>
    ctx.slots.register(
      {
        name: "shell.overlay",
        id: "dsh-purge-panel-overlays",
        order: 60,
      },
      PanelOverlays,
    ),
  );
  ctx.inject(["sidebarRightTabs", "sidebarRight"], (host) => {
    setNativeSidebar(host.sidebarRight);
    host.effect(
      () =>
        host.sidebarRightTabs.register({
          id: "dsh-purge",
          kind: "dsh-purge",
          title: () => "Purge",
          keepMounted: true,
          guide: [
            {
              id: "dsh-purge",
              order: 60,
              title: () => "Purge",
              description: () => "独立界面 · 官方插件可单独更新",
              icon: PurgeIcon,
            },
          ],
        }),
      "purge panel tab",
    );
    host.slots.inject("sidebar.right.pane.tab", () =>
      host.slots.register(
        {
          name: "sidebar.right.pane.tab",
          key: "dsh-purge",
          inject: () => ({ t }),
        },
        SettingsRoot,
      ),
    );
    host.effect(() => () => {
      clearNativeSidebar(host.sidebarRight);
    });
  });
  ctx.slots.inject("plugins.bundle.config", () =>
    ctx.slots.register(
      {
        name: "plugins.bundle.config",
        key: "dsh-purge-panel",
        inject: () => ({ t }),
      },
      SettingsRoot,
    ),
  );
}
