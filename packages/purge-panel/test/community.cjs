process.env.PANEL_CLIENT = require("path").join(
  __dirname,
  "../../..",
  "client.js",
);
const fs = require("fs"),
  vm = require("vm"),
  assert = require("assert");
const React = require("react"),
  { create, act } = require("react-test-renderer");
const calls = [],
  writes = [],
  seats = [],
  definitions = [];
const headStyles = [],
  lifecycle = [];
const doc = {
  head: {
    append(node) {
      headStyles.push(node);
    },
  },
  createElement(tag) {
    assert.equal(tag, "style");
    return {
      setAttribute() {},
      textContent: "",
      remove() {
        const index = headStyles.indexOf(this);
        if (index >= 0) headStyles.splice(index, 1);
      },
    };
  },
};
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
  document: doc,
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
    if (init.method === "POST")
      writes.push({ path, body: JSON.parse(init.body) });
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
  effect: (fn, name) => {
    const dispose = fn();
    lifecycle.push({ name, dispose });
    return dispose;
  },
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
assert.equal(
  headStyles.length,
  1,
  "Legacy visibility must install before any overlay is rendered",
);
assert(
  headStyles[0].textContent.includes(".dshp-dock{display:none!important}"),
);
if (process.env.PANEL_CLIENT) {
  assert.equal(plugin.name, "dsh-purge-community");
  assert(!seats.some((x) => /conversation\./.test(x.spec.name)));
}
assert.equal(definitions.length, 1);
assert.equal(definitions[0].kind, "dsh-purge");
assert.equal(definitions[0].keepMounted, true);
const body = seats.find((x) => x.spec.name === "sidebar.right.pane.tab").body;

responses["/dsh-purge/community"] = {
  version: "1.2.0",
  compatibility: {
    host_version: "0.2.1-rc.1",
    message: "Runtime tested; binary patches disabled",
  },
  backups: [
    {
      id: "backup-fixture",
      created_at: "2026-10-17T00:00:00Z",
      reason: "manual",
      plugins: [{ version: "1.1.71" }],
    },
  ],
};
win.confirm = () => true;
(async () => {
  let tree;
  await act(async () => {
    tree = create(React.createElement(body, { t: ctx.locale.bind() }));
    await new Promise((r) => setTimeout(r, 15));
  });
  const root = tree.root,
    button = (text) =>
      root.findAllByType("button").find((x) => x.children.join("") === text);
  assert(
    root
      .findAllByType("h2")
      .some((x) => x.children.join("") === "Purge Community"),
  );
  assert(root.findAllByProps({ "aria-label": "社区版维护" }).length);
  assert.equal(writes.length, 0, "opening never writes configuration");
  assert(
    button("应用").props.disabled,
    "unqualified binary patch action disabled",
  );
  await act(async () => {
    button("立即备份").props.onClick();
    await new Promise((r) => setTimeout(r, 15));
  });
  assert.deepEqual(
    writes.map((x) => x.body.op),
    ["backup"],
  );
  await act(async () => {
    root
      .findByProps({ "aria-label": "选择回滚备份" })
      .props.onChange({ target: { value: "backup-fixture" } });
  });
  await act(async () => {
    button("回滚插件").props.onClick();
    await new Promise((r) => setTimeout(r, 15));
  });
  assert.equal(writes[1].body.id, "backup-fixture");
  assert.equal(writes[1].body.op, "rollback");
  assert(
    !writes.some((x) => /apply|restart|revert/.test(x.path)),
    "maintenance never applies host patches or restarts DSH",
  );
  await act(async () => tree.unmount());
  for (const life of lifecycle.reverse())
    if (typeof life.dispose === "function") life.dispose();
  console.log(
    "PASS: Community bundled UI, single native entry, backup and rollback contracts",
  );
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
