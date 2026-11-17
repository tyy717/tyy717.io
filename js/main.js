// js/main.js — 列表渲染、单篇渲染、主题切换

const POSTS_INDEX_URL = 'posts_index.json';
const POSTS_DIR = 'posts/';

// 年份
document.getElementById('current-year') && (document.getElementById('current-year').textContent = new Date().getFullYear());

function formatReadTime(value) {
    const text = String(value || '').trim();
    if (!text) return '';
    return /^\d+$/.test(text) ? text + ' 分钟阅读' : text;
}

function postCardHTML(post) {
    return `
        <article class="post-card is-visible" onclick="window.location.href='post.html?id=${encodeURIComponent(post.id)}'">
            <span class="post-date">${post.date || ''}<br>${formatReadTime(post.readTime)}</span>
            <h3 class="post-title">${post.title || ''}</h3>
            <p class="post-summary">${post.summary || ''}</p>
            <span class="read-more"><i class="fas fa-arrow-right"></i></span>
        </article>`;
}

// 日记归档页
async function loadAllPosts() {
    const postsListEl = document.getElementById('posts-list');
    if (!postsListEl) return;

    try {
        const indexResp = await fetch(POSTS_INDEX_URL);
        if (!indexResp.ok) throw new Error('无法加载日志列表');
        const postsIndex = await indexResp.json();

        if (!postsIndex.length) {
            postsListEl.innerHTML = '<p class="no-posts">还没有日志，快去写下第一篇吧。</p>';
            return;
        }

        postsIndex.sort((a, b) => new Date(b.id) - new Date(a.id));
        postsListEl.innerHTML = postsIndex.map(postCardHTML).join('');
    } catch (error) {
        console.error('加载日志列表失败:', error);
        postsListEl.innerHTML = '<p class="error">加载日志时出错，请稍后重试。</p>';
    }
}

// 单篇日志
async function loadSinglePost(postId) {
    const postContentEl = document.getElementById('post-content');
    if (!postContentEl) return;

    try {
        const resp = await fetch(`${POSTS_DIR}${postId}.json`);
        if (!resp.ok) throw new Error('日志未找到');
        const post = await resp.json();

        const bodyHTML = String(post.body || '').replace(/\n/g, '<br>');

        postContentEl.innerHTML = `
            <div class="article-kicker">
                <span>DIARY</span><span class="rule"></span><span>${post.date || ''}</span>
            </div>
            <h1>${post.title}</h1>
            <div class="post-meta">
                ${post.date || ''} · ${formatReadTime(post.readTime)} · ${post.mood || ''}
            </div>
            <div class="post-body">${bodyHTML}</div>
        `;

        document.title = `${post.title} - 我的日常手记`;
    } catch (error) {
        console.error('加载单篇日志失败:', error);
        postContentEl.innerHTML = '<p class="error">日志加载失败或不存在。<a href="diary.html">返回归档</a></p>';
    }
}

// 主题切换
async function initThemeSwitcher() {
    const themeToggle = document.getElementById('theme-toggle');
    if (!themeToggle) return;

    const savedTheme = localStorage.getItem('theme');
    const systemPrefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const currentTheme = savedTheme || (systemPrefersDark ? 'dark' : 'light');

    document.documentElement.setAttribute('data-theme', currentTheme);
    themeToggle.innerHTML = currentTheme === 'dark'
        ? '<i class="fas fa-sun"></i>'
        : '<i class="fas fa-moon"></i>';

    themeToggle.addEventListener('click', () => {
        const theme = document.documentElement.getAttribute('data-theme');
        const newTheme = theme === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', newTheme);
        localStorage.setItem('theme', newTheme);
        themeToggle.innerHTML = newTheme === 'dark'
            ? '<i class="fas fa-sun"></i>'
            : '<i class="fas fa-moon"></i>';
    });
}

document.addEventListener('DOMContentLoaded', initThemeSwitcher);

document.addEventListener('DOMContentLoaded', function () {
    if (document.getElementById('posts-list')) {
        loadAllPosts();
    }
});
