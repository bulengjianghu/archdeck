/**
 * 图解标签的 iframe 文档（EX-2、EX-3）：在图解原文的 head 最前注入 CSP（禁止一切网络请求）与引用的样式，
 * 在 body 末尾注入桥接脚本——按架构台给的原文填 data-field、给有图解的引用附「图解 ›」（每个模块只在 HTML 正文里第一次出现的地方附一次，SVG 里的跳过）、把单击与悬停（LY-15）变成 postMessage。
 * iframe 只给 allow-scripts（不给 same-origin），父页按消息来源校验（ExplainerDoc）。
 */
import type { ExplainerRefView } from '@/state/useDeskState'

/** 桥接脚本发给父页的消息 */
export type ExplainerMessage =
  | { type: 'arch:select'; module: string }
  | { type: 'arch:open'; module: string }
  /** LY-15：悬停引用（空串 = 离开） */
  | { type: 'arch:hover'; module: string }

const TYPES = new Set(['arch:select', 'arch:open', 'arch:hover'])
export const isExplainerMessage = (d: unknown): d is ExplainerMessage =>
  !!d && typeof d === 'object' && TYPES.has((d as ExplainerMessage).type) && typeof (d as ExplainerMessage).module === 'string'

const CSP = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; font-src data:">`

const STYLE = `<style>
[data-arch]{cursor:pointer;text-decoration:underline dotted;text-underline-offset:3px}
[data-arch]:hover,[data-arch]:focus-visible{text-decoration-style:solid;outline:none}
.arch-missing{text-decoration:line-through;opacity:.6;cursor:default}
.arch-pending{font-size:.8em;opacity:.65;margin-left:.3em}
.arch-adr{font-size:.8em;opacity:.65;margin-left:.3em}
a.arch-exp{font-size:.82em;margin-left:.35em;white-space:nowrap;text-decoration:none;opacity:.8}
a.arch-exp:hover{opacity:1;text-decoration:underline}
</style>`

/** 桥接脚本：D = { refs, origin }。只用 DOM 与 postMessage，不发网络请求 */
const BRIDGE = `(function () {
  var D = __DATA__;
  var linked = {};
  var adr = function (n) { return 'ADR-' + String(n).padStart(4, '0'); };
  var span = function (cls, text) { var s = document.createElement('span'); s.className = cls; s.textContent = text; return s; };
  document.querySelectorAll('[data-arch]').forEach(function (el) {
    var id = el.getAttribute('data-arch');
    var r = D.refs[id];
    if (!r) { el.classList.add('arch-missing'); el.title = '模块不存在：' + id; return; }
    el.setAttribute('role', 'link');
    el.tabIndex = 0;
    if (!el.title) el.title = r.name + '（' + id + '）· 单击在画布上选中';
    var f = el.getAttribute('data-field');
    if (f === 'summary') {
      el.textContent = r.summary ? r.summary.text : '';
      if (r.summary && r.summary.pending) el.appendChild(span('arch-pending', '待提炼'));
    } else if (f === 'invariants') {
      el.textContent = '';
      var list = el.tagName === 'UL' || el.tagName === 'OL';
      r.invariants.forEach(function (x, i) {
        var item = document.createElement(list ? 'li' : 'span');
        item.textContent = (!list && i ? '；' : '') + x.text;
        if (x.adr) item.appendChild(span('arch-adr', adr(x.adr)));
        el.appendChild(item);
      });
    }
    // 「图解 ›」只附在 HTML 正文里第一次出现的地方：SVG 里插不进 HTML 的 <a>（插了也不显示），跳过（第二十二轮波 5）
    if (r.explainer && !linked[id] && !el.closest('svg') && !(el.parentElement && el.parentElement.closest('[data-arch]'))) {
      linked[id] = true;
      var a = document.createElement('a');
      a.className = 'arch-exp';
      a.href = '#';
      a.textContent = '图解 ›';
      a.title = '打开「' + r.name + '」的图解';
      a.setAttribute('data-explainer', id);
      el.after(a);
    }
  });
  var send = function (type, module) { parent.postMessage({ type: type, module: module }, D.origin); };
  var act = function (e) {
    var t = e.target instanceof Element ? e.target : null;
    if (!t) return;
    var x = t.closest('[data-explainer]');
    if (x) { e.preventDefault(); send('arch:open', x.getAttribute('data-explainer')); return; }
    var el = t.closest('[data-arch]');
    if (el && !el.classList.contains('arch-missing')) { e.preventDefault(); send('arch:select', el.getAttribute('data-arch')); }
  };
  document.addEventListener('click', act);
  var hovered = '';
  document.addEventListener('mouseover', function (e) {
    var t = e.target instanceof Element ? e.target.closest('[data-arch]') : null;
    var id = t && !t.classList.contains('arch-missing') ? t.getAttribute('data-arch') || '' : '';
    if (id !== hovered) { hovered = id; send('arch:hover', id); }
  });
  document.addEventListener('mouseleave', function () { if (hovered) { hovered = ''; send('arch:hover', ''); } });
  document.addEventListener('keydown', function (e) { if (e.key === 'Enter') act(e); });
})();`

/** 脚本里的 JSON：防止 </script> 提前结束脚本 */
const scriptJson = (v: unknown) => JSON.stringify(v).replace(/</g, '\\u003c')

/** EX-2、EX-3：组装 iframe 的 srcdoc */
export function explainerSrcdoc(html: string, refs: Record<string, ExplainerRefView>, origin: string): string {
  const head = /<head\b[^>]*>/i.exec(html)
  const top = `${CSP}${STYLE}`
  let out = head ? `${html.slice(0, head.index + head[0].length)}${top}${html.slice(head.index + head[0].length)}` : `${top}${html}`
  const script = `<script>${BRIDGE.replace('__DATA__', scriptJson({ refs, origin }))}</script>`
  const end = out.search(/<\/body>/i)
  out = end >= 0 ? `${out.slice(0, end)}${script}${out.slice(end)}` : `${out}${script}`
  return out
}
