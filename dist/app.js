(() => {
  'use strict';
  const SIZE = 256;
  const LOGICAL = 64;
  const DB_NAME = 'cursor-playground-v1';
  const CURSOR_ROLES = ['Arrow','Busy','Crosshair','Forbidden','Help','IBeam','Link','Move','Pointing','Window E-W','Window N-S','Window NE-SW','Window NW-SE'];
  const $ = (id) => document.getElementById(id);
  const $$ = (selector) => [...document.querySelectorAll(selector)];
  const clamp = (number, min, max) => Math.max(min, Math.min(max, number));
  const freshMask = () => new Uint8ClampedArray(SIZE * SIZE).fill(255);
  const COMPONENT_STYLES = [{ id: 'classic', label: 'Classic', color: '#303149' }, { id: 'soft', label: 'Soft', color: '#ea809b' }, { id: 'pixel', label: 'Pixel', color: '#4843a9' }, { id: 'neon', label: 'Neon', color: '#27cfc4' }, { id: 'outline', label: 'Outline', color: '#303149' }];
  const baseVariant = () => ({ id: 'variant-1', name: 'Arrow', role: 'Arrow', parts: [], componentStyle: 'classic', hotspotX: 18, hotspotY: 16 });
  const defaults = () => ({ name: 'My little cursor', sourceUrl: null, x: 0, y: 0, scale: 1, rotation: 0, outline: 2, outlineColor: '#ffffff', style: 'original', hotspotX: 18, hotspotY: 16, mask: freshMask(), pixelDetail: 32, pixelGray: 0, pixelBrightness: 0, pixelContrast: 0, pixelLevels: 8, pixelDither: 'none', duoDark: '#443057', duoLight: '#ffc8aa', duoContrast: 0, halftoneInk: '#303149', halftonePaper: '#fff8eb', halftoneSpacing: 10, halftoneAngle: 45, halftoneContrast: 10, sketchInk: '#303149', sketchPaper: '#fffaf2', sketchLines: 24, sketchStrength: 70, sketchContrast: 15, crtType: 'monitor', crtScan: 55, crtPitch: 5, crtGlow: 28, crtWarp: 10, crtRgb: 2, crtGrain: 8, componentStyle: 'classic', cursorRole: 'Arrow', parts: [], variants: [baseVariant()], activeVariantId: 'variant-1' });
  let state = defaults();
  let sourceImage = null;
  let currentPage = 'home';
  let currentTool = 'cutout';
  let cutoutTool = 'magic';
  let history = [];
  let future = [];
  let drag = null;
  let saveTimer = null;
  let toastTimer = null;
  let databasePromise = null;
  let activeWorkId = null;
  let galleryRequestId = 0;
  let lastFocus = null;
  let selectedPartId = null;
  let partSequence = 0;
  let selectionDraft = null;
  let selectedShape = 'square';
  let setGridOpen = false;
  let setGridKey = '';
  let setGridDrag = null;

  const stage = $('artCanvas');
  const stageCtx = stage.getContext('2d', { willReadFrequently: true });
  const lassoOverlay = $('lassoOverlay');
  const lassoCtx = lassoOverlay.getContext('2d');
  const sourceCanvas = document.createElement('canvas');
  sourceCanvas.width = sourceCanvas.height = SIZE;
  const sourceCtx = sourceCanvas.getContext('2d', { willReadFrequently: true });
  const renderCanvas = document.createElement('canvas');
  renderCanvas.width = renderCanvas.height = SIZE;
  const renderCtx = renderCanvas.getContext('2d', { willReadFrequently: true });
  const setArtworkCanvas = document.createElement('canvas');
  setArtworkCanvas.width = setArtworkCanvas.height = SIZE;
  const setArtworkCtx = setArtworkCanvas.getContext('2d');
  const maskedCanvas = document.createElement('canvas');
  maskedCanvas.width = maskedCanvas.height = SIZE;
  const maskedCtx = maskedCanvas.getContext('2d', { willReadFrequently: true });
  const transformedCanvas = document.createElement('canvas');
  transformedCanvas.width = transformedCanvas.height = SIZE;
  const transformedCtx = transformedCanvas.getContext('2d', { willReadFrequently: true });
  const pixelCanvas = document.createElement('canvas');
  pixelCanvas.width = pixelCanvas.height = 32;
  const pixelCtx = pixelCanvas.getContext('2d', { willReadFrequently: true });

  function showToast(message) {
    const el = $('toast');
    el.textContent = message;
    el.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.add('hidden'), 3500);
  }

  function showPage(page, updateUrl = true) {
    if (!['home', 'editor', 'gallery', 'guide'].includes(page)) page = 'home';
    currentPage = page;
    $('homePage').classList.toggle('hidden', page !== 'home');
    $('editorPage').classList.toggle('hidden', page !== 'editor');
    $('galleryPage').classList.toggle('hidden', page !== 'gallery');
    $('guidePage').classList.toggle('hidden', page !== 'guide');
    $$('[data-page]').forEach(button => button.classList.toggle('active', button.dataset.page === page));
    if (updateUrl) window.history.pushState({ page }, '', page === 'home' ? location.pathname + location.search : `#${page}`);
    window.scrollTo({ top: 0, behavior: 'instant' });
    if (page === 'editor') {
      selectTool('cutout', { automatic: true });
      $('inspectorScrollContent').scrollTop = 0;
      renderAll();
    }
    if (page === 'home' || page === 'gallery') refreshCreations();
  }

  function cloneParts(parts) { return parts.map(part => ({ ...part })); }
  function cloneVariants(variants) { return variants.map(variant => ({ ...variant, parts: cloneParts(variant.parts || []) })); }

  function syncActiveVariant() {
    const variant = state.variants.find(item => item.id === state.activeVariantId);
    if (variant) Object.assign(variant, { role: state.cursorRole, parts: cloneParts(state.parts), componentStyle: state.componentStyle, hotspotX: state.hotspotX, hotspotY: state.hotspotY });
  }

  function normalizeVariants(next) {
    if (!Array.isArray(next.variants) || !next.variants.length) {
      state.variants = [{ ...baseVariant(), name: state.cursorRole, role: state.cursorRole, parts: cloneParts(state.parts), componentStyle: state.componentStyle, hotspotX: state.hotspotX, hotspotY: state.hotspotY }];
      state.activeVariantId = 'variant-1';
    } else {
      state.variants = cloneVariants(next.variants);
      if (!state.variants.some(item => item.id === state.activeVariantId)) state.activeVariantId = state.variants[0].id;
    }
  }

  function snapshot() {
    syncActiveVariant();
    return { ...state, mask: state.mask.slice(), parts: cloneParts(state.parts), variants: cloneVariants(state.variants) };
  }

  function checkpoint() {
    history.push(snapshot());
    if (history.length > 30) history.shift();
    future = [];
    updateHistoryButtons();
  }

  function updateHistoryButtons() {
    $('undoBtn').disabled = history.length === 0;
    $('redoBtn').disabled = future.length === 0;
  }

  function loadImage(url) {
    return new Promise((resolve, reject) => {
      if (!url) return resolve(null);
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('This image could not be opened.'));
      image.src = url;
    });
  }

  async function applySnapshot(next) {
    state = { ...defaults(), ...next, mask: next.mask instanceof Uint8ClampedArray ? next.mask.slice() : new Uint8ClampedArray(next.mask || freshMask()), parts: cloneParts(next.parts || []) };
    normalizeVariants(next);
    selectedPartId = null;
    sourceImage = await loadImage(state.sourceUrl);
    syncControls();
    renderAll();
    scheduleSave();
  }

  async function undo() {
    if (!history.length) return;
    future.push(snapshot());
    await applySnapshot(history.pop());
    updateHistoryButtons();
  }

  async function redo() {
    if (!future.length) return;
    history.push(snapshot());
    await applySnapshot(future.pop());
    updateHistoryButtons();
  }

  function scheduleSave() {
    $('saveStatus').classList.remove('error');
    $('saveStatus').textContent = 'Saving…';
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveProject, 700);
  }

  function getDatabase() {
    if (!('indexedDB' in window)) return Promise.reject(new Error('Browser storage is unavailable.'));
    if (!databasePromise) databasePromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => request.result.createObjectStore('projects');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Could not open local storage.'));
    });
    return databasePromise;
  }

  async function saveProject() {
    try {
      const database = await getDatabase();
      const record = { ...snapshot(), activeWorkId, savedAt: Date.now() };
      await new Promise((resolve, reject) => {
        const transaction = database.transaction('projects', 'readwrite');
        transaction.objectStore('projects').put(record, 'current');
        transaction.oncomplete = resolve;
        transaction.onerror = () => reject(transaction.error);
      });
      $('saveStatus').textContent = 'Saved locally ✓';
      $('saveStatus').classList.remove('error');
    } catch (error) {
      $('saveStatus').textContent = 'Save failed';
      $('saveStatus').classList.add('error');
      showToast('Local save failed. Export your artwork before leaving.');
      console.error(error);
    }
  }

  async function restoreProject() {
    try {
      const database = await getDatabase();
      const record = await new Promise((resolve, reject) => {
        const transaction = database.transaction('projects', 'readonly');
        const request = transaction.objectStore('projects').get('current');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      if (!record) return;
      const { savedAt, activeWorkId: storedWorkId, ...next } = record;
      activeWorkId = storedWorkId || null;
      state = { ...defaults(), ...next, mask: next.mask instanceof Uint8ClampedArray ? next.mask : new Uint8ClampedArray(next.mask || freshMask()), parts: Array.isArray(next.parts) ? next.parts : [] };
      normalizeVariants(next);
      sourceImage = await loadImage(state.sourceUrl);
      syncControls();
      renderAll();
      $('saveStatus').textContent = 'Saved locally ✓';
      $('headerStart').firstChild.textContent = 'Continue creating ';
    } catch (error) {
      console.error(error);
      $('saveStatus').textContent = 'Storage unavailable';
      $('saveStatus').classList.add('error');
    }
  }

  async function getSavedWorks() {
    const database = await getDatabase();
    const works = await new Promise((resolve, reject) => {
      const items = [];
      const transaction = database.transaction('projects', 'readonly');
      const request = transaction.objectStore('projects').openCursor(IDBKeyRange.bound('work:', 'work:\uffff'));
      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor) { items.push(cursor.value); cursor.continue(); }
        else resolve(items);
      };
      request.onerror = () => reject(request.error);
    });
    return works.sort((a, b) => b.savedAt - a.savedAt);
  }

  function creationCard(work, allowDelete) {
    const card = document.createElement('article'); card.className = 'creation-card';
    const art = document.createElement('div'); art.className = 'creation-art';
    const image = document.createElement('img'); image.src = work.previewUrl || ''; image.alt = '';
    art.append(image);
    const body = document.createElement('div'); body.className = 'creation-card-body';
    const title = document.createElement('h3'); title.textContent = work.name || 'My little cursor';
    const meta = document.createElement('p'); meta.className = 'creation-meta';
    const locale = window.CURSOR_I18N?.language || 'zh-CN';
    const date = new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'short', day: 'numeric' }).format(new Date(work.savedAt));
    meta.textContent = `${date} · ${work.cursorRole || 'Arrow'}`;
    const actions = document.createElement('div'); actions.className = 'creation-actions';
    const open = document.createElement('button'); open.type = 'button'; open.className = 'small-outline'; open.textContent = 'Open in studio'; open.addEventListener('click', () => openWork(work.id));
    actions.append(open);
    if (allowDelete) {
      const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'creation-delete'; remove.textContent = 'Delete'; remove.addEventListener('click', () => deleteWork(work.id));
      actions.append(remove);
    }
    body.append(title, meta, actions); card.append(art, body);
    return card;
  }

  async function refreshCreations() {
    const requestId = ++galleryRequestId;
    try {
      const works = await getSavedWorks();
      if (requestId !== galleryRequestId) return;
      $('galleryCount').textContent = String(works.length);
      $('homeCreationsEmpty').classList.toggle('hidden', works.length > 0);
      $('galleryEmpty').classList.toggle('hidden', works.length > 0);
      $('viewAllCreations').classList.toggle('hidden', works.length === 0);
      $('homeCreationsGrid').replaceChildren(...works.slice(0, 3).map(work => creationCard(work, false)));
      $('galleryGrid').replaceChildren(...works.map(work => creationCard(work, true)));
    } catch (error) {
      console.error(error);
      if (requestId === galleryRequestId) showToast('Could not load saved creations in this browser.');
    }
  }

  async function saveWork({ quiet = false } = {}) {
    if (!sourceImage && !state.parts.length && !state.variants.some(variant => variant.parts.length)) {
      if (!quiet) showToast('Add an image or component before saving.');
      return false;
    }
    const buttons = [$('saveWork')];
    buttons.forEach(button => { button.disabled = true; });
    try {
      const database = await getDatabase();
      const id = activeWorkId || crypto.randomUUID();
      state.name = $('projectName').value.trim().slice(0, 48) || 'My little cursor';
      const record = { ...snapshot(), id, savedAt: Date.now(), previewUrl: outputCanvas(256).toDataURL('image/png') };
      await new Promise((resolve, reject) => {
        const transaction = database.transaction('projects', 'readwrite');
        transaction.objectStore('projects').put(record, `work:${id}`);
        transaction.oncomplete = resolve;
        transaction.onerror = () => reject(transaction.error);
      });
      activeWorkId = id;
      clearTimeout(saveTimer);
      await saveProject();
      refreshCreations();
      if (!quiet) showToast('Saved to My creations.');
      return true;
    } catch (error) {
      console.error(error);
      if (!quiet) showToast('Could not save this creation in this browser.');
      return false;
    } finally { buttons.forEach(button => { button.disabled = false; }); }
  }

  async function openWork(id) {
    if ((sourceImage || state.parts.length || state.variants.some(variant => variant.parts.length)) && !(await saveWork({ quiet: true }))) return;
    try {
      const database = await getDatabase();
      const record = await new Promise((resolve, reject) => {
        const request = database.transaction('projects', 'readonly').objectStore('projects').get(`work:${id}`);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      if (!record) return showToast('This saved creation is no longer available.');
      const { id: workId, savedAt, previewUrl, ...next } = record;
      clearTimeout(saveTimer);
      activeWorkId = workId;
      history = []; future = []; updateHistoryButtons();
      await applySnapshot(next);
      showPage('editor');
      showToast('Creation opened.');
    } catch (error) { console.error(error); showToast('Could not open this creation.'); }
  }

  async function deleteWork(id) {
    if (!confirm('Delete this saved creation? This cannot be undone.')) return;
    try {
      const database = await getDatabase();
      await new Promise((resolve, reject) => {
        const transaction = database.transaction('projects', 'readwrite');
        transaction.objectStore('projects').delete(`work:${id}`);
        transaction.oncomplete = resolve;
        transaction.onerror = () => reject(transaction.error);
      });
      if (activeWorkId === id) { activeWorkId = null; scheduleSave(); }
      refreshCreations(); showToast('Saved creation deleted.');
    } catch (error) { console.error(error); showToast('Could not delete this creation.'); }
  }

  async function startNewWork() {
    if ((sourceImage || state.parts.length || state.variants.some(variant => variant.parts.length)) && !(await saveWork({ quiet: true }))) return;
    clearTimeout(saveTimer);
    activeWorkId = null;
    state = defaults(); sourceImage = null; selectedPartId = null; selectionDraft = null;
    history = []; future = []; updateHistoryButtons();
    syncControls(); renderAll(); scheduleSave(); showPage('editor');
  }

  function makeSample() {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 512;
    const c = canvas.getContext('2d');
    c.translate(256, 256);
    c.strokeStyle = '#303149';
    c.lineWidth = 17;
    c.lineJoin = 'round';
    c.lineCap = 'round';
    c.fillStyle = '#ffb4a5';
    c.beginPath();
    c.moveTo(-158, -68); c.lineTo(-140, -189); c.lineTo(-61, -135);
    c.quadraticCurveTo(0, -157, 61, -135);
    c.lineTo(140, -189); c.lineTo(158, -68);
    c.bezierCurveTo(198, -13, 162, 118, 0, 129);
    c.bezierCurveTo(-162, 118, -198, -13, -158, -68);
    c.closePath(); c.fill(); c.stroke();
    c.fillStyle = '#ff8a98';
    c.beginPath(); c.moveTo(-132,-153);c.lineTo(-76,-119);c.lineTo(-143,-95);c.fill();
    c.beginPath();c.moveTo(132,-153);c.lineTo(76,-119);c.lineTo(143,-95);c.fill();
    c.beginPath();c.moveTo(-83,9);c.quadraticCurveTo(-66,-8,-49,9);c.stroke();
    c.beginPath();c.moveTo(49,9);c.quadraticCurveTo(66,-8,83,9);c.stroke();
    c.fillStyle = '#303149'; c.beginPath();c.moveTo(-13,40);c.lineTo(13,40);c.lineTo(0,56);c.closePath();c.fill();
    c.lineWidth = 9;c.beginPath();c.moveTo(0,56);c.lineTo(0,67);c.moveTo(0,67);c.quadraticCurveTo(-15,79,-29,67);c.moveTo(0,67);c.quadraticCurveTo(15,79,29,67);c.stroke();
    c.lineWidth = 7;[[-121,45,-185,32],[-119,67,-182,72],[121,45,185,32],[119,67,182,72]].forEach(([x1,y1,x2,y2])=>{c.beginPath();c.moveTo(x1,y1);c.lineTo(x2,y2);c.stroke();});
    return canvas.toDataURL('image/png');
  }

  async function startSample() {
    checkpoint();
    selectionDraft = null;
    activeWorkId = null;
    state = { ...state, sourceUrl: makeSample(), mask: freshMask(), x: 0, y: 0, scale: 1, rotation: 0, hotspotX: 11, hotspotY: 10, name: 'My little cat' };
    sourceImage = await loadImage(state.sourceUrl);
    syncControls(); renderAll(); scheduleSave(); showPage('editor');
    showToast('Sample loaded. Make it yours!');
  }

  async function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error || new Error('Could not read the file.'));
      reader.readAsDataURL(file);
    });
  }

  async function importFile(file) {
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) return showToast('Please choose a PNG, JPG, or WebP image.');
    if (file.size > 15 * 1024 * 1024) return showToast('Please choose an image smaller than 15 MB.');
    try {
      const url = await fileToDataUrl(file);
      const image = await loadImage(url);
      checkpoint();
      selectionDraft = null;
      activeWorkId = null;
      state = { ...state, sourceUrl: url, mask: freshMask(), x: 0, y: 0, scale: 1, rotation: 0, name: file.name.replace(/\.[^.]+$/, '').slice(0, 48) || 'My cursor' };
      sourceImage = image;
      syncControls(); renderAll(); scheduleSave(); showPage('editor');
      showToast('Image added. Use Cut out if it has a background.');
    } catch (error) {
      console.error(error);
      showToast('This image could not be opened. Please try another file.');
    }
  }

  function drawSource() {
    sourceCtx.clearRect(0, 0, SIZE, SIZE);
    if (!sourceImage) return;
    const longSide = Math.max(sourceImage.naturalWidth, sourceImage.naturalHeight);
    const width = sourceImage.naturalWidth / longSide * 188;
    const height = sourceImage.naturalHeight / longSide * 188;
    sourceCtx.save();
    sourceCtx.translate(SIZE / 2, SIZE / 2);
    sourceCtx.imageSmoothingEnabled = state.style !== 'pixel';
    sourceCtx.imageSmoothingQuality = 'high';
    sourceCtx.drawImage(sourceImage, -width / 2, -height / 2, width, height);
    sourceCtx.restore();
  }

  function rgb(hex) {
    return [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16));
  }

  function luminance(data, offset) {
    return .299 * data[offset] + .587 * data[offset + 1] + .114 * data[offset + 2];
  }

  function tone(value, contrast) {
    return clamp((value - 128) * (1 + contrast / 100) + 128, 0, 255);
  }

  function applyPixel() {
    const detail = state.pixelDetail;
    pixelCanvas.width = pixelCanvas.height = detail;
    pixelCtx.clearRect(0, 0, detail, detail);
    pixelCtx.drawImage(sourceCanvas, 0, 0, detail, detail);
    const image = pixelCtx.getImageData(0, 0, detail, detail);
    const data = image.data;
    const errors = new Float32Array(detail * detail * 3);
    const matrix = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
    const levels = state.pixelLevels;
    const step = 255 / (levels - 1);
    for (let y = 0; y < detail; y++) for (let x = 0; x < detail; x++) {
      const pixel = y * detail + x, offset = pixel * 4;
      if (!data[offset + 3]) continue;
      const gray = luminance(data, offset);
      for (let channel = 0; channel < 3; channel++) {
        const blended = data[offset + channel] * (1 - state.pixelGray / 100) + gray * state.pixelGray / 100;
        const adjusted = tone(blended + state.pixelBrightness * 2, state.pixelContrast) + errors[pixel * 3 + channel];
        const bias = state.pixelDither === 'ordered' ? (matrix[(y % 4) * 4 + (x % 4)] / 16 - .5) * step : 0;
        const quantized = clamp(Math.round((adjusted + bias) / step) * step, 0, 255);
        data[offset + channel] = quantized;
        if (state.pixelDither === 'floyd') {
          const error = adjusted - quantized;
          if (x + 1 < detail) errors[(pixel + 1) * 3 + channel] += error * 7 / 16;
          if (y + 1 < detail) {
            if (x > 0) errors[(pixel + detail - 1) * 3 + channel] += error * 3 / 16;
            errors[(pixel + detail) * 3 + channel] += error * 5 / 16;
            if (x + 1 < detail) errors[(pixel + detail + 1) * 3 + channel] += error / 16;
          }
        }
      }
    }
    pixelCtx.putImageData(image, 0, 0);
    maskedCtx.imageSmoothingEnabled = false;
    maskedCtx.drawImage(pixelCanvas, 0, 0, SIZE, SIZE);
    maskedCtx.imageSmoothingEnabled = true;
  }

  function applyHalftone(original) {
    const spacing = state.halftoneSpacing;
    const angle = state.halftoneAngle * Math.PI / 180;
    const ink = state.halftoneInk, paper = state.halftonePaper;
    const data = original.data;
    maskedCtx.save();
    maskedCtx.translate(SIZE / 2, SIZE / 2);
    maskedCtx.rotate(angle);
    maskedCtx.fillStyle = paper;
    maskedCtx.fillRect(-SIZE, -SIZE, SIZE * 2, SIZE * 2);
    maskedCtx.fillStyle = ink;
    const c = Math.cos(angle), s = Math.sin(angle);
    for (let gy = -SIZE; gy < SIZE; gy += spacing) for (let gx = -SIZE; gx < SIZE; gx += spacing) {
      const sx = Math.round(gx * c - gy * s + SIZE / 2);
      const sy = Math.round(gx * s + gy * c + SIZE / 2);
      if (sx < 0 || sx >= SIZE || sy < 0 || sy >= SIZE) continue;
      const index = (sy * SIZE + sx) * 4;
      if (data[index + 3] < 8) continue;
      const darkness = 1 - tone(luminance(data, index), state.halftoneContrast) / 255;
      const radius = Math.sqrt(darkness) * spacing * .68;
      if (radius < .3) continue;
      maskedCtx.beginPath(); maskedCtx.arc(gx, gy, radius, 0, Math.PI * 2); maskedCtx.fill();
    }
    maskedCtx.restore();
  }

  function applySketch(original) {
    const input = original.data;
    const output = maskedCtx.createImageData(SIZE, SIZE);
    const data = output.data;
    const ink = rgb(state.sketchInk), paper = rgb(state.sketchPaper);
    const gap = Math.max(3, Math.round(300 / state.sketchLines));
    const strength = state.sketchStrength / 100;
    const light = (x, y) => luminance(input, (clamp(y, 0, SIZE - 1) * SIZE + clamp(x, 0, SIZE - 1)) * 4);
    for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
      const i = (y * SIZE + x) * 4;
      if (!input[i + 3]) continue;
      const base = tone(light(x, y), state.sketchContrast);
      const edge = Math.min(1, (Math.abs(light(x + 1, y) - light(x - 1, y)) + Math.abs(light(x, y + 1) - light(x, y - 1))) / 140);
      const shade = (255 - base) / 255;
      const row = Math.abs((y + x * .15) % gap - gap / 2) < .9 ? 1 : 0;
      const diagonal = Math.abs((x + y) % (gap * 1.5) - gap * .75) < .8 ? 1 : 0;
      const line = clamp(edge * 1.25 + (shade > .16 ? row * shade * .9 : 0) + (shade > .48 ? diagonal * shade * .6 : 0), 0, 1) * strength;
      for (let channel = 0; channel < 3; channel++) data[i + channel] = Math.round(paper[channel] * (1 - line) + ink[channel] * line);
      data[i + 3] = input[i + 3];
    }
    maskedCtx.putImageData(output, 0, 0);
  }

  function applyCRT(original) {
    const input = original.data;
    const image = maskedCtx.createImageData(SIZE, SIZE);
    const output = image.data;
    const pitch = state.crtPitch;
    const offset = state.crtRgb;
    const pixel = (x, y) => (clamp(y, 0, SIZE - 1) * SIZE + clamp(x, 0, SIZE - 1)) * 4;
    for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
      const dx = (x - SIZE / 2) / (SIZE / 2), dy = (y - SIZE / 2) / (SIZE / 2);
      const warp = 1 + state.crtWarp / 100 * (dx * dx + dy * dy) * .55;
      const sx = Math.round(SIZE / 2 + dx * SIZE / 2 * warp);
      const sy = Math.round(SIZE / 2 + dy * SIZE / 2 * warp);
      if (sx < 0 || sx >= SIZE || sy < 0 || sy >= SIZE) continue;
      const source = pixel(sx, sy), target = pixel(x, y);
      const alpha = Math.round(input[source + 3] * state.mask[sy * SIZE + sx] / 255);
      if (!alpha) continue;
      const red = input[pixel(sx + offset, sy)], green = input[source + 1], blue = input[pixel(sx - offset, sy) + 2];
      const grain = (((x * 73 + y * 151) ^ (x * y * 19)) % 101 / 50 - 1) * state.crtGrain;
      const scanPhase = (y % pitch) / pitch;
      const scan = state.crtType === 'lcd' ? 1 : 1 - state.crtScan / 100 * (scanPhase > .58 ? (state.crtType === 'tv' ? .75 : .48) : .08);
      const triad = Math.floor(x / Math.max(1, pitch / 3)) % 3;
      const vignette = 1 - Math.min(.24, (dx * dx + dy * dy) * .12);
      const glow = state.crtGlow / 100;
      const neighbors = (input[pixel(sx - 2, sy) + 1] + input[pixel(sx + 2, sy) + 1] + input[pixel(sx, sy - 2) + 1] + input[pixel(sx, sy + 2) + 1]) / 4;
      const channels = [red, green, blue];
      for (let channel = 0; channel < 3; channel++) {
        const grille = state.crtType === 'tv' ? 1 : (triad === channel ? 1 : 1 - state.crtScan / 450);
        output[target + channel] = clamp((channels[channel] * (1 - glow * .12) + neighbors * glow * .12 + grain) * scan * grille * vignette, 0, 255);
      }
      output[target + 3] = alpha;
    }
    maskedCtx.putImageData(image, 0, 0);
  }

  function applyStyle() {
    maskedCtx.clearRect(0, 0, SIZE, SIZE);
    const original = sourceCtx.getImageData(0, 0, SIZE, SIZE);
    if (state.style === 'pixel') applyPixel();
    else if (state.style === 'halftone') applyHalftone(original);
    else if (state.style === 'sketch') applySketch(original);
    else if (state.style === 'crt') applyCRT(original);
    else maskedCtx.drawImage(sourceCanvas, 0, 0);
    const image = maskedCtx.getImageData(0, 0, SIZE, SIZE);
    const data = image.data;
    const dark = rgb(state.duoDark), light = rgb(state.duoLight);
    for (let i = 0; i < state.mask.length; i++) {
      const offset = i * 4;
      if (state.style === 'duotone' && data[offset + 3]) {
        const value = tone(luminance(data, offset), state.duoContrast) / 255;
        for (let channel = 0; channel < 3; channel++) data[offset + channel] = Math.round(dark[channel] * (1 - value) + light[channel] * value);
      }
      const sourceAlpha = original.data[offset + 3];
      if (state.style === 'halftone' || state.style === 'sketch') data[offset + 3] = sourceAlpha;
      if (state.style !== 'crt') data[offset + 3] = Math.round(data[offset + 3] * state.mask[i] / 255);
    }
    maskedCtx.putImageData(image, 0, 0);
  }

  function drawTransformed() {
    transformedCtx.clearRect(0, 0, SIZE, SIZE);
    transformedCtx.save();
    transformedCtx.translate(SIZE / 2 + state.x * 4, SIZE / 2 + state.y * 4);
    transformedCtx.rotate(state.rotation * Math.PI / 180);
    transformedCtx.scale(state.scale, state.scale);
    transformedCtx.imageSmoothingEnabled = state.style !== 'pixel';
    transformedCtx.drawImage(maskedCanvas, -SIZE / 2, -SIZE / 2);
    transformedCtx.restore();
  }

  function drawOutline() {
    renderCtx.clearRect(0, 0, SIZE, SIZE);
    const radius = state.outline * 4;
    if (radius > 0) {
      for (let step = 1; step <= radius; step += Math.max(1, radius / 3)) {
        for (let angle = 0; angle < 360; angle += 24) {
          const rad = angle * Math.PI / 180;
          renderCtx.drawImage(transformedCanvas, Math.cos(rad) * step, Math.sin(rad) * step);
        }
      }
      renderCtx.globalCompositeOperation = 'source-in';
      renderCtx.fillStyle = state.outlineColor;
      renderCtx.fillRect(0, 0, SIZE, SIZE);
      renderCtx.globalCompositeOperation = 'source-over';
    }
    renderCtx.drawImage(transformedCanvas, 0, 0);
  }

  function selectedPart() {
    return state.parts.find(part => part.id === selectedPartId) || null;
  }

  function partForRole(role, anchor = null) {
    const types = { Arrow: 'arrow', Busy: 'busy', Crosshair: 'crosshair', Forbidden: 'forbidden', Help: 'help', IBeam: 'ibeam', Link: 'link', Move: 'move', Pointing: 'link', 'Window E-W': 'resize-ew', 'Window N-S': 'resize-ns', 'Window NE-SW': 'resize-diag', 'Window NW-SE': 'resize-diag' };
    const type = types[role] || 'arrow';
    return { id: `part-${crypto.randomUUID()}`, type, x: anchor?.x ?? 32, y: anchor?.y ?? 32, size: anchor?.size ?? 14, rotation: role === 'Window NE-SW' ? -45 : role === 'Window NW-SE' ? 45 : anchor?.type === type ? (anchor.rotation || 0) : 0, color: anchor?.color || COMPONENT_STYLES.find(style => style.id === state.componentStyle)?.color || '#303149', visualStyle: anchor?.visualStyle || state.componentStyle };
  }

  function setAnchorPart() {
    return selectedPart() || state.parts[0] || state.variants.find(variant => variant.parts?.length)?.parts[0] || null;
  }

  function alignedRolePart(role, anchor, existing = null) {
    const part = partForRole(role, anchor);
    if (existing) part.id = existing.id;
    return part;
  }

  function ensureSetComponents(anchor) {
    for (const variant of state.variants) {
      if (variant.parts?.length) continue;
      variant.parts = [alignedRolePart(variant.role, anchor)];
      variant.componentStyle = anchor.visualStyle || state.componentStyle;
    }
    const active = state.variants.find(variant => variant.id === state.activeVariantId);
    if (active) state.parts = cloneParts(active.parts);
  }

  function setHasMissingParts() { return state.variants.some(variant => !variant.parts?.length); }

  function makeVariant(role, anchor) {
    return { id: `variant-${crypto.randomUUID()}`, name: role, role, parts: [partForRole(role, anchor)], componentStyle: anchor.visualStyle || state.componentStyle, hotspotX: role === 'Arrow' ? 26 : 32, hotspotY: role === 'Arrow' ? 25 : 32 };
  }

  function activateVariant(id) {
    const variant = state.variants.find(item => item.id === id);
    if (!variant) return;
    state.activeVariantId = id;
    state.cursorRole = variant.role;
    state.componentStyle = variant.componentStyle || variant.parts?.[0]?.visualStyle || 'classic';
    state.parts = cloneParts(variant.parts || []);
    state.hotspotX = variant.hotspotX;
    state.hotspotY = variant.hotspotY;
    selectedPartId = null;
    syncControls(); renderAll(); scheduleSave();
  }

  function renderVariantList() {
    const list = $('variantList'); list.replaceChildren();
    $('variantCount').textContent = `${state.variants.length} ${state.variants.length === 1 ? 'STATE' : 'STATES'}`;
    for (const variant of state.variants) {
      const button = document.createElement('button'); button.type = 'button';
      button.className = `variant-item${variant.id === state.activeVariantId ? ' active' : ''}`;
      button.textContent = variant.name;
      button.title = `Edit ${variant.name}`;
      button.addEventListener('click', () => { if (variant.id === state.activeVariantId) return; checkpoint(); activateVariant(variant.id); });
      list.append(button);
    }
    $('deleteVariant').disabled = state.variants.length < 2;
    $('downloadBatch').classList.toggle('hidden', state.variants.length < 2);
  }

  function selectGridVariant(id, selectPart = false) {
    if (state.activeVariantId !== id) { syncActiveVariant(); activateVariant(id); }
    selectedPartId = selectPart ? state.parts[0]?.id || null : null;
    syncPartControls(); renderAll();
  }

  function gridPosition(preview, event) {
    const rect = preview.getBoundingClientRect();
    return { x: clamp((event.clientX - rect.left) / rect.width * LOGICAL, 0, LOGICAL), y: clamp((event.clientY - rect.top) / rect.height * LOGICAL, 0, LOGICAL) };
  }

  function gridResizeHandle(preview, point, part) {
    const radius = part.size / 2 + 1.5;
    const tolerance = Math.max(1.5, 11 / preview.getBoundingClientRect().width * LOGICAL);
    return [-1, 1].some(dx => [-1, 1].some(dy => Math.hypot(point.x - part.x - dx * radius, point.y - part.y - dy * radius) <= tolerance));
  }

  function buildSetGrid() {
    const grid = $('setGridCards'); grid.replaceChildren();
    for (const variant of state.variants) {
      const card = document.createElement('article'); card.className = 'set-grid-card'; card.dataset.variantId = variant.id;
      const heading = document.createElement('div'); heading.className = 'set-grid-card-head';
      const name = document.createElement('strong'); name.textContent = variant.name;
      const hint = document.createElement('span'); hint.textContent = 'DRAG TO ADJUST';
      heading.append(name, hint);
      const preview = document.createElement('button'); preview.type = 'button'; preview.className = 'set-grid-preview'; preview.setAttribute('aria-label', variant.name);
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = SIZE;
      const selection = document.createElement('div'); selection.className = 'set-grid-selection hidden'; selection.setAttribute('aria-hidden', 'true');
      for (const corner of ['nw','ne','se','sw']) { const handle = document.createElement('span'); handle.className = `set-grid-handle ${corner}`; selection.append(handle); }
      preview.append(canvas, selection);
      preview.addEventListener('pointerdown', event => {
        if (event.button !== 0) return;
        const wasSelected = state.activeVariantId === variant.id && selectedPartId === state.parts[0]?.id;
        selectGridVariant(variant.id);
        const part = state.parts[0]; if (!part) return;
        const point = gridPosition(preview, event);
        const resizing = wasSelected && gridResizeHandle(preview, point, part);
        if (!resizing && Math.hypot(point.x - part.x, point.y - part.y) > part.size * .55 + 2) return;
        selectedPartId = part.id; syncPartControls(); renderAll();
        setGridDrag = { type: resizing ? 'resize' : 'move', id: variant.id, pointerId: event.pointerId, dx: point.x - part.x, dy: point.y - part.y, startDistance: Math.hypot(point.x - part.x, point.y - part.y), startSize: part.size, checkpointed: false };
        preview.setPointerCapture(event.pointerId);
      });
      preview.addEventListener('pointermove', event => {
        if (!setGridDrag || setGridDrag.id !== variant.id || setGridDrag.pointerId !== event.pointerId) return;
        const point = gridPosition(preview, event), part = state.parts[0]; if (!part) return;
        if (setGridDrag.type === 'resize') {
          const distance = Math.hypot(point.x - part.x, point.y - part.y);
          const size = clamp(Math.round(setGridDrag.startSize * distance / Math.max(1, setGridDrag.startDistance)), 6, 36);
          if (size === part.size) return;
          if (!setGridDrag.checkpointed) { checkpoint(); setGridDrag.checkpointed = true; }
          part.size = size; syncPartControls(); renderAll(); scheduleSave(); return;
        }
        const x = clamp(Math.round(point.x - setGridDrag.dx), 0, LOGICAL), y = clamp(Math.round(point.y - setGridDrag.dy), 0, LOGICAL);
        if (x === part.x && y === part.y) return;
        if (!setGridDrag.checkpointed) { checkpoint(); setGridDrag.checkpointed = true; }
        part.x = x; part.y = y; syncPartControls(); renderAll(); scheduleSave();
      });
      const finishDrag = event => { if (setGridDrag?.pointerId === event.pointerId) setGridDrag = null; };
      preview.addEventListener('pointerup', finishDrag); preview.addEventListener('pointercancel', finishDrag);
      preview.addEventListener('click', event => { if (event.detail === 0) selectGridVariant(variant.id, true); });
      const controls = document.createElement('div'); controls.className = 'set-grid-card-controls';
      for (const key of ['x','y']) {
        const label = document.createElement('label'); label.textContent = key.toUpperCase();
        const input = document.createElement('input'); input.type = 'number'; input.min = '0'; input.max = '64'; input.step = '1'; input.dataset.coordinate = key; input.setAttribute('aria-label', `${variant.name} ${key.toUpperCase()}`);
        let editing = false;
        input.addEventListener('input', () => {
          if (input.value === '') return;
          const value = Number(input.value); if (!Number.isFinite(value)) return;
          selectGridVariant(variant.id, true); const part = state.parts[0]; if (!part) return;
          const next = clamp(Math.round(value), 0, LOGICAL); if (part[key] === next) return;
          if (!editing) { checkpoint(); editing = true; }
          part[key] = next; syncPartControls(); renderAll(); scheduleSave();
        });
        input.addEventListener('blur', () => { editing = false; renderSetGrid(); });
        label.append(input); controls.append(label);
      }
      card.append(heading, preview, controls); grid.append(card);
    }
    setGridKey = state.variants.map(variant => `${variant.id}:${variant.name}`).join('|');
    window.CURSOR_I18N?.translate(grid);
  }

  function renderSetGrid() {
    if (!setGridOpen) return;
    syncActiveVariant();
    if (setGridKey !== state.variants.map(variant => `${variant.id}:${variant.name}`).join('|')) buildSetGrid();
    for (const card of $('setGridCards').children) {
      const variant = state.variants.find(item => item.id === card.dataset.variantId); if (!variant) continue;
      card.classList.toggle('active', variant.id === state.activeVariantId);
      const canvas = card.querySelector('canvas'), context = canvas.getContext('2d');
      context.clearRect(0, 0, SIZE, SIZE); context.drawImage(setArtworkCanvas, 0, 0);
      for (const part of variant.parts || []) drawPart(context, part);
      const part = variant.parts?.[0], selection = card.querySelector('.set-grid-selection');
      const selected = variant.id === state.activeVariantId && part?.id === selectedPartId;
      selection.classList.toggle('hidden', !selected);
      if (selected) {
        const radius = part.size / 2 + 1.5;
        selection.style.left = `${(part.x - radius) / LOGICAL * 100}%`;
        selection.style.top = `${(part.y - radius) / LOGICAL * 100}%`;
        selection.style.width = `${radius * 2 / LOGICAL * 100}%`;
        selection.style.height = `${radius * 2 / LOGICAL * 100}%`;
      }
      for (const input of card.querySelectorAll('[data-coordinate]')) if (document.activeElement !== input) input.value = Math.round(variant.parts?.[0]?.[input.dataset.coordinate] ?? 0);
    }
  }

  function showSetGrid() {
    setGridOpen = true;
    $('setGridView').classList.remove('hidden');
    document.querySelector('.canvas-surround').classList.add('hidden');
    renderAll();
    $('setGridView').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function leaveSetGrid() {
    setGridOpen = false; setGridDrag = null;
    $('setGridView').classList.add('hidden');
    document.querySelector('.canvas-surround').classList.remove('hidden');
    renderAll();
  }

  function renderComponentStyles() {
    const grid = $('componentStyleGrid');
    grid.replaceChildren();
    for (const style of COMPONENT_STYLES) {
      const button = document.createElement('button');
      button.type = 'button'; button.className = `component-style-tile${state.componentStyle === style.id ? ' active' : ''}`;
      button.dataset.componentStyle = style.id;
      button.setAttribute('aria-pressed', String(state.componentStyle === style.id));
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 64;
      drawPart(canvas.getContext('2d'), { ...partForRole(state.cursorRole), x: 8, y: 8, size: 14, visualStyle: style.id, color: style.color });
      const label = document.createElement('span'); label.textContent = style.label;
      button.append(canvas, label);
      button.addEventListener('click', () => {
        checkpoint(); state.componentStyle = style.id;
        if (!state.parts.length) { const part = partForRole(state.cursorRole); state.parts.push(part); selectedPartId = part.id; }
        else for (const part of state.parts) { part.visualStyle = style.id; part.color = style.color; }
        syncControls(); renderAll(); scheduleSave();
      });
      grid.append(button);
    }
    window.CURSOR_I18N?.translate(grid);
  }

  function drawPart(context, part) {
    context.save();
    const visualStyle = part.visualStyle || 'classic';
    context.translate(part.x * 4, part.y * 4);
    context.rotate((part.rotation || 0) * Math.PI / 180);
    context.scale(part.size * 4 / 24, part.size * 4 / 24);
    context.strokeStyle = visualStyle === 'neon' ? '#49ffe8' : part.color;
    context.fillStyle = visualStyle === 'soft' ? '#ffe5ed' : visualStyle === 'neon' ? '#192040' : visualStyle === 'pixel' ? '#dcd9ff' : visualStyle === 'outline' ? 'rgba(255,255,255,.08)' : '#ffffff';
    context.lineWidth = visualStyle === 'soft' ? 3.8 : visualStyle === 'outline' ? 1.5 : visualStyle === 'neon' ? 2.6 : 2.2;
    context.lineJoin = visualStyle === 'pixel' ? 'miter' : 'round';
    context.lineCap = visualStyle === 'pixel' ? 'square' : 'round';
    if (visualStyle === 'neon') { context.shadowColor = '#49ffe8'; context.shadowBlur = 8; }
    if (visualStyle === 'pixel') context.setLineDash([3, 1]);
    const line = (...points) => { context.beginPath(); context.moveTo(points[0], points[1]); for (let i = 2; i < points.length; i += 2) context.lineTo(points[i], points[i + 1]); context.stroke(); };
    const arrowHead = (x, y, direction) => { context.save(); context.translate(x, y); context.rotate(direction); line(-3, 4, 0, 0, 3, 4); context.restore(); };
    switch (part.type) {
      case 'arrow':
        context.beginPath(); context.moveTo(-9, -11); context.lineTo(-8, 9); context.lineTo(-3, 4); context.lineTo(1, 11); context.lineTo(5, 9); context.lineTo(1, 2); context.lineTo(8, 2); context.closePath(); context.fill(); context.stroke(); break;
      case 'ibeam':
        line(-7, -10, 7, -10); line(0, -10, 0, 10); line(-7, 10, 7, 10); break;
      case 'help':
        context.beginPath(); context.arc(0, 0, 11, 0, Math.PI * 2); context.fill(); context.stroke();
        context.fillStyle = part.color; context.font = 'bold 19px sans-serif'; context.textAlign = 'center'; context.textBaseline = 'middle'; context.fillText('?', 0, 1); break;
      case 'forbidden':
        context.beginPath(); context.arc(0, 0, 10, 0, Math.PI * 2); context.fill(); context.stroke(); line(-7, -7, 7, 7); break;
      case 'crosshair':
        context.beginPath(); context.arc(0, 0, 5, 0, Math.PI * 2); context.stroke(); line(-12, 0, -7, 0); line(7, 0, 12, 0); line(0, -12, 0, -7); line(0, 7, 0, 12); break;
      case 'busy':
        for (let i = 0; i < 8; i++) { context.save(); context.rotate(i * Math.PI / 4); context.globalAlpha = .25 + i * .1; line(0, -7, 0, -11); context.restore(); } break;
      case 'link':
        context.beginPath(); context.moveTo(-5, 10); context.lineTo(-7, 1); context.quadraticCurveTo(-7, -3, -4, -3); context.lineTo(-1, 1); context.lineTo(-1, -9); context.quadraticCurveTo(-1, -12, 2, -12); context.quadraticCurveTo(5, -12, 5, -9); context.lineTo(5, 0); context.quadraticCurveTo(9, -3, 11, 1); context.lineTo(10, 9); context.closePath(); context.fill(); context.stroke(); break;
      case 'move':
        line(0, -11, 0, 11); line(-11, 0, 11, 0);
        arrowHead(0, -11, 0); arrowHead(11, 0, Math.PI / 2); arrowHead(0, 11, Math.PI); arrowHead(-11, 0, -Math.PI / 2); break;
      case 'resize-ns':
        line(0, -10, 0, 10); arrowHead(0, -10, 0); arrowHead(0, 10, Math.PI); break;
      case 'resize-diag':
      case 'resize-ew':
        line(-10, 0, 10, 0); arrowHead(10, 0, Math.PI / 2); arrowHead(-10, 0, -Math.PI / 2); break;
    }
    context.restore();
  }

  function drawParts() {
    for (const part of state.parts) drawPart(renderCtx, part);
  }

  function shapePoints(draft) {
    const left = Math.min(draft.x0, draft.x1), top = Math.min(draft.y0, draft.y1);
    const width = Math.abs(draft.x1 - draft.x0), height = Math.abs(draft.y1 - draft.y0);
    const at = (x, y) => ({ x: left + x * width, y: top + y * height });
    if (draft.shape === 'square') return [at(0, 0), at(1, 0), at(1, 1), at(0, 1)];
    if (draft.shape === 'triangle') return [at(.5, 0), at(1, 1), at(0, 1)];
    if (draft.shape === 'star') return Array.from({ length: 10 }, (_, i) => { const angle = -Math.PI / 2 + i * Math.PI / 5, radius = i % 2 ? .23 : .5; return at(.5 + Math.cos(angle) * radius, .5 + Math.sin(angle) * radius); });
    if (draft.shape === 'heart') return Array.from({ length: 64 }, (_, i) => { const t = i * Math.PI * 2 / 64; return at(.5 + 16 * Math.sin(t) ** 3 / 36, .5 - (13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)) / 36); });
    return Array.from({ length: 64 }, (_, i) => { const t = i * Math.PI * 2 / 64; return at(.5 + .5 * Math.cos(t), .5 + .5 * Math.sin(t)); });
  }

  function shapeHandles(draft) {
    return [
      { x: draft.x0, y: draft.y0, key: 'x0y0' }, { x: draft.x1, y: draft.y0, key: 'x1y0' },
      { x: draft.x1, y: draft.y1, key: 'x1y1' }, { x: draft.x0, y: draft.y1, key: 'x0y1' }
    ];
  }

  function partHandles(part) {
    const radius = part.size * 2 + 6, x = part.x * 4, y = part.y * 4;
    return [{ x: x - radius, y: y - radius }, { x: x + radius, y: y - radius }, { x: x + radius, y: y + radius }, { x: x - radius, y: y + radius }];
  }

  function hitHandle(point, handles) {
    return handles.find(handle => Math.hypot(point.x - handle.x, point.y - handle.y) <= 9) || null;
  }

  function insidePolygon(point, vertices) {
    let inside = false;
    for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
      const a = vertices[i], b = vertices[j];
      if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
    }
    return inside;
  }

  function imageCorners() {
    if (!sourceImage) return [];
    const longSide = Math.max(sourceImage.naturalWidth, sourceImage.naturalHeight);
    const halfWidth = sourceImage.naturalWidth / longSide * 94 * state.scale;
    const halfHeight = sourceImage.naturalHeight / longSide * 94 * state.scale;
    const angle = state.rotation * Math.PI / 180, cx = 128 + state.x * 4, cy = 128 + state.y * 4;
    return [[-halfWidth,-halfHeight],[halfWidth,-halfHeight],[halfWidth,halfHeight],[-halfWidth,halfHeight]].map(([x,y]) => ({ x: cx + x * Math.cos(angle) - y * Math.sin(angle), y: cy + x * Math.sin(angle) + y * Math.cos(angle) }));
  }

  function drawEditOverlay() {
    lassoCtx.clearRect(0, 0, SIZE, SIZE);
    if (currentTool === 'design' && sourceImage) {
      const corners = imageCorners();
      lassoCtx.beginPath(); lassoCtx.moveTo(corners[0].x, corners[0].y);
      for (const corner of corners.slice(1)) lassoCtx.lineTo(corner.x, corner.y);
      lassoCtx.closePath(); lassoCtx.strokeStyle = '#ed778a'; lassoCtx.lineWidth = 2; lassoCtx.setLineDash([5, 4]); lassoCtx.stroke(); lassoCtx.setLineDash([]);
      for (const corner of corners) { lassoCtx.fillStyle = '#fff'; lassoCtx.strokeStyle = '#ed778a'; lassoCtx.fillRect(corner.x - 5, corner.y - 5, 10, 10); lassoCtx.strokeRect(corner.x - 5, corner.y - 5, 10, 10); }
    }
    if (currentTool === 'parts' && selectedPart()) {
      const part = selectedPart();
      const radius = part.size * 2 + 6;
      lassoCtx.strokeStyle = '#ed778a'; lassoCtx.lineWidth = 2; lassoCtx.setLineDash([4, 3]);
      lassoCtx.strokeRect(part.x * 4 - radius, part.y * 4 - radius, radius * 2, radius * 2);
      lassoCtx.setLineDash([]);
      for (const handle of partHandles(part)) { lassoCtx.fillStyle = '#ffffff'; lassoCtx.strokeStyle = '#ed778a'; lassoCtx.lineWidth = 2; lassoCtx.fillRect(handle.x - 4, handle.y - 4, 8, 8); lassoCtx.strokeRect(handle.x - 4, handle.y - 4, 8, 8); }
    }
    const points = drag?.type === 'lasso' ? drag.points : selectionDraft?.type === 'polygon' ? selectionDraft.points : selectionDraft?.type === 'shape' ? shapePoints(selectionDraft) : [];
    if (currentTool === 'cutout' && points.length) {
      lassoCtx.beginPath(); lassoCtx.moveTo(points[0].x, points[0].y);
      for (const point of points.slice(1)) lassoCtx.lineTo(point.x, point.y);
      if (selectionDraft?.type === 'shape' || selectionDraft?.closed) lassoCtx.closePath();
      if (points.length >= 3) { lassoCtx.fillStyle = 'rgba(244,139,151,.18)'; lassoCtx.fill(); }
      lassoCtx.strokeStyle = '#ffffff'; lassoCtx.lineWidth = 4; lassoCtx.stroke();
      lassoCtx.strokeStyle = '#303149'; lassoCtx.lineWidth = 2; lassoCtx.setLineDash([6, 4]); lassoCtx.stroke(); lassoCtx.setLineDash([]);
      if (selectionDraft?.type === 'polygon') for (const [index, point] of points.entries()) { lassoCtx.fillStyle = index ? '#ffffff' : '#f69b9c'; lassoCtx.strokeStyle = '#303149'; lassoCtx.beginPath(); lassoCtx.arc(point.x, point.y, 4, 0, Math.PI * 2); lassoCtx.fill(); lassoCtx.stroke(); }
      if (selectionDraft?.type === 'shape') for (const handle of shapeHandles(selectionDraft)) { lassoCtx.fillStyle = '#ffffff'; lassoCtx.strokeStyle = '#303149'; lassoCtx.fillRect(handle.x - 5, handle.y - 5, 10, 10); lassoCtx.strokeRect(handle.x - 5, handle.y - 5, 10, 10); }
    }
  }

  function outputCanvas(size = 64) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const context = canvas.getContext('2d');
    context.imageSmoothingEnabled = state.style !== 'pixel';
    context.imageSmoothingQuality = 'high';
    context.drawImage(renderCanvas, 0, 0, size, size);
    return canvas;
  }

  function drawPreviewCanvas(canvas, output) {
    const context = canvas.getContext('2d');
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.imageSmoothingEnabled = state.style !== 'pixel';
    context.drawImage(output, 0, 0, canvas.width, canvas.height);
  }

  function drawComposition() {
    drawSource(); applyStyle(); drawTransformed(); drawOutline();
    if (setGridOpen) { setArtworkCtx.clearRect(0, 0, SIZE, SIZE); setArtworkCtx.drawImage(renderCanvas, 0, 0); }
    drawParts();
  }

  function renderAll() {
    drawComposition();
    stageCtx.clearRect(0, 0, SIZE, SIZE);
    stageCtx.drawImage(renderCanvas, 0, 0);
    drawEditOverlay();
    const output = outputCanvas();
    drawPreviewCanvas($('actualLight'), output);
    drawPreviewCanvas($('actualDark'), output);
    updateMarker(); updatePreview(output); updateQuality(output); updateExport();
    $('emptyCanvas').classList.toggle('hidden', !!sourceImage || state.parts.length > 0);
    $('hotspotMarker').classList.toggle('hidden', !sourceImage && !state.parts.length);
    renderSetGrid();
  }

  function updateMarker() {
    $('hotspotMarker').style.left = `${(state.hotspotX + .5) / LOGICAL * 100}%`;
    $('hotspotMarker').style.top = `${(state.hotspotY + .5) / LOGICAL * 100}%`;
  }

  function updatePreview(output) {
    const playground = $('previewPlayground');
    const cursor = sourceImage || state.parts.length ? `url(${output.toDataURL('image/png')}) ${state.hotspotX} ${state.hotspotY}, auto` : 'auto';
    playground.querySelectorAll('*').forEach(el => { el.style.cursor = cursor; });
    playground.style.cursor = cursor;
  }

  function qualityItem(kind, title, detail, action, fix) {
    const item = document.createElement('div'); item.className = `quality-item ${kind}`;
    const icon = document.createElement('span'); icon.className = 'quality-symbol'; icon.textContent = kind === 'good' ? '✓' : '!';
    const body = document.createElement('div');
    const heading = document.createElement('strong'); heading.textContent = title;
    const description = document.createElement('p'); description.textContent = detail;
    body.append(heading, description);
    if (action) { const button = document.createElement('button'); button.type = 'button'; button.textContent = action; button.addEventListener('click', fix); body.append(button); }
    item.append(icon, body); return item;
  }

  function updateQuality(output) {
    const list = $('qualityList'); list.replaceChildren();
    if (!sourceImage && !state.parts.length) return list.append(qualityItem('warn', 'Add an image or part to begin', 'Try the sample, upload an image, or add a cursor part.'));
    const data = output.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, 64, 64).data;
    let minX = 64, minY = 64, maxX = -1, maxY = -1, visible = 0, lightPixels = 0, darkPixels = 0;
    for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
      const i = (y * 64 + x) * 4, alpha = data[i + 3];
      if (alpha < 75) continue;
      visible++; minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
      const lum = .299 * data[i] + .587 * data[i + 1] + .114 * data[i + 2];
      if (lum > 195) lightPixels++; if (lum < 70) darkPixels++;
    }
    if (!visible) return list.append(qualityItem('warn', 'Nothing visible yet', 'Restore the image, increase its size, or adjust your cutout.'));
    const span = Math.max(maxX - minX + 1, maxY - minY + 1);
    list.append(qualityItem(span >= 30 ? 'good' : 'warn', span >= 30 ? 'Clear size at 64 px' : 'Your art may be too small', span >= 30 ? 'The design fills enough of the available space.' : 'Enlarge the image so details survive at actual size.', span >= 30 ? null : 'Enlarge artwork', span >= 30 ? null : () => { checkpoint(); state.scale = clamp(state.scale * 1.25, .2, 2); syncControls(); renderAll(); scheduleSave(); }));
    const hotspotIndex = (state.hotspotY * 64 + state.hotspotX) * 4 + 3;
    let nearest = Infinity;
    for (let y = Math.max(0, state.hotspotY - 8); y <= Math.min(63, state.hotspotY + 8); y++) for (let x = Math.max(0, state.hotspotX - 8); x <= Math.min(63, state.hotspotX + 8); x++) if (data[(y * 64 + x) * 4 + 3] > 75) nearest = Math.min(nearest, Math.hypot(x - state.hotspotX, y - state.hotspotY));
    const hotspotOkay = data[hotspotIndex] > 75 || nearest <= 4;
    list.append(qualityItem(hotspotOkay ? 'good' : 'warn', hotspotOkay ? 'Click point near artwork' : 'Click point looks far from artwork', hotspotOkay ? 'Your hotspot sits on or very near visible pixels.' : 'Test a small button, then place the hotspot on the intended tip.', hotspotOkay ? null : 'Adjust hotspot', hotspotOkay ? null : () => selectTool('hotspot')));
    const contrastRisk = Math.max(lightPixels, darkPixels) / visible > .82 && state.outline < 1;
    list.append(qualityItem(contrastRisk ? 'warn' : 'good', contrastRisk ? 'Try a contrasting outline' : 'Outline ready for testing', contrastRisk ? 'Your artwork may blend into one background.' : 'Check it on both light and dark backgrounds below.', contrastRisk ? 'Add outline' : null, contrastRisk ? () => { checkpoint(); state.outline = 2; state.outlineColor = lightPixels > darkPixels ? '#303149' : '#ffffff'; syncControls(); renderAll(); scheduleSave(); } : null));
  }

  function updateExport() {
    const size = Number($('exportSize').value || 64);
    const factor = size / LOGICAL;
    $('exportHotspot').textContent = `X ${clamp(Math.round(state.hotspotX * factor), 0, size - 1)} · Y ${clamp(Math.round(state.hotspotY * factor), 0, size - 1)}`;
    $('exportRole').textContent = state.cursorRole;
    drawPreviewCanvas($('exportPreview'), outputCanvas(size));
  }

  function syncControls() {
    $('projectName').value = state.name;
    $('scaleRange').value = Math.round(state.scale * 100); $('scaleValue').textContent = `${Math.round(state.scale * 100)}%`;
    $('rotateRange').value = state.rotation; $('rotateValue').textContent = `${state.rotation}°`;
    $('posX').value = state.x; $('posY').value = state.y;
    $('outlineRange').value = state.outline; $('outlineValue').textContent = `${state.outline} px`;
    $('outlineColor').value = state.outlineColor;
    $('hotspotX').value = state.hotspotX; $('hotspotY').value = state.hotspotY;
    $('styleSelect').value = state.style;
    $$('[data-style]').forEach(button => button.classList.toggle('active', button.dataset.style === state.style));
    $$('[data-style-controls]').forEach(panel => panel.classList.toggle('hidden', panel.dataset.styleControls !== state.style));
    for (const [id, suffix] of Object.entries({ pixelDetail: '', pixelGray: '%', pixelBrightness: '', pixelContrast: '', pixelLevels: '', duoContrast: '', halftoneSpacing: ' px', halftoneAngle: '°', halftoneContrast: '', sketchLines: '', sketchStrength: '%', sketchContrast: '', crtScan: '%', crtPitch: ' px', crtGlow: '%', crtWarp: '%', crtRgb: ' px', crtGrain: '' })) {
      $(id).value = state[id]; $(`${id}Value`).textContent = `${state[id]}${suffix}`;
    }
    for (const id of ['pixelDither','duoDark','duoLight','halftoneInk','halftonePaper','sketchInk','sketchPaper','crtType','cursorRole']) $(id).value = state[id];
    syncPartControls();
    renderVariantList();
    renderComponentStyles();
  }

  function syncPartControls() {
    const part = selectedPart();
    $('partInspector').classList.toggle('hidden', !part);
    if (!part) return;
    const labels = { arrow: 'Arrow', ibeam: 'Input', help: 'Help', forbidden: 'Forbidden', crosshair: 'Select', busy: 'Busy', link: 'Link', move: 'Move', 'resize-ew': 'Resize E-W', 'resize-ns': 'Resize N-S', 'resize-diag': 'Diagonal' };
    $('partLabel').textContent = labels[part.type] || 'Selected part';
    $('partSize').value = part.size; $('partSizeValue').textContent = `${part.size} px`;
    $('partRotation').value = part.rotation; $('partRotationValue').textContent = `${part.rotation}°`;
    $('partX').value = Math.round(part.x); $('partY').value = Math.round(part.y); $('partColor').value = part.color;
  }

  function setupInspectorScrollbar() {
    const inspector = document.querySelector('.inspector');
    const scroller = $('inspectorScrollContent');
    const footer = inspector.querySelector('.inspector-footer');
    const rail = $('inspectorScrollbar');
    const thumb = $('inspectorScrollThumb');
    let frame = 0;

    function update() {
      frame = 0;
      inspector.style.setProperty('--inspector-footer-height', `${footer.offsetHeight}px`);
      const railHeight = rail.clientHeight;
      const scrollRange = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
      const thumbHeight = scrollRange ? Math.max(28, railHeight * scroller.clientHeight / scroller.scrollHeight) : railHeight;
      thumb.style.height = `${Math.min(railHeight, thumbHeight)}px`;
      thumb.style.transform = `translateY(${scrollRange ? scroller.scrollTop / scrollRange * (railHeight - thumbHeight) : 0}px)`;
      rail.setAttribute('aria-valuenow', String(scrollRange ? Math.round(scroller.scrollTop / scrollRange * 100) : 0));
      rail.setAttribute('aria-disabled', String(scrollRange === 0));
    }

    const scheduleUpdate = () => { if (!frame) frame = requestAnimationFrame(update); };
    const scrollToPointer = event => {
      const track = rail.getBoundingClientRect();
      const travel = rail.clientHeight - thumb.offsetHeight;
      if (travel <= 0) return;
      scroller.scrollTop = clamp((event.clientY - track.top - dragOffset) / travel, 0, 1) * (scroller.scrollHeight - scroller.clientHeight);
    };
    let dragOffset = 0;
    rail.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      const bounds = thumb.getBoundingClientRect();
      dragOffset = event.clientY >= bounds.top && event.clientY <= bounds.bottom ? event.clientY - bounds.top : thumb.offsetHeight / 2;
      rail.setPointerCapture(event.pointerId);
      scrollToPointer(event);
    });
    rail.addEventListener('pointermove', event => { if (rail.hasPointerCapture(event.pointerId)) scrollToPointer(event); });
    rail.addEventListener('keydown', event => {
      const amounts = { ArrowUp: -48, ArrowDown: 48, PageUp: -scroller.clientHeight, PageDown: scroller.clientHeight, Home: -Infinity, End: Infinity };
      if (!(event.key in amounts)) return;
      event.preventDefault();
      if (event.key === 'Home') scroller.scrollTop = 0;
      else if (event.key === 'End') scroller.scrollTop = scroller.scrollHeight;
      else scroller.scrollTop += amounts[event.key];
    });
    scroller.addEventListener('scroll', scheduleUpdate, { passive: true });
    new ResizeObserver(scheduleUpdate).observe(inspector);
    new ResizeObserver(scheduleUpdate).observe(scroller);
    new ResizeObserver(scheduleUpdate).observe(footer);
    new MutationObserver(scheduleUpdate).observe(inspector, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });
    update();
  }

  function selectTool(tool, { automatic = false } = {}) {
    if (tool !== 'parts' && setGridOpen) leaveSetGrid();
    const previousTool = currentTool;
    currentTool = tool;
    $$('[data-tool]').forEach(button => button.classList.toggle('active', button.dataset.tool === tool));
    ['design','cutout','parts','hotspot','check'].forEach(name => $(`${name}Panel`).classList.toggle('hidden', name !== tool));
    const descriptions = { design: ['Make it yours', 'Adjust your artwork and tune its style.'], cutout: ['Tidy the edges', 'Select with a lasso, points, or resizable shapes.'], parts: ['Build your cursor', 'Make a set of cursor roles with shared artwork.'], hotspot: ['Point precisely', 'Choose the exact place your click will land.'], check: ['Little checkup', 'See how your artwork holds up at real size.'] };
    $('inspectorTitle').textContent = descriptions[tool][0];
    $('inspectorDesc').textContent = descriptions[tool][1];
    stage.style.cursor = tool === 'design' ? 'grab' : 'crosshair';
    if (!automatic && !sourceImage && tool === 'cutout') showToast('Add an image before using Cut out.');
    drawEditOverlay();
    if (tool !== previousTool) $('inspectorScrollContent').scrollTop = 0;
    if (!automatic && window.innerWidth < 700) $('inspectorTitle').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function stagePoint(event) {
    const rect = stage.getBoundingClientRect();
    return { x: clamp(Math.floor((event.clientX - rect.left) / rect.width * SIZE), 0, SIZE - 1), y: clamp(Math.floor((event.clientY - rect.top) / rect.height * SIZE), 0, SIZE - 1) };
  }

  function sourcePoint(point) {
    const angle = state.rotation * Math.PI / 180;
    const dx = point.x - (SIZE / 2 + state.x * 4);
    const dy = point.y - (SIZE / 2 + state.y * 4);
    return {
      x: Math.round((dx * Math.cos(angle) + dy * Math.sin(angle)) / state.scale + SIZE / 2),
      y: Math.round((-dx * Math.sin(angle) + dy * Math.cos(angle)) / state.scale + SIZE / 2)
    };
  }

  function floodRemove(point) {
    if (point.x < 0 || point.x >= SIZE || point.y < 0 || point.y >= SIZE) return showToast('Click on the image to remove its background.');
    const imageData = sourceCtx.getImageData(0, 0, SIZE, SIZE).data;
    const start = point.y * SIZE + point.x;
    const startOffset = start * 4;
    if (imageData[startOffset + 3] < 20) return showToast('Click on a visible background color to remove it.');
    const base = [imageData[startOffset], imageData[startOffset + 1], imageData[startOffset + 2]];
    const tolerance = Number($('toleranceRange').value);
    const seen = new Uint8Array(SIZE * SIZE);
    const queue = new Int32Array(SIZE * SIZE);
    let head = 0, tail = 0;
    queue[tail++] = start; seen[start] = 1;
    let removed = 0;
    while (head < tail) {
      const pixel = queue[head++];
      const offset = pixel * 4;
      if (imageData[offset + 3] < 20) continue;
      const distance = Math.hypot(imageData[offset] - base[0], imageData[offset + 1] - base[1], imageData[offset + 2] - base[2]);
      if (distance > tolerance * 1.7) continue;
      state.mask[pixel] = 0; removed++;
      const x = pixel % SIZE, y = Math.floor(pixel / SIZE);
      if (x > 0 && !seen[pixel - 1]) { seen[pixel - 1] = 1; queue[tail++] = pixel - 1; }
      if (x < SIZE - 1 && !seen[pixel + 1]) { seen[pixel + 1] = 1; queue[tail++] = pixel + 1; }
      if (y > 0 && !seen[pixel - SIZE]) { seen[pixel - SIZE] = 1; queue[tail++] = pixel - SIZE; }
      if (y < SIZE - 1 && !seen[pixel + SIZE]) { seen[pixel + SIZE] = 1; queue[tail++] = pixel + SIZE; }
    }
    if (!removed) showToast('No matching pixels found. Try a higher tolerance.');
    else showToast('Background removed. Use Undo if needed.');
  }

  function brushMask(point) {
    const radius = Number($('brushRange').value) * 2 / state.scale;
    const minX = Math.max(0, point.x - radius), maxX = Math.min(SIZE - 1, point.x + radius);
    const minY = Math.max(0, point.y - radius), maxY = Math.min(SIZE - 1, point.y + radius);
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) if ((x - point.x) ** 2 + (y - point.y) ** 2 <= radius ** 2) state.mask[y * SIZE + x] = 0;
  }

  function applyPolygonSelection(points) {
    if (points.length < 3) return showToast('Add at least three points to select an area.');
    const sourcePoints = points.map(sourcePoint);
    const first = sourcePoints[0];
    let signedArea = 0;
    for (let i = 0; i < sourcePoints.length; i++) { const a = sourcePoints[i], b = sourcePoints[(i + 1) % sourcePoints.length]; signedArea += a.x * b.y - b.x * a.y; }
    if (Math.abs(signedArea) < 120) return showToast('Select a larger area before applying.');
    const selection = document.createElement('canvas'); selection.width = selection.height = SIZE;
    const context = selection.getContext('2d', { willReadFrequently: true });
    context.beginPath(); context.moveTo(first.x, first.y);
    for (const point of sourcePoints.slice(1)) context.lineTo(point.x, point.y);
    context.closePath(); context.fill();
    const alpha = context.getImageData(0, 0, SIZE, SIZE).data;
    const action = $('selectionAction').value;
    checkpoint();
    for (let i = 0; i < state.mask.length; i++) {
      const selected = alpha[i * 4 + 3];
      if (action === 'restore') state.mask[i] = Math.max(state.mask[i], selected);
      else state.mask[i] = Math.round(state.mask[i] * (action === 'invert' ? 255 - selected : selected) / 255);
    }
    selectionDraft = null; drawEditOverlay(); scheduleSave();
    showToast(action === 'invert' ? 'Kept the area outside your selection.' : action === 'restore' ? 'Restored the selected area.' : 'Kept the area inside your selection.');
  }

  function applyDraftSelection() {
    if (!selectionDraft) return showToast('Draw a selection on the canvas first.');
    if (selectionDraft.type === 'polygon') applyPolygonSelection(selectionDraft.points);
    else if (Math.abs(selectionDraft.x1 - selectionDraft.x0) < 8 || Math.abs(selectionDraft.y1 - selectionDraft.y0) < 8) showToast('Stretch the shape to cover a larger area.');
    else applyPolygonSelection(shapePoints(selectionDraft));
  }

  function updateSelectionHint() {
    if (cutoutTool === 'polygon') $('selectionHint').textContent = selectionDraft?.type === 'polygon' ? `${selectionDraft.points.length} points placed. Click more points, then Apply selection.` : 'Click at least three corners on the canvas, then Apply selection.';
    else if (cutoutTool === 'shape') $('selectionHint').textContent = 'Drag to draw a shape. Drag its corner handles to resize, then Apply selection.';
    else $('selectionHint').textContent = 'Draw around the area you want, then release.';
    $('undoSelectionPoint').classList.toggle('hidden', cutoutTool !== 'polygon');
  }

  function hitPart(point) {
    return [...state.parts].reverse().find(part => Math.hypot(point.x - part.x * 4, point.y - part.y * 4) <= part.size * 2.2 + 8) || null;
  }

  function bindCanvas() {
    stage.addEventListener('pointerdown', event => {
      if (currentTool === 'check' || (!sourceImage && !state.parts.length)) return;
      const point = stagePoint(event);
      stage.setPointerCapture(event.pointerId);
      if (currentTool === 'parts') {
        const active = selectedPart();
        const handle = active && hitHandle(point, partHandles(active));
        if (handle) { checkpoint(); drag = { type: 'part-resize', id: active.id, startDistance: Math.hypot(point.x - active.x * 4, point.y - active.y * 4), startSize: active.size }; stage.style.cursor = 'nwse-resize'; return; }
        const part = hitPart(point);
        selectedPartId = part?.id || null;
        if (part) { checkpoint(); drag = { type: 'part', id: part.id, dx: point.x / 4 - part.x, dy: point.y / 4 - part.y }; stage.style.cursor = 'grabbing'; }
        syncPartControls(); drawEditOverlay(); return;
      }
      if (currentTool === 'hotspot') {
        checkpoint();
        state.hotspotX = clamp(Math.floor(point.x / 4), 0, 63);
        state.hotspotY = clamp(Math.floor(point.y / 4), 0, 63);
        syncControls(); renderAll(); scheduleSave(); return;
      }
      if (currentTool === 'cutout') {
        if (!sourceImage) return;
        if (cutoutTool === 'lasso') { selectionDraft = null; drag = { type: 'lasso', points: [point] }; drawEditOverlay(); return; }
        if (cutoutTool === 'polygon') {
          if (selectionDraft?.type === 'polygon' && selectionDraft.closed && insidePolygon(point, selectionDraft.points)) { drag = { type: 'polygon-move', point, points: selectionDraft.points.map(vertex => ({ ...vertex })) }; stage.style.cursor = 'grabbing'; return; }
          if (!selectionDraft || selectionDraft.type !== 'polygon' || selectionDraft.closed) selectionDraft = { type: 'polygon', points: [] };
          const first = selectionDraft.points[0];
          if (first && selectionDraft.points.length >= 3 && Math.hypot(point.x - first.x, point.y - first.y) <= 10) selectionDraft.closed = true;
          else selectionDraft.points.push(point);
          updateSelectionHint(); drawEditOverlay(); return;
        }
        if (cutoutTool === 'shape') {
          const handle = selectionDraft?.type === 'shape' && hitHandle(point, shapeHandles(selectionDraft));
          if (handle) drag = { type: 'shape-resize', key: handle.key };
          else if (selectionDraft?.type === 'shape' && insidePolygon(point, shapePoints(selectionDraft))) drag = { type: 'shape-move', point, x0: selectionDraft.x0, x1: selectionDraft.x1, y0: selectionDraft.y0, y1: selectionDraft.y1 };
          else { selectionDraft = { type: 'shape', shape: selectedShape, x0: point.x, y0: point.y, x1: point.x, y1: point.y }; drag = { type: 'shape-draw' }; }
          drawEditOverlay(); return;
        }
        checkpoint();
        if (cutoutTool === 'magic') floodRemove(sourcePoint(point));
        else { brushMask(sourcePoint(point)); drag = { type: 'brush' }; }
        renderAll(); scheduleSave(); return;
      }
      if (!sourceImage) return;
      checkpoint();
      const handle = hitHandle(point, imageCorners());
      drag = handle ? { type: 'image-resize', center: { x: 128 + state.x * 4, y: 128 + state.y * 4 }, startDistance: Math.hypot(point.x - (128 + state.x * 4), point.y - (128 + state.y * 4)), startScale: state.scale } : { type: 'move', point, x: state.x, y: state.y };
      if (handle) stage.style.cursor = 'nwse-resize';
      else stage.style.cursor = 'grabbing';
    });
    stage.addEventListener('pointermove', event => {
      if (!drag) return;
      const point = stagePoint(event);
      if (drag.type === 'lasso') {
        const last = drag.points.at(-1);
        if (Math.hypot(point.x - last.x, point.y - last.y) >= 2) { drag.points.push(point); drawEditOverlay(); }
        return;
      }
      if (drag.type === 'shape-draw') { selectionDraft.x1 = point.x; selectionDraft.y1 = point.y; drawEditOverlay(); return; }
      if (drag.type === 'shape-resize') {
        if (drag.key.includes('x0')) selectionDraft.x0 = point.x; else selectionDraft.x1 = point.x;
        if (drag.key.includes('y0')) selectionDraft.y0 = point.y; else selectionDraft.y1 = point.y;
        drawEditOverlay(); return;
      }
      if (drag.type === 'shape-move') {
        const dx = point.x - drag.point.x, dy = point.y - drag.point.y;
        const left = Math.min(drag.x0, drag.x1), right = Math.max(drag.x0, drag.x1), top = Math.min(drag.y0, drag.y1), bottom = Math.max(drag.y0, drag.y1);
        const mx = clamp(dx, -left, SIZE - right), my = clamp(dy, -top, SIZE - bottom);
        selectionDraft.x0 = drag.x0 + mx; selectionDraft.x1 = drag.x1 + mx; selectionDraft.y0 = drag.y0 + my; selectionDraft.y1 = drag.y1 + my;
        drawEditOverlay(); return;
      }
      if (drag.type === 'polygon-move') {
        const dx = point.x - drag.point.x, dy = point.y - drag.point.y;
        const xs = drag.points.map(vertex => vertex.x), ys = drag.points.map(vertex => vertex.y);
        const mx = clamp(dx, -Math.min(...xs), SIZE - 1 - Math.max(...xs)), my = clamp(dy, -Math.min(...ys), SIZE - 1 - Math.max(...ys));
        selectionDraft.points = drag.points.map(vertex => ({ x: vertex.x + mx, y: vertex.y + my })); drawEditOverlay(); return;
      }
      if (drag.type === 'image-resize') {
        const distance = Math.hypot(point.x - drag.center.x, point.y - drag.center.y);
        state.scale = clamp(Math.round(drag.startScale * distance / Math.max(1, drag.startDistance) * 100) / 100, .2, 2);
        syncControls(); renderAll(); scheduleSave(); return;
      }
      if (drag.type === 'part-resize') {
        const part = state.parts.find(item => item.id === drag.id);
        if (part) { const distance = Math.hypot(point.x - part.x * 4, point.y - part.y * 4); part.size = clamp(Math.round(drag.startSize * distance / Math.max(1, drag.startDistance)), 6, 36); syncPartControls(); renderAll(); scheduleSave(); }
        return;
      }
      if (drag.type === 'part') {
        const part = state.parts.find(item => item.id === drag.id);
        if (part) { part.x = clamp(Math.round(point.x / 4 - drag.dx), 0, 64); part.y = clamp(Math.round(point.y / 4 - drag.dy), 0, 64); syncPartControls(); }
      } else if (drag.type === 'brush') brushMask(sourcePoint(point));
      else if (drag.type === 'move') { state.x = clamp(Math.round(drag.x + (point.x - drag.point.x) / 4), -64, 64); state.y = clamp(Math.round(drag.y + (point.y - drag.point.y) / 4), -64, 64); syncControls(); }
      renderAll(); scheduleSave();
    });
    stage.addEventListener('pointerup', () => { if (drag?.type === 'lasso') applyPolygonSelection(drag.points); drag = null; stage.style.cursor = currentTool === 'design' ? 'grab' : 'crosshair'; renderAll(); });
    stage.addEventListener('pointercancel', () => { drag = null; stage.style.cursor = currentTool === 'design' ? 'grab' : 'crosshair'; drawEditOverlay(); });
  }

  function bindSlider(id, key, transform = Number) {
    const input = $(id);
    let active = false;
    input.addEventListener('pointerdown', () => { checkpoint(); active = true; });
    input.addEventListener('input', () => {
      if (!active) { checkpoint(); active = true; }
      state[key] = transform(input.value);
      syncControls(); renderAll(); scheduleSave();
    });
    input.addEventListener('change', () => { active = false; });
    input.addEventListener('pointerup', () => { active = false; });
  }

  function bindNumber(id, key, min, max) {
    $(id).addEventListener('change', event => {
      const value = Number(event.target.value);
      if (!Number.isFinite(value)) return syncControls();
      checkpoint(); state[key] = clamp(Math.round(value), min, max);
      syncControls(); renderAll(); scheduleSave();
    });
  }

  function safeFilename() {
    return (state.name || 'my-cursor').trim().replace(/[\\/:*?"<>|\x00-\x1f]/g, '').replace(/\s+/g, '-').slice(0, 60) || 'my-cursor';
  }

  function triggerDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename;
    document.body.append(anchor); anchor.click(); anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  function crc32(bytes) {
    let value = 0xffffffff;
    for (const byte of bytes) { value ^= byte; for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0); }
    return (value ^ 0xffffffff) >>> 0;
  }

  function zipFiles(files) {
    const encoder = new TextEncoder(), localChunks = [], centralChunks = [];
    const now = new Date(), dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2);
    const dosDate = ((Math.max(1980, now.getFullYear()) - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
    let offset = 0, centralSize = 0;
    for (const file of files) {
      const name = encoder.encode(file.name), data = file.data, crc = crc32(data);
      const local = new Uint8Array(30 + name.length), lv = new DataView(local.buffer);
      lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true); lv.setUint16(6, 0x800, true);
      lv.setUint16(10, dosTime, true); lv.setUint16(12, dosDate, true);
      lv.setUint32(14, crc, true); lv.setUint32(18, data.length, true); lv.setUint32(22, data.length, true); lv.setUint16(26, name.length, true); local.set(name, 30);
      localChunks.push(local, data);
      const central = new Uint8Array(46 + name.length), cv = new DataView(central.buffer);
      cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true); cv.setUint16(8, 0x800, true);
      cv.setUint16(12, dosTime, true); cv.setUint16(14, dosDate, true);
      cv.setUint32(16, crc, true); cv.setUint32(20, data.length, true); cv.setUint32(24, data.length, true); cv.setUint16(28, name.length, true); cv.setUint32(42, offset, true); central.set(name, 46);
      centralChunks.push(central); centralSize += central.length; offset += local.length + data.length;
    }
    const end = new Uint8Array(22), ev = new DataView(end.buffer);
    ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, files.length, true); ev.setUint16(10, files.length, true); ev.setUint32(12, centralSize, true); ev.setUint32(16, offset, true);
    return new Blob([...localChunks, ...centralChunks, end], { type: 'application/zip' });
  }

  async function downloadBatch() {
    syncActiveVariant();
    const anchor = setAnchorPart();
    if (!anchor) return showToast('Place a cursor component before exporting a set.');
    if (setHasMissingParts()) { checkpoint(); ensureSetComponents(anchor); syncControls(); renderAll(); scheduleSave(); }
    const button = $('downloadBatch'); button.disabled = true; button.textContent = 'Preparing ZIP…';
    const gridButton = $('exportSetGrid'); gridButton.disabled = true;
    const original = { parts: state.parts, cursorRole: state.cursorRole, hotspotX: state.hotspotX, hotspotY: state.hotspotY };
    try {
      const size = Number($('exportSize').value), factor = size / LOGICAL, files = [], manifest = { name: state.name, size, style: state.style, states: [] };
      for (const [index, variant] of state.variants.entries()) {
        state.parts = cloneParts(variant.parts); state.cursorRole = variant.role; state.hotspotX = variant.hotspotX; state.hotspotY = variant.hotspotY;
        drawComposition();
        const canvas = outputCanvas(size);
        const blob = await new Promise((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('PNG export failed')), 'image/png'));
        const filename = `${String(index + 1).padStart(2, '0')}-${variant.role.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.png`;
        files.push({ name: filename, data: new Uint8Array(await blob.arrayBuffer()) });
        manifest.states.push({ name: variant.name, role: variant.role, file: filename, hotspot: { x: clamp(Math.round(variant.hotspotX * factor), 0, size - 1), y: clamp(Math.round(variant.hotspotY * factor), 0, size - 1) } });
      }
      files.push({ name: 'cursor-set.json', data: new TextEncoder().encode(JSON.stringify(manifest, null, 2)) });
      triggerDownload(zipFiles(files), `${safeFilename()}-cursor-set.zip`);
      showToast(`Downloaded ${state.variants.length} cursor states as ZIP.`);
    } catch (error) { console.error(error); showToast('Could not prepare the cursor set. Please try again.'); }
    finally { Object.assign(state, original); renderAll(); button.disabled = false; button.textContent = 'Download all states as ZIP'; gridButton.disabled = false; }
  }

  function showExport() {
    if (!sourceImage && !state.variants.some(variant => variant.parts.length) && !state.parts.length) return showToast('Add an image or part before exporting.');
    updateExport(); lastFocus = document.activeElement;
    $('exportModal').classList.remove('hidden'); $('closeExport').focus();
  }

  function closeExport() {
    $('exportModal').classList.add('hidden');
    if (lastFocus && typeof lastFocus.focus === 'function') lastFocus.focus();
  }

  function bindPreview() {
    $$('[data-bg]').forEach(button => button.addEventListener('click', () => {
      $$('[data-bg]').forEach(other => other.classList.toggle('active', other === button));
      $('previewPlayground').className = `preview-playground ${button.dataset.bg === 'light' ? '' : button.dataset.bg}`;
    }));
    $('previewButton').addEventListener('click', () => showToast('Nice click! Your hotspot landed here.'));
    $('previewLink').addEventListener('click', event => { event.preventDefault(); showToast('This is a test link. Your artwork is unchanged.'); });
    $('aimZone').addEventListener('pointerdown', event => {
      if (!sourceImage && !state.parts.length) return;
      const rect = $('aimZone').getBoundingClientRect();
      const x = event.clientX - rect.left, y = event.clientY - rect.top;
      const distance = Math.round(Math.hypot(x - rect.width / 2, y - rect.height / 2));
      $('aimHit').style.left = `${x}px`;
      $('aimHit').style.top = `${y}px`;
      $('aimHit').classList.remove('hidden');
      $('aimFeedback').textContent = distance <= 8 ? 'On target! Your click landed within 8 px.' : `${distance} px from center. Adjust the hotspot and try again.`;
    });
  }

  function bindUI() {
    setupInspectorScrollbar();
    $('brandHome').addEventListener('click', () => showPage('home'));
    $$('[data-page]').forEach(button => button.addEventListener('click', () => showPage(button.dataset.page)));
    $('headerStart').addEventListener('click', () => showPage('editor'));
    $('saveWork').addEventListener('click', () => saveWork());
    $('editorGallery').addEventListener('click', () => showPage('gallery'));
    $('viewAllCreations').addEventListener('click', () => showPage('gallery'));
    ['homeCreationsCreate','galleryCreate','galleryEmptyCreate'].forEach(id => $(id).addEventListener('click', startNewWork));
    $('languageSelect').addEventListener('change', () => queueMicrotask(refreshCreations));
    ['heroUpload','uploadEditor','emptyUpload'].forEach(id => $(id).addEventListener('click', () => $('fileInput').click()));
    ['heroSample','sampleEditor'].forEach(id => $(id).addEventListener('click', startSample));
    $('fileInput').addEventListener('change', async event => { const file = event.target.files?.[0]; event.target.value = ''; await importFile(file); });
    $('homeGuide').addEventListener('click', () => showPage('guide'));
    $('guideCreate').addEventListener('click', () => showPage('editor'));
    $$('[data-tool]').forEach(button => button.addEventListener('click', () => selectTool(button.dataset.tool)));
    $$('[data-cutout]').forEach(button => button.addEventListener('click', () => {
      cutoutTool = button.dataset.cutout; selectionDraft = null;
      $$('[data-cutout]').forEach(item => item.classList.toggle('active', item === button));
      $('cutoutHint').textContent = { magic: 'Click a plain background color to remove it.', erase: 'Brush over pixels to erase them.', lasso: 'Drag a freehand loop. Choose whether to keep inside or outside.', polygon: 'Click corners to form an area. Click the first point to close it.', shape: 'Choose a shape, drag to draw it, then move or stretch it. Press Delete to remove the selection.' }[cutoutTool];
      $('selectionControls').classList.toggle('hidden', !['lasso','polygon','shape'].includes(cutoutTool));
      $('shapeChoices').classList.toggle('hidden', cutoutTool !== 'shape');
      updateSelectionHint(); drawEditOverlay();
    }));
    $$('[data-shape]').forEach(button => button.addEventListener('click', () => { selectedShape = button.dataset.shape; $$('[data-shape]').forEach(item => item.classList.toggle('active', item === button)); if (selectionDraft?.type === 'shape') selectionDraft.shape = selectedShape; drawEditOverlay(); }));
    $('applySelection').addEventListener('click', () => { applyDraftSelection(); renderAll(); updateSelectionHint(); });
    $('undoSelectionPoint').addEventListener('click', () => { if (selectionDraft?.type !== 'polygon') return; selectionDraft.points.pop(); selectionDraft.closed = false; if (!selectionDraft.points.length) selectionDraft = null; updateSelectionHint(); drawEditOverlay(); });
    $('cancelSelection').addEventListener('click', () => { selectionDraft = null; drawEditOverlay(); updateSelectionHint(); });
    $$('[data-style]').forEach(button => button.addEventListener('click', () => { if (state.style === button.dataset.style) return; checkpoint(); state.style = button.dataset.style; syncControls(); renderAll(); scheduleSave(); }));
    $('styleSelect').addEventListener('change', event => { checkpoint(); state.style = event.target.value; syncControls(); renderAll(); scheduleSave(); });
    bindSlider('scaleRange', 'scale', value => Number(value) / 100);
    bindSlider('rotateRange', 'rotation');
    bindSlider('outlineRange', 'outline');
    for (const id of ['pixelDetail','pixelGray','pixelBrightness','pixelContrast','pixelLevels','duoContrast','halftoneSpacing','halftoneAngle','halftoneContrast','sketchLines','sketchStrength','sketchContrast','crtScan','crtPitch','crtGlow','crtWarp','crtRgb','crtGrain']) bindSlider(id, id);
    $('crtType').addEventListener('change', event => { checkpoint(); state.crtType = event.target.value; renderAll(); scheduleSave(); });
    $('pixelDither').addEventListener('change', event => { checkpoint(); state.pixelDither = event.target.value; renderAll(); scheduleSave(); });
    for (const id of ['duoDark','duoLight','halftoneInk','halftonePaper','sketchInk','sketchPaper']) $(id).addEventListener('change', event => { checkpoint(); state[id] = event.target.value; renderAll(); scheduleSave(); });
    ['posX','posY'].forEach((id, index) => bindNumber(id, index ? 'y' : 'x', -64, 64));
    bindNumber('hotspotX', 'hotspotX', 0, 63); bindNumber('hotspotY', 'hotspotY', 0, 63);
    $('outlineColor').addEventListener('input', event => { checkpoint(); state.outlineColor = event.target.value; renderAll(); scheduleSave(); });
    $('cursorRole').addEventListener('change', event => { checkpoint(); const variant = state.variants.find(item => item.id === state.activeVariantId); if (variant && variant.name === state.cursorRole) variant.name = event.target.value; state.cursorRole = event.target.value; if (state.parts.length === 1) { const replacement = partForRole(state.cursorRole); state.parts[0].type = replacement.type; state.parts[0].rotation = replacement.rotation; } syncControls(); renderAll(); scheduleSave(); });
    const roleChoices = $('roleChoices');
    for (const role of CURSOR_ROLES) { const label = document.createElement('label'); const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.value = role; checkbox.checked = ['IBeam','Help','Forbidden'].includes(role); label.append(checkbox, document.createTextNode(role)); roleChoices.append(label); }
    $('generateVariants').addEventListener('click', () => {
      const roles = [...roleChoices.querySelectorAll('input:checked')].map(input => input.value);
      if (!roles.length) return showToast('Select at least one cursor role.');
      syncActiveVariant();
      const anchor = setAnchorPart();
      if (!anchor) return showToast('Place a cursor component before generating a set.');
      const existing = new Set(state.variants.map(variant => variant.role));
      const newRoles = roles.filter(role => !existing.has(role));
      if (newRoles.length || setHasMissingParts()) {
        checkpoint(); ensureSetComponents(anchor);
        for (const role of newRoles) state.variants.push(makeVariant(role, anchor));
        if (newRoles.length) activateVariant(state.variants.at(-newRoles.length).id);
        else { syncControls(); renderAll(); scheduleSave(); }
      }
      showSetGrid();
      if (newRoles.length) showToast(`Created ${newRoles.length} cursor states with the same artwork.`);
    });
    $('leaveSetGrid').addEventListener('click', leaveSetGrid);
    $('exportSetGrid').addEventListener('click', downloadBatch);
    $('duplicateVariant').addEventListener('click', () => { checkpoint(); syncActiveVariant(); const original = state.variants.find(item => item.id === state.activeVariantId); const copy = { ...original, id: `variant-${crypto.randomUUID()}`, name: `${original.name} copy`, parts: cloneParts(original.parts) }; state.variants.push(copy); activateVariant(copy.id); showToast('State duplicated. Change its parts or role.'); });
    $('deleteVariant').addEventListener('click', () => { if (state.variants.length < 2) return; checkpoint(); state.variants = state.variants.filter(item => item.id !== state.activeVariantId); activateVariant(state.variants[0].id); showToast('Cursor state removed. Undo to restore it.'); });
    $('deletePart').addEventListener('click', () => { if (!selectedPart()) return; checkpoint(); state.parts = state.parts.filter(part => part.id !== selectedPartId); selectedPartId = null; syncPartControls(); renderAll(); scheduleSave(); });
    for (const [id, key] of [['partSize','size'],['partRotation','rotation']]) {
      let active = false;
      $(id).addEventListener('pointerdown', () => { if (selectedPart()) { checkpoint(); active = true; } });
      $(id).addEventListener('input', event => { const part = selectedPart(); if (!part) return; if (!active) { checkpoint(); active = true; } part[key] = Number(event.target.value); syncPartControls(); renderAll(); scheduleSave(); });
      $(id).addEventListener('change', () => { active = false; });
      $(id).addEventListener('pointerup', () => { active = false; });
    }
    for (const [id, key] of [['partX','x'],['partY','y']]) $(id).addEventListener('change', event => { const part = selectedPart(); if (!part) return; checkpoint(); part[key] = clamp(Math.round(Number(event.target.value) || 0), 0, 64); syncPartControls(); renderAll(); scheduleSave(); });
    $('partColor').addEventListener('change', event => { const part = selectedPart(); if (!part) return; checkpoint(); part.color = event.target.value; renderAll(); scheduleSave(); });
    $('projectName').addEventListener('change', event => { checkpoint(); state.name = event.target.value.trim().slice(0, 48) || 'My cursor'; syncControls(); scheduleSave(); });
    $('toleranceRange').addEventListener('input', event => $('toleranceValue').textContent = event.target.value);
    $('brushRange').addEventListener('input', event => $('brushValue').textContent = `${event.target.value} px`);
    $('clearMask').addEventListener('click', () => { if (!sourceImage) return; checkpoint(); state.mask = freshMask(); renderAll(); scheduleSave(); showToast('Whole image restored.'); });
    $('centerHotspot').addEventListener('click', () => { checkpoint(); state.hotspotX = 32; state.hotspotY = 32; syncControls(); renderAll(); scheduleSave(); });
    $('undoBtn').addEventListener('click', undo); $('redoBtn').addEventListener('click', redo);
    $('resetBtn').addEventListener('click', () => { if (!confirm('Start a new cursor? Your current local project will be replaced.')) return; checkpoint(); state = defaults(); activeWorkId = null; sourceImage = null; selectedPartId = null; selectionDraft = null; syncControls(); renderAll(); scheduleSave(); selectTool('cutout', { automatic: true }); });
    $('exportTop').addEventListener('click', showExport);
    $('closeExport').addEventListener('click', closeExport);
    $('exportModal').addEventListener('click', event => { if (event.target === $('exportModal')) closeExport(); });
    $('exportSize').addEventListener('change', updateExport);
    $('downloadPng').addEventListener('click', () => {
      if (!sourceImage && !state.parts.length) return;
      const size = Number($('exportSize').value);
      outputCanvas(size).toBlob(blob => { if (!blob) return showToast('Could not create PNG. Please try again.'); triggerDownload(blob, `${safeFilename()}-${size}px.png`); showToast('Transparent PNG downloaded.'); }, 'image/png');
    });
    $('downloadInfo').addEventListener('click', () => { const size = Number($('exportSize').value); const factor = size / 64; const info = { name: state.name, role: state.cursorRole, width: size, height: size, hotspot: { x: clamp(Math.round(state.hotspotX * factor), 0, size - 1), y: clamp(Math.round(state.hotspotY * factor), 0, size - 1) }, note: 'PNG does not automatically apply this hotspot or role in Mousecape.' }; triggerDownload(new Blob([JSON.stringify(info, null, 2)], { type: 'application/json' }), `${safeFilename()}-hotspot.json`); });
    $('downloadBatch').addEventListener('click', downloadBatch);
    $('copyHotspot').addEventListener('click', async () => { try { await navigator.clipboard.writeText($('exportHotspot').textContent); showToast('Hotspot copied.'); } catch { showToast('Copy unavailable. Read the coordinates shown above.'); } });
    $('exportGuide').addEventListener('click', () => { closeExport(); showPage('guide'); });
    document.addEventListener('keydown', event => {
      if (!$('exportModal').classList.contains('hidden')) {
        if (event.key === 'Escape') { closeExport(); return; }
        if (event.key === 'Tab') {
          const focusable = [...$('exportModal').querySelectorAll('button, select')].filter(el => !el.disabled);
          const first = focusable[0], last = focusable[focusable.length - 1];
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        }
      }
      const typing = ['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName);
      if (!typing && currentPage === 'editor' && $('exportModal').classList.contains('hidden') && (event.key === 'Delete' || event.key === 'Backspace')) {
        if (currentTool === 'parts' && selectedPart()) { event.preventDefault(); checkpoint(); state.parts = state.parts.filter(part => part.id !== selectedPartId); selectedPartId = null; syncControls(); renderAll(); scheduleSave(); return; }
        if (currentTool === 'cutout' && selectionDraft) { event.preventDefault(); selectionDraft = null; drawEditOverlay(); updateSelectionHint(); return; }
      }
      if (typing || !(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'z') return;
      event.preventDefault(); if (event.shiftKey) redo(); else undo();
    });
    window.addEventListener('popstate', () => showPage(location.hash.replace('#', '') || 'home', false));
    window.addEventListener('hashchange', () => showPage(location.hash.replace('#', '') || 'home', false));
    bindCanvas(); bindPreview(); updateHistoryButtons();
  }

  bindUI(); syncControls(); renderAll(); showPage(location.hash.replace('#', '') || 'home', false); restoreProject();
})();
