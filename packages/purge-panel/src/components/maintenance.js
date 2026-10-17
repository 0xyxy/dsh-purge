import { h, useState, useEffect } from "../shared/react.js";
import { apiJson } from "../api/client.js";
import { Btn } from "./primitives.js";
export function CommunityMaintenance() {
  const [value, setValue] = useState(null),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [selected, setSelected] = useState(""),
    [releases, setReleases] = useState(null),
    [release, setRelease] = useState(""),
    [check, setCheck] = useState(null),
    [checkBusy, setCheckBusy] = useState(false),
    [boost, setBoost] = useState(null);
  const load = () =>
    apiJson("/dsh-purge/community")
      .then(setValue)
      .catch((e) => setNotice(e.message));
  const loadCheck = () =>
    apiJson("/dsh-purge/selfcheck")
      .then(setCheck)
      .catch(() => setCheck(null));
  useEffect(() => {
    load();
    loadCheck();
    loadBoost();
  }, []);
  const loadBoost = () =>
    apiJson("/dsh-purge/boost")
      .then((r) => setBoost(!!r.enabled))
      .catch(() => setBoost(null));
  async function toggleBoost() {
    try {
      const r = await apiJson("/dsh-purge/boost", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled: !boost }),
      });
      setBoost(!!r.enabled);
      setNotice(
        r.enabled
          ? "破甲强化段已开启，下次重启生效"
          : "破甲强化段已关闭，下次重启生效",
      );
    } catch (e) {
      setNotice(e.message);
    }
  }
  async function rerunCheck() {
    setCheckBusy(true);
    try {
      setCheck(await apiJson("/dsh-purge/selfcheck"));
    } catch (e) {
      setNotice(e.message);
    } finally {
      setCheckBusy(false);
    }
  }
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
    h("h3", null, "版本与恢复"),
    h(
      "p",
      null,
      `Purge Community ${value?.version || "…"} · DSH ${value?.compatibility?.host_version || "…"}`,
    ),
    h(
      "p",
      { role: "status", className: "dshpp-hint" },
      value?.compatibility?.message || "正在检查宿主版本…",
    ),
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
    h(
      "h3",
      { style: { marginTop: 20 } },
      "破甲强化段",
      h(
        Btn,
        {
          tiny: true,
          disabled: boost === null,
          onClick: toggleBoost,
          style: { marginLeft: 8 },
        },
        boost === null
          ? "…"
          : boost
            ? "已开启 · 点击关闭"
            : "已关闭 · 点击开启",
      ),
    ),
    h(
      "p",
      { className: "dshpp-hint" },
      "在系统提示词末尾追加一段与注入同级的强化文本（层级声明 / 拒绝即故障 / 抗谄媚 / 多轮重申）。默认关闭；改动需重启 DSH 生效。",
    ),
    h(
      "h3",
      { style: { marginTop: 20 } },
      "破甲自检",
      h(
        Btn,
        {
          tiny: true,
          disabled: checkBusy,
          onClick: rerunCheck,
          style: { marginLeft: 8 },
        },
        checkBusy ? "检测中…" : "重新检测",
      ),
    ),
    check && Array.isArray(check.layers)
      ? h(
          "div",
          null,
          h(
            "p",
            { role: "status" },
            check.ok
              ? `全部在位 · 宿主补丁 ${check.patch?.applied ?? "?"}/${check.patch?.total ?? "?"} · DSH ${check.host_version}（${check.level}）`
              : `有 ${check.layers.filter((l) => !l.ok).length} 层未生效 · 宿主补丁 ${check.patch?.applied ?? "?"}/${check.patch?.total ?? "?"}`,
          ),
          h(
            "ul",
            {
              className: "dshpp-hint",
              style: { paddingLeft: 18, margin: "6px 0" },
            },
            check.layers.map((layer) =>
              h(
                "li",
                { key: layer.title },
                `${layer.ok ? "✓" : "✗"} ${layer.title} ${layer.required === undefined ? "" : `${layer.applied}/${layer.required}`}${layer.note ? `（${layer.note}）` : ""}`,
                layer.ok || !layer.broken?.length
                  ? null
                  : h(
                      "span",
                      null,
                      ` → ${layer.broken.map((b) => "#" + b.id + " " + b.status).join("，")}`,
                    ),
              ),
            ),
          ),
        )
      : h("p", { className: "dshpp-hint" }, "正在检测各层是否生效…"),
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
