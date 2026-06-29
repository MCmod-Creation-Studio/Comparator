// ==UserScript==
// @name         后台审核对比
// @namespace    http://mcmod.cn/
// @version      2.1.1
// @description  MC百科后台审核对比（内置 diff 算法，HTML标记感知，支持格式变更高亮）
// @author       寒冽
// @match        *://admin.mcmod.cn/*
// @icon         https://www.mcmod.cn/favicon.ico
// @updateURL    https://raw.githubusercontent.com/MCmod-Creation-Studio/Comparator/main/comparator.user.js
// @downloadURL  https://raw.githubusercontent.com/MCmod-Creation-Studio/Comparator/main/comparator.user.js
// @grant        none
// ==/UserScript==
(function () {
    'use strict';

    // ========== UI 元素清理 ==========

    function stripUIElements(html) {
        var div = document.createElement('div');
        div.innerHTML = html;
        var btns = div.querySelectorAll('.verify-copy-btn');
        for (var k = btns.length - 1; k >= 0; k--) {
            var btn = btns[k];
            btn.parentNode.removeChild(btn);
        }
        var spans = div.querySelectorAll('.verify-copy-text');
        for (var k = spans.length - 1; k >= 0; k--) {
            var span = spans[k];
            var parent = span.parentNode;
            while (span.firstChild) {
                parent.insertBefore(span.firstChild, span);
            }
            parent.removeChild(span);
        }
        return div.innerHTML;
    }

    // ========== HTML 感知分词器 ==========

    function splitHTML(text) {
        var tokens = [];
        var current = '';
        var inTag = false;

        for (var i = 0; i < text.length; i++) {
            var ch = text[i];
            if (ch === '<') {
                if (current && !inTag) {
                    tokens.push(current);
                    current = '';
                }
                inTag = true;
                current = '<';
            } else if (ch === '>' && inTag) {
                current += '>';
                tokens.push(current);
                current = '';
                inTag = false;
            } else if (inTag) {
                current += ch;
            } else if (/\s/.test(ch)) {
                if (current) {
                    tokens.push(current);
                    current = '';
                }
                tokens.push(ch);
            } else {
                current += ch;
            }
        }
        if (current) tokens.push(current);
        return tokens;
    }

    // ========== Diff 核心算法 ==========

    function diffTokens(A, B, sep) {
        var n = A.length;
        var m = B.length;
        if (n === 0 && m === 0) return [];
        if (n === 0) return [{ added: true, value: B.join(sep) }];
        if (m === 0) return [{ removed: true, value: A.join(sep) }];

        // 仅使用公共前缀优化，不使用公共后缀
        // 因为 HTML 中有大量重复的闭合标签（如 </p>），后缀匹配容易错误对齐
        var start = 0;
        while (start < n && start < m && A[start] === B[start]) start++;

        var result = [];

        if (start > 0) {
            result.push({ value: A.slice(0, start).join(sep) });
        }

        var midA = A.slice(start);
        var midB = B.slice(start);
        var midN = midA.length;
        var midM = midB.length;

        if (midN === 0 && midM === 0) {
            // 完全相同
        } else if (midN === 0) {
            result.push({ added: true, value: midB.join(sep) });
        } else if (midM === 0) {
            result.push({ removed: true, value: midA.join(sep) });
        } else if (midN * midM > 10000000 || midN > 100000 || midM > 100000) {
            result.push({ truncated: true, value: '<p style="color:#856404;background:#fff3cd;padding:4px 8px;margin:4px 0;border-radius:3px;white-space:normal"><b>\u26A0 内容过长，已简化对比</b>（仅显示全部旧版/全部新版）</p>' });
            result.push({ removed: true, value: midA.join(sep) });
            result.push({ added: true, value: midB.join(sep) });
        } else {
            result = result.concat(lcsDiff(midA, midB, sep));
        }

        return mergeResult(result, sep);
    }

    function lcsDiff(A, B, sep) {
        var n = A.length;
        var m = B.length;

        var table = new Array(n + 1);
        for (var i = 0; i <= n; i++) {
            table[i] = new Array(m + 1);
            for (var j = 0; j <= m; j++) {
                table[i][j] = 0;
            }
        }

        for (var i = 1; i <= n; i++) {
            for (var j = 1; j <= m; j++) {
                if (A[i - 1] === B[j - 1]) {
                    table[i][j] = table[i - 1][j - 1] + 1;
                } else {
                    table[i][j] = Math.max(table[i - 1][j], table[i][j - 1]);
                }
            }
        }

        var result = [];
        var i = n, j = m;
        var removedBuffer = [];
        var addedBuffer = [];

        function flushBuf() {
            if (addedBuffer.length > 0) {
                result.unshift({ added: true, value: addedBuffer.reverse().join(sep) });
                addedBuffer = [];
            }
            if (removedBuffer.length > 0) {
                result.unshift({ removed: true, value: removedBuffer.reverse().join(sep) });
                removedBuffer = [];
            }
        }

        while (i > 0 || j > 0) {
            if (i > 0 && j > 0 && A[i - 1] === B[j - 1]) {
                flushBuf();
                result.unshift({ value: A[i - 1] });
                i--; j--;
            } else if (j > 0 && (i === 0 || table[i][j - 1] >= table[i - 1][j])) {
                addedBuffer.push(B[j - 1]);
                j--;
            } else {
                removedBuffer.push(A[i - 1]);
                i--;
            }
        }
        flushBuf();

        return result;
    }

    function mergeResult(result, sep) {
        var merged = [];
        for (var i = 0; i < result.length; i++) {
            var part = result[i];
            if (part.value !== undefined && !part.added && !part.removed && !part.truncated) {
                if (merged.length > 0) {
                    var last = merged[merged.length - 1];
                    if (last.value !== undefined && !last.added && !last.removed && !last.truncated) {
                        last.value += sep + part.value;
                        continue;
                    }
                }
            }
            merged.push({ added: part.added, removed: part.removed, truncated: part.truncated, value: part.value });
        }
        return merged;
    }

    function diffLines(oldStr, newStr) {
        return diffTokens(oldStr.split('\n'), newStr.split('\n'), '\n');
    }

    function diffHTML(oldStr, newStr) {
        return diffTokens(splitHTML(oldStr), splitHTML(newStr), '');
    }

    // ========== 块级元素嵌套修复 ==========

    function fixBlockNesting(html) {
        var div = document.createElement('div');
        div.innerHTML = html;
        var wrappers = div.querySelectorAll('ins, del');
        for (var i = wrappers.length - 1; i >= 0; i--) {
            var el = wrappers[i];
            var tagName = el.tagName.toLowerCase();

            // 检查是否有直接块级子元素
            var hasBlock = false;
            var children = el.children;
            for (var j = 0; j < children.length; j++) {
                var childTag = children[j].tagName.toLowerCase();
                if (/^(p|div|table|pre|ul|ol|h[1-6]|blockquote|li|tr|section|article|header|footer|nav|aside|figure|figcaption|dl|dt|dd|fieldset|main)$/.test(childTag)) {
                    hasBlock = true;
                    break;
                }
            }
            if (!hasBlock) continue;

            // 重组：将 <ins>/<del> 移入块级元素内部
            var parent = el.parentNode;
            var fragment = document.createDocumentFragment();

            while (el.firstChild) {
                var child = el.firstChild;
                el.removeChild(child);

                if (child.nodeType === 1) {
                    var ct = child.tagName.toLowerCase();
                    if (/^(p|div|table|pre|ul|ol|h[1-6]|blockquote|li|tr|section|article|header|footer|nav|aside|figure|figcaption|dl|dt|dd|fieldset|main)$/.test(ct)) {
                        var wrapper = document.createElement(tagName);
                        for (var a = 0; a < el.attributes.length; a++) {
                            wrapper.setAttribute(el.attributes[a].name, el.attributes[a].value);
                        }
                        while (child.firstChild) {
                            wrapper.appendChild(child.firstChild);
                        }
                        child.appendChild(wrapper);
                        fragment.appendChild(child);
                    } else {
                        var wi = document.createElement(tagName);
                        for (var b = 0; b < el.attributes.length; b++) {
                            wi.setAttribute(el.attributes[b].name, el.attributes[b].value);
                        }
                        wi.appendChild(child);
                        fragment.appendChild(wi);
                    }
                } else {
                    var wt = document.createElement(tagName);
                    for (var c = 0; c < el.attributes.length; c++) {
                        wt.setAttribute(el.attributes[c].name, el.attributes[c].value);
                    }
                    wt.appendChild(child);
                    fragment.appendChild(wt);
                }
            }

            parent.insertBefore(fragment, el);
            parent.removeChild(el);
        }
        return div.innerHTML;
    }

    // ========== 格式变更检测 ==========

    function stripText(html) {
        return html.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
    }

    function splitAddedRemovedAtBlocks(diff) {
        var BLOCK_RE = /<(\/?)(p|div|table|pre|ul|ol|h[1-6]|blockquote|li|tr|section|article|header|footer|nav|aside|figure|figcaption|dl|dt|dd|fieldset|main)\b[^>]*>/gi;
        var result = [];
        for (var i = 0; i < diff.length; i++) {
            var part = diff[i];
            if (!part.added && !part.removed) {
                result.push(part);
                continue;
            }
            BLOCK_RE.lastIndex = 0;
            var value = part.value;
            var lastIdx = 0;
            var match;
            while ((match = BLOCK_RE.exec(value)) !== null) {
                var before = value.slice(lastIdx, match.index);
                if (before) result.push({ added: part.added, removed: part.removed, formatChange: part.formatChange, value: before });
                result.push({ value: match[0] });
                lastIdx = match.index + match[0].length;
            }
            if (lastIdx < value.length) {
                result.push({ added: part.added, removed: part.removed, formatChange: part.formatChange, value: value.slice(lastIdx) });
            }
        }
        return result;
    }

    // ========== 对比主函数 ==========

    function textCompare(left, right) {
        var totalLen = left.length + right.length;
        var diff;

        // 检测是否为纯文本（低 HTML 标签密度）：避免 splitHTML 对纯文本产生爆炸级 token 数量
        var tagCount = (left.match(/</g) || []).length + (right.match(/</g) || []).length;
        if (totalLen > 500000 || tagCount < totalLen / 150) {
            diff = diffLines(left, right);
        } else {
            diff = diffHTML(left, right);
        }

        // 检测格式变更：add/remove 中，去标签后文本内容相同但 HTML 不同
        var MAX_GAP = 5;
        for (var i = 0; i < diff.length; i++) {
            if (!diff[i].added && !diff[i].removed) continue;
            if (diff[i].formatChange) continue;
            var textI = stripText(diff[i].value);
            if (textI.length === 0) continue;

            for (var j = i + 1; j < diff.length && j <= i + MAX_GAP; j++) {
                if (!diff[j].added && !diff[j].removed) continue;
                if (diff[j].formatChange) continue;
                if (diff[i].added === diff[j].added) continue;
                var textJ = stripText(diff[j].value);
                if (textI === textJ && diff[i].value !== diff[j].value) {
                    diff[i].formatChange = true;
                    diff[j].formatChange = true;
                    break;
                }
            }
        }

        // 拆分块级元素，避免 <ins>/<del> 包裹块级标签导致浏览器解析异常
        diff = splitAddedRemovedAtBlocks(diff);

        var result = "";
        diff.forEach(function (part) {
            if (part.truncated) {
                result += part.value;
            } else if (part.added) {
                result += part.formatChange ? '<ins class="fmt">' + part.value + '</ins>' : '<ins>' + part.value + '</ins>';
            } else if (part.removed) {
                result += part.formatChange ? '<del class="fmt">' + part.value + '</del>' : '<del>' + part.value + '</del>';
            } else {
                result += part.value;
            }
        });

        // 修复 <ins>/<del> 包裹块级元素（如 <p>）导致的 CSS 失效
        result = fixBlockNesting(result);

        return result;
    }

    // ========== 主逻辑 ==========

    new MutationObserver(function () {
        if (document.querySelector("div.verify-action-btns") && !document.getElementById("diff-btn")) {
            insertCompareButton();
        }
    }).observe(document.body, { childList: true, subtree: true });

    if (document.querySelector("div.verify-action-btns")) {
        insertCompareButton();
    }

    function insertCompareButton() {
        var actionDiv = document.querySelector("div.verify-action-btns");
        if (!actionDiv) return;
        if (document.getElementById("diff-btn")) return;

        var btn = document.createElement("button");
        btn.id = "diff-btn";
        btn.textContent = "对比表格内容";
        btn.className = "btn btn-primary action-btn";

        var firstBr = actionDiv.querySelector("br");
        if (firstBr) {
            actionDiv.insertBefore(btn, firstBr);
        } else {
            actionDiv.appendChild(btn);
        }

        btn.addEventListener("click", function () {
            toggleDiff(btn);
        });
    }

    function toggleDiff(btn) {
        var table = document.querySelector("table.verify-info-table");
        if (!table) {
            alert("未找到目标表格");
            return;
        }

        var rows = table.querySelectorAll("tr");
        var isDiffOn = btn.dataset.diffOn === "true";

        rows.forEach(function (row) {
            if (row.closest("table") !== table) return;
            if (row.parentElement && row.parentElement.tagName === "THEAD") return;

            var cols = row.cells;
            if (cols.length < 3) return;

            var leftCell = cols[1];
            var rightCell = cols[2];

            if (isDiffOn) {
                if (leftCell.dataset.original) {
                    leftCell.innerHTML = leftCell.dataset.original;
                    delete leftCell.dataset.original;
                    delete leftCell.dataset.diffHtml;
                }
                if (rightCell.dataset.original) {
                    rightCell.innerHTML = rightCell.dataset.original;
                    delete rightCell.dataset.original;
                    delete rightCell.dataset.diffHtml;
                }
            } else {
                if (!leftCell.dataset.original) {
                    leftCell.dataset.original = leftCell.innerHTML;
                }
                if (!rightCell.dataset.original) {
                    rightCell.dataset.original = rightCell.innerHTML;
                }

                // 清理 UI 元素后取文本进行对比
                var submitted = stripUIElements(leftCell.dataset.original).trim();
                var current = stripUIElements(rightCell.dataset.original).trim();

                var diffHTML = textCompare(current, submitted);
                leftCell.innerHTML = diffHTML;
                leftCell.dataset.diffHtml = diffHTML;
                var rightClean = stripUIElements(rightCell.dataset.original);
                rightCell.innerHTML = rightClean;
                rightCell.dataset.diffHtml = rightClean;
            }
        });

        btn.dataset.diffOn = (!isDiffOn).toString();

        if (!document.getElementById("diff-style")) {
            var style = document.createElement("style");
            style.id = "diff-style";
            style.innerHTML = [
                'table.verify-info-table td ins { background-color: #c6efce; text-decoration: none; }',
                'table.verify-info-table td del { background-color: #ffc7ce; text-decoration: line-through; }',
                'table.verify-info-table td ins.fmt { background-color: #fff3bf; text-decoration: none; }',
                'table.verify-info-table td del.fmt { background-color: #fff3bf; text-decoration: line-through; }',
                'table.verify-info-table td del br { display: none; }',
                'table.verify-info-table td { white-space: pre-wrap; }'
            ].join('\n');
            document.head.appendChild(style);
        }
    }
})();
