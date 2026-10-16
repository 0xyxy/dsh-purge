// UI derived from YuJunZhiXue/dsh-purge 1.1.71 (MIT). See LICENSE.
import { h } from "../shared/react.js";
import { useT } from "../shared/locale.js";
import { statusKind, statusLabel } from "./patch-status.js";

export function formatSize(bytes) {
  if (typeof bytes !== "number" || !isFinite(bytes) || bytes < 0) return "0 B";
  if (bytes < 1024) return bytes + " B";
  const kb = bytes / 1024;
  return (kb >= 100 ? Math.round(kb) : kb.toFixed(1)) + " KB";
}

export function noticeNode(notice) {
  if (!notice || notice.kind === "idle" || !notice.text) return null;
  return h(
    "span",
    {
      className:
        "dshpp-notice " + (notice.kind === "error" ? "is-bad" : "is-ok"),
    },
    notice.text,
  );
}

export function Btn(props) {
  const { kind, tiny, children, className, type, ...rest } = props;
  const cls = [
    "dshpp-btn",
    kind ? "dshpp-btn-" + kind : "dshpp-btn-ghost",
    tiny ? "dshpp-btn-tiny" : "",
    className || "",
  ]
    .filter(Boolean)
    .join(" ");
  return h(
    "button",
    Object.assign({ type: type || "button", className: cls }, rest),
    children,
  );
}

export function Pill({ value, label }) {
  const t = useT();
  return h(
    "span",
    { className: "dshpp-pill is-" + statusKind(value) },
    label || statusLabel(value, t),
  );
}
