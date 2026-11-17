'use strict';

const OWNER = 'tyy717';
const REPO = 'tyy717.io';
const BRANCH = 'main';
const API = 'https://api.github.com';
const TOKEN_KEY = 'tyy717-admin-token';

const $ = (id) => document.getElementById(id);
let editingId = null;

/* ---------------- 基础工具 ---------------- */

function token() {
  return localStorage.getItem(TOKEN_KEY) || '';
}

function setStatus(id, text, kind) {
  const el = $(id);
  el.textContent = text || '';
  el.className = 'status' + (kind ? ' ' + kind : '');
}

function cnDate() {
  const d = new Date();
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

function encPath(p) {
  return p.split('/').map(encodeURIComponent).join('/');
}

function encodeText(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (const byte of bytes) bin += String.fromCharCode(byte);
  return btoa(bin);
}

function decodeText(base64) {
  const bin = atob(String(base64 || '').replace(/\s/g, ''));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

async function gh(method, path, payload) {
  const headers = {
    accept: 'application/vnd.github+json',
    authorization: `Bearer ${token()}`,
    'x-github-api-version': '2022-11-28',
  };
  if (payload) headers['content-type'] = 'application/json';
  const res = await fetch(API + path, {
    method,
    headers,
    body: payload ? JSON.stringify(payload) : undefined,
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    const err = new Error((data && data.message) || `GitHub 返回 ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

async function getTextFile(path) {
  try {
    const data = await gh('GET', `/repos/${OWNER}/${REPO}/contents/${encPath(path)}?ref=${BRANCH}`);
    return decodeText(data.content);
  } catch (err) {
    if (err.status === 404) return null;
    throw err;
  }
}

async function getJsonFile(path) {
  const text = await getTextFile(path);
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function commitFiles(changes, message) {
  const ref = await gh('GET', `/repos/${OWNER}/${REPO}/git/ref/heads/${BRANCH}`);
  const headSha = ref.object.sha;
  const head = await gh('GET', `/repos/${OWNER}/${REPO}/git/commits/${headSha}`);

  const tree = [];
  for (const change of changes) {
    if (change.delete) {
      tree.push({ path: change.path, mode: '100644', type: 'blob', sha: null });
      continue;
    }
    const blob = await gh('POST', `/repos/${OWNER}/${REPO}/git/blobs`, {
      content: change.base64 != null ? change.base64 : encodeText(change.text),
      encoding: 'base64',
    });
    tree.push({ path: change.path, mode: '100644', type: 'blob', sha: blob.sha });
  }

  const newTree = await gh('POST', `/repos/${OWNER}/${REPO}/git/trees`, { base_tree: head.tree.sha, tree });
  const commit = await gh('POST', `/repos/${OWNER}/${REPO}/git/commits`, {
    message,
    tree: newTree.sha,
    parents: [headSha],
  });
  await gh('PATCH', `/repos/${OWNER}/${REPO}/git/refs/heads/${BRANCH}`, { sha: commit.sha });
  return commit.sha;
}

function slugify(title) {
  const slug = String(title)
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 40);
  return slug || 'untitled';
}

function todayId() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function uniqueId(base, taken) {
  let id = base;
  let n = 2;
  while (taken.includes(id)) {
    id = `${base}-${n}`;
    n += 1;
  }
  return id;
}

function normalizeTags(input) {
  const list = Array.isArray(input) ? input : String(input || '').split(/[,，\s]+/);
  const tags = [];
  for (const item of list) {
    const tag = String(item).trim().slice(0, 20);
    if (tag && !tags.includes(tag)) tags.push(tag);
    if (tags.length >= 5) break;
  }
  return tags.length ? tags : ['随笔'];
}

function meta(detail) {
  return {
    id: detail.id,
    title: detail.title,
    date: detail.date,
    readTime: detail.readTime,
    mood: detail.mood,
    tags: detail.tags,
    summary: detail.summary,
  };
}

/* ---------------- 登录 ---------------- */

async function login() {
  const value = $('token').value.trim();
  if (!value) {
    setStatus('login-state', '请填写 Token', 'err');
    return;
  }
  localStorage.setItem(TOKEN_KEY, value);
  try {
    setStatus('login-state', '验证中…');
    const user = await gh('GET', '/user');
    const repo = await gh('GET', `/repos/${OWNER}/${REPO}`);
    if (!repo.permissions || !repo.permissions.push) {
      throw new Error(`该 Token 对 ${OWNER}/${REPO} 没有写入权限`);
    }
    setStatus('login-state', `已登录：${user.login}`, 'ok');
    showConsole();
    loadPosts();
    loadBooks();
  } catch (err) {
    localStorage.removeItem(TOKEN_KEY);
    setStatus('login-state', err.message, 'err');
  }
}

function logout() {
  localStorage.removeItem(TOKEN_KEY);
  $('console').classList.add('hidden');
  $('logout-btn').classList.add('hidden');
  $('token').value = '';
  setStatus('login-state', '已清除本机 Token');
}

function showConsole() {
  $('console').classList.remove('hidden');
  $('logout-btn').classList.remove('hidden');
  $('token').value = token();
  if (!$('post-date').value) $('post-date').value = cnDate();
  if (!$('book-date').value) $('book-date').value = cnDate();
}

/* ---------------- 日记 ---------------- */

async function loadPosts() {
  const list = $('post-list');
  try {
    list.textContent = '加载中…';
    const posts = (await getJsonFile('posts_index.json')) || [];
    list.textContent = '';
    $('post-count').textContent = posts.length ? `${posts.length} 篇` : '暂无';
    if (!posts.length) {
      const empty = document.createElement('p');
      empty.className = 'hint';
      empty.textContent = '还没有日记。';
      list.appendChild(empty);
      return;
    }
    for (const post of posts) {
      const row = document.createElement('div');
      row.className = 'item';

      const main = document.createElement('div');
      main.className = 'item-main';
      const title = document.createElement('div');
      title.className = 'item-title';
      title.textContent = post.title;
      const sub = document.createElement('div');
      sub.className = 'item-sub';
      sub.textContent = `${post.date || ''} · ${(post.tags || []).join(' / ')}`;
      main.append(title, sub);

      const actions = document.createElement('div');
      actions.className = 'item-actions';
      const editBtn = document.createElement('button');
      editBtn.className = 'ghost';
      editBtn.textContent = '编辑';
      editBtn.addEventListener('click', () => startEdit(post.id));
      const delBtn = document.createElement('button');
      delBtn.className = 'ghost';
      delBtn.textContent = '删除';
      delBtn.addEventListener('click', () => removePost(post.id, post.title));
      actions.append(editBtn, delBtn);

      row.append(main, actions);
      list.appendChild(row);
    }
  } catch (err) {
    list.textContent = '日记列表加载失败：' + err.message;
  }
}

async function startEdit(id) {
  try {
    setStatus('post-status', '读取中…');
    const post = await getJsonFile(`posts/${id}.json`);
    if (!post) throw new Error('无法读取这篇日记');
    editingId = post.id;
    $('post-title').value = post.title || '';
    $('post-date').value = post.date || '';
    $('post-readtime').value = post.readTime || '3分钟阅读';
    $('post-mood').value = post.mood || '平静';
    $('post-tags').value = (post.tags || []).join(', ');
    $('post-summary').value = post.summary || '';
    $('post-body').value = post.body || '';
    $('post-submit').textContent = '保存修改';
    $('post-cancel').classList.remove('hidden');
    setStatus('post-status', `正在编辑：${post.title}`, 'ok');
    $('tab-posts').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) {
    setStatus('post-status', err.message, 'err');
  }
}

function resetPostForm() {
  editingId = null;
  $('post-title').value = '';
  $('post-date').value = cnDate();
  $('post-readtime').value = '3分钟阅读';
  $('post-mood').value = '平静';
  $('post-tags').value = '';
  $('post-summary').value = '';
  $('post-body').value = '';
  $('post-submit').textContent = '发布日记';
  $('post-cancel').classList.add('hidden');
}

async function submitPost() {
  const title = $('post-title').value.trim();
  if (!title) {
    setStatus('post-status', '请填写标题', 'err');
    return;
  }
  const btn = $('post-submit');
  btn.disabled = true;
  try {
    setStatus('post-status', '提交中…');
    const index = (await getJsonFile('posts_index.json')) || [];
    const detail = {
      id: '',
      title,
      date: $('post-date').value.trim() || cnDate(),
      readTime: $('post-readtime').value.trim() || '3分钟阅读',
      mood: $('post-mood').value,
      tags: normalizeTags($('post-tags').value),
      summary: $('post-summary').value.trim(),
      body: $('post-body').value,
    };

    if (editingId) {
      const existing = (await getJsonFile(`posts/${editingId}.json`)) || {};
      detail.id = editingId;
      detail.body = $('post-body').value;
      detail.summary = detail.summary || existing.summary || '';
      const pos = index.findIndex((p) => p.id === editingId);
      if (pos >= 0) index[pos] = meta(detail);
      else index.unshift(meta(detail));
      await commitFiles(
        [
          { path: `posts/${editingId}.json`, text: JSON.stringify(detail, null, 2) },
          { path: 'posts_index.json', text: JSON.stringify(index, null, 2) },
        ],
        `更新日记：${title}`
      );
      setStatus('post-status', '已保存修改，Pages 约一分钟后更新', 'ok');
    } else {
      detail.id = uniqueId(`${todayId()}-${slugify(title)}`, index.map((p) => p.id));
      index.unshift(meta(detail));
      await commitFiles(
        [
          { path: `posts/${detail.id}.json`, text: JSON.stringify(detail, null, 2) },
          { path: 'posts_index.json', text: JSON.stringify(index, null, 2) },
        ],
        `发布新文章: ${title}`
      );
      setStatus('post-status', '已发布，Pages 约一分钟后更新', 'ok');
    }
    resetPostForm();
    loadPosts();
  } catch (err) {
    setStatus('post-status', err.message, 'err');
  } finally {
    btn.disabled = false;
  }
}

async function removePost(id, title) {
  if (!window.confirm(`确定删除《${title}》？`)) return;
  try {
    setStatus('post-status', '删除中…');
    const index = (await getJsonFile('posts_index.json')) || [];
    const next = index.filter((p) => p.id !== id);
    await commitFiles(
      [
        { path: `posts/${id}.json`, delete: true },
        { path: 'posts_index.json', text: JSON.stringify(next, null, 2) },
      ],
      `删除文章: ${title}`
    );
    setStatus('post-status', '已删除', 'ok');
    if (editingId === id) resetPostForm();
    loadPosts();
  } catch (err) {
    setStatus('post-status', err.message, 'err');
  }
}

/* ---------------- 书籍 ---------------- */

async function loadBooks() {
  const list = $('book-list');
  try {
    list.textContent = '加载中…';
    const books = (await getJsonFile('books_index.json')) || [];
    list.textContent = '';
    $('book-count').textContent = books.length ? `${books.length} 本` : '暂无';
    if (!books.length) {
      const empty = document.createElement('p');
      empty.className = 'hint';
      empty.textContent = '书架还空着。';
      list.appendChild(empty);
      return;
    }
    for (const book of books) {
      const row = document.createElement('div');
      row.className = 'item';

      const main = document.createElement('div');
      main.className = 'item-main';
      const title = document.createElement('div');
      title.className = 'item-title';
      title.textContent = book.title;
      const sub = document.createElement('div');
      sub.className = 'item-sub';
      sub.textContent = `${book.author || '佚名'} · ${book.date || ''}`;
      main.append(title, sub);

      const actions = document.createElement('div');
      actions.className = 'item-actions';
      const delBtn = document.createElement('button');
      delBtn.className = 'ghost';
      delBtn.textContent = '删除';
      delBtn.addEventListener('click', () => removeBook(book.id, book.title));
      actions.append(delBtn);

      row.append(main, actions);
      list.appendChild(row);
    }
  } catch (err) {
    list.textContent = '书籍列表加载失败：' + err.message;
  }
}

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      const index = result.indexOf(',');
      resolve(index >= 0 ? result.slice(index + 1) : result);
    };
    reader.onerror = () => reject(new Error('读取文件失败'));
    reader.readAsDataURL(file);
  });
}

async function submitBook() {
  const file = $('book-file').files[0];
  if (!file) {
    setStatus('book-status', '请选择 txt 文件', 'err');
    return;
  }
  if (!file.name.toLowerCase().endsWith('.txt')) {
    setStatus('book-status', '只支持 txt 文件', 'err');
    return;
  }
  if (file.size > 12 * 1024 * 1024) {
    setStatus('book-status', '文件超过 12MB 限制', 'err');
    return;
  }
  const btn = $('book-submit');
  btn.disabled = true;
  try {
    setStatus('book-status', '上传中…');
    const index = (await getJsonFile('books_index.json')) || [];
    const id = uniqueId(`book-${Date.now().toString(36)}`, index.map((b) => b.id));
    const title = $('book-title').value.trim() || file.name.replace(/\.txt$/i, '');
    const entry = {
      id,
      title,
      author: $('book-author').value.trim(),
      date: $('book-date').value.trim() || cnDate(),
      summary: $('book-summary').value.trim(),
      file: `books/${id}.txt`,
    };
    index.push(entry);
    await commitFiles(
      [
        { path: `books/${id}.txt`, base64: await readFileAsBase64(file) },
        { path: 'books_index.json', text: JSON.stringify(index, null, 2) },
      ],
      `上架新书: 《${title}》`
    );
    setStatus('book-status', '已上传，Pages 约一分钟后更新', 'ok');
    $('book-title').value = '';
    $('book-author').value = '';
    $('book-summary').value = '';
    $('book-file').value = '';
    loadBooks();
  } catch (err) {
    setStatus('book-status', err.message, 'err');
  } finally {
    btn.disabled = false;
  }
}

async function removeBook(id, title) {
  if (!window.confirm(`确定删除《${title}》？`)) return;
  try {
    setStatus('book-status', '删除中…');
    const index = (await getJsonFile('books_index.json')) || [];
    const next = index.filter((b) => b.id !== id);
    await commitFiles(
      [
        { path: `books/${id}.txt`, delete: true },
        { path: 'books_index.json', text: JSON.stringify(next, null, 2) },
      ],
      `下架书籍: 《${title}》`
    );
    setStatus('book-status', '已删除', 'ok');
    loadBooks();
  } catch (err) {
    setStatus('book-status', err.message, 'err');
  }
}

/* ---------------- 图片 ---------------- */

async function submitImage() {
  const file = $('image-file').files[0];
  if (!file) {
    setStatus('image-status', '请选择图片', 'err');
    return;
  }
  if (file.size > 6 * 1024 * 1024) {
    setStatus('image-status', '图片超过 6MB 限制', 'err');
    return;
  }
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  if (!['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext)) {
    setStatus('image-status', '仅支持 jpg / png / gif / webp', 'err');
    return;
  }
  const btn = $('image-submit');
  btn.disabled = true;
  try {
    setStatus('image-status', '上传中…');
    const name = `${todayId().replace(/-/g, '')}-${Math.random().toString(16).slice(2, 10)}.${ext}`;
    await commitFiles([{ path: `images/${name}`, base64: await readFileAsBase64(file) }], `上传图片: ${name}`);
    const src = `images/${name}`;
    const snippet = `<img src="${src}" alt="" style="max-width:100%;border-radius:8px;margin:1rem 0;">`;
    $('image-snippet').textContent = snippet;
    $('image-preview').src = src;
    $('image-result').classList.remove('hidden');
    $('image-snippet').onclick = () => {
      if (navigator.clipboard) navigator.clipboard.writeText(snippet);
      setStatus('image-status', '已复制到剪贴板', 'ok');
    };
    setStatus('image-status', '上传成功，点击下方代码可复制', 'ok');
    $('image-file').value = '';
  } catch (err) {
    setStatus('image-status', err.message, 'err');
  } finally {
    btn.disabled = false;
  }
}

/* ---------------- 初始化 ---------------- */

document.addEventListener('DOMContentLoaded', async () => {
  $('login-btn').addEventListener('click', login);
  $('logout-btn').addEventListener('click', logout);
  $('token').addEventListener('keydown', (e) => { if (e.key === 'Enter') login(); });
  $('post-submit').addEventListener('click', submitPost);
  $('post-cancel').addEventListener('click', () => { resetPostForm(); setStatus('post-status', ''); });
  $('book-submit').addEventListener('click', submitBook);
  $('image-submit').addEventListener('click', submitImage);

  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t === tab));
      document.querySelectorAll('.tab-panel').forEach((panel) => {
        panel.classList.toggle('hidden', panel.id !== `tab-${tab.dataset.tab}`);
      });
    });
  });

  if (token()) {
    $('token').value = token();
    try {
      const user = await gh('GET', '/user');
      setStatus('login-state', `已登录：${user.login}`, 'ok');
      showConsole();
      loadPosts();
      loadBooks();
    } catch {
      setStatus('login-state', '已保存的 Token 失效，请重新填写', 'err');
    }
  }
});
