// ── Utility ───────────────────────────────────
function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2, 6);
}

function escapeHTML(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isTextFile(file) {
    if (file.type.startsWith('text/')) return true;
    return /\.(txt|md|csv|json|xml|html|css|js|ts|py|java|c|cpp|h|log|yml|yaml|toml|ini|cfg|sh|bat)$/i.test(file.name);
}

function formatDate(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    const now = new Date();
    const diff = now - d;
    if (diff < 60000) return 'vừa xong';
    if (diff < 3600000) return `${Math.floor(diff / 60000)} phút trước`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)} giờ trước`;
    const pad = n => n.toString().padStart(2, '0');
    if (d.getFullYear() === now.getFullYear()) {
        return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}

function formatDateFull(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    const pad = n => n.toString().padStart(2, '0');
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function getDisplayName(node) {
    if (node.type === 'folder') return node.name || 'Folder mới';
    if (node.name) return node.name;
    const content = workspace.files[node.id] || '';
    const firstLine = content.split('\n')[0].trim();
    if (!firstLine) return 'Văn bản mới';
    return firstLine.length > 35 ? firstLine.substring(0, 32) + '…' : firstLine;
}

function getDownloadName(node) {
    const display = getDisplayName(node);
    if (/\.\w{1,10}$/.test(display)) return display;
    return display + '.txt';
}

function ensureUniqueName(name, siblings, excludeId) {
    if (!name) return name;
    const existing = new Set(
        siblings.filter(n => n.id !== excludeId).map(n => getDisplayName(n).toLowerCase())
    );
    if (!existing.has(name.toLowerCase())) return name;
    const base = name.replace(/ \(\d+\)$/, '');
    let counter = 2;
    while (existing.has(`${base} (${counter})`.toLowerCase())) counter++;
    return `${base} (${counter})`;
}

// ── Minimal ZIP Creator (no dependencies) ─────
function createZipBlob(entries) {
    const crc32Table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
        let c = i;
        for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        crc32Table[i] = c;
    }
    function crc32(data) {
        let crc = 0xFFFFFFFF;
        for (let i = 0; i < data.length; i++) crc = crc32Table[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8);
        return (crc ^ 0xFFFFFFFF) >>> 0;
    }

    const enc = new TextEncoder();
    const parts = [];
    const centralDir = [];
    let offset = 0;

    for (const entry of entries) {
        const nameBytes = enc.encode(entry.name);
        const data = entry.data;
        const crcVal = crc32(data);

        const local = new Uint8Array(30 + nameBytes.length);
        const lv = new DataView(local.buffer);
        lv.setUint32(0, 0x04034B50, true);
        lv.setUint16(4, 20, true);
        lv.setUint16(8, 0, true);
        lv.setUint32(14, crcVal, true);
        lv.setUint32(18, data.length, true);
        lv.setUint32(22, data.length, true);
        lv.setUint16(26, nameBytes.length, true);
        local.set(nameBytes, 30);
        parts.push(local, data);

        const central = new Uint8Array(46 + nameBytes.length);
        const cv = new DataView(central.buffer);
        cv.setUint32(0, 0x02014B50, true);
        cv.setUint16(4, 20, true);
        cv.setUint16(6, 20, true);
        cv.setUint32(16, crcVal, true);
        cv.setUint32(20, data.length, true);
        cv.setUint32(24, data.length, true);
        cv.setUint16(28, nameBytes.length, true);
        cv.setUint32(42, offset, true);
        central.set(nameBytes, 46);
        centralDir.push(central);

        offset += local.length + data.length;
    }

    const cdOffset = offset;
    let cdSize = 0;
    for (const cd of centralDir) { parts.push(cd); cdSize += cd.length; }

    const eocd = new Uint8Array(22);
    const ev = new DataView(eocd.buffer);
    ev.setUint32(0, 0x06054B50, true);
    ev.setUint16(8, entries.length, true);
    ev.setUint16(10, entries.length, true);
    ev.setUint32(12, cdSize, true);
    ev.setUint32(16, cdOffset, true);
    parts.push(eocd);

    return new Blob(parts, { type: 'application/zip' });
}

// ── Folder Drop Processing ────────────────────
async function processDroppedEntries(dataTransferItems) {
    const entries = [];
    for (let i = 0; i < dataTransferItems.length; i++) {
        const entry = dataTransferItems[i].webkitGetAsEntry?.();
        if (entry) entries.push(entry);
    }
    const results = [];
    for (const entry of entries) {
        const result = await processEntry(entry);
        if (result) results.push(result);
    }
    return results;
}

async function processEntry(entry) {
    const now = Date.now();
    if (entry.isFile) {
        return new Promise(resolve => {
            entry.file(file => {
                if (!isTextFile(file)) { resolve(null); return; }
                const reader = new FileReader();
                reader.onload = e => {
                    const id = generateId();
                    resolve({
                        node: { id, type: 'file', name: entry.name, createdAt: now, modifiedAt: now },
                        files: { [id]: e.target.result }
                    });
                };
                reader.readAsText(file, 'UTF-8');
            });
        });
    }
    if (entry.isDirectory) {
        const dirEntries = await readAllDirectoryEntries(entry.createReader());
        const id = generateId();
        const children = [];
        const filesMap = {};
        for (const child of dirEntries) {
            const result = await processEntry(child);
            if (result) {
                children.push(result.node);
                Object.assign(filesMap, result.files);
            }
        }
        if (children.length === 0) return null;
        return {
            node: { id, type: 'folder', name: entry.name, expanded: true, children, createdAt: now, modifiedAt: now },
            files: filesMap
        };
    }
    return null;
}

function readAllDirectoryEntries(reader) {
    return new Promise(resolve => {
        const entries = [];
        function readBatch() {
            reader.readEntries(batch => {
                if (batch.length === 0) resolve(entries);
                else { entries.push(...batch); readBatch(); }
            });
        }
        readBatch();
    });
}

// ── Elements ──────────────────────────────────
const editor = document.getElementById('editor');
const gutter = document.getElementById('gutter');
const mirror = document.getElementById('mirror');
const editorWrap = document.getElementById('editor-wrap');
const findPanel = document.getElementById('find-replace');
const findInput = document.getElementById('find-input');
const replaceInput = document.getElementById('replace-input');
const statChars = document.getElementById('stat-chars');
const statWords = document.getElementById('stat-words');
const statLines = document.getElementById('stat-lines');
const toastBox = document.getElementById('toast-container');
const matchCountEl = document.getElementById('match-count');
const highlightLayer = document.getElementById('highlight-layer');
const spaceLayer = document.getElementById('space-layer');
const btnUndo = document.getElementById('btn-undo');
const btnRedo = document.getElementById('btn-redo');
const btnShowSpaces = document.getElementById('btn-show-spaces');
const sidebarEl = document.getElementById('sidebar');
const fileTreeEl = document.getElementById('file-tree');
const contextMenuEl = document.getElementById('context-menu');
const backdropEl = document.getElementById('sidebar-backdrop');
const importInput = document.getElementById('import-input');
const btnSort = document.getElementById('btn-sort');

// ── Toast ─────────────────────────────────────
function showToast(message) {
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = message;
    toastBox.appendChild(t);
    setTimeout(() => t.remove(), 2200);
}

function countNodes(nodes) {
    let files = 0, folders = 0, totalSize = 0;
    for (const n of nodes) {
        if (n.type === 'folder') {
            folders++;
            if (n.children) {
                const sub = countNodes(n.children);
                files += sub.files;
                folders += sub.folders;
                totalSize += sub.totalSize;
            }
        } else {
            files++;
            totalSize += (workspace.files[n.id] || '').length;
        }
    }
    return { files, folders, totalSize };
}

function formatBytes(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1048576).toFixed(1) + ' MB';
}

// ── Usage Tracking ───────────────────────────
const USAGE_KEY = 'rawer_usage';
let usageData = null;

function loadUsage() {
    try {
        const saved = localStorage.getItem(USAGE_KEY);
        if (saved) { usageData = JSON.parse(saved); return; }
    } catch { }
    usageData = { firstVisit: Date.now(), totalSessions: 0, totalKeystrokes: 0, totalTime: 0, lastVisit: Date.now() };
}

function saveUsage() {
    try { localStorage.setItem(USAGE_KEY, JSON.stringify(usageData)); } catch { }
}

loadUsage();
usageData.totalSessions++;
usageData.lastVisit = Date.now();
saveUsage();

let sessionStart = Date.now();
setInterval(() => {
    usageData.totalTime += 5;
    usageData.lastVisit = Date.now();
    saveUsage();
}, 5000);

// ── Workspace Data Model ──────────────────────
const WS_KEY = 'rawer_workspace';
let workspace = null;

function migrateNodeDates(nodes) {
    const now = Date.now();
    for (const n of nodes) {
        if (!n.createdAt) n.createdAt = now;
        if (!n.modifiedAt) n.modifiedAt = now;
        if (n.children) migrateNodeDates(n.children);
    }
}

function loadWorkspace() {
    try {
        const saved = localStorage.getItem(WS_KEY);
        if (saved) {
            workspace = JSON.parse(saved);
            if (!workspace.tree || !workspace.files) throw 0;
            migrateNodeDates(workspace.tree);
            if (!workspace.sortMode) workspace.sortMode = 'manual';
            return;
        }
    } catch { /* fall through */ }

    let legacyContent = '';
    try {
        const old = localStorage.getItem('rawer_content');
        if (old !== null) { legacyContent = old; localStorage.removeItem('rawer_content'); }
    } catch { /* ignore */ }

    workspace = {
        tree: [],
        files: {},
        activeFileId: null,
        sidebarOpen: true,
        sortMode: 'manual'
    };

    if (legacyContent) {
        const id = generateId();
        const now = Date.now();
        workspace.tree.push({ id, type: 'file', name: '', createdAt: now, modifiedAt: now });
        workspace.files[id] = legacyContent;
        workspace.activeFileId = id;
    }
}

const statSaveEl = document.getElementById('stat-save');
let saveIndicatorTimer = null;

function saveWorkspace() {
    const activeId = workspace.activeFileId;
    if (activeId && workspace.files[activeId] !== editor.value) {
        workspace.files[activeId] = editor.value;
        const node = findNodeById(activeId, workspace.tree);
        if (node) node.modifiedAt = Date.now();
    }
    try {
        const payload = JSON.stringify(workspace);
        localStorage.setItem(WS_KEY, payload);
    } catch { }
    if (statSaveEl) {
        statSaveEl.textContent = 'Đang lưu...';
        statSaveEl.classList.add('saving');
        clearTimeout(saveIndicatorTimer);
        saveIndicatorTimer = setTimeout(() => {
            statSaveEl.textContent = 'Đã lưu';
            statSaveEl.classList.remove('saving');
        }, 600);
    }
}

function findNodeById(id, nodes) {
    for (const n of nodes) {
        if (n.id === id) return n;
        if (n.type === 'folder' && n.children) {
            const found = findNodeById(id, n.children);
            if (found) return found;
        }
    }
    return null;
}

function findParentArray(id, nodes) {
    for (let i = 0; i < nodes.length; i++) {
        if (nodes[i].id === id) return { arr: nodes, idx: i };
        if (nodes[i].type === 'folder' && nodes[i].children) {
            const found = findParentArray(id, nodes[i].children);
            if (found) return found;
        }
    }
    return null;
}

function getAllFileIds(nodes) {
    let ids = [];
    for (const n of nodes) {
        if (n.type === 'file') ids.push(n.id);
        if (n.type === 'folder' && n.children) ids = ids.concat(getAllFileIds(n.children));
    }
    return ids;
}

function collectAllIds(nodes) {
    let ids = [];
    for (const n of nodes) {
        ids.push(n.id);
        if (n.children) ids = ids.concat(collectAllIds(n.children));
    }
    return ids;
}

function deepCloneNode(node) {
    const now = Date.now();
    const clone = { ...node, id: generateId(), createdAt: now, modifiedAt: now };
    if (node.type === 'file') {
        workspace.files[clone.id] = workspace.files[node.id] || '';
    }
    if (node.type === 'folder' && node.children) {
        clone.children = node.children.map(c => deepCloneNode(c));
    }
    return clone;
}

// ── Sort ──────────────────────────────────────
const SORT_MODES = ['manual', 'name', 'modified', 'created'];
const SORT_LABELS = { manual: 'Thủ công', name: 'Tên', modified: 'Ngày sửa', created: 'Ngày tạo' };

function sortNodes(nodes) {
    if (workspace.sortMode === 'manual') return nodes;
    return [...nodes].sort((a, b) => {
        if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
        switch (workspace.sortMode) {
            case 'name': return a.name.localeCompare(b.name);
            case 'modified': return (b.modifiedAt || 0) - (a.modifiedAt || 0);
            case 'created': return (b.createdAt || 0) - (a.createdAt || 0);
            default: return 0;
        }
    });
}

function setSortMode(mode) {
    workspace.sortMode = mode;
    btnSort.title = `Sắp xếp: ${SORT_LABELS[mode]}`;
    btnSort.classList.toggle('active', mode !== 'manual');
    hideSortMenu();
    saveWorkspace();
    renderTree();
}

const sortMenu = document.getElementById('sort-menu');

function showSortMenu() {
    const rect = btnSort.getBoundingClientRect();
    sortMenu.style.left = rect.left + 'px';
    sortMenu.style.top = (rect.bottom + 4) + 'px';
    sortMenu.querySelectorAll('button').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.sort === workspace.sortMode);
    });
    sortMenu.classList.add('visible');
}

function hideSortMenu() {
    sortMenu.classList.remove('visible');
}

btnSort.addEventListener('click', (e) => {
    e.stopPropagation();
    if (sortMenu.classList.contains('visible')) hideSortMenu();
    else showSortMenu();
});

sortMenu.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-sort]');
    if (!btn) return;
    setSortMode(btn.dataset.sort);
});


// ── Sidebar Undo Stack ────────────────────────
const sidebarUndoStack = [];
const MAX_SIDEBAR_UNDO = 30;
let lastActionType = 'editor';

function pushSidebarUndo() {
    const activeId = workspace.activeFileId;
    if (activeId && workspace.files[activeId] !== editor.value) {
        workspace.files[activeId] = editor.value;
    }
    lastActionType = 'sidebar';
    sidebarUndoStack.push({
        tree: JSON.parse(JSON.stringify(workspace.tree)),
        files: { ...workspace.files },
        activeFileId: workspace.activeFileId
    });
    if (sidebarUndoStack.length > MAX_SIDEBAR_UNDO) sidebarUndoStack.shift();
}

function performSidebarUndo() {
    if (sidebarUndoStack.length === 0) { showToast('Không có gì để hoàn tác'); return; }
    const prev = sidebarUndoStack.pop();
    workspace.tree = prev.tree;
    workspace.files = prev.files;
    workspace.activeFileId = prev.activeFileId;
    editor.value = workspace.activeFileId ? (workspace.files[workspace.activeFileId] || '') : '';
    undoStack.length = 0;
    redoStack.length = 0;
    lastSavedText = editor.value;
    lastSavedStart = 0;
    lastSavedEnd = 0;
    updateUndoRedoButtons();
    saveWorkspace();
    renderTree();
    update();
    showToast('Đã hoàn tác');
}

// ── Per-file Undo/Redo Stacks (in memory) ─────
const fileStacks = new Map();
const undoStack = [];
const redoStack = [];
const MAX_HISTORY = 200;
let debounceTimer = null;
let lastSavedText = '';
let lastSavedStart = 0;
let lastSavedEnd = 0;

function snapshot() {
    return { text: editor.value, start: editor.selectionStart, end: editor.selectionEnd };
}

function pushUndo(snap) {
    if (!snap) snap = snapshot();
    if (undoStack.length > 0 && undoStack[undoStack.length - 1].text === snap.text) return;
    undoStack.push(snap);
    if (undoStack.length > MAX_HISTORY) undoStack.shift();
    redoStack.length = 0;
    updateUndoRedoButtons();
}

function restoreSnapshot(snap) {
    editor.value = snap.text;
    editor.setSelectionRange(snap.start, snap.end);
    update();
}

function performUndo() {
    if (undoStack.length === 0) return;
    clearTimeout(debounceTimer);
    if (editor.value !== lastSavedText) {
        pushUndo({ text: lastSavedText, start: lastSavedStart, end: lastSavedEnd });
        lastSavedText = editor.value;
    }
    redoStack.push(snapshot());
    restoreSnapshot(undoStack.pop());
    lastSavedText = editor.value;
    lastSavedStart = editor.selectionStart;
    lastSavedEnd = editor.selectionEnd;
    updateUndoRedoButtons();
}

function performRedo() {
    if (redoStack.length === 0) return;
    clearTimeout(debounceTimer);
    undoStack.push(snapshot());
    restoreSnapshot(redoStack.pop());
    lastSavedText = editor.value;
    lastSavedStart = editor.selectionStart;
    lastSavedEnd = editor.selectionEnd;
    updateUndoRedoButtons();
}

function updateUndoRedoButtons() {
    btnUndo.disabled = undoStack.length === 0;
    btnRedo.disabled = redoStack.length === 0;
}

// ── File Switching ────────────────────────────
function saveCurrentFileStacks() {
    if (!workspace.activeFileId) return;
    fileStacks.set(workspace.activeFileId, { undoStack: undoStack.slice(), redoStack: redoStack.slice() });
}

function switchFile(id) {
    if (id === workspace.activeFileId) return;
    clearTimeout(debounceTimer);
    lastClickedId = id;

    const oldId = workspace.activeFileId;
    if (oldId && workspace.files[oldId] !== editor.value) {
        workspace.files[oldId] = editor.value;
        const oldNode = findNodeById(oldId, workspace.tree);
        if (oldNode) oldNode.modifiedAt = Date.now();
    }
    saveCurrentFileStacks();

    workspace.activeFileId = id;
    editor.value = workspace.files[id] || '';

    const stacks = fileStacks.get(id);
    undoStack.length = 0;
    redoStack.length = 0;
    if (stacks) { undoStack.push(...stacks.undoStack); redoStack.push(...stacks.redoStack); }
    else { undoStack.push({ text: editor.value, start: 0, end: 0 }); }

    lastSavedText = editor.value;
    lastSavedStart = 0;
    lastSavedEnd = 0;
    updateUndoRedoButtons();
    update();
    findAllMatches();
    updateHighlights();
    renderTree();
    saveWorkspace();

    if (isMobile()) closeSidebar();
}

// ── Sidebar Toggle ────────────────────────────
function isMobile() { return window.innerWidth <= 768; }

function openSidebar() {
    sidebarEl.classList.remove('hidden');
    workspace.sidebarOpen = true;
    if (isMobile()) backdropEl.classList.add('visible');
    saveWorkspace();
}

function closeSidebar() {
    sidebarEl.classList.add('hidden');
    workspace.sidebarOpen = false;
    backdropEl.classList.remove('visible');
    saveWorkspace();
}

function toggleSidebar() {
    if (sidebarEl.classList.contains('hidden')) openSidebar();
    else closeSidebar();
}

document.getElementById('btn-toggle-sidebar').addEventListener('click', toggleSidebar);
backdropEl.addEventListener('click', closeSidebar);

// ── Sidebar: Render Tree ──────────────────────
const sidebarStatsEl = document.getElementById('sidebar-stats');

function updateSidebarStats() {
    const counts = countNodes(workspace.tree);
    const parts = [];
    if (counts.files > 0) parts.push(`${counts.files} file`);
    if (counts.folders > 0) parts.push(`${counts.folders} folder`);
    if (parts.length === 0) parts.push('Trống');
    sidebarStatsEl.textContent = parts.join(' · ');
}

function renderTree() {
    fileTreeEl.innerHTML = '';
    sortNodes(workspace.tree).forEach(node => fileTreeEl.appendChild(renderNode(node, 0)));
    updateSidebarStats();
}

function renderNode(node, depth) {
    const item = document.createElement('div');
    item.className = 'tree-item';
    item.dataset.id = node.id;
    item.dataset.type = node.type;
    item.draggable = workspace.sortMode === 'manual';

    const row = document.createElement('div');
    row.className = 'tree-item-row';
    if (node.id === (lastClickedId || workspace.activeFileId)) {
        row.classList.add('active');
    } else if (node.type === 'file' && node.id === workspace.activeFileId) {
        row.classList.add('active-editing');
    }
    if (selectedIds.has(node.id)) row.classList.add('selected');
    row.style.paddingLeft = (12 + depth * 20) + 'px';
    if (depth > 0) {
        for (let i = 0; i < depth; i++) {
            const guide = document.createElement('span');
            guide.className = 'tree-guide';
            guide.style.left = (12 + i * 20 + 9) + 'px';
            row.appendChild(guide);
        }
    }

    const titleParts = [];
    if (node.createdAt) titleParts.push(`Tạo: ${formatDateFull(node.createdAt)}`);
    if (node.modifiedAt) titleParts.push(`Sửa: ${formatDateFull(node.modifiedAt)}`);
    if (titleParts.length) row.title = titleParts.join('\n');

    if (node.type === 'folder') {
        const chevron = document.createElement('span');
        chevron.className = 'tree-chevron' + (node.expanded ? ' expanded' : '');
        chevron.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>';
        row.appendChild(chevron);
    }

    const icon = document.createElement('span');
    icon.className = 'tree-icon';
    icon.innerHTML = node.type === 'folder'
        ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/></svg>'
        : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/></svg>';
    row.appendChild(icon);

    const nameWrap = document.createElement('div');
    nameWrap.className = 'tree-name-wrap';

    const nameEl = document.createElement('span');
    nameEl.className = 'tree-name';
    const displayName = getDisplayName(node);
    nameEl.textContent = displayName;
    if (!node.name && node.type === 'file') nameEl.classList.add('auto-name');
    nameWrap.appendChild(nameEl);

    if (node.modifiedAt) {
        const dateEl = document.createElement('span');
        dateEl.className = 'tree-date';
        dateEl.textContent = formatDate(node.modifiedAt);
        nameWrap.appendChild(dateEl);
    }

    row.appendChild(nameWrap);
    item.appendChild(row);

    if (node.type === 'folder') {
        const children = document.createElement('div');
        children.className = 'tree-children';
        if (!node.expanded) children.style.display = 'none';
        if (node.children) {
            sortNodes(node.children).forEach(child => children.appendChild(renderNode(child, depth + 1)));
        }
        item.appendChild(children);
    }

    return item;
}

// ── Focus Area Tracking ──────────────────────
let focusArea = 'editor';

const FOCUS_LABELS = { sidebar: 'Sidebar', toolbar: 'Toolbar', editor: 'Editor' };
const statFocusEl = document.getElementById('stat-focus');

function setFocusArea(area) {
    if (focusArea === area) return;
    focusArea = area;
    sidebarEl.classList.toggle('area-focused', area === 'sidebar');
    document.querySelector('.top-bar').classList.toggle('area-focused', area === 'toolbar');
    editorWrap.classList.toggle('area-focused', area === 'editor');
    if (statFocusEl) statFocusEl.textContent = FOCUS_LABELS[area] || area;
}

sidebarEl.addEventListener('mousedown', () => setFocusArea('sidebar'));
document.querySelector('.top-bar').addEventListener('mousedown', () => setFocusArea('toolbar'));
editor.addEventListener('focus', () => setFocusArea('editor'));

// ── Multi-Select ──────────────────────────────
const selectedIds = new Set();
let lastClickedId = null;

function clearSelection() {
    selectedIds.clear();
    fileTreeEl.querySelectorAll('.tree-item-row.selected').forEach(el => el.classList.remove('selected'));
}

function toggleSelection(id) {
    if (selectedIds.has(id)) {
        selectedIds.delete(id);
    } else {
        selectedIds.add(id);
    }
    updateSelectionVisuals();
}

function selectRange(fromId, toId) {
    const allIds = [];
    function walk(nodes) {
        const sorted = sortNodes(nodes);
        for (const n of sorted) {
            allIds.push(n.id);
            if (n.type === 'folder' && n.expanded && n.children) walk(n.children);
        }
    }
    walk(workspace.tree);

    const fromIdx = allIds.indexOf(fromId);
    const toIdx = allIds.indexOf(toId);
    if (fromIdx < 0 || toIdx < 0) return;
    const start = Math.min(fromIdx, toIdx);
    const end = Math.max(fromIdx, toIdx);
    for (let i = start; i <= end; i++) selectedIds.add(allIds[i]);
    updateSelectionVisuals();
}

function selectAll() {
    selectedIds.clear();
    collectAllIds(workspace.tree).forEach(id => selectedIds.add(id));
    updateSelectionVisuals();
}

function updateSelectionVisuals() {
    fileTreeEl.querySelectorAll('.tree-item-row').forEach(row => {
        const item = row.closest('.tree-item');
        if (item) row.classList.toggle('selected', selectedIds.has(item.dataset.id));
    });
}

function deleteSelected() {
    if (selectedIds.size === 0) return;
    pushSidebarUndo();
    const ids = [...selectedIds];
    const alreadyRemoved = new Set();
    for (const id of ids) {
        if (alreadyRemoved.has(id)) continue;
        const node = findNodeById(id, workspace.tree);
        if (!node) continue;
        const parent = findParentArray(id, workspace.tree);
        if (!parent) continue;
        const allFileIds = collectAllIds([node]);
        parent.arr.splice(parent.idx, 1);
        allFileIds.forEach(fid => { delete workspace.files[fid]; fileStacks.delete(fid); alreadyRemoved.add(fid); });
        alreadyRemoved.add(id);
    }
    selectedIds.clear();
    const remaining = getAllFileIds(workspace.tree);
    if (remaining.length === 0) {
        workspace.activeFileId = null;
    } else if (!remaining.includes(workspace.activeFileId)) {
        workspace.activeFileId = remaining[0];
    }
    editor.value = workspace.activeFileId ? (workspace.files[workspace.activeFileId] || '') : '';
    undoStack.length = 0;
    redoStack.length = 0;
    lastSavedText = editor.value;
    updateUndoRedoButtons();
    update();
    saveWorkspace();
    renderTree();
    showToast(`Đã xóa ${ids.length} mục (Ctrl+Z để hoàn tác)`);
}

// ── Sidebar: Events ───────────────────────────
fileTreeEl.addEventListener('click', (e) => {
    const row = e.target.closest('.tree-item-row');
    if (!row) return;
    const item = row.closest('.tree-item');
    const id = item.dataset.id;
    const type = item.dataset.type;

    if (e.target.closest('.tree-chevron')) {
        const node = findNodeById(id, workspace.tree);
        if (node) { node.expanded = !node.expanded; saveWorkspace(); renderTree(); }
        return;
    }

    if (e.ctrlKey) {
        toggleSelection(id);
        lastClickedId = id;
        return;
    }
    if (e.shiftKey && lastClickedId) {
        selectRange(lastClickedId, id);
        return;
    }

    clearSelection();
    lastClickedId = id;
    if (type === 'file') {
        switchFile(id);
        updateSidebarStats();
    } else if (type === 'folder') {
        const node = findNodeById(id, workspace.tree);
        if (node) {
            node.expanded = !node.expanded;
            saveWorkspace();
            renderTree();
            const fc = countNodes(node.children || []);
            sidebarStatsEl.textContent = `${getDisplayName(node)}: ${fc.files} file, ${fc.folders} folder`;
        }
    }
});

fileTreeEl.addEventListener('dblclick', (e) => {
    const row = e.target.closest('.tree-item-row');
    if (!row || e.target.closest('.tree-chevron')) return;
    startInlineRename(row.closest('.tree-item').dataset.id);
});

// ── Inline Rename ─────────────────────────────
function startInlineRename(id, skipUndo) {
    const node = findNodeById(id, workspace.tree);
    if (!node) return;
    const item = fileTreeEl.querySelector(`.tree-item[data-id="${id}"]`);
    if (!item) return;

    const nameEl = item.querySelector('.tree-name');
    if (!nameEl) return;

    if (!skipUndo) pushSidebarUndo();

    const input = document.createElement('input');
    input.className = 'tree-name-input';
    const currentDisplay = getDisplayName(node);
    input.value = currentDisplay;
    input.spellcheck = false;

    const wrap = nameEl.closest('.tree-name-wrap');
    const dateEl = wrap?.querySelector('.tree-date');
    if (dateEl) dateEl.style.display = 'none';
    nameEl.replaceWith(input);

    input.focus();
    const dotIdx = currentDisplay.lastIndexOf('.');
    input.setSelectionRange(0, dotIdx > 0 ? dotIdx : currentDisplay.length);

    function commit() {
        const newName = input.value.trim();
        if (newName && newName !== currentDisplay) {
            const parentInfo = findParentArray(id, workspace.tree);
            const siblings = parentInfo ? parentInfo.arr : workspace.tree;
            node.name = ensureUniqueName(newName, siblings, id);
            node.modifiedAt = Date.now();
            saveWorkspace();
        }
        renderTree();
    }

    input.addEventListener('blur', commit);
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
        if (e.key === 'Escape') { input.value = node.name; input.blur(); }
    });
}

// ── Context Menu ──────────────────────────────
let contextTargetId = null;

fileTreeEl.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const row = e.target.closest('.tree-item-row');
    if (!row) return;
    contextTargetId = row.closest('.tree-item').dataset.id;
    showContextMenu(e.clientX, e.clientY);
});

function showContextMenu(x, y) {
    contextMenuEl.style.left = Math.min(x, window.innerWidth - 200) + 'px';
    contextMenuEl.style.top = Math.min(y, window.innerHeight - 200) + 'px';
    contextMenuEl.classList.add('visible');
}

function hideContextMenu() {
    contextMenuEl.classList.remove('visible');
    contextTargetId = null;
}

document.addEventListener('click', (e) => {
    if (!contextMenuEl.contains(e.target)) hideContextMenu();
    if (!sortMenu.contains(e.target) && e.target !== btnSort && !btnSort.contains(e.target)) hideSortMenu();
});

contextMenuEl.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn || !contextTargetId) return;
    const action = btn.dataset.action;
    const id = contextTargetId;
    hideContextMenu();

    switch (action) {
        case 'rename': startInlineRename(id); break;
        case 'duplicate': duplicateNode(id); break;
        case 'download': downloadNode(id); break;
        case 'delete':
            if (selectedIds.size > 1 && selectedIds.has(id)) {
                deleteSelected();
            } else {
                deleteNode(id);
            }
            break;
        case 'new-file': createFile(id); break;
        case 'new-folder': createFolder(id); break;
    }
});

// ── File Operations ───────────────────────────
function createFile(nearId) {
    pushSidebarUndo();
    const id = generateId();
    const now = Date.now();
    const defaultName = 'Văn bản mới';
    const newNode = { id, type: 'file', name: defaultName, createdAt: now, modifiedAt: now };
    workspace.files[id] = '';

    if (nearId) {
        const node = findNodeById(nearId, workspace.tree);
        if (node && node.type === 'folder') {
            if (!node.children) node.children = [];
            newNode.name = ensureUniqueName(defaultName, node.children, id);
            node.children.push(newNode);
            node.expanded = true;
        } else {
            const parent = findParentArray(nearId, workspace.tree);
            const siblings = parent ? parent.arr : workspace.tree;
            newNode.name = ensureUniqueName(defaultName, siblings, id);
            if (parent) parent.arr.splice(parent.idx + 1, 0, newNode);
            else workspace.tree.push(newNode);
        }
    } else {
        newNode.name = ensureUniqueName(defaultName, workspace.tree, id);
        workspace.tree.push(newNode);
    }

    saveWorkspace();
    renderTree();
    switchFile(id);
    setTimeout(() => startInlineRename(id, true), 50);
}

function createFolder(nearId) {
    pushSidebarUndo();
    const id = generateId();
    const now = Date.now();
    const newNode = { id, type: 'folder', name: 'New Folder', expanded: true, children: [], createdAt: now, modifiedAt: now };

    if (nearId) {
        const node = findNodeById(nearId, workspace.tree);
        if (node && node.type === 'folder') {
            if (!node.children) node.children = [];
            newNode.name = ensureUniqueName(newNode.name, node.children, newNode.id);
            node.children.push(newNode);
            node.expanded = true;
        } else {
            const parent = findParentArray(nearId, workspace.tree);
            const siblings = parent ? parent.arr : workspace.tree;
            newNode.name = ensureUniqueName(newNode.name, siblings, newNode.id);
            if (parent) parent.arr.splice(parent.idx + 1, 0, newNode);
            else workspace.tree.push(newNode);
        }
    } else {
        newNode.name = ensureUniqueName(newNode.name, workspace.tree, newNode.id);
        workspace.tree.push(newNode);
    }

    saveWorkspace();
    renderTree();
    setTimeout(() => startInlineRename(id, true), 50);
}

function deleteNode(id) {
    pushSidebarUndo();
    const allIds = collectAllIds([findNodeById(id, workspace.tree)].filter(Boolean));
    const parent = findParentArray(id, workspace.tree);
    if (!parent) return;

    const needSwitch = allIds.includes(workspace.activeFileId);
    parent.arr.splice(parent.idx, 1);
    allIds.forEach(fid => { delete workspace.files[fid]; fileStacks.delete(fid); });

    if (needSwitch) {
        const remaining = getAllFileIds(workspace.tree);
        if (remaining.length === 0) {
            workspace.activeFileId = null;
        } else {
            workspace.activeFileId = remaining[0];
        }
        editor.value = workspace.activeFileId ? (workspace.files[workspace.activeFileId] || '') : '';
        undoStack.length = 0;
        redoStack.length = 0;
        lastSavedText = editor.value;
        lastSavedStart = 0;
        lastSavedEnd = 0;
        updateUndoRedoButtons();
        update();
    }

    saveWorkspace();
    renderTree();
    showToast('Đã xóa (Ctrl+Z để hoàn tác)');
}

function duplicateNode(id) {
    pushSidebarUndo();
    const original = findNodeById(id, workspace.tree);
    if (!original) return;
    const parent = findParentArray(id, workspace.tree);
    if (!parent) return;

    const clone = deepCloneNode(original);
    const nameForCopy = clone.name || getDisplayName(original);
    const baseName = nameForCopy.replace(/\.\w+$/, '');
    const ext = nameForCopy.includes('.') ? nameForCopy.substring(nameForCopy.lastIndexOf('.')) : '';
    clone.name = baseName + ' (copy)' + ext;

    parent.arr.splice(parent.idx + 1, 0, clone);
    saveWorkspace();
    renderTree();
    if (clone.type === 'file') switchFile(clone.id);
    showToast('Đã nhân bản');
}

// ── Download Node (file or folder as zip) ─────
function downloadNode(id) {
    const node = findNodeById(id, workspace.tree);
    if (!node) return;

    if (node.type === 'file') {
        const content = workspace.files[id] || '';
        if (!content) { showToast('File trống'); return; }
        const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = getDownloadName(node);
        a.click();
        URL.revokeObjectURL(a.href);
        showToast(`Đã tải xuống ${getDownloadName(node)}`);
    } else if (node.type === 'folder') {
        downloadFolderAsZip(node);
    }
}

function downloadFolderAsZip(node) {
    const enc = new TextEncoder();
    const entries = [];
    const usedNames = new Map();

    function uniqueName(name) {
        if (!usedNames.has(name)) { usedNames.set(name, 1); return name; }
        const count = usedNames.get(name);
        usedNames.set(name, count + 1);
        const dot = name.lastIndexOf('.');
        if (dot > 0) return name.substring(0, dot) + ` (${count})` + name.substring(dot);
        return name + ` (${count})`;
    }

    function collectFiles(n, path) {
        if (n.type === 'file') {
            const fileName = getDownloadName(n);
            const fullName = uniqueName(path + fileName);
            entries.push({ name: fullName, data: enc.encode(workspace.files[n.id] || '') });
        } else if (n.type === 'folder' && n.children) {
            const folderName = n.name || 'Folder';
            for (const child of n.children) collectFiles(child, path + folderName + '/');
        }
    }

    collectFiles(node, '');
    if (entries.length === 0) { showToast('Folder trống'); return; }

    const blob = createZipBlob(entries);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = node.name + '.zip';
    a.click();
    URL.revokeObjectURL(a.href);
    showToast(`Đã tải xuống ${a.download}`);
}

// ── Sidebar Header Buttons ────────────────────
document.getElementById('btn-new-file').addEventListener('click', () => createFile(lastClickedId));
document.getElementById('btn-new-folder').addEventListener('click', () => createFolder(lastClickedId));
document.getElementById('btn-import').addEventListener('click', () => importInput.click());

importInput.addEventListener('change', () => {
    const files = importInput.files;
    if (!files || files.length === 0) return;
    pushSidebarUndo();
    let lastId = null;
    let loaded = 0;
    const total = files.length;
    const now = Date.now();

    for (const file of files) {
        const reader = new FileReader();
        reader.onload = (evt) => {
            const id = generateId();
            const safeName = ensureUniqueName(file.name, workspace.tree, id);
            workspace.tree.push({ id, type: 'file', name: safeName, createdAt: now, modifiedAt: now });
            workspace.files[id] = evt.target.result;
            lastId = id;
            loaded++;
            if (loaded === total) {
                saveWorkspace();
                renderTree();
                if (lastId) switchFile(lastId);
                showToast(`Đã import ${total} file`);
            }
        };
        reader.readAsText(file, 'UTF-8');
    }
    importInput.value = '';
});

// ── Tree Drag & Drop ──────────────────────────
let draggedId = null;

fileTreeEl.addEventListener('dragstart', (e) => {
    if (workspace.sortMode !== 'manual') { e.preventDefault(); return; }
    const item = e.target.closest('.tree-item');
    if (!item) return;
    draggedId = item.dataset.id;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', draggedId);
    item.style.opacity = '0.4';
});

fileTreeEl.addEventListener('dragend', (e) => {
    const item = e.target.closest('.tree-item');
    if (item) item.style.opacity = '';
    clearDragIndicators();
    draggedId = null;
});

fileTreeEl.addEventListener('dragover', (e) => {
    if (!draggedId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    clearDragIndicators();
    const row = e.target.closest('.tree-item-row');
    if (!row) return;
    const item = row.closest('.tree-item');
    if (item.dataset.id === draggedId) return;
    if (selectedIds.size > 1 && selectedIds.has(item.dataset.id)) return;
    const rect = row.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const h = rect.height;
    if (item.dataset.type === 'folder') {
        if (y < h * 0.25) row.classList.add('drag-above');
        else if (y > h * 0.75) row.classList.add('drag-below');
        else row.classList.add('drag-inside');
    } else {
        row.classList.add(y < h / 2 ? 'drag-above' : 'drag-below');
    }
});

fileTreeEl.addEventListener('dragleave', (e) => {
    const row = e.target.closest('.tree-item-row');
    if (row) row.classList.remove('drag-above', 'drag-below', 'drag-inside');
});

fileTreeEl.addEventListener('drop', (e) => {
    e.preventDefault();
    clearDragIndicators();
    const row = e.target.closest('.tree-item-row');
    if (!row || !draggedId) return;
    const targetItem = row.closest('.tree-item');
    const targetId = targetItem.dataset.id;
    if (targetId === draggedId) return;
    if (selectedIds.size > 1 && selectedIds.has(targetId)) return;

    const draggedNode = findNodeById(draggedId, workspace.tree);
    if (draggedNode && draggedNode.type === 'folder') {
        if (findNodeById(targetId, draggedNode.children || [])) return;
    }

    const rect = row.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const h = rect.height;
    let position;
    if (targetItem.dataset.type === 'folder') {
        if (y < h * 0.25) position = 'before';
        else if (y > h * 0.75) position = 'after';
        else position = 'inside';
    } else {
        position = y < h / 2 ? 'before' : 'after';
    }

    pushSidebarUndo();
    if (selectedIds.size > 1 && selectedIds.has(draggedId)) {
        moveSelectedNodes(targetId, position);
    } else {
        moveNode(draggedId, targetId, position);
    }
    draggedId = null;
});

function clearDragIndicators() {
    fileTreeEl.querySelectorAll('.drag-above, .drag-below, .drag-inside').forEach(el => {
        el.classList.remove('drag-above', 'drag-below', 'drag-inside');
    });
}

function moveNode(sourceId, targetId, position) {
    const sourceParent = findParentArray(sourceId, workspace.tree);
    if (!sourceParent) return;
    const sourceNode = sourceParent.arr.splice(sourceParent.idx, 1)[0];
    sourceNode.modifiedAt = Date.now();

    if (position === 'inside') {
        const target = findNodeById(targetId, workspace.tree);
        if (target && target.type === 'folder') {
            if (!target.children) target.children = [];
            sourceNode.name = ensureUniqueName(sourceNode.name, target.children, sourceNode.id);
            target.children.push(sourceNode);
            target.expanded = true;
        }
    } else {
        const targetParent = findParentArray(targetId, workspace.tree);
        const destArr = targetParent ? targetParent.arr : workspace.tree;
        sourceNode.name = ensureUniqueName(sourceNode.name, destArr, sourceNode.id);
        if (!targetParent) { workspace.tree.push(sourceNode); } else {
            targetParent.arr.splice(position === 'before' ? targetParent.idx : targetParent.idx + 1, 0, sourceNode);
        }
    }

    saveWorkspace();
    renderTree();
}

function moveSelectedNodes(targetId, position) {
    const idsToMove = [...selectedIds].filter(id => {
        if (id === targetId) return false;
        const node = findNodeById(id, workspace.tree);
        if (!node) return false;
        if (node.type === 'folder') {
            if (findNodeById(targetId, node.children || [])) return false;
        }
        return true;
    });

    const nodes = [];
    for (const id of idsToMove) {
        const parent = findParentArray(id, workspace.tree);
        if (!parent) continue;
        const node = parent.arr.splice(parent.idx, 1)[0];
        node.modifiedAt = Date.now();
        nodes.push(node);
    }

    if (nodes.length === 0) return;

    if (position === 'inside') {
        const target = findNodeById(targetId, workspace.tree);
        if (target && target.type === 'folder') {
            if (!target.children) target.children = [];
            for (const node of nodes) {
                node.name = ensureUniqueName(node.name, target.children, node.id);
                target.children.push(node);
            }
            target.expanded = true;
        }
    } else {
        const targetParent = findParentArray(targetId, workspace.tree);
        const destArr = targetParent ? targetParent.arr : workspace.tree;
        const insertIdx = targetParent
            ? (position === 'before' ? targetParent.idx : targetParent.idx + 1)
            : destArr.length;
        for (let i = nodes.length - 1; i >= 0; i--) {
            nodes[i].name = ensureUniqueName(nodes[i].name, destArr, nodes[i].id);
            destArr.splice(insertIdx, 0, nodes[i]);
        }
    }

    selectedIds.clear();
    saveWorkspace();
    renderTree();
}

// ── Auto-resize ───────────────────────────────
const supportsFieldSizing = CSS.supports && CSS.supports('field-sizing', 'content');

function autoResize() {
    if (supportsFieldSizing) return;
    editor.style.height = '0';
    editor.style.height = Math.max(editor.scrollHeight, 320) + 'px';
}

// ── Gutter ────────────────────────────────────
function updateGutter() {
    const text = editor.value;
    const lines = text.split('\n');
    const currentLine = getCurrentLine();
    const editorStyles = getComputedStyle(editor);
    const editorWidth = editor.clientWidth - parseFloat(editorStyles.paddingLeft) - parseFloat(editorStyles.paddingRight);
    mirror.style.width = editorWidth + 'px';
    mirror.innerHTML = '';
    const lineEls = [];
    for (let i = 0; i < lines.length; i++) {
        const div = document.createElement('div');
        div.textContent = lines[i] || '\u200B';
        mirror.appendChild(div);
        lineEls.push(div);
    }
    let html = '';
    for (let i = 0; i < lineEls.length; i++) {
        const h = lineEls[i].getBoundingClientRect().height;
        const cls = (i + 1) === currentLine ? ' active' : '';
        html += `<div class="gutter-line${cls}" style="height:${h}px">${i + 1}</div>`;
    }
    gutter.innerHTML = html;
}

function getCurrentLine() {
    return editor.value.substring(0, editor.selectionStart).split('\n').length;
}

// ── Status Bar ────────────────────────────────
function updateStatus() {
    const text = editor.value;
    statChars.textContent = `${text.length} ký tự`;
    statWords.textContent = `${text.trim() === '' ? 0 : text.trim().split(/\s+/).length} từ`;
    statLines.textContent = `${text.split('\n').length} dòng`;
}

// ── Core Update ───────────────────────────────
function update() {
    autoResize();
    updateGutter();
    updateStatus();
    updateHighlights();
    updateSpaceHighlights();
    updateEmptyState();
    saveWorkspace();
}

function updateEmptyState() {
    editorWrap.classList.toggle('empty', editor.value === '');
}

// ── Find & Replace ────────────────────────────
let matches = [];
let currentMatchIndex = -1;
let findCaseSensitive = false;
let findUseRegex = false;

const btnCase = document.getElementById('btn-case');
const btnRegex = document.getElementById('btn-regex');

btnCase.addEventListener('click', () => {
    findCaseSensitive = !findCaseSensitive;
    btnCase.classList.toggle('active', findCaseSensitive);
    findAllMatches();
    updateHighlights();
});

btnRegex.addEventListener('click', () => {
    findUseRegex = !findUseRegex;
    btnRegex.classList.toggle('active', findUseRegex);
    findAllMatches();
    updateHighlights();
});

function findAllMatches() {
    const search = findInput.value;
    matches = [];
    currentMatchIndex = -1;
    if (!search || !findPanel.classList.contains('visible')) { matchCountEl.textContent = ''; return; }
    try {
        const pattern = findUseRegex ? search : escapeRegex(search);
        const flags = findCaseSensitive ? 'g' : 'gi';
        const regex = new RegExp(pattern, flags);
        let m;
        while ((m = regex.exec(editor.value)) !== null) {
            matches.push({ start: m.index, end: m.index + m[0].length });
            if (m[0].length === 0) break;
        }
    } catch { /* invalid regex */ }
    if (matches.length > 0) {
        const cursor = editor.selectionStart;
        currentMatchIndex = 0;
        for (let i = 0; i < matches.length; i++) { if (matches[i].start >= cursor) { currentMatchIndex = i; break; } }
        matchCountEl.textContent = `${currentMatchIndex + 1}/${matches.length}`;
    } else { matchCountEl.textContent = '0/0'; }
}

function goToMatch(index) {
    if (matches.length === 0) return;
    if (index < 0) index = matches.length - 1;
    if (index >= matches.length) index = 0;
    currentMatchIndex = index;
    const match = matches[currentMatchIndex];
    editor.focus();
    editor.setSelectionRange(match.start, match.end);
    matchCountEl.textContent = `${currentMatchIndex + 1}/${matches.length}`;
    const scrollTop = editor.scrollTop;
    editor.blur();
    editor.focus();
    if (editor.scrollTop === scrollTop) {
        const lineNum = editor.value.substring(0, match.start).split('\n').length;
        editor.scrollTop = Math.max(0, (lineNum - 3) * parseFloat(getComputedStyle(editor).lineHeight));
    }
    updateHighlights();
    updateGutter();
}

function findNext() { if (matches.length === 0) { findAllMatches(); if (matches.length === 0) return; } goToMatch(currentMatchIndex + 1); }
function findPrev() { if (matches.length === 0) { findAllMatches(); if (matches.length === 0) return; } goToMatch(currentMatchIndex - 1); }

// ── Highlight Overlay ─────────────────────────
function updateHighlights() {
    if (!findPanel.classList.contains('visible') || matches.length === 0) { highlightLayer.innerHTML = ''; return; }
    const text = editor.value;
    let html = '';
    let lastEnd = 0;
    for (let i = 0; i < matches.length; i++) {
        const m = matches[i];
        html += escapeHTML(text.substring(lastEnd, m.start));
        html += `<mark class="${i === currentMatchIndex ? 'current' : 'match'}">${escapeHTML(text.substring(m.start, m.end))}</mark>`;
        lastEnd = m.end;
    }
    html += escapeHTML(text.substring(lastEnd));
    highlightLayer.innerHTML = html;
}

// ── Show Spaces ───────────────────────────────
let showSpaces = false;

btnShowSpaces.addEventListener('click', () => {
    showSpaces = !showSpaces;
    btnShowSpaces.classList.toggle('active', showSpaces);
    updateSpaceHighlights();
});

function updateSpaceHighlights() {
    if (!showSpaces) { spaceLayer.innerHTML = ''; return; }
    const lines = editor.value.split('\n');
    let html = '';
    for (let i = 0; i < lines.length; i++) {
        if (i > 0) html += '\n';
        const line = lines[i];
        if (line.length === 0) continue;
        const leadingMatch = line.match(/^([ \t]+)/);
        const trailingMatch = line.match(/([ \t]+)$/);
        const leadingLen = leadingMatch ? leadingMatch[1].length : 0;
        const trailingStart = trailingMatch ? line.length - trailingMatch[1].length : line.length;
        if (leadingLen > 0 && trailingStart <= leadingLen) { html += `<span class="ws-trailing">${escapeHTML(line)}</span>`; continue; }
        if (leadingLen > 0) html += `<span class="ws-leading">${escapeHTML(line.substring(0, leadingLen))}</span>`;
        let pos = leadingLen;
        while (pos < trailingStart) {
            const sm = line.substring(pos, trailingStart).match(/^([ \t]+)/);
            if (sm) { const cls = sm[1].length > 1 || sm[1].includes('\t') ? 'ws-multi' : 'ws-single'; html += `<span class="${cls}">${escapeHTML(sm[1])}</span>`; pos += sm[1].length; }
            else { const nm = line.substring(pos, trailingStart).match(/^([^ \t]+)/); if (nm) { html += escapeHTML(nm[1]); pos += nm[1].length; } else break; }
        }
        if (trailingStart < line.length) html += `<span class="ws-trailing">${escapeHTML(line.substring(trailingStart))}</span>`;
    }
    spaceLayer.innerHTML = html;
}

// ── Paste ─────────────────────────────────────
editor.addEventListener('paste', (e) => {
    e.preventDefault();
    ensureActiveFile();
    clearTimeout(debounceTimer);
    pushUndo();
    const plain = (e.clipboardData || window.clipboardData).getData('text/plain');
    const start = editor.selectionStart;
    const end = editor.selectionEnd;
    editor.value = editor.value.substring(0, start) + plain + editor.value.substring(end);
    const newPos = start + plain.length;
    editor.setSelectionRange(newPos, newPos);
    lastSavedText = editor.value;
    lastSavedStart = newPos;
    lastSavedEnd = newPos;
    update();
    findAllMatches();
});

// ── Input ─────────────────────────────────────
let treeNameTimer = null;
function ensureActiveFile() {
    if (workspace.activeFileId) return;
    const id = generateId();
    const now = Date.now();
    workspace.tree.push({ id, type: 'file', name: '', createdAt: now, modifiedAt: now });
    workspace.files[id] = '';
    workspace.activeFileId = id;
    lastClickedId = id;
    renderTree();
}
editor.addEventListener('input', () => {
    ensureActiveFile();
    usageData.totalKeystrokes++;
    lastActionType = 'editor';
    clearTimeout(debounceTimer);
    const currentText = editor.value;
    debounceTimer = setTimeout(() => {
        if (currentText !== lastSavedText) {
            pushUndo({ text: lastSavedText, start: lastSavedStart, end: lastSavedEnd });
            lastSavedText = currentText;
            lastSavedStart = editor.selectionStart;
            lastSavedEnd = editor.selectionEnd;
        }
    }, 300);
    update();
    findAllMatches();
    updateHighlights();
    const activeNode = findNodeById(workspace.activeFileId, workspace.tree);
    if (activeNode && !activeNode.name) {
        clearTimeout(treeNameTimer);
        treeNameTimer = setTimeout(() => renderTree(), 500);
    }
});

editor.addEventListener('click', () => updateGutter());
editor.addEventListener('keyup', () => updateGutter());
editor.addEventListener('focus', () => editorWrap.classList.add('focused'));
editor.addEventListener('blur', () => editorWrap.classList.remove('focused'));

window.addEventListener('resize', () => {
    update();
    if (!isMobile()) backdropEl.classList.remove('visible');
});

// ── Toolbar Buttons ───────────────────────────
btnUndo.addEventListener('click', () => { performUndo(); findAllMatches(); updateHighlights(); });
btnRedo.addEventListener('click', () => { performRedo(); findAllMatches(); updateHighlights(); });

document.getElementById('btn-copy').addEventListener('click', async () => {
    if (!editor.value) { showToast('Không có nội dung để sao chép'); return; }
    try { await navigator.clipboard.writeText(editor.value); showToast('Đã sao chép vào clipboard'); }
    catch { showToast('Không thể sao chép'); }
});

document.getElementById('btn-paste').addEventListener('click', async () => {
    try {
        clearTimeout(debounceTimer);
        pushUndo();
        const text = await navigator.clipboard.readText();
        const start = editor.selectionStart;
        const end = editor.selectionEnd;
        editor.value = editor.value.substring(0, start) + text + editor.value.substring(end);
        const newPos = start + text.length;
        editor.setSelectionRange(newPos, newPos);
        lastSavedText = editor.value;
        lastSavedStart = newPos;
        lastSavedEnd = newPos;
        editor.focus();
        update();
        findAllMatches();
        showToast('Đã dán văn bản');
    } catch { showToast('Không thể đọc clipboard'); }
});

document.getElementById('btn-clear').addEventListener('click', () => {
    if (!editor.value) { showToast('Trình soạn thảo đã trống'); return; }
    clearTimeout(debounceTimer);
    pushUndo();
    editor.value = '';
    lastSavedText = '';
    lastSavedStart = 0;
    lastSavedEnd = 0;
    editor.focus();
    update();
    findAllMatches();
    showToast('Đã xóa tất cả nội dung');
});

// ── Find & Replace: Toggle ────────────────────
function toggleFind(show) {
    const visible = show !== undefined ? show : !findPanel.classList.contains('visible');
    findPanel.classList.toggle('visible', visible);
    if (visible) { findInput.focus(); findAllMatches(); updateHighlights(); }
    else { matches = []; currentMatchIndex = -1; matchCountEl.textContent = ''; highlightLayer.innerHTML = ''; }
}

document.getElementById('btn-find').addEventListener('click', () => toggleFind());
document.getElementById('btn-close-find').addEventListener('click', () => toggleFind(false));
document.getElementById('btn-find-next').addEventListener('click', findNext);
document.getElementById('btn-find-prev').addEventListener('click', findPrev);

findInput.addEventListener('input', () => { findAllMatches(); updateHighlights(); if (matches.length > 0) goToMatch(currentMatchIndex); });
findInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); e.shiftKey ? findPrev() : findNext(); } });

document.getElementById('btn-replace-all').addEventListener('click', () => {
    const search = findInput.value;
    if (!search) { showToast('Nhập từ cần tìm'); return; }
    const regex = new RegExp(escapeRegex(search), 'gi');
    const matchCount = (editor.value.match(regex) || []).length;
    if (matchCount === 0) { showToast('Không tìm thấy kết quả'); return; }
    clearTimeout(debounceTimer);
    pushUndo();
    editor.value = editor.value.replace(regex, replaceInput.value);
    lastSavedText = editor.value;
    lastSavedStart = editor.selectionStart;
    lastSavedEnd = editor.selectionEnd;
    update();
    findAllMatches();
    updateHighlights();
    showToast(`Đã thay thế ${matchCount} kết quả`);
});

document.getElementById('btn-replace-one').addEventListener('click', () => {
    const search = findInput.value;
    if (!search) { showToast('Nhập từ cần tìm'); return; }
    if (matches.length === 0 || currentMatchIndex < 0) { findAllMatches(); if (matches.length === 0) { showToast('Không tìm thấy kết quả'); return; } }
    const match = matches[currentMatchIndex];
    const replacement = replaceInput.value;
    clearTimeout(debounceTimer);
    pushUndo();
    editor.value = editor.value.substring(0, match.start) + replacement + editor.value.substring(match.end);
    const newPos = match.start + replacement.length;
    editor.setSelectionRange(newPos, newPos);
    lastSavedText = editor.value;
    lastSavedStart = newPos;
    lastSavedEnd = newPos;
    update();
    findAllMatches();
    updateHighlights();
    if (matches.length > 0) goToMatch(Math.min(currentMatchIndex, matches.length - 1));
    showToast('Đã thay thế 1 kết quả');
});

// ── Keyboard Shortcuts ────────────────────────
document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key === 's') { e.preventDefault(); document.getElementById('btn-download').click(); }
    if (e.ctrlKey && e.key === 'h') { e.preventDefault(); toggleFind(true); }
    if (e.ctrlKey && e.key === 'b') { e.preventDefault(); toggleSidebar(); }

    if (e.ctrlKey && e.key === 'a' && focusArea === 'sidebar') {
        e.preventDefault();
        selectAll();
    }

    if (e.ctrlKey && !e.shiftKey && e.key === 'z') {
        const ae = document.activeElement;
        if (ae && ae !== editor && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA')) return;
        e.preventDefault();
        if (lastActionType === 'sidebar' && sidebarUndoStack.length > 0) {
            performSidebarUndo();
        } else if (ae === editor && undoStack.length > 0) {
            performUndo();
            findAllMatches();
            updateHighlights();
        } else {
            performSidebarUndo();
        }
    }

    if ((e.ctrlKey && e.key === 'y') || (e.ctrlKey && e.shiftKey && e.key === 'Z')) {
        const ae2 = document.activeElement;
        if (ae2 && ae2 !== editor && (ae2.tagName === 'INPUT' || ae2.tagName === 'TEXTAREA')) return;
        e.preventDefault();
        performRedo();
        findAllMatches();
        updateHighlights();
    }

    if (e.key === 'Delete' && document.activeElement !== editor) {
        if (selectedIds.size > 1) {
            e.preventDefault();
            deleteSelected();
        } else {
            const targetId = selectedIds.size === 1 ? [...selectedIds][0] : lastClickedId;
            if (targetId) {
                e.preventDefault();
                deleteNode(targetId);
                if (lastClickedId === targetId) lastClickedId = null;
            }
        }
    }

    if (e.key === 'Escape') {
        hideContextMenu();
        hideSortMenu();
        if (selectedIds.size > 0) { clearSelection(); return; }
        if (findPanel.classList.contains('visible')) { toggleFind(false); editor.focus(); }
    }
});

// ── Copy & Cut ────────────────────────────────
editor.addEventListener('copy', (e) => {
    e.preventDefault();
    (e.clipboardData || window.clipboardData).setData('text/plain', editor.value.substring(editor.selectionStart, editor.selectionEnd));
});

editor.addEventListener('cut', (e) => {
    e.preventDefault();
    clearTimeout(debounceTimer);
    pushUndo();
    const start = editor.selectionStart;
    const end = editor.selectionEnd;
    (e.clipboardData || window.clipboardData).setData('text/plain', editor.value.substring(start, end));
    editor.value = editor.value.substring(0, start) + editor.value.substring(end);
    editor.setSelectionRange(start, start);
    lastSavedText = editor.value;
    lastSavedStart = start;
    lastSavedEnd = start;
    update();
    findAllMatches();
});

// ── Tab Key ───────────────────────────────────
editor.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
        e.preventDefault();
        clearTimeout(debounceTimer);
        pushUndo();
        const start = editor.selectionStart;
        const end = editor.selectionEnd;
        editor.value = editor.value.substring(0, start) + '\t' + editor.value.substring(end);
        const newPos = start + 1;
        editor.setSelectionRange(newPos, newPos);
        lastSavedText = editor.value;
        lastSavedStart = newPos;
        lastSavedEnd = newPos;
        update();
        findAllMatches();
    }
});

// ── Download ──────────────────────────────────
document.getElementById('btn-download').addEventListener('click', () => {
    const text = editor.value;
    if (!text) { showToast('Không có nội dung để tải xuống'); return; }
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    const activeNode = findNodeById(workspace.activeFileId, workspace.tree);
    a.download = activeNode ? getDownloadName(activeNode) : 'rawer.txt';
    a.click();
    URL.revokeObjectURL(a.href);
    showToast(`Đã tải xuống ${a.download}`);
});

// ── Drag & Drop onto Editor ───────────────────
editorWrap.addEventListener('dragover', (e) => {
    if (e.dataTransfer.types.includes('Files')) {
        e.preventDefault();
        editorWrap.classList.add('drag-over');
    }
});

editorWrap.addEventListener('dragleave', (e) => {
    if (!editorWrap.contains(e.relatedTarget)) editorWrap.classList.remove('drag-over');
});

editorWrap.addEventListener('drop', async (e) => {
    e.preventDefault();
    editorWrap.classList.remove('drag-over');

    const items = e.dataTransfer.items;
    if (!items || items.length === 0) return;

    const hasEntryAPI = items[0] && typeof items[0].webkitGetAsEntry === 'function';

    if (hasEntryAPI) {
        const results = await processDroppedEntries(items);
        if (results.length === 0) { showToast('Không tìm thấy file văn bản'); return; }

        pushSidebarUndo();
        let lastFileId = null;
        for (const { node, files } of results) {
            node.name = ensureUniqueName(node.name, workspace.tree, node.id);
            workspace.tree.push(node);
            Object.assign(workspace.files, files);
            const fids = getAllFileIds([node]);
            if (fids.length > 0) lastFileId = fids[fids.length - 1];
        }
        saveWorkspace();
        renderTree();
        if (lastFileId) switchFile(lastFileId);

        const totalFiles = results.reduce((sum, r) => sum + getAllFileIds([r.node]).length, 0);
        showToast(`Đã tải ${totalFiles} file`);
    } else {
        const files = e.dataTransfer.files;
        if (!files || files.length === 0) return;
        const validFiles = Array.from(files).filter(isTextFile);
        if (validFiles.length === 0) { showToast('Chỉ hỗ trợ file văn bản'); return; }

        pushSidebarUndo();
        let lastId = null;
        let loaded = 0;
        const now = Date.now();
        for (const file of validFiles) {
            const reader = new FileReader();
            reader.onload = (evt) => {
                const id = generateId();
                workspace.tree.push({ id, type: 'file', name: file.name, createdAt: now, modifiedAt: now });
                workspace.files[id] = evt.target.result;
                lastId = id;
                loaded++;
                if (loaded === validFiles.length) {
                    saveWorkspace();
                    renderTree();
                    if (lastId) switchFile(lastId);
                    showToast(`Đã tải ${validFiles.length} file`);
                }
            };
            reader.readAsText(file, 'UTF-8');
        }
    }
});

// ── Export / Import Workspace ─────────────────
const exportOverlay = document.getElementById('export-overlay');
const exportSelectAll = document.getElementById('export-select-all');
const exportChecks = exportOverlay.querySelectorAll('.export-check');

// "Select All" toggle logic
exportSelectAll.addEventListener('change', () => {
    exportChecks.forEach(cb => cb.checked = exportSelectAll.checked);
});

// Keep "Select All" in sync with individual checkboxes
exportChecks.forEach(cb => {
    cb.addEventListener('change', () => {
        exportSelectAll.checked = [...exportChecks].every(c => c.checked);
    });
});

function showExportDialog() {
    // Reset all checkboxes to checked
    exportSelectAll.checked = true;
    exportChecks.forEach(cb => cb.checked = true);
    exportOverlay.classList.add('visible');
}

function hideExportDialog() {
    exportOverlay.classList.remove('visible');
}

document.getElementById('btn-export-ws').addEventListener('click', showExportDialog);
document.getElementById('export-cancel').addEventListener('click', hideExportDialog);
exportOverlay.addEventListener('click', (e) => { if (e.target === exportOverlay) hideExportDialog(); });

// Perform export based on selected options
document.getElementById('export-confirm').addEventListener('click', () => {
    hideExportDialog();

    // Sync current editor content
    if (workspace.activeFileId && workspace.files[workspace.activeFileId] !== editor.value) {
        workspace.files[workspace.activeFileId] = editor.value;
    }

    const selected = {};
    exportChecks.forEach(cb => { selected[cb.dataset.key] = cb.checked; });

    // Check if at least one option is selected
    if (!Object.values(selected).some(v => v)) {
        showToast('Vui lòng chọn ít nhất một mục để xuất');
        return;
    }

    const data = {
        version: 2,
        exportedAt: new Date().toISOString()
    };

    // Workspace (tree + files + activeFileId)
    if (selected.workspace) {
        data.tree = workspace.tree;
        data.files = workspace.files;
        data.activeFileId = workspace.activeFileId;
    }

    // Sort mode
    if (selected.sortMode) {
        data.sortMode = workspace.sortMode;
    }

    // Sidebar state
    if (selected.sidebarOpen) {
        data.sidebarOpen = workspace.sidebarOpen;
    }

    // Usage statistics
    if (selected.usage) {
        try {
            const u = localStorage.getItem(USAGE_KEY);
            if (u) data.usage = JSON.parse(u);
        } catch { }
    }

    // Timer preferences
    if (selected.timerPrefs) {
        data.timerPrefs = { ...timerOptions };
    }

    // Toolbar collapsed state
    if (selected.toolbarCollapsed) {
        try {
            const tc = localStorage.getItem(COLLAPSE_KEY);
            if (tc !== null) data.toolbarCollapsed = tc === '1';
        } catch { }
    }

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const ts = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
    a.download = `rawer-workspace-${ts}.json`;
    a.click();
    URL.revokeObjectURL(url);

    const count = Object.values(selected).filter(v => v).length;
    showToast(`Đã xuất ${count} mục cài đặt`);
});

const importWsInput = document.getElementById('import-ws-input');
document.getElementById('btn-import-ws').addEventListener('click', () => importWsInput.click());

importWsInput.addEventListener('change', () => {
    const file = importWsInput.files[0];
    if (!file) return;
    importWsInput.value = '';

    const reader = new FileReader();
    reader.onload = (evt) => {
        try {
            const data = JSON.parse(evt.target.result);

            // Workspace data (backward compatible: v1 always has tree+files)
            if (data.tree && data.files) {
                pushSidebarUndo();
                workspace.tree = data.tree;
                workspace.files = data.files;
                workspace.activeFileId = data.activeFileId || null;

                const allFileIds = getAllFileIds(workspace.tree);
                if (workspace.activeFileId && !allFileIds.includes(workspace.activeFileId)) {
                    workspace.activeFileId = allFileIds[0] || null;
                }
                if (!workspace.activeFileId && allFileIds.length > 0) {
                    workspace.activeFileId = allFileIds[0];
                }

                editor.value = workspace.activeFileId ? (workspace.files[workspace.activeFileId] || '') : '';
                undoStack.length = 0;
                redoStack.length = 0;
                lastSavedText = editor.value;
                lastSavedStart = 0;
                lastSavedEnd = 0;
                updateUndoRedoButtons();
                fileStacks.clear();
                selectedIds.clear();
                lastClickedId = null;
            } else if (data.version >= 2) {
                // v2 export without workspace data — just settings
            } else {
                throw new Error('Invalid format');
            }

            // Sort mode
            if (data.sortMode) {
                workspace.sortMode = data.sortMode;
            }
            btnSort.title = `Sắp xếp: ${SORT_LABELS[workspace.sortMode]}`;
            btnSort.classList.toggle('active', workspace.sortMode !== 'manual');

            // Sidebar state
            if (data.sidebarOpen !== undefined) {
                workspace.sidebarOpen = data.sidebarOpen;
                if (workspace.sidebarOpen && !isMobile()) {
                    sidebarEl.classList.remove('hidden');
                } else if (!workspace.sidebarOpen) {
                    sidebarEl.classList.add('hidden');
                }
            }

            // Usage statistics
            if (data.usage) {
                try {
                    usageData = data.usage;
                    saveUsage();
                } catch { }
            }

            // Timer preferences
            if (data.timerPrefs) {
                Object.assign(timerOptions, data.timerPrefs);
                saveTimerPrefs();
            }

            // Toolbar collapsed state
            if (data.toolbarCollapsed !== undefined) {
                setToolbarCollapsed(data.toolbarCollapsed);
            }

            saveWorkspace();
            renderTree();
            update();

            const parts = [];
            if (data.tree) parts.push(`${getAllFileIds(workspace.tree).length} file`);
            if (data.sortMode) parts.push('sắp xếp');
            if (data.sidebarOpen !== undefined) parts.push('sidebar');
            if (data.usage) parts.push('thống kê');
            if (data.timerPrefs) parts.push('hẹn giờ');
            if (data.toolbarCollapsed !== undefined) parts.push('toolbar');
            showToast(`Đã nhập: ${parts.join(', ')}`);
        } catch (err) {
            showToast('Lỗi: File không đúng định dạng workspace');
        }
    };
    reader.readAsText(file);
});

// ── Reset ─────────────────────────────────────
const confirmOverlay = document.getElementById('confirm-overlay');
const confirmResetBtn = document.getElementById('confirm-reset');
const confirmCancelBtn = document.getElementById('confirm-cancel');
let resetCountdown = null;

document.getElementById('btn-reset').addEventListener('click', () => {
    const counts = countNodes(workspace.tree);
    const totalContent = Object.values(workspace.files).reduce((s, c) => s + (c || '').length, 0);
    const statsEl = document.getElementById('confirm-stats');
    statsEl.innerHTML = `
        <div class="stat-row"><span class="stat-label">File</span><span class="stat-value">${counts.files}</span></div>
        <div class="stat-row"><span class="stat-label">Folder</span><span class="stat-value">${counts.folders}</span></div>
        <div class="stat-row"><span class="stat-label">Nội dung</span><span class="stat-value">${formatBytes(totalContent * 2)}</span></div>
    `;
    confirmOverlay.classList.add('visible');
    confirmResetBtn.disabled = true;
    let sec = 5;
    confirmResetBtn.textContent = `Xác nhận (${sec})`;
    clearInterval(resetCountdown);
    resetCountdown = setInterval(() => {
        sec--;
        if (sec > 0) {
            confirmResetBtn.textContent = `Xác nhận (${sec})`;
        } else {
            clearInterval(resetCountdown);
            confirmResetBtn.textContent = 'Xác nhận xóa';
            confirmResetBtn.disabled = false;
        }
    }, 1000);
});

function hideConfirm() {
    confirmOverlay.classList.remove('visible');
    clearInterval(resetCountdown);
}

confirmCancelBtn.addEventListener('click', hideConfirm);
confirmOverlay.addEventListener('click', (e) => { if (e.target === confirmOverlay) hideConfirm(); });

confirmResetBtn.addEventListener('click', () => {
    hideConfirm();
    try { localStorage.removeItem(WS_KEY); localStorage.removeItem(COLLAPSE_KEY); } catch { }
    sidebarUndoStack.length = 0;
    undoStack.length = 0;
    redoStack.length = 0;
    fileStacks.clear();
    selectedIds.clear();
    lastClickedId = null;
    loadWorkspace();
    editor.value = workspace.activeFileId ? (workspace.files[workspace.activeFileId] || '') : '';
    lastSavedText = editor.value;
    lastSavedStart = 0;
    lastSavedEnd = 0;
    updateUndoRedoButtons();
    renderTree();
    update();
    showToast('Đã đặt lại toàn bộ');
});

// ── Virtual Keyboard ──────────────────────────
const vkEl = document.getElementById('virtual-keyboard');
const btnKeyboard = document.getElementById('btn-keyboard');
let vkShift = false;

function initVirtualKeyboard() {
    vkEl.querySelectorAll('.vk-row').forEach(row => {
        const keysAttr = row.getAttribute('data-keys');
        if (keysAttr) {
            keysAttr.split(' ').forEach(k => {
                const btn = document.createElement('button');
                btn.className = 'vk-key';
                btn.textContent = k;
                btn.dataset.char = k;
                row.appendChild(btn);
            });
        }
        row.querySelectorAll('span[data-keys]').forEach(span => {
            const keys = span.getAttribute('data-keys').split(' ');
            const frag = document.createDocumentFragment();
            keys.forEach(k => {
                const btn = document.createElement('button');
                btn.className = 'vk-key';
                btn.textContent = k;
                btn.dataset.char = k;
                frag.appendChild(btn);
            });
            span.replaceWith(frag);
        });
    });
}
initVirtualKeyboard();

function vkInsert(text) {
    ensureActiveFile();
    editor.focus();
    const start = editor.selectionStart;
    const end = editor.selectionEnd;
    pushUndo();
    editor.value = editor.value.substring(0, start) + text + editor.value.substring(end);
    const newPos = start + text.length;
    editor.setSelectionRange(newPos, newPos);
    lastSavedText = editor.value;
    lastSavedStart = newPos;
    lastSavedEnd = newPos;
    usageData.totalKeystrokes++;
    update();
}

vkEl.addEventListener('mousedown', (e) => {
    e.preventDefault();
    const btn = e.target.closest('.vk-key');
    if (!btn) return;

    const action = btn.dataset.action;
    if (action === 'shift') {
        vkShift = !vkShift;
        btn.classList.toggle('active', vkShift);
        return;
    }
    if (action === 'backspace') {
        ensureActiveFile();
        editor.focus();
        const s = editor.selectionStart, en = editor.selectionEnd;
        if (s === en && s > 0) {
            pushUndo();
            editor.value = editor.value.substring(0, s - 1) + editor.value.substring(s);
            editor.setSelectionRange(s - 1, s - 1);
        } else if (s !== en) {
            pushUndo();
            editor.value = editor.value.substring(0, s) + editor.value.substring(en);
            editor.setSelectionRange(s, s);
        }
        lastSavedText = editor.value;
        update();
        return;
    }
    if (action === 'space') { vkInsert(' '); return; }
    if (action === 'tab') { vkInsert('\t'); return; }
    if (action === 'enter') { vkInsert('\n'); return; }

    const diacritic = btn.dataset.diacritic;
    if (diacritic) {
        applyVietnameseDiacritic(diacritic);
        return;
    }

    const ch = btn.dataset.char;
    if (ch) {
        vkInsert(vkShift ? ch.toUpperCase() : ch);
        if (vkShift) {
            vkShift = false;
            vkEl.querySelector('.vk-key[data-action="shift"]')?.classList.remove('active');
        }
    }
});

const VN_MAP = {
    s: {
        a: 'á', e: 'é', i: 'í', o: 'ó', u: 'ú', y: 'ý', ă: 'ắ', â: 'ấ', ê: 'ế', ô: 'ố', ơ: 'ớ', ư: 'ứ',
        A: 'Á', E: 'É', I: 'Í', O: 'Ó', U: 'Ú', Y: 'Ý', Ă: 'Ắ', Â: 'Ấ', Ê: 'Ế', Ô: 'Ố', Ơ: 'Ớ', Ư: 'Ứ'
    },
    f: {
        a: 'à', e: 'è', i: 'ì', o: 'ò', u: 'ù', y: 'ỳ', ă: 'ằ', â: 'ầ', ê: 'ề', ô: 'ồ', ơ: 'ờ', ư: 'ừ',
        A: 'À', E: 'È', I: 'Ì', O: 'Ò', U: 'Ù', Y: 'Ỳ', Ă: 'Ằ', Â: 'Ầ', Ê: 'Ề', Ô: 'Ồ', Ơ: 'Ờ', Ư: 'Ừ'
    },
    r: {
        a: 'ả', e: 'ẻ', i: 'ỉ', o: 'ỏ', u: 'ủ', y: 'ỷ', ă: 'ẳ', â: 'ẩ', ê: 'ể', ô: 'ổ', ơ: 'ở', ư: 'ử',
        A: 'Ả', E: 'Ẻ', I: 'Ỉ', O: 'Ỏ', U: 'Ủ', Y: 'Ỷ', Ă: 'Ẳ', Â: 'Ẩ', Ê: 'Ể', Ô: 'Ổ', Ơ: 'Ở', Ư: 'Ử'
    },
    x: {
        a: 'ã', e: 'ẽ', i: 'ĩ', o: 'õ', u: 'ũ', y: 'ỹ', ă: 'ẵ', â: 'ẫ', ê: 'ễ', ô: 'ỗ', ơ: 'ỡ', ư: 'ữ',
        A: 'Ã', E: 'Ẽ', I: 'Ĩ', O: 'Õ', U: 'Ũ', Y: 'Ỹ', Ă: 'Ẵ', Â: 'Ẫ', Ê: 'Ễ', Ô: 'Ỗ', Ơ: 'Ỡ', Ư: 'Ữ'
    },
    j: {
        a: 'ạ', e: 'ẹ', i: 'ị', o: 'ọ', u: 'ụ', y: 'ỵ', ă: 'ặ', â: 'ậ', ê: 'ệ', ô: 'ộ', ơ: 'ợ', ư: 'ự',
        A: 'Ạ', E: 'Ẹ', I: 'Ị', O: 'Ọ', U: 'Ụ', Y: 'Ỵ', Ă: 'Ặ', Â: 'Ậ', Ê: 'Ệ', Ô: 'Ộ', Ơ: 'Ợ', Ư: 'Ự'
    }
};

function applyVietnameseDiacritic(type) {
    ensureActiveFile();
    editor.focus();
    const pos = editor.selectionStart;
    if (pos === 0) return;
    const map = VN_MAP[type];
    if (!map) return;

    for (let i = pos - 1; i >= Math.max(0, pos - 3); i--) {
        const ch = editor.value[i];
        if (map[ch]) {
            pushUndo();
            editor.value = editor.value.substring(0, i) + map[ch] + editor.value.substring(i + 1);
            editor.setSelectionRange(pos, pos);
            lastSavedText = editor.value;
            update();
            return;
        }
    }
}

btnKeyboard.addEventListener('click', () => {
    vkEl.classList.toggle('visible');
    btnKeyboard.classList.toggle('active', vkEl.classList.contains('visible'));
});

document.getElementById('vk-close').addEventListener('click', () => {
    vkEl.classList.remove('visible');
    btnKeyboard.classList.remove('active');
});

// ── Usage Stats Dialog ────────────────────────
const statsOverlay = document.getElementById('stats-overlay');
const statsContent = document.getElementById('stats-content');

function formatDuration(seconds) {
    if (seconds < 60) return `${seconds} giây`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)} phút`;
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return m > 0 ? `${h} giờ ${m} phút` : `${h} giờ`;
}

function showStatsDialog() {
    const counts = countNodes(workspace.tree);
    const totalContent = Object.values(workspace.files).reduce((s, c) => s + (c || '').length, 0);
    const sessionTime = Math.floor((Date.now() - sessionStart) / 1000);
    const totalTime = usageData.totalTime + sessionTime;
    const firstDate = new Date(usageData.firstVisit);
    const daysSince = Math.max(1, Math.floor((Date.now() - usageData.firstVisit) / 86400000));

    statsContent.innerHTML = `
        <div class="stats-section">
            <div class="stats-section-title">Phiên hiện tại</div>
            <div class="stats-grid">
                <div class="stats-item"><span class="stats-item-value">${formatDuration(sessionTime)}</span><span class="stats-item-label">Thời gian</span></div>
                <div class="stats-item"><span class="stats-item-value">${counts.files} / ${counts.folders}</span><span class="stats-item-label">File / Folder</span></div>
            </div>
        </div>
        <div class="stats-section">
            <div class="stats-section-title">Tổng quan</div>
            <div class="stats-grid">
                <div class="stats-item"><span class="stats-item-value">${usageData.totalSessions}</span><span class="stats-item-label">Lần truy cập</span></div>
                <div class="stats-item"><span class="stats-item-value">${formatDuration(totalTime)}</span><span class="stats-item-label">Tổng thời gian</span></div>
                <div class="stats-item"><span class="stats-item-value">${usageData.totalKeystrokes.toLocaleString()}</span><span class="stats-item-label">Phím đã nhấn</span></div>
                <div class="stats-item"><span class="stats-item-value">${formatBytes(totalContent * 2)}</span><span class="stats-item-label">Dung lượng nội dung</span></div>
            </div>
        </div>
        <div class="stats-section">
            <div class="stats-section-title">Lịch sử</div>
            <div class="stats-grid">
                <div class="stats-item"><span class="stats-item-value">${firstDate.toLocaleDateString('vi-VN')}</span><span class="stats-item-label">Lần đầu sử dụng</span></div>
                <div class="stats-item"><span class="stats-item-value">${daysSince} ngày</span><span class="stats-item-label">Đã đồng hành</span></div>
            </div>
        </div>
    `;
    statsOverlay.classList.add('visible');
}

document.getElementById('btn-stats').addEventListener('click', showStatsDialog);
document.getElementById('stats-close').addEventListener('click', () => statsOverlay.classList.remove('visible'));
statsOverlay.addEventListener('click', (e) => { if (e.target === statsOverlay) statsOverlay.classList.remove('visible'); });

// ── Real-time Clock ──────────────────────────
const statClockEl = document.getElementById('stat-clock');
const DAY_NAMES = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];

function updateClock() {
    const now = new Date();
    const pad = n => n.toString().padStart(2, '0');
    const day = DAY_NAMES[now.getDay()];
    const date = `${pad(now.getDate())}/${pad(now.getMonth() + 1)}`;
    const time = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
    statClockEl.textContent = `${day} ${date} ${time}`;
}
updateClock();
setInterval(updateClock, 1000);

// ── Timer / Alarm ────────────────────────────
const statTimerEl = document.getElementById('stat-timer');
const btnTimer = document.getElementById('btn-timer');
const timerOverlay = document.getElementById('timer-overlay');
const timerAlarmOverlay = document.getElementById('timer-alarm-overlay');

let timerInterval = null;
let timerRemaining = 0;
let timerMode = 'countdown'; // 'countdown' or 'alarm'
let timerOriginalSeconds = 0;
let timerTargetTime = null;
let timerOptions = { popup: true, sound: false, repeat: false };

// Load saved preferences
try {
    const saved = localStorage.getItem('rawer_timer_prefs');
    if (saved) Object.assign(timerOptions, JSON.parse(saved));
} catch { }

function saveTimerPrefs() {
    try { localStorage.setItem('rawer_timer_prefs', JSON.stringify(timerOptions)); } catch { }
}

function stopTimer() {
    clearInterval(timerInterval);
    timerInterval = null;
    timerRemaining = 0;
    timerTargetTime = null;
    statTimerEl.style.display = 'none';
    statTimerEl.classList.remove('alarm');
    btnTimer.classList.remove('active');
}

function playAlarmSound() {
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const times = [0, 0.3, 0.6];
        times.forEach(t => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.frequency.value = 880;
            gain.gain.setValueAtTime(0.25, ctx.currentTime + t);
            gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + t + 0.2);
            osc.start(ctx.currentTime + t);
            osc.stop(ctx.currentTime + t + 0.2);
        });
        setTimeout(() => ctx.close(), 1500);
    } catch { }
}

function triggerAlarm() {
    clearInterval(timerInterval);
    timerInterval = null;
    statTimerEl.textContent = 'Hết giờ!';
    statTimerEl.classList.add('alarm');

    if (timerOptions.sound) playAlarmSound();

    if (timerOptions.popup) {
        const desc = timerMode === 'countdown'
            ? `Đếm ngược ${formatTimerDuration(timerOriginalSeconds)} đã kết thúc.`
            : `Báo thức đã đến giờ.`;
        document.getElementById('timer-alarm-desc').textContent = desc;
        const repeatBtn = document.getElementById('timer-alarm-repeat');
        repeatBtn.style.display = timerOptions.repeat ? '' : 'none';
        timerAlarmOverlay.classList.add('visible');
    } else {
        showToast('Hết giờ!');
        if (timerOptions.repeat && timerMode === 'countdown') {
            startCountdown(timerOriginalSeconds);
        } else {
            btnTimer.classList.remove('active');
        }
    }
}

function formatTimerDuration(seconds) {
    if (seconds >= 3600) {
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        return m > 0 ? `${h} giờ ${m} phút` : `${h} giờ`;
    }
    return `${Math.floor(seconds / 60)} phút`;
}

function startCountdown(seconds) {
    stopTimer();
    timerMode = 'countdown';
    timerOriginalSeconds = seconds;
    timerRemaining = seconds;
    btnTimer.classList.add('active');
    statTimerEl.style.display = '';

    function tick() {
        if (timerRemaining <= 0) {
            triggerAlarm();
            return;
        }
        const m = Math.floor(timerRemaining / 60);
        const s = timerRemaining % 60;
        statTimerEl.textContent = `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
        timerRemaining--;
    }
    tick();
    timerInterval = setInterval(tick, 1000);
}

function startAlarmMode(targetDate) {
    stopTimer();
    timerMode = 'alarm';
    timerTargetTime = targetDate;
    btnTimer.classList.add('active');
    statTimerEl.style.display = '';

    function tick() {
        const now = Date.now();
        const diff = Math.ceil((timerTargetTime - now) / 1000);
        if (diff <= 0) {
            triggerAlarm();
            return;
        }
        const m = Math.floor(diff / 60);
        const s = diff % 60;
        statTimerEl.textContent = `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }
    tick();
    timerInterval = setInterval(tick, 1000);
}

// ── Timer Dialog Logic ──────────────────────
function showTimerDialog() {
    // Sync checkboxes with saved prefs
    document.getElementById('timer-opt-popup').checked = timerOptions.popup;
    document.getElementById('timer-opt-sound').checked = timerOptions.sound;
    document.getElementById('timer-opt-repeat').checked = timerOptions.repeat;
    document.getElementById('timer-custom-min').value = '';

    // Set alarm time input to current time + 5min
    const now = new Date();
    now.setMinutes(now.getMinutes() + 5);
    const pad = n => n.toString().padStart(2, '0');
    document.getElementById('timer-alarm-time').value = `${pad(now.getHours())}:${pad(now.getMinutes())}`;

    // Activate correct tab
    setTimerTab(timerMode === 'alarm' ? 'alarm' : 'countdown');
    timerOverlay.classList.add('visible');
}

function hideTimerDialog() {
    timerOverlay.classList.remove('visible');
}

function setTimerTab(tab) {
    timerOverlay.querySelectorAll('.timer-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
    document.getElementById('timer-tab-countdown').style.display = tab === 'countdown' ? '' : 'none';
    document.getElementById('timer-tab-alarm').style.display = tab === 'alarm' ? '' : 'none';
}

// Tab clicks
timerOverlay.querySelectorAll('.timer-tab').forEach(tab => {
    tab.addEventListener('click', () => setTimerTab(tab.dataset.tab));
});

// Countdown presets — fill input, don't auto-start
timerOverlay.querySelectorAll('.timer-preset').forEach(btn => {
    btn.addEventListener('click', () => {
        document.getElementById('timer-custom-min').value = btn.dataset.minutes;
    });
});

// Alarm presets — fill time input, don't auto-start
timerOverlay.querySelectorAll('.timer-alarm-preset').forEach(btn => {
    btn.addEventListener('click', () => {
        const addMins = parseInt(btn.dataset.addMinutes);
        const target = new Date(Date.now() + addMins * 60000);
        const pad = n => n.toString().padStart(2, '0');
        document.getElementById('timer-alarm-time').value = `${pad(target.getHours())}:${pad(target.getMinutes())}`;
    });
});

function syncTimerOptions() {
    timerOptions.popup = document.getElementById('timer-opt-popup').checked;
    timerOptions.sound = document.getElementById('timer-opt-sound').checked;
    timerOptions.repeat = document.getElementById('timer-opt-repeat').checked;
    saveTimerPrefs();
}

// Start button (custom input)
document.getElementById('timer-start').addEventListener('click', () => {
    syncTimerOptions();
    const activeTab = timerOverlay.querySelector('.timer-tab.active').dataset.tab;

    if (activeTab === 'countdown') {
        const mins = parseInt(document.getElementById('timer-custom-min').value);
        if (isNaN(mins) || mins <= 0) {
            document.getElementById('timer-custom-min').focus();
            return;
        }
        hideTimerDialog();
        startCountdown(mins * 60);
    } else {
        const timeVal = document.getElementById('timer-alarm-time').value;
        if (!timeVal) return;
        const [h, m] = timeVal.split(':').map(Number);
        const now = new Date();
        const target = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m, 0);
        if (target <= now) target.setDate(target.getDate() + 1); // next day
        hideTimerDialog();
        startAlarmMode(target.getTime());
    }
});

document.getElementById('timer-cancel').addEventListener('click', hideTimerDialog);
timerOverlay.addEventListener('click', (e) => { if (e.target === timerOverlay) hideTimerDialog(); });

// Alarm notification actions
document.getElementById('timer-alarm-dismiss').addEventListener('click', () => {
    timerAlarmOverlay.classList.remove('visible');
    if (timerOptions.repeat && timerMode === 'countdown') {
        startCountdown(timerOriginalSeconds);
    } else {
        stopTimer();
    }
});

document.getElementById('timer-alarm-repeat').addEventListener('click', () => {
    timerAlarmOverlay.classList.remove('visible');
    if (timerMode === 'countdown') {
        startCountdown(timerOriginalSeconds);
    } else if (timerTargetTime) {
        // Repeat alarm at same time tomorrow
        const target = new Date(timerTargetTime);
        target.setDate(target.getDate() + 1);
        startAlarmMode(target.getTime());
    }
});

timerAlarmOverlay.addEventListener('click', (e) => {
    if (e.target === timerAlarmOverlay) {
        timerAlarmOverlay.classList.remove('visible');
        stopTimer();
    }
});

// Timer button click
btnTimer.addEventListener('click', () => {
    if (timerInterval || statTimerEl.classList.contains('alarm')) {
        stopTimer();
        return;
    }
    showTimerDialog();
});

statTimerEl.addEventListener('click', () => {
    if (statTimerEl.classList.contains('alarm')) stopTimer();
});

// ── Toolbar Collapse ──────────────────────────
const topBar = document.querySelector('.top-bar');
const btnCollapse = document.getElementById('btn-collapse');
const COLLAPSE_KEY = 'rawer_toolbar_collapsed';

function setToolbarCollapsed(collapsed) {
    topBar.classList.toggle('collapsed', collapsed);
    try { localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0'); } catch { }
}

btnCollapse.addEventListener('click', () => setToolbarCollapsed(!topBar.classList.contains('collapsed')));
try { if (localStorage.getItem(COLLAPSE_KEY) === '1') setToolbarCollapsed(true); } catch { }

// ── Init ──────────────────────────────────────
loadWorkspace();


editor.value = workspace.activeFileId ? (workspace.files[workspace.activeFileId] || '') : '';


lastSavedText = editor.value;
updateUndoRedoButtons();

btnSort.title = `Sắp xếp: ${SORT_LABELS[workspace.sortMode]}`;
btnSort.classList.toggle('active', workspace.sortMode !== 'manual');

if (!workspace.sidebarOpen || (isMobile() && workspace.sidebarOpen)) {
    sidebarEl.classList.add('hidden');
    if (isMobile()) workspace.sidebarOpen = false;
} else {
    sidebarEl.classList.remove('hidden');
}

renderTree();
update();
