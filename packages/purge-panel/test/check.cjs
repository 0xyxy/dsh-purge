process.env.PANEL_CLIENT = require("path").join(__dirname, "..", "client.js");
const fs = require("fs"),
  vm = require("vm"),
  assert = require("assert");
const React = require("react"),
  { create, act } = require("react-test-renderer");
const calls = [],
  writes = [],
  seats = [],
  definitions = [];
let plugin,
  dict = {};
const responses = {
  "/dsh-purge/status": {
    ok: true,
    surface: "desktop",
    ai_base: "/fixture",
    patches_total: 68,
    patches_applied: 66,
    patches_skipped: 2,
    patches_pending: 0,
    patch_status: {},
    patches: [],
    plugin_version: "1.1.71",
    has_backup: true,
  },
  "/dsh-purge/update": { versions: [], channel: "stable" },
  "/dsh-purge/override": {
    ok: true,
    content: "Existing test prompt",
    defaultContent: "Default test prompt",
  },
  "/dsh-purge/own-servers": { ok: true, content: "example.test" },
  "/dsh-purge/hooks-deny": { ok: true, hooksDenyBypass: false },
  "/dsh-purge/drill-grant": { ok: true, granted: false },
};
const storage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
};
const win = {
  location: { origin: "http://test", href: "http://test" },
  localStorage: storage,
  sessionStorage: storage,
  setTimeout,
  clearTimeout,
  addEventListener() {},
  removeEventListener() {},
  __ModuleLoader__: {
    load: ({ factory }) => {
      plugin = factory((n) => (n === "react" ? React : require(n)));
    },
  },
};
const sandbox = {
  window: win,
  localStorage: storage,
  console,
  AbortController,
  URL,
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval,
  fetch: async (url, init = {}) => {
    const path = new URL(url, "http://test").pathname;
    calls.push(path);
    if (init.method === "POST") writes.push(path);
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify(responses[path] || { ok: true }),
      json: async () => responses[path] || { ok: true },
    };
  },
};
vm.runInNewContext(
  fs.readFileSync(
    process.env.PANEL_CLIENT || "../dsh-purge-ui/client.js",
    "utf8",
  ),
  sandbox,
);
const ctx = {
  locale: {
    register: (_, v) => {
      dict = v.zh;
      return () => {};
    },
    bind: () => (k) => dict[k] || k,
  },
  effect: (fn) => fn(),
  slots: {
    inject: (_, fn) => fn(),
    register: (spec, body) => {
      seats.push({ spec, body });
      return () => {};
    },
  },
  sidebarRight: { openTab() {} },
  sidebarRightTabs: {
    register: (d) => {
      definitions.push(d);
      return () => {};
    },
  },
  inject: (deps, fn) => {
    if (deps[0] === "sidebarRightTabs") fn(ctx);
  },
};
plugin.apply(ctx);
if (process.env.PANEL_CLIENT) {
  assert.equal(plugin.name, "dsh-purge-panel");
  assert(!seats.some((x) => /conversation\./.test(x.spec.name)));
}
assert.equal(definitions.length, 1);
assert.equal(definitions[0].kind, "dsh-purge");
assert.equal(definitions[0].keepMounted, true);
const body = seats.find((x) => x.spec.name === "sidebar.right.pane.tab").body;
const test = async () => {
  let tree;
  await act(async () => {
    tree = create(React.createElement(body, { t: ctx.locale.bind() }));
    await new Promise((r) => setTimeout(r, 10));
  });
  const root = tree.root;
  const btn = (text) =>
    root.findAllByType("button").find((x) => x.children.join("") === text);
  const area = (label) =>
    root.findAllByType("textarea").find((x) => x.props["aria-label"] === label);
  assert.equal(area("提示词内容").props.value, "Existing test prompt");
  await act(async () => btn("提示词").props.onClick());
  await act(async () =>
    area("提示词内容").props.onChange({ target: { value: "UNSAVED prompt" } }),
  );
  await act(async () => btn("更多").props.onClick());
  await act(async () =>
    area("服务器名单").props.onChange({
      target: { value: "unsaved.example.test" },
    }),
  );
  await act(async () => btn("状态").props.onClick());
  await act(async () => {
    btn("刷新状态").props.onClick();
    await new Promise((r) => setTimeout(r, 10));
  });
  assert.equal(area("提示词内容").props.value, "UNSAVED prompt");
  assert.equal(area("服务器名单").props.value, "unsaved.example.test");
  responses["/dsh-purge/status"].plugin_version = "2.0.0";
  await act(async () => {
    btn("刷新状态").props.onClick();
    await new Promise((r) => setTimeout(r, 10));
  });
  assert(
    root
      .findAll((x) => x.props.role === "status")
      .some((x) => x.children.join("").includes("官方版本 2.0.0")),
    "Compatibility banner must follow refreshed status",
  );
  assert.equal(
    writes.length,
    0,
    "Opening, changing tabs and refreshing must not write configuration",
  );
  assert(
    !root
      .findAllByType("button")
      .some((x) =>
        /dshp-launch|hero-chip|tab-btn/.test(x.props.className || ""),
      ),
  );
  await act(async () => tree.unmount());
  if (process.env.PANEL_CLIENT) {
    const overlay = seats.find(
      (x) => x.spec.id === "dsh-purge-panel-overlays",
    ).body;
    let o;
    await act(async () => {
      o = create(React.createElement(overlay));
    });
    assert(
      o.root
        .findAllByType("style")
        .some((x) =>
          x.children
            .join("")
            .includes(
              ".dshp-launch,.dshp-hero-chip,.dshp-tab-chip,.dshp-dock{display:none!important}",
            ),
        ),
    );
    assert.equal(o.root.findAllByType("button").length, 0);
    await act(async () => o.unmount());
    responses["/dsh-purge/status"].plugin_version = "2.0.0";
    await act(async () => {
      tree = create(React.createElement(body, { t: ctx.locale.bind() }));
      await new Promise((r) => setTimeout(r, 10));
    });
    assert(
      tree.root
        .findAll((x) => x.props.role === "status")
        .some((x) => x.children.join("").includes("官方版本 2.0.0")),
    );
    await act(async () => tree.unmount());
    responses["/dsh-purge/status"] = { ok: false, error: "unavailable" };
    await act(async () => {
      tree = create(React.createElement(body, { t: ctx.locale.bind() }));
      await new Promise((r) => setTimeout(r, 10));
    });
    assert(
      tree.root
        .findAll((x) => x.props.role === "status")
        .some((x) => x.children.join("").includes("无法确认官方 Purge 接口")),
    );
    await act(async () => tree.unmount());
    assert.equal(writes.length, 0);
    console.log(
      "PASS: isolated overlay, upstream version warning, unavailable service warning, no duplicate chat hooks",
    );
  }
  console.log(
    "PASS: native registry, persistent tab, loaded values, draft preservation across tabs and refresh, no implicit writes, no legacy launchers",
  );
};
test().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
