/*
  FOLIO — interface independente para a Open Library.
  O app.js original não é modificado e não é necessário para este arquivo funcionar.
  Documentação: https://openlibrary.org/dev/docs/api/search
*/
(() => {
  'use strict';

  const API = 'https://openlibrary.org';
  const LIMIT = 24;
  const PAGE_SIZE = 8;
  const STORAGE_KEY = 'folio-open-library-favorites-v1';
  const colors = ['#e2e7da','#e7e2d6','#dce7e8','#e3dfed','#eee0d6','#dce7d9','#f0e7d3','#e3e7db'];
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const els = {
    header: $('#siteHeader'), progress: $('#scrollProgress'), art: $('#heroArt'), title: $('#heroTitle'),
    searchInput: $('#searchInput'), searchForm: $('#searchForm'), booksGrid: $('#booksGrid'),
    totalCount: $('#totalCount'), shownCount: $('#shownCount'), resultsHeading: $('#resultsHeading'),
    loadMoreWrap: $('#loadMoreWrap'), loadMore: $('#loadMore'), sort: $('#sortSelect'),
    gridView: $('#gridView'), listView: $('#listView'), shelfCount: $('#shelfCount'),
    shelfDrawer: $('#shelfDrawer'), shelfItems: $('#shelfItems'), overlay: $('#overlay'),
    modal: $('#bookModal'), modalContent: $('#modalContent'), toast: $('#toast'),
  };

  const state = {
    query: 'Harry Potter', books: [], total: 0, visible: PAGE_SIZE, sort: 'relevance',
    view: 'grid', controller: null, requestId: 0, detailRequestId: 0,
    favorites: readFavorites(), activePanel: null, lastFocus: null, debounceId: null, toastId: null,
  };

  function readFavorites() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
      return Array.isArray(parsed) ? parsed.filter(v => v && typeof v.id === 'string').slice(0, 200) : [];
    } catch { return []; }
  }
  function persistFavorites() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state.favorites)); }
    catch { showToast('Não foi possível salvar os favoritos neste navegador.'); }
  }
  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  }
  function normalizeId(value) {
    const str = String(value || '');
    if (/^\/works\/OL\d+W$/.test(str)) return str;
    if (/^OL\d+W$/.test(str)) return `/works/${str}`;
    return '';
  }
  const number = value => new Intl.NumberFormat('pt-BR').format(value || 0);
  const slug = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  const coverUrl = (id, size = 'M') => Number.isSafeInteger(Number(id)) && Number(id) > 0 ? `https://covers.openlibrary.org/b/id/${Number(id)}-${size}.jpg?default=false` : '';
  const externalUrl = book => book.id ? `${API}${book.id}` : `${API}/search?q=${encodeURIComponent(book.title)}`;
  const sanitizeBook = item => ({
    id: normalizeId(item.key), title: String(item.title || 'Título desconhecido'),
    author: Array.isArray(item.author_name) && item.author_name.length ? String(item.author_name[0]) : 'Autor desconhecido',
    year: Number(item.first_publish_year) || null, editions: Number(item.edition_count) || 0,
    cover: Number.isSafeInteger(Number(item.cover_i)) && Number(item.cover_i) > 0 ? Number(item.cover_i) : null,
  });

  function renderSkeleton() {
    els.booksGrid.classList.remove('list-mode');
    els.booksGrid.setAttribute('aria-busy', 'true');
    els.booksGrid.innerHTML = Array.from({length: 8}, () => `<article class="book-card skeleton" aria-hidden="true"><div class="book-visual"></div><div class="sk-line"></div><div class="sk-line short"></div></article>`).join('');
    els.resultsHeading.textContent = 'BUSCANDO HISTÓRIAS';
    els.shownCount.textContent = 'CARREGANDO...';
    els.loadMoreWrap.hidden = true;
  }

  function renderEmpty(title, message, retry = false) {
    els.booksGrid.setAttribute('aria-busy', 'false');
    els.booksGrid.innerHTML = `<div class="empty-state"><svg class="icon"><use href="#i-book"/></svg><h3>${escapeHtml(title)}</h3><p>${escapeHtml(message)}</p>${retry ? '<button type="button" id="retrySearch">Tentar novamente</button>' : ''}</div>`;
    els.loadMoreWrap.hidden = true;
    $('#retrySearch')?.addEventListener('click', () => searchBooks(state.query));
  }

  function sortedBooks() {
    const books = [...state.books];
    if (state.sort === 'newest') books.sort((a,b) => (b.year || 0) - (a.year || 0));
    if (state.sort === 'oldest') books.sort((a,b) => (a.year || 9999) - (b.year || 9999));
    if (state.sort === 'editions') books.sort((a,b) => b.editions - a.editions);
    return books;
  }

  function coverMarkup(book, index) {
    const image = coverUrl(book.cover);
    const fallback = `<div class="book-fallback"><small>FOLIO / LIVROS</small><span>${escapeHtml(book.title)}</span></div>`;
    return image
      ? `<img class="book-cover" src="${image}" alt="Capa de ${escapeHtml(book.title)}" loading="lazy" decoding="async" onerror="this.outerHTML=decodeURIComponent(this.dataset.fallback)" data-fallback="${encodeURIComponent(fallback)}" />`
      : fallback;
  }

  function cardMarkup(book, index) {
    const favorite = state.favorites.some(f => f.id === book.id);
    return `<article class="book-card" style="--i:${index % 8};--card-bg:${colors[index % colors.length]}" data-bookid="${escapeHtml(book.id)}" data-favorite="${favorite}">
      <div class="book-visual" role="group" aria-label="${escapeHtml(book.title)}">
        <span class="card-index">${String(index + 1).padStart(2,'0')}</span>
        ${coverMarkup(book,index)}
        <button type="button" class="favorite-btn ${favorite ? 'is-saved' : ''}" data-action="favorite" data-bookid="${escapeHtml(book.id)}" aria-label="${favorite ? 'Remover dos favoritos' : 'Adicionar aos favoritos'}: ${escapeHtml(book.title)}" aria-pressed="${favorite}"><svg class="icon"><use href="#i-heart"/></svg></button>
        <button type="button" class="book-quick" data-action="details" data-bookid="${escapeHtml(book.id)}">Ver detalhes <svg class="icon"><use href="#i-arrow"/></svg></button>
      </div>
      <div class="book-info"><div class="book-info-top"><span>${escapeHtml(book.year || 'ANO NÃO INFORMADO')}</span><span>${book.editions ? `${number(book.editions)} ED.` : 'LIVRO'}</span></div>
      <h3 class="book-title"><button type="button" data-action="details" data-bookid="${escapeHtml(book.id)}">${escapeHtml(book.title)}</button></h3>
      <p class="book-author">${escapeHtml(book.author)}</p></div>
    </article>`;
  }

  function renderBooks() {
    const sorted = sortedBooks();
    const visible = sorted.slice(0,state.visible);
    els.booksGrid.classList.toggle('list-mode',state.view === 'list');
    els.booksGrid.setAttribute('aria-busy','false');
    els.totalCount.textContent = state.total ? number(state.total) : '0';
    els.resultsHeading.textContent = `RESULTADOS PARA “${state.query.toLocaleUpperCase('pt-BR')}”`;
    els.shownCount.textContent = `EXIBINDO ${visible.length} DE ${number(state.total)}`;
    els.booksGrid.innerHTML = visible.length ? visible.map(cardMarkup).join('') : '';
    els.loadMoreWrap.hidden = visible.length >= sorted.length || !visible.length;
    if (!visible.length) renderEmpty('Nenhum livro encontrado','Experimente outro título, autor ou assunto.');
    loadHeroBooks(sorted);
  }

  function loadHeroBooks(books) {
    const ids = ['heroBookBack','heroBookMid','heroBookFront'];
    const withCovers = books.filter(book => book.cover).slice(0,3);
    ids.forEach((id,i) => {
      const node = document.getElementById(id);
      const book = withCovers[i];
      if (!node || !book) return;
      const image = new Image();
      image.src = coverUrl(book.cover,'L');
      image.alt = `Capa de ${book.title}`;
      image.loading = 'eager';
      image.onload = () => node.replaceChildren(image);
    });
  }

  async function searchBooks(query) {
    const term = String(query || '').trim();
    if (!term) { showToast('Digite um título, autor ou assunto para pesquisar.');els.searchInput.focus();return; }
    if (state.controller) state.controller.abort();
    const controller = new AbortController();
    state.controller = controller;
    const thisRequest = ++state.requestId;
    state.query = term;
    state.visible = PAGE_SIZE;
    els.searchInput.value = term;
    setActiveTopic(term);
    renderSkeleton();
    const params = new URLSearchParams({q:term, limit:String(LIMIT), lang:'pt', fields:'key,title,author_name,cover_i,first_publish_year,edition_count'});
    try {
      const response = await fetch(`${API}/search.json?${params.toString()}`, {signal:controller.signal});
      if (!response.ok) throw new Error(`Erro HTTP ${response.status}`);
      const data = await response.json();
      if (thisRequest !== state.requestId) return;
      if (!Array.isArray(data.docs)) throw new Error('Formato inesperado da API');
      const unique = new Set();
      state.books = data.docs.map(sanitizeBook).filter(book => {
        if (!book.id || unique.has(book.id)) return false;
        unique.add(book.id);return true;
      });
      state.total = Number(data.numFound ?? data.num_found) || 0;
      renderBooks();
      try { history.replaceState(null,'',`${location.pathname}${location.hash || ''}`); } catch { /* ambientes restritos */ }
    } catch (error) {
      if (error.name === 'AbortError' || thisRequest !== state.requestId) return;
      console.error('Falha ao consultar Open Library:',error);
      els.totalCount.textContent = '—';
      els.resultsHeading.textContent = 'NÃO FOI POSSÍVEL CARREGAR';
      els.shownCount.textContent = 'FALHA NA CONSULTA';
      renderEmpty('A biblioteca está indisponível','Verifique sua conexão e tente novamente.',true);
    }
  }

  function setActiveTopic(query) {
    $$('.topic-chip').forEach(chip => {
      const selected = slug(chip.dataset.query) === slug(query);
      chip.classList.toggle('is-selected', selected);
      chip.setAttribute('aria-pressed',String(selected));
    });
  }

  function changeView(view) {
    state.view = view;
    els.gridView.classList.toggle('is-active',view === 'grid');
    els.listView.classList.toggle('is-active',view === 'list');
    els.gridView.setAttribute('aria-pressed',String(view === 'grid'));
    els.listView.setAttribute('aria-pressed',String(view === 'list'));
    if (state.books.length) renderBooks();
  }

  function findBook(id) { return state.books.find(item => item.id === id) || state.favorites.find(item => item.id === id); }
  function toggleFavorite(book) {
    if (!book || !book.id) return;
    const existed = state.favorites.some(item => item.id === book.id);
    state.favorites = existed ? state.favorites.filter(item => item.id !== book.id) : [book, ...state.favorites];
    persistFavorites();
    els.shelfCount.textContent = String(state.favorites.length);
    showToast(existed ? 'Livro removido da sua estante.' : 'Livro salvo na sua estante.');
    if (state.books.length) renderBooks();
    renderShelf();
    const modalSave = $('#modalFavorite');
    if (modalSave) { modalSave.innerHTML = `<svg class="icon"><use href="#i-heart"/></svg>${existed ? 'Salvar na estante' : 'Remover da estante'}`; }
  }

  function renderShelf() {
    if (!state.favorites.length) {
      els.shelfItems.innerHTML = '<div class="shelf-empty"><svg class="icon"><use href="#i-heart"/></svg><h3>Sua estante está vazia.</h3><p>Toque no coração de qualquer livro para guardar aqui.</p></div>';
      return;
    }
    els.shelfItems.innerHTML = state.favorites.map(book => `<article class="shelf-item" data-bookid="${escapeHtml(book.id)}">
      <div class="shelf-item-cover">${book.cover ? `<img src="${coverUrl(book.cover,'S')}" alt="" loading="lazy" onerror="this.style.display='none'">` : '<svg class="icon"><use href="#i-book"/></svg>'}</div>
      <div class="shelf-item-info"><h3>${escapeHtml(book.title)}</h3><p>${escapeHtml(book.author)}</p><button type="button" data-shelf-action="details" data-bookid="${escapeHtml(book.id)}">Ver detalhes</button></div>
      <button class="shelf-remove" type="button" data-shelf-action="remove" data-bookid="${escapeHtml(book.id)}" aria-label="Remover ${escapeHtml(book.title)}"><svg class="icon"><use href="#i-close"/></svg></button>
    </article>`).join('');
  }

  function openPanel(name) {
    const previousFocus = state.activePanel ? state.lastFocus : document.activeElement;
    if (state.activePanel) closePanel(false);
    state.activePanel = name;
    state.lastFocus = previousFocus;
    els.overlay.hidden = false;
    document.body.classList.add('modal-open');
    if (name === 'shelf') {
      els.shelfDrawer.inert = false;
      els.shelfDrawer.setAttribute('aria-hidden','false');
      els.shelfDrawer.classList.add('is-open');
      renderShelf();
      $('#closeShelf').focus();
    } else {
      els.modal.inert = false;
      els.modal.setAttribute('aria-hidden','false');
      els.modal.classList.add('is-open');
      $('#closeModal').focus();
    }
  }
  function closePanel(restoreFocus = true) {
    if (!state.activePanel) return;
    const panel = state.activePanel;
    state.activePanel = null;
    state.detailRequestId++;
    els.overlay.hidden = true;
    document.body.classList.remove('modal-open');
    if (panel === 'shelf') {
      els.shelfDrawer.classList.remove('is-open');
      els.shelfDrawer.setAttribute('aria-hidden','true');
      els.shelfDrawer.inert = true;
    } else {
      els.modal.classList.remove('is-open');
      els.modal.setAttribute('aria-hidden','true');
      els.modal.inert = true;
    }
    if (restoreFocus && state.lastFocus && typeof state.lastFocus.focus === 'function') state.lastFocus.focus();
  }

  function descriptionText(raw) {
    if (typeof raw === 'string') return raw;
    if (raw && typeof raw.value === 'string') return raw.value;
    return '';
  }
  async function showDetails(book) {
    if (!book) return;
    const saved = state.favorites.some(f => f.id === book.id);
    const illustration = book.cover ? `<img src="${coverUrl(book.cover,'L')}" alt="Capa de ${escapeHtml(book.title)}" onerror="this.style.display='none'">` : `<div class="book-fallback"><small>FOLIO / LIVROS</small><span>${escapeHtml(book.title)}</span></div>`;
    els.modalContent.innerHTML = `<div class="modal-visual">${illustration}</div><div class="modal-details">
      <span class="modal-overline">DETALHES DO LIVRO / OPEN LIBRARY</span>
      <h2 id="modalTitle">${escapeHtml(book.title)}</h2><p class="modal-author">${escapeHtml(book.author)}</p>
      <div class="modal-facts"><span>PUBLICAÇÃO <strong>${book.year || '—'}</strong></span><span>EDIÇÕES <strong>${number(book.editions)}</strong></span></div>
      <p class="modal-description" id="modalDescription">Carregando informações sobre esta obra...</p>
      <div class="modal-actions"><a href="${externalUrl(book)}" target="_blank" rel="noopener noreferrer">Ver na Open Library <svg class="icon"><use href="#i-arrow-up"/></svg></a><button type="button" id="modalFavorite"><svg class="icon"><use href="#i-heart"/></svg> ${saved ? 'Remover da estante' : 'Salvar na estante'}</button></div>
    </div>`;
    openPanel('modal');
    const request = ++state.detailRequestId;
    $('#modalFavorite').addEventListener('click', () => toggleFavorite(book));
    if (!book.id) { $('#modalDescription').textContent = 'Mais informações disponíveis na página da Open Library.';return; }
    try {
      const response = await fetch(`${API}${book.id}.json`);
      if (!response.ok) throw new Error('Detalhes indisponíveis');
      const data = await response.json();
      if (request !== state.detailRequestId || state.activePanel !== 'modal') return;
      const description = descriptionText(data.description).trim().replace(/\s+/g,' ');
      $('#modalDescription').textContent = description || 'Esta obra ainda não possui uma descrição cadastrada. Confira mais informações na Open Library.';
    } catch {
      if (request === state.detailRequestId && state.activePanel === 'modal') {
        $('#modalDescription').textContent = 'Não foi possível carregar a sinopse agora. Confira a página da obra na Open Library.';
      }
    }
  }

  function showToast(message) {
    clearTimeout(state.toastId);
    els.toast.textContent = message;
    els.toast.classList.add('is-visible');
    state.toastId = setTimeout(() => els.toast.classList.remove('is-visible'), 3100);
  }

  function bindEvents() {
    els.searchForm.addEventListener('submit', event => {
      event.preventDefault();
      clearTimeout(state.debounceId);
      searchBooks(els.searchInput.value);
    });
    els.searchInput.addEventListener('input', () => {
      clearTimeout(state.debounceId);
      const query = els.searchInput.value.trim();
      setActiveTopic(query);
      if (query.length >= 3 && slug(query) !== slug(state.query)) {
        state.debounceId = setTimeout(() => searchBooks(query), 750);
      }
    });
    $$('.topic-chip').forEach(chip => chip.addEventListener('click', () => {
      clearTimeout(state.debounceId);
      searchBooks(chip.dataset.query);
    }));
    els.sort.addEventListener('change', event => {state.sort = event.target.value; if (state.books.length) renderBooks();});
    els.gridView.addEventListener('click', () => changeView('grid'));
    els.listView.addEventListener('click', () => changeView('list'));
    els.loadMore.addEventListener('click', () => {state.visible += PAGE_SIZE;renderBooks();});
    els.booksGrid.addEventListener('click', event => {
      const button = event.target.closest('[data-action]');
      if (button) {
        const book = findBook(button.dataset.bookid);
        if (button.dataset.action === 'favorite') toggleFavorite(book);
        if (button.dataset.action === 'details') showDetails(book);
        return;
      }
      const visual = event.target.closest('.book-visual');
      if (visual) showDetails(findBook(visual.closest('[data-bookid]')?.dataset.bookid));
    });
    els.shelfItems.addEventListener('click', event => {
      const button = event.target.closest('[data-shelf-action]');
      if (!button) return;
      const book = findBook(button.dataset.bookid);
      if (button.dataset.shelfAction === 'remove') toggleFavorite(book);
      if (button.dataset.shelfAction === 'details') showDetails(book);
    });
    $('#openShelf').addEventListener('click', () => openPanel('shelf'));
    $('#closeShelf').addEventListener('click', () => closePanel());
    $('#closeModal').addEventListener('click', () => closePanel());
    els.overlay.addEventListener('click', () => closePanel());
    $('#headerSearch').addEventListener('click', focusSearch);
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && state.activePanel) { event.preventDefault();closePanel();return; }
      if (state.activePanel && event.key === 'Tab') {
        const active = state.activePanel === 'shelf' ? els.shelfDrawer : els.modal;
        const items = $$('button:not([disabled]),a[href],input:not([disabled])',active).filter(el => el.getClientRects().length);
        if (!items.length) return;
        const first = items[0],last = items[items.length-1];
        if (event.shiftKey && document.activeElement === first) {event.preventDefault();last.focus();}
        if (!event.shiftKey && document.activeElement === last) {event.preventDefault();first.focus();}
        return;
      }
      const tag = document.activeElement?.tagName || '';
      const typing = ['INPUT','TEXTAREA','SELECT'].includes(tag) || document.activeElement?.isContentEditable;
      if (!state.activePanel && ((event.key === '/' && !typing) || ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k'))) {
        event.preventDefault();focusSearch();
      }
    });
  }
  function focusSearch() {
    document.getElementById('explorar').scrollIntoView({behavior: window.matchMedia('(prefers-reduced-motion:reduce)').matches ? 'instant' : 'smooth'});
    setTimeout(() => {els.searchInput.focus({preventScroll:true});els.searchInput.select();}, 320);
  }

  function initMotion() {
    document.documentElement.classList.add('js-ready');
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if ('IntersectionObserver' in window) {
      const observer = new IntersectionObserver(entries => {
        entries.forEach(entry => { if (entry.isIntersecting) {entry.target.classList.add('is-visible');observer.unobserve(entry.target);} });
      },{threshold:.04,rootMargin:'0px 0px -15px 0px'});
      $$('.reveal').forEach(el => observer.observe(el));
    } else {$$('.reveal').forEach(el => el.classList.add('is-visible'));}
    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        const y = window.scrollY;
        const height = Math.max(1,document.documentElement.scrollHeight-window.innerHeight);
        els.progress.style.transform = `scaleX(${Math.min(1,y/height)})`;
        els.header.classList.toggle('is-scrolled',y > 60);
        const inExplore = y > Math.max(0,document.getElementById('explorar').offsetTop-170);
        $$('.nav-link').forEach(link => link.classList.toggle('is-active',link.getAttribute('href') === (inExplore ? '#explorar' : '#inicio')));
        if (!reduced && window.innerWidth > 700 && y < 830) {
          els.art.style.translate = `0 ${Math.round(y*.09)}px`;
          els.title.style.transform = `translate3d(0,${Math.round(y*.07)}px,0)`;
        }
        frame = 0;
      });
    };
    window.addEventListener('scroll',onScroll,{passive:true});
    onScroll();
    if (!reduced && window.matchMedia('(pointer:fine)').matches) {
      els.art.addEventListener('pointermove', event => {
        const rect = els.art.getBoundingClientRect();
        const x = (event.clientX-rect.left)/rect.width-.5;
        const y = (event.clientY-rect.top)/rect.height-.5;
        els.art.style.transform = `rotateX(${-y*3}deg) rotateY(${x*5}deg)`;
      });
      els.art.addEventListener('pointerleave', () => {els.art.style.transform = '';});
    }
  }

  function init() {
    els.shelfCount.textContent = String(state.favorites.length);
    bindEvents();
    initMotion();
    searchBooks('Harry Potter');
  }
  init();
})();
