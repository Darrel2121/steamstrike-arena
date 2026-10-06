/**
 * NewsModal.js
 * Interactive Steampunk News & Patch Notes viewer for players.
 * Fetches latest updates from GET /api/news and renders rich cards with modal reading.
 */

export class NewsModal {
  constructor() {
    this.news = [];
    this.selectedArticle = null;
    this.isLoaded = false;

    this.bindDom();
    this.attachEvents();
    this.fetchNews();
  }

  bindDom() {
    this.dom = {
      modalNews: document.getElementById('modalNews'),
      btnCloseNews: document.getElementById('btnCloseNews'),
      newsListContainer: document.getElementById('newsModalListContainer'),
      newsArticleView: document.getElementById('newsModalArticleView'),
      btnBackToNewsList: document.getElementById('btnBackToNewsList'),
      homeNewsGrid: document.getElementById('homeNewsGrid'),
      navBtnNews: document.getElementById('navBtnNews'),
      mNavBtnNews: document.getElementById('mNavBtnNews')
    };
  }

  attachEvents() {
    const addTap = (el, handler) => {
      if (!el) return;
      const fn = (e) => {
        if (e && e.type === 'touchend') e.preventDefault();
        handler(e);
      };
      el.addEventListener('click', fn);
      el.addEventListener('touchend', fn, { passive: false });
    };

    addTap(this.dom.navBtnNews, () => this.open());
    addTap(this.dom.mNavBtnNews, () => {
      const drawer = document.getElementById('mobileNavDrawer');
      if (drawer) drawer.classList.remove('open');
      this.open();
    });

    addTap(this.dom.btnCloseNews, () => this.close());
    addTap(this.dom.btnBackToNewsList, () => this.showListView());

    // Close on backdrop click
    this.dom.modalNews?.addEventListener('click', (e) => {
      if (e.target === this.dom.modalNews) {
        this.close();
      }
    });
  }

  async fetchNews() {
    try {
      const res = await fetch('/api/news');
      const data = await res.json();
      if (data.success && Array.isArray(data.news)) {
        this.news = data.news;
        this.isLoaded = true;
        this.renderHomeNewsPreview();
        this.renderModalNewsList();
      }
    } catch (err) {
      console.warn('[NewsModal] Failed to fetch news:', err.message);
    }
  }

  open(articleId = null) {
    if (!this.dom.modalNews) return;
    this.dom.modalNews.style.display = 'flex';

    if (articleId) {
      this.showArticle(articleId);
    } else {
      this.showListView();
    }
  }

  close() {
    if (!this.dom.modalNews) return;
    this.dom.modalNews.style.display = 'none';
  }

  showListView() {
    if (this.dom.newsListContainer) this.dom.newsListContainer.style.display = 'flex';
    if (this.dom.newsArticleView) this.dom.newsArticleView.style.display = 'none';
    this.renderModalNewsList();
  }

  showArticle(id) {
    const article = this.news.find(n => n.id === id);
    if (!article) return;

    this.selectedArticle = article;
    if (this.dom.newsListContainer) this.dom.newsListContainer.style.display = 'none';
    if (this.dom.newsArticleView) {
      this.dom.newsArticleView.style.display = 'block';
      this.dom.newsArticleView.innerHTML = `
        <div style="border-bottom: 1.5px solid rgba(197, 155, 39, 0.3); padding-bottom: 12px; margin-bottom: 14px;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
            <span class="tab-pill" style="background: ${article.tagColor || '#2ec4b6'}; font-size: 11px; padding: 2px 8px;">
              ${article.category}
            </span>
            <span style="font-size: 11px; color: #8e9aa8; font-family: var(--font-mono);">${article.date}</span>
          </div>

          <h2 style="font-family: var(--font-header); font-size: 20px; color: #ffcf48; margin: 4px 0 8px 0; line-height: 1.3;">
            ${article.title}
          </h2>

          <div style="font-size: 11px; color: var(--color-copper-light);">
            Автор: <strong>${article.author || 'Команда розробки'}</strong>
          </div>
        </div>

        <div style="font-size: 14px; color: #e6edf3; line-height: 1.7; white-space: pre-line; background: rgba(0,0,0,0.3); padding: 16px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.06);">
          ${article.content || article.summary}
        </div>
      `;
    }
  }

  renderModalNewsList() {
    if (!this.dom.newsListContainer) return;
    if (this.news.length === 0) {
      this.dom.newsListContainer.innerHTML = `<div style="text-align: center; color: #8e9aa8; padding: 30px;">Новин наразі немає</div>`;
      return;
    }

    this.dom.newsListContainer.innerHTML = this.news.map(n => `
      <div class="steampunk-panel news-card-item" style="padding: 14px; cursor: pointer; transition: all 0.2s ease; border: 1px solid rgba(197, 155, 39, 0.25); display: flex; flex-direction: column; gap: 8px;" data-id="${n.id}">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <div>
            <span class="tab-pill" style="background: ${n.tagColor || '#2ec4b6'}; font-size: 10px; padding: 2px 6px; margin-right: 6px;">${n.category}</span>
            <strong style="color: #ffcf48; font-size: 14px;">${n.title}</strong>
            ${n.pinned ? '📌' : ''}
          </div>
          <span style="font-size: 11px; color: #8e9aa8;">${n.date}</span>
        </div>

        <p style="font-size: 12px; color: #c9d1d9; margin: 0; line-height: 1.4;">${n.summary}</p>

        <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 4px;">
          <span style="font-size: 10px; color: #8e9aa8;">✍️ ${n.author}</span>
          <span style="font-size: 11px; color: #2ec4b6; font-weight: bold;">Читати повністю →</span>
        </div>
      </div>
    `).join('');

    this.dom.newsListContainer.querySelectorAll('.news-card-item').forEach(card => {
      card.addEventListener('click', () => {
        this.showArticle(card.dataset.id);
      });
    });
  }

  renderHomeNewsPreview() {
    if (!this.dom.homeNewsGrid) return;
    const previewNews = this.news.slice(0, 3);
    if (previewNews.length === 0) {
      this.dom.homeNewsGrid.innerHTML = `<div style="text-align: center; color: #8e9aa8; padding: 20px; grid-column: 1 / -1;">Новини завантажуються...</div>`;
      return;
    }

    this.dom.homeNewsGrid.innerHTML = previewNews.map(n => `
      <div class="home-news-card steampunk-panel" data-id="${n.id}" style="padding: 16px; cursor: pointer; display: flex; flex-direction: column; justify-content: space-between; transition: all 0.2s ease;">
        <div>
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
            <span class="tab-pill" style="background: ${n.tagColor || '#2ec4b6'}; font-size: 10px; padding: 2px 6px;">${n.category}</span>
            <span style="font-size: 11px; color: #8e9aa8;">${n.date}</span>
          </div>
          <h4 style="font-family: var(--font-header); font-size: 15px; color: #ffcf48; margin: 0 0 6px 0; line-height: 1.3;">
            ${n.title} ${n.pinned ? '📌' : ''}
          </h4>
          <p style="font-size: 12px; color: #c9d1d9; line-height: 1.4; margin: 0 0 10px 0;">
            ${n.summary}
          </p>
        </div>
        <div style="display: flex; justify-content: space-between; align-items: center; border-top: 1px solid rgba(255,255,255,0.06); padding-top: 8px;">
          <span style="font-size: 11px; color: #8e9aa8;">✍️ ${n.author}</span>
          <span style="font-size: 12px; color: #2ec4b6; font-weight: bold;">Детальніше →</span>
        </div>
      </div>
    `).join('');

    this.dom.homeNewsGrid.querySelectorAll('.home-news-card').forEach(card => {
      card.addEventListener('click', () => {
        this.open(card.dataset.id);
      });
    });
  }
}
