/**
 * 三层破甲判定核：纯函数，不碰文件系统。
 *
 * 设计约束（来自一次对抗性审查，见 REVIEW-codex-1.md）：
 *   1. 每个判据返回 { state, detail, fix }，state ∈ PASS / N_A / WAITING / ACTION_REQUIRED / BROKEN。
 *      不再用单一 boolean——"还没应用"和"补丁漂移"是两件事，前者可等，后者必须停。
 *   2. 不允许"白名单凭空放行"：豁免必须带可复核的 proof，调用方负责把 proof 算出来。
 *   3. 判据要能被变异测试抓到（bootstrap/test/mutation-check.mjs）。
 */

export const LAYERS = ["提示词", "代码", "引擎"];

/** 确认有问题：必须停下修。 */
export const BROKEN_STATES = new Set([
  "drifted",
  "partial",
  "partial_drift",
  "unmatched",
  "hit_mismatch",
  "unreadable",
  "error",
  "failed",
]);

/** 补丁状态 → 判定状态。pending 是"还没点应用"，属于可等待事项而不是故障。 */
const STATUS_STATE = {
  applied: "PASS",
  already: "PASS",
  disabled: "N_A",
  na: "N_A",
  pending: "ACTION_REQUIRED",
  unknown: "BROKEN",
};

export const STATE_RANK = { PASS: 0, N_A: 0, WAITING: 1, ACTION_REQUIRED: 2, BROKEN: 3 };

/**
 * 一组 verdict → 最差状态。
 * 注意 "全是 N_A" 不等于 "有 PASS"：整层都不适用时应当报 N_A，别假装证明过。
 */
export function worstState(states) {
  const list = [...states];
  if (!list.length) return "N_A"; // 空集合什么都没证明，不能报 PASS
  if (list.some((s) => !(s in STATE_RANK))) return "BROKEN"; // 拼错/未知状态一律当坏，不能默认 PASS
  const ranks = list.map((s) => STATE_RANK[s]);
  const max = Math.max(...ranks);
  if (max === 0) return list.every((s) => s === "N_A") ? "N_A" : "PASS";
  return list[ranks.indexOf(max)];
}

/** 进程退出码：0 = 全通，2 = 待动作/等待，1 = 真坏了。 */
export function exitCodeFor(states) {
  const worst = worstState(states);
  if (worst === "BROKEN") return 1;
  if (worst === "WAITING" || worst === "ACTION_REQUIRED") return 2;
  return 0;
}

const count = (text, re) => (String(text || "").match(re) || []).length;

/**
 * 标签对：要么都不出现，要么恰好一开一闭且开在闭前。
 * 单边开标签 = 后面所有内容被吞进这条消息（上游 #107 的 ChatML 事故就是这个形态）。
 */
/**
 * 去掉不该参与判定的字面量：HTML 注释与围栏代码块。
 * 否则注释里的一对标签会把正文真实的单边标签"配平"，P6 就白做了。
 */
export function stripNonProse(text) {
  return String(text || "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/^```[\s\S]*?^```/gm, "")
    .replace(/^(~~~)[\s\S]*?^\1/gm, "");
}

function pairing(rawSrc, openRe, closeRe, label) {
  const src = stripNonProse(rawSrc);
  const opens = [...src.matchAll(openRe)].map((m) => m.index);
  const closes = [...src.matchAll(closeRe)].map((m) => m.index);
  if (!opens.length && !closes.length) return { ok: true, absent: true, note: `无 ${label}` };
  if (opens.length !== closes.length) {
    return { ok: false, note: `${label} 不成对：开 ×${opens.length} / 闭 ×${closes.length}` };
  }
  if (opens.length > 1) return { ok: false, note: `${label} 出现 ${opens.length} 对（应至多 1 对）` };
  if (opens[0] > closes[0]) return { ok: false, note: `${label} 闭合在开启之前` };
  return { ok: true, note: `${label} 成对` };
}

/**
 * P6 注入信封体检。
 *
 * 宿主 `@deepseek-ai` 树里 `<|im_start|>`/`<|im_end|>` 本来就是 0 处：这两个标签是注入
 * 自己带进来的包装。单边开标签会让模型把系统提示读成"上一条 system 消息已结束、
 * 新开一条永不结束的 system 消息"，后面所有官方段被吞进去（上游 #107）。
 * project 标签同理：只开不闭会把后续官方段并进"项目备注"。
 */
export function injectEnvelope(text) {
  const src = String(text || "");
  if (!src.trim()) {
    return { state: "BROKEN", detail: "prompt-inject.md 缺失或为空", fix: "从 dsh-unleashed-custom.zip 铺 prompt-inject.md" };
  }
  const prose = stripNonProse(src).trim();
  const chatml = pairing(src, /<\|im_start\|>/gi, /<\|im_end\|>/gi, "ChatML");
  const project = pairing(src, /<project_instructions>/gi, /<\/project_instructions>/gi, "project");
  if (!chatml.ok || !project.ok) {
    return {
      state: "BROKEN",
      detail: [chatml.note, project.note].join("；"),
      fix: "成对写标签，或干脆不写 ChatML（宿主全程不用）；project 开标签必须有闭标签",
    };
  }
  // 有 project 标签时要求它就是正文的头尾：否则"中间夹一对"同样会把段落切错。
  const wrapped = /^<project_instructions>/i.test(prose) && /<\/project_instructions>$/i.test(prose);
  if (!chatml.absent && !/^<\|im_start\|>/i.test(prose)) {
    return { state: "BROKEN", detail: "ChatML 开标签不在正文开头", fix: "信封要么整体去掉，要么从第一行开始" };
  }
  if (!project.absent && chatml.absent && !wrapped) {
    return {
      state: "BROKEN",
      detail: "project 标签不是正文的头尾（中间夹一对会让官方段被切进项目备注）",
      fix: "把 <project_instructions> 放第一行、</project_instructions> 放最后一行，正文里不要再出现第二对",
    };
  }
  return { state: "PASS", detail: [chatml.note, project.note, wrapped ? "project 包裹整个正文" : ""].filter(Boolean).join("；") };
}

/**
 * P7 预设副本一致性：用 {sha256} manifest 比对路径集合与内容。
 * 只比文件名抓不到"同内容改名"和"内容被改了一个字符"；只比内容抓不到"多出来的副本"。
 *
 * repoManifest / payloadManifest: { "unrestricted/agent.cordis.yml": "<sha256>", ... }
 * payloadOnly: 允许只存在于 payload 的精确文件前缀列表（如 ["liangshen/"]）
 */
export function presetSync({ repoManifest = {}, payloadManifest = {}, payloadOnly = [] }) {
  const repoFiles = Object.keys(repoManifest).sort();
  const payloadFiles = Object.keys(payloadManifest).sort();
  const allow = (f) => payloadOnly.some((p) => (p.endsWith("/") ? f.startsWith(p) : f === p));

  const missing = repoFiles.filter((f) => !(f in payloadManifest));
  const extra = payloadFiles.filter((f) => !(f in repoManifest) && !allow(f));
  const changed = repoFiles.filter((f) => f in payloadManifest && repoManifest[f] !== payloadManifest[f]);
  const problems = [
    ...missing.map((f) => `payload 缺 ${f}`),
    ...extra.map((f) => `payload 多出 ${f}`),
    ...changed.map((f) => `内容不一致 ${f}`),
  ];
  if (problems.length) {
    return {
      state: "BROKEN",
      detail: problems.join("；"),
      fix: "node bootstrap/sync-presets.mjs（仓库 presets/ 是唯一事实源，同步会删掉多余副本）",
    };
  }
  return { state: "PASS", detail: `${repoFiles.length} 个文件与仓库 presets/ 哈希一致` };
}

/**
 * `skipped` 是否算"已结算"，只看**证据**，不看 pattern 文本：
 *   - 补丁自带 silentWhenMissing（上游 #76：用户预设里本来没有官方身份行）→ 结算；
 *   - 目标文件根本不存在（`activeIds` 里没有它）→ 无对象，结算；
 *   - 目标文件在、却没打上、也没声明静默 → 这是"该打没打上"，判 BROKEN。
 */
function skippedIsSettled(patch, activeIds) {
  if (patch?.silentWhenMissing) return true;
  return !activeIds.has(patch.id);
}

/**
 * C6 按插件自己的补丁表核对宿主。
 *
 * 吸收上游语义：漂移 / 部分命中 / 命中数不符都是"没打上"；pending 是"还没点应用"。
 * disabledByDefault（#18/#19）按选择关闭 → N_A。
 * `optional` 补丁只在目标文件确实不存在时才算不适用；目标在就要真核对（否则第三方插件
 * 装上了、补丁漂了，也会被"optional"两个字盖过去）。
 *
 * exempt 不接受裸 id 白名单：必须是 { [id]: { reason, proof: true } }，proof 由调用方现场算。
 * activeIds 由调用方给（该补丁至少有一个目标文件真实存在）。
 */
export function patchAccounting({ patches, statusById, drift, exempt = {}, activeIds = null, readyFn = null }) {
  const list = Array.isArray(patches) ? patches : [];
  if (!list.length) {
    return { state: "BROKEN", detail: "补丁表为空（插件未装或 core.js 未加载）", fix: "先装 dsh-purge-community" };
  }

  const status = statusById || {};
  const active = activeIds instanceof Set ? activeIds : new Set(list.map((p) => p.id));
  const optIn = list.filter((p) => p.disabledByDefault).map((p) => p.id);
  const required = list.filter((p) => !p.disabledByDefault && (!p.optional || active.has(p.id)));
  const states = [];
  const notes = [];
  const problems = [];

  for (const p of required) {
    const s = status[p.id] ?? "unknown";
    let state;
    // surface / 按选择关闭：插件自己已经判了"这条不适用或不打算打"，直接结算，别再问 ready。
    if (s === "na" || s === "disabled") state = "N_A";
    else if (typeof readyFn === "function") {
      // 让插件自己判"这条算不算完事"（它知道 drifted/partial/silentWhenMissing 的语义），
      // 我们只在它说"完了"时再分级，避免手搓规则跟插件版本对不上。
      const ready = readyFn(s, p) === true;
      state = ready ? (s === "applied" || s === "already" ? "PASS" : "N_A") : s === "pending" ? "ACTION_REQUIRED" : "BROKEN";
    } else {
      state = s === "skipped" ? (skippedIsSettled(p, active) ? "N_A" : "BROKEN") : STATUS_STATE[s];
    }
    if (state === undefined) state = "BROKEN";
    if (state === "BROKEN" && exempt[p.id]?.proof === true) {
      state = "N_A";
      notes.push(`${p.id} 由外部证据证明：${exempt[p.id].reason || "proof"}`);
    }
    states.push(state);
    if (state === "BROKEN") problems.push(`${p.id}:${s}`);
  }

  const driftIds = (drift?.drifted || []).map((x) => (x && (x.id ?? x.patch_id)) ?? x);
  const partialIds = (drift?.partial_drift || []).map((x) => (x && (x.id ?? x.patch_id)) ?? x);
  if (driftIds.length) problems.push(`drifted:${driftIds.join(",")}`);
  if (partialIds.length) problems.push(`partial:${partialIds.join(",")}`);
  if (driftIds.length || partialIds.length) states.push("BROKEN");

  const histogram = required.reduce((acc, p) => {
    const s = status[p.id] ?? "unknown";
    acc[s] = (acc[s] || 0) + 1;
    return acc;
  }, {});
  const detail = [
    `共 ${list.length} 条（必需 ${required.length}）`,
    Object.entries(histogram)
      .map(([k, v]) => `${k} ${v}`)
      .join(" / ") || "无状态",
    optIn.length ? `可选关闭 ${optIn.join(",")}` : "",
    drift ? `drift checked ${drift.checked ?? "?"}` : "",
    problems.length ? `问题：${problems.join(" ")}` : "",
    ...notes,
  ]
    .filter(Boolean)
    .join(" · ");

  const state = problems.length ? "BROKEN" : worstState(states);
  const fix =
    state === "BROKEN"
      ? "purge-community diagnose 看锚点漂移，必要时 reanchor apply <id>；确认不是官方更新后没重打"
      : state === "ACTION_REQUIRED"
        ? "点一次面板「应用」→ 完整退出 DSH → 重开后复验"
        : "";
  return { state, detail, fix, problems };
}

/**
 * C4 循环守卫：查**具体补丁的 marker**，不再数通用 `[dsh-purge]`（那会被 #68 或任意其它
 * 标记冒充），也不再依赖体量阈值（宿主压缩/拆包会让 60KB 变噪声）。
 */
export function guardMarkers({ src, markers = [] } = {}) {
  const text = String(src || "");
  if (!text) return { state: "BROKEN", detail: "dsh-agent-loop/lib/index.js 缺失", fix: "宿主未解包或插件未应用" };
  const missing = markers.filter((m) => !text.includes(m));
  const detail = `${Math.round(text.length / 1024)} KB · 标记 ${markers.length - missing.length}/${markers.length}${
    missing.length ? ` · 缺 ${missing.join(" / ")}` : ""
  }`;
  return missing.length
    ? { state: "BROKEN", detail, fix: "重跑 run-purge.mjs（补丁 #67 / #68）" }
    : { state: "PASS", detail };
}

/**
 * C7 锚点唯一性（取自上游 1.6.64 的 expect 契约）。
 *
 * 待打补丁的字面锚点在宿主里必须"找得到"：0 次 = 官方改了写法；>1 次 = replace-all
 * 会顺手改掉不相干的那处。已打上的补丁不参与（它们本来就被替换掉了）。
 */
export function anchorUniqueness({ samples = [] } = {}) {
  const problems = [];
  const ambiguities = [];
  let checked = 0;
  for (const s of samples) {
    if (!s || !Array.isArray(s.hits) || !s.hits.length) continue;
    checked += 1;
    const max = Math.max(...s.hits.map((h) => h.count));
    if (max === 0) problems.push(`${s.id}:锚点 0 次（${s.file || "?"}，宿主写法已变，需 reanchor）`);
    else if (max > 1) ambiguities.push(`${s.id}:${s.file || "?"} 命中 ${max} 次（会多改一处，建议收窄或声明 expect）`);
  }
  if (!checked) return { state: "N_A", detail: "没有待打补丁，跳过锚点唯一性检查" };
  const detail = [
    `检查 ${checked} 条待打补丁`,
    ambiguities.length ? `多处命中：${ambiguities.join("；")}` : "",
    problems.length ? `丢失：${problems.join("；")}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
  return problems.length
    ? { state: "BROKEN", detail, fix: "purge-community diagnose 看新落点，再 reanchor apply <id> --lines A-B" }
    : { state: "PASS", detail };
}

/** 行汇总：整层状态 / 全局状态 / 统计。 */
export function layerSummary(rows) {
  const byLayer = Object.fromEntries(LAYERS.map((l) => [l, []]));
  for (const r of rows) (byLayer[r.layer] ||= []).push(r);
  const layerState = (l) => worstState((byLayer[l] || []).map((r) => r.state));
  return {
    byLayer,
    layerState,
    state: worstState(rows.map((r) => r.state)),
    pass: rows.filter((r) => r.state === "PASS" || r.state === "N_A").length,
    total: rows.length,
    exitCode: exitCodeFor(rows.map((r) => r.state)),
  };
}
