import { h, useState, useEffect } from "../shared/react.js";
import { apiJson } from "../api/client.js";
import { Btn, HelpTip } from "./primitives.js";
/**
 * 状态页顶部的两块紧凑信息：破甲自检（默认收起）+ 破甲强化段开关。
 * 单独拆出来，是为了让「应用」按钮留在页面最上面，而自检不占一屏。
 */
export function StatusExtras() {
  const [check, setCheck] = useState(null);
  const [boost, setBoost] = useState(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const load = () =>
    Promise.all([
      apiJson("/dsh-purge/selfcheck")
        .then(setCheck)
        .catch(() => setCheck(null)),
      apiJson("/dsh-purge/boost")
        .then((r) => setBoost(!!r.enabled))
        .catch(() => setBoost(null)),
    ]);
  useEffect(() => {
    load();
  }, []);
  async function toggle() {
    try {
      const r = await apiJson("/dsh-purge/boost", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled: !boost }),
      });
      setBoost(!!r.enabled);
      setNotice(r.enabled ? "已开启，重启后生效" : "已关闭，重启后生效");
    } catch (e) {
      setNotice(e.message);
    }
  }
  async function rerun() {
    setBusy(true);
    try {
      setCheck(await apiJson("/dsh-purge/selfcheck"));
    } catch (e) {
      setNotice(e.message);
    } finally {
      setBusy(false);
    }
  }
  const failed =
    check && Array.isArray(check.layers)
      ? check.layers.filter((l) => !l.ok)
      : [];
  const total = check && Array.isArray(check.layers) ? check.layers.length : 0;
  return h(
    "section",
    { className: "dshpp-card", "aria-label": "破甲状态" },
    h(
      "div",
      { className: "dshpp-line" },
      h(
        "span",
        { className: "dshpp-line-main" },
        h("i", {
          className:
            "dshpp-dot " + (check ? (failed.length ? "is-bad" : "is-ok") : ""),
        }),
        "破甲自检",
        h(
          "b",
          null,
          check
            ? failed.length
              ? `${failed.length} 层未生效`
              : `${total} 层全部在位`
            : "检测中…",
        ),
      ),
      h(
        "details",
        { className: "dshpp-fold-inline" },
        h("summary", null, "查看逐层"),
        h(
          "div",
          { className: "dshpp-checks" },
          check && Array.isArray(check.layers)
            ? check.layers.map((layer) =>
                h(
                  "div",
                  {
                    key: layer.title,
                    className: "dshpp-check" + (layer.ok ? "" : " is-bad"),
                  },
                  h("i", {
                    className: "dshpp-dot " + (layer.ok ? "is-ok" : "is-bad"),
                  }),
                  h("span", { className: "dshpp-check-name" }, layer.title),
                  h(
                    "span",
                    { className: "dshpp-check-val" },
                    `${layer.applied}/${layer.required ?? layer.total}`,
                  ),
                ),
              )
            : h("div", { className: "dshpp-muted" }, "检测中…"),
        ),
      ),
      h(
        Btn,
        { tiny: true, disabled: busy, onClick: rerun },
        busy ? "…" : "重测",
      ),
    ),
    h(
      "div",
      { className: "dshpp-line" },
      h(
        "span",
        { className: "dshpp-line-main" },
        "破甲强化段",
        h(
          HelpTip,
          { title: "破甲强化段" },
          "在系统提示词末尾追加一段与注入同级的文本：层级声明 / 拒绝即故障 / 抗谄媚 / 多轮重申。默认开启。",
        ),
        h("b", null, boost === null ? "…" : boost ? "已开启" : "已关闭"),
      ),
      h(
        Btn,
        { tiny: true, disabled: boost === null, onClick: toggle },
        boost ? "关闭" : "开启",
      ),
      notice ? h("span", { className: "dshpp-muted" }, notice) : null,
    ),
  );
}

export function CommunityMaintenance() {
  const [value, setValue] = useState(null),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [selected, setSelected] = useState(""),
    [releases, setReleases] = useState(null),
    [release, setRelease] = useState("");
  const load = () =>
    apiJson("/dsh-purge/community")
      .then(setValue)
      .catch((e) => setNotice(e.message));
  async function run(op) {
    if (
      op === "rollback" &&
      !window.confirm(
        "只回滚 Purge 插件及其入口，保留当前提示词和设置；完成后需手动重启 DSH。继续？",
      )
    )
      return;
    if (
      op === "update" &&
      !window.confirm(
        "将先备份，再安装所选社区正式版；不会重新应用宿主补丁。安装后请手动重启 DSH。继续？",
      )
    )
      return;
    setBusy(true);
    setNotice("处理中…");
    try {
      const r = await apiJson("/dsh-purge/community", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ op, id: selected, ref: release }),
      });
      if (op === "check") {
        setReleases(r.versions.filter((v) => v.asset));
        setRelease(r.versions.find((v) => v.asset)?.ref || "");
        setNotice(
          r.error
            ? `检查更新失败：${r.error}`
            : r.hasUpdate
              ? `发现新版本 ${r.remoteVersion}`
              : "当前已是最新正式版",
        );
      } else {
        setNotice(r.note || `备份已创建：${r.id}`);
        await load();
      }
    } catch (e) {
      setNotice(
        e.message === "timeout"
          ? "维护请求超时，操作可能仍在执行；请先刷新状态，勿重复提交。"
          : e.message,
      );
    } finally {
      setBusy(false);
    }
  }
  return h(
    "section",
    { className: "dshpp-panel", "aria-label": "社区版维护" },
    h("h3", null, "维护：更新与本机备份"),
    h(
      "div",
      { className: "dshpp-row" },
      h(Btn, { disabled: busy, onClick: () => run("check") }, "检查社区版更新"),
      h(
        "a",
        {
          href: "https://github.com/kingcharleslzy-ai/dsh-purge/releases",
          target: "_blank",
          rel: "noreferrer",
        },
        "发行记录",
      ),
    ),
    releases?.length
      ? h(
          "div",
          { className: "dshpp-row" },
          h(
            "select",
            {
              "aria-label": "选择社区发行版本",
              value: release,
              onChange: (e) => setRelease(e.target.value),
              disabled: busy,
            },
            releases.map((r) =>
              h("option", { key: r.ref, value: r.ref }, r.label),
            ),
          ),
          h(
            Btn,
            { disabled: busy || !release, onClick: () => run("update") },
            "安装所选版本",
          ),
        )
      : null,
    h("h3", { style: { marginTop: 20 } }, "本机备份"),
    h(
      "div",
      { className: "dshpp-row" },
      h(Btn, { disabled: busy, onClick: () => run("backup") }, "立即备份"),
      h(
        "select",
        {
          "aria-label": "选择回滚备份",
          value: selected,
          onChange: (e) => setSelected(e.target.value),
          disabled: busy,
        },
        h("option", { value: "" }, "选择备份"),
        ...(value?.backups || []).map((b) =>
          h(
            "option",
            { key: b.id, value: b.id },
            `${new Date(b.created_at).toLocaleString()} · ${b.plugins.map((p) => p.version).join(" / ")}`,
          ),
        ),
      ),
      h(
        Btn,
        { disabled: busy || !selected, onClick: () => run("rollback") },
        "回滚插件",
      ),
    ),
    h(
      "p",
      { className: "dshpp-hint" },
      "备份只保存在本机。回滚保留当前提示词、规则和其他插件设置；两种安装操作均需手动重启 DSH。",
    ),
    notice ? h("p", { role: "status" }, notice) : null,
  );
}
