  const vscode = acquireVsCodeApi();
  let sendOnEnter = true;
  let isComposing = false; // IME composition guard

  const inputBox = document.getElementById('inputBox');
  const sendBtn = document.getElementById('sendBtn');
  const timeline = document.getElementById('timeline');
  const emptyState = document.getElementById('emptyState');
  const topbarDate = document.getElementById('topbarDate');
  const topbarCount = document.getElementById('topbarCount');
  const inboxBtn = document.getElementById('inboxBtn');
  const allBtn = document.getElementById('allBtn');
  const activeTagBtn = document.getElementById('activeTagBtn');
  const openFileBtn = document.getElementById('openFileBtn');
  const jumpDateBtn = document.getElementById('jumpDateBtn');
  const jumpDateInput = document.getElementById('jumpDateInput');
  const backToTodayBtn = document.getElementById('backToTodayBtn');
  const errorBanner = document.getElementById('errorBanner');
  const searchInput = document.getElementById('searchInput');
  const clearSearch = document.getElementById('clearSearch');
  const exportBtn = document.getElementById('exportBtn');
  const selectedCountLabel = document.getElementById('selectedCountLabel');
  const exportNoteBtn = document.getElementById('exportNoteBtn');
  const exportCancelBtn = document.getElementById('exportCancelBtn');
  let activeTag = null;
  let activeTagLabel = '';
  let currentSearchText = '';
  let latestSections = [];
  let currentPinnedEntries = [];
  let editingEntryKey = null;
  let editingText = '';
  let selectMode = false;
  const selectedEntries = new Set();
  let pendingScrollMode = 'top';
  let pendingScrollTop = 0;
  let hasMoreOlder = false;
  let loadingOlder = false;
  let todayDate = '';
  let anchorDate = '';
  const momentTagPattern = __MOMENT_TAG_PATTERN__;

  // Notify extension we're ready
  vscode.postMessage({ command: 'ready' });

  // ---- Message from extension ----
  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (msg.command === 'update') {
      sendOnEnter = msg.sendOnEnter;
      currentLocale = msg.locale || 'en';
      applyStaticStrings();
      latestSections = msg.sections;
      todayDate = msg.todayDate || '';
      anchorDate = msg.anchorDate || todayDate;
      currentPinnedEntries = msg.pinnedEntries || [];
      hasMoreOlder = Boolean(msg.hasMoreOlder);
      loadingOlder = false;
      updateTopbar(todayDate, latestSections, anchorDate);
      updateAnchorChip(anchorDate, todayDate);
      if (
        editingEntryKey !== null
        && !latestSections.some((section) => section.entries.some((entry) => (section.date + ':' + entry.index) === editingEntryKey))
      ) {
        editingEntryKey = null;
        editingText = '';
      }
      renderTimeline(latestSections);
      if (pendingScrollMode === 'top') {
        timeline.scrollTop = 0;
      } else if (pendingScrollMode === 'preserve') {
        timeline.scrollTop = pendingScrollTop;
      }
      pendingScrollMode = null;
      window.requestAnimationFrame(() => {
        maybeLoadOlderEntries();
      });
    } else if (msg.command === 'error') {
      showError(msg.message);
    }
  });

  function showError(msg) {
    errorBanner.textContent = msg;
    errorBanner.style.display = 'block';
    setTimeout(() => { errorBanner.style.display = 'none'; }, 4000);
  }

  function applyStaticStrings() {
    allBtn.title = UI('allMoments');
    allBtn.setAttribute('aria-label', UI('allMoments'));
    inboxBtn.title = UI('taskInbox');
    inboxBtn.setAttribute('aria-label', UI('taskInbox'));
    openFileBtn.title = UI('openTodayFile');
    openFileBtn.setAttribute('aria-label', UI('openTodayFile'));
    jumpDateBtn.title = UI('jumpToDate');
    jumpDateBtn.setAttribute('aria-label', UI('jumpToDate'));
    jumpDateInput.setAttribute('aria-label', UI('jumpToDate'));
    backToTodayBtn.title = UI('backToToday');
    backToTodayBtn.setAttribute('aria-label', UI('backToToday'));
    backToTodayBtn.textContent = UI('backToToday');
    exportBtn.title = UI('exportSelected');
    exportBtn.setAttribute('aria-label', UI('exportSelected'));
    clearSearch.title = UI('clearSearch');
    searchInput.placeholder = UI('searchPlaceholder');
    inputBox.placeholder = UI('capturePlaceholder');
    sendBtn.title = UI('sendBtn');
    exportNoteBtn.textContent = UI('exportAsNote');
    exportCancelBtn.textContent = UI('cancelBtn');
    const emptyTitle = document.getElementById('emptyTitle');
    const emptyHint = document.getElementById('emptyHint');
    if (emptyTitle) emptyTitle.textContent = UI('emptyToday');
    if (emptyHint) emptyHint.textContent = UI('emptyHint');
  }

  function updateTopbar(dateStr, sections, anchorDate) {
    // Format date label
    const anchor = anchorDate || dateStr;
    if (anchor) {
      const d = new Date(anchor + 'T00:00:00');
      const opts = { month: 'short', day: 'numeric', year: 'numeric' };
      const dateLocale = currentLocale === 'ja' ? 'ja-JP' : 'en-US';
      const label = d.toLocaleDateString(dateLocale, opts);
      topbarDate.textContent = anchor === dateStr ? label + ' ' + UI('todaySuffix') : label;
    } else {
      topbarDate.textContent = '';
    }

    // Count today's entries
    const todaySection = sections.find(s => s.isToday);
    const todayCount = todaySection ? todaySection.entries.length : 0;
    if (todayCount > 0) {
      topbarCount.textContent = UI('momentCount', { count: todayCount });
      topbarCount.style.display = '';
    } else {
      topbarCount.style.display = 'none';
    }

    // Highlight allBtn as active (default view)
    allBtn.classList.add('active');
    allBtn.setAttribute('aria-pressed', 'true');
  }

  function updateAnchorChip(anchorDate, todayDate) {
    backToTodayBtn.style.display = anchorDate && anchorDate !== todayDate ? '' : 'none';
  }

  // ---- Render ----
  function escapeHtml(text) {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function renderText(text) {
    // Highlight #tags
    let html = escapeHtml(text);
    html = html.replace(new RegExp(momentTagPattern, 'gu'), (tag) => '<button class="tag" type="button" data-tag="' + tag + '">' + tag + '</button>');
    // Highlight @YYYY-MM-DD due dates
    html = html.replace(/@(\d{4}-\d{2}-\d{2})/g, '<span class="due-date-inline">@$1</span>');
    // Auto-link URLs
    html = html.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" style="color:var(--moments-accent)">$1</a>');
    return html;
  }

  function matchMomentTags(text) {
    return text.match(new RegExp(momentTagPattern, 'gu')) || [];
  }

  function normalizeTag(tag) {
    return String(tag || '').normalize('NFKC').toLowerCase();
  }

  function getEntryTags(entry) {
    if (Array.isArray(entry.tags) && entry.tags.length > 0) {
      return entry.tags.map((tag) => normalizeTag(tag));
    }

    return matchMomentTags(entry.text).map((tag) => normalizeTag(tag));
  }

  function setActiveTag(tag) {
    const normalizedTag = normalizeTag(tag);
    if (!normalizedTag || activeTag === normalizedTag) {
      activeTag = null;
      activeTagLabel = '';
    } else {
      activeTag = normalizedTag;
      activeTagLabel = tag;
    }

    timeline.scrollTop = 0;
    renderTimeline(latestSections);
  }

  function autoResizeTextarea(textarea) {
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 180) + 'px';
  }

  function requestLoadOlderEntries() {
    if (loadingOlder || !hasMoreOlder) {
      return;
    }

    loadingOlder = true;
    pendingScrollMode = 'preserve';
    pendingScrollTop = timeline.scrollTop;
    vscode.postMessage({ command: 'loadMore' });
  }

  function maybeLoadOlderEntries() {
    if (loadingOlder || !hasMoreOlder) {
      return;
    }

    const threshold = 180;
    const nearBottom = timeline.scrollTop + timeline.clientHeight >= timeline.scrollHeight - threshold;
    const contentShort = timeline.scrollHeight <= timeline.clientHeight + threshold;

    if (nearBottom || contentShort) {
      requestLoadOlderEntries();
    }
  }

  function renderTimeline(sections) {
    const visibleSections = sections
      .map((section) => ({
        ...section,
        entries: section.entries
          .filter((entry) => !activeTag || getEntryTags(entry).includes(activeTag))
          .filter((entry) => !currentSearchText || entry.text.toLowerCase().includes(currentSearchText))
          .slice()
          .reverse(),
      }))
      .filter((section) => section.entries.length > 0);

    allBtn.classList.add('active');
    allBtn.setAttribute('aria-pressed', 'true');
    activeTagBtn.style.display = activeTag ? '' : 'none';
    activeTagBtn.textContent = activeTag ? activeTagLabel + ' ×' : '';
    activeTagBtn.title = activeTag ? UI('clearSearch') : UI('clearSearch');
    activeTagBtn.setAttribute('aria-label', activeTag ? UI('clearSearch') : UI('clearSearch'));

    if (visibleSections.length === 0) {
      emptyState.style.display = 'block';
      timeline.querySelectorAll('.day-section, .pinned-section').forEach(e => e.remove());
      if (currentSearchText && activeTag) {
        emptyState.textContent = UI('noMomentsSearchTag', { tag: activeTagLabel, query: currentSearchText });
      } else if (currentSearchText) {
        emptyState.textContent = UI('noMomentsSearch', { query: currentSearchText });
      } else if (activeTag) {
        emptyState.textContent = UI('noMomentsTagged', { tag: activeTagLabel });
      } else {
        emptyState.textContent = UI('noMomentsEmpty');
      }
      return;
    }

    emptyState.style.display = 'none';

    timeline.querySelectorAll('.day-section, .pinned-section').forEach(e => e.remove());

    // Render pinned section
    if (currentPinnedEntries.length > 0) {
      const pinnedSectionEl = document.createElement('section');
      pinnedSectionEl.className = 'pinned-section';

      const pinnedHeader = document.createElement('div');
      pinnedHeader.className = 'pinned-section-header';
      const pinnedLabel = document.createElement('span');
      pinnedLabel.className = 'pinned-section-label';
      pinnedLabel.textContent = '📌 ' + UI('pinnedHeader');
      pinnedHeader.appendChild(pinnedLabel);
      pinnedSectionEl.appendChild(pinnedHeader);

      currentPinnedEntries.forEach((pinned) => {
        const div = document.createElement('div');
        div.className = 'entry pinned-entry';

        const meta = document.createElement('div');
        meta.className = 'entry-meta';

        const dateBadge = document.createElement('span');
        dateBadge.className = 'entry-time';
        dateBadge.textContent = pinned.date + (pinned.time ? ' · ' + pinned.time : '');
        meta.appendChild(dateBadge);

        const header = document.createElement('div');
        header.className = 'entry-header';

        const headerLeading = document.createElement('div');
        headerLeading.className = 'entry-header-leading';

        const textSpan = document.createElement('div');
        textSpan.className = 'entry-text';
        textSpan.innerHTML = renderText(pinned.text);
        textSpan.querySelectorAll('.tag').forEach((tagButton) => {
          tagButton.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            setActiveTag(tagButton.dataset.tag || '');
          });
        });

        const content = document.createElement('div');
        content.className = 'entry-content';

        headerLeading.appendChild(meta);

        const actions = document.createElement('div');
        actions.className = 'entry-actions entry-header-actions';

        const unpinButton = document.createElement('button');
        unpinButton.className = 'pin-btn pinned';
        unpinButton.type = 'button';
        unpinButton.title = UI('unpin');
        unpinButton.setAttribute('aria-label', UI('unpin'));
        unpinButton.textContent = '📌';
        unpinButton.addEventListener('click', () => {
          vscode.postMessage({ command: 'unpinEntry', pinnedId: pinned.date + ':' + pinned.index });
        });
        actions.appendChild(unpinButton);

        header.appendChild(headerLeading);
        header.appendChild(actions);
        content.appendChild(header);
        content.appendChild(textSpan);
        div.appendChild(content);
        pinnedSectionEl.appendChild(div);
      });

      timeline.appendChild(pinnedSectionEl);
    }

    visibleSections.forEach((section) => {
      const unpinnedEntries = section.entries.filter(
        (e) => !currentPinnedEntries.some((p) => p.date === section.date && p.index === e.index)
      );
      if (unpinnedEntries.length === 0) return;

      const sectionEl = document.createElement('section');
      sectionEl.className = 'day-section';

      const sectionHeader = document.createElement('div');
      sectionHeader.className = 'day-section-header';

      const sectionLabel = document.createElement('span');
      sectionLabel.className = 'day-section-label' + (section.isToday ? ' is-today' : '');
      sectionLabel.textContent = section.dateLabel;

      sectionHeader.appendChild(sectionLabel);
      sectionEl.appendChild(sectionHeader);

      unpinnedEntries.forEach((entry) => {
      const entryKey = section.date + ':' + entry.index;
      const exportKey = JSON.stringify({ date: section.date, index: entry.index });
      const div = document.createElement('div');
      div.className = 'entry' + (selectMode && selectedEntries.has(exportKey) ? ' selected-for-export' : '');

      const meta = document.createElement('div');
      meta.className = 'entry-meta';

      const timeBadge = document.createElement('span');
      timeBadge.className = 'entry-time';
      timeBadge.textContent = entry.time;

      meta.appendChild(timeBadge);

      const header = document.createElement('div');
      header.className = 'entry-header';

      const dueDateMatch = entry.text.match(new RegExp(__DUE_DATE_PATTERN_SOURCE__, "i"));
      const dueDate = dueDateMatch ? dueDateMatch[1] : null;
      if (dueDate) {
        let dueDateStatus = null;
        if (!entry.done && todayDate) {
          if (dueDate < todayDate) {
            dueDateStatus = 'overdue';
          } else if (dueDate === todayDate) {
            dueDateStatus = 'today';
          } else {
            dueDateStatus = 'upcoming';
          }
        }
        if (dueDateStatus) {
          div.classList.add('due-' + dueDateStatus);
        }
        const dueBadge = document.createElement('span');
        dueBadge.className = 'due-badge';
        dueBadge.textContent = dueDateStatus === 'today' ? UI('todayBadge') : dueDate;
        meta.appendChild(dueBadge);
      }

      if (entryKey === editingEntryKey) {
        const editWrap = document.createElement('div');
        editWrap.className = 'entry-edit';

        const editInput = document.createElement('textarea');
        editInput.value = editingText;
        editInput.setAttribute('aria-label', UI('edit'));
        editInput.addEventListener('input', () => {
          editingText = editInput.value;
          autoResizeTextarea(editInput);
        });
        editInput.addEventListener('keydown', (event) => {
          if (event.isComposing || event.keyCode === 229) {
            return;
          }
          if (event.key === 'Enter') {
            let shouldSave = false;
            if (sendOnEnter && !event.shiftKey) {
              shouldSave = true;
            } else if (!sendOnEnter && (event.metaKey || event.ctrlKey)) {
              shouldSave = true;
            }

            if (shouldSave) {
              event.preventDefault();
              const nextText = editInput.value.trim();
              if (!nextText) {
                showError(UI('momentTextEmpty'));
                return;
              }
              editingEntryKey = null;
              editingText = '';
              vscode.postMessage({ command: 'saveEdit', date: section.date, index: entry.index, text: nextText });
            }
          }
          if (event.key === 'Escape') {
            event.preventDefault();
            editingEntryKey = null;
            editingText = '';
            renderTimeline(latestSections);
          }
        });

        const editActions = document.createElement('div');
        editActions.className = 'entry-edit-actions';

        const saveButton = document.createElement('button');
        saveButton.className = 'entry-action save';
        saveButton.type = 'button';
        saveButton.title = UI('save');
        saveButton.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><polyline points="20 6 9 17 4 12"></polyline></svg>';
        saveButton.addEventListener('click', () => {
          const nextText = editInput.value.trim();
          if (!nextText) {
            showError(UI('momentTextEmpty'));
            return;
          }
          editingEntryKey = null;
          editingText = '';
          vscode.postMessage({ command: 'saveEdit', date: section.date, index: entry.index, text: nextText });
        });

        const cancelButton = document.createElement('button');
        cancelButton.className = 'entry-action';
        cancelButton.type = 'button';
        cancelButton.title = UI('cancelBtn');
        cancelButton.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';
        cancelButton.addEventListener('click', () => {
          editingEntryKey = null;
          editingText = '';
          renderTimeline(latestSections);
        });

        editActions.appendChild(saveButton);
        editActions.appendChild(cancelButton);
        editWrap.appendChild(editInput);
        editWrap.appendChild(editActions);
        div.appendChild(editWrap);

        sectionEl.appendChild(div);
        setTimeout(() => {
          editInput.focus();
          editInput.selectionStart = editInput.value.length;
          editInput.selectionEnd = editInput.value.length;
          autoResizeTextarea(editInput);
        }, 0);
        return;
      }

      const textSpan = document.createElement('div');
      textSpan.className = 'entry-text';
      textSpan.innerHTML = renderText(entry.text);
      textSpan.querySelectorAll('.tag').forEach((tagButton) => {
        tagButton.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          setActiveTag(tagButton.dataset.tag || '');
        });
      });

      const content = document.createElement('div');
      content.className = 'entry-content';

      const selectCb = document.createElement('input');
      selectCb.type = 'checkbox';
      selectCb.className = 'select-entry-cb';
      selectCb.checked = selectedEntries.has(exportKey);
      selectCb.setAttribute('aria-label', 'Select entry for export');
      selectCb.addEventListener('change', () => {
        if (selectCb.checked) {
          selectedEntries.add(exportKey);
          div.classList.add('selected-for-export');
        } else {
          selectedEntries.delete(exportKey);
          div.classList.remove('selected-for-export');
        }
        updateExportBar();
      });

      const actions = document.createElement('div');
      actions.className = 'entry-actions entry-header-actions';

      const editButton = document.createElement('button');
      editButton.className = 'entry-action';
      editButton.type = 'button';
      editButton.title = UI('edit');
      editButton.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path></svg>';
      editButton.addEventListener('click', () => {
        editingEntryKey = entryKey;
        editingText = entry.text;
        renderTimeline(latestSections);
      });

      const deleteButton = document.createElement('button');
      deleteButton.className = 'entry-action danger';
      deleteButton.type = 'button';
      deleteButton.title = UI('delete');
      deleteButton.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>';
      deleteButton.addEventListener('click', () => {
        if (editingEntryKey === entryKey) {
          editingEntryKey = null;
          editingText = '';
        }
        vscode.postMessage({ command: 'requestDeleteEntry', date: section.date, index: entry.index });
      });

      actions.appendChild(editButton);

      const isPinned = currentPinnedEntries.some((p) => p.date === section.date && p.index === entry.index);
      const pinButton = document.createElement('button');
      pinButton.className = 'pin-btn' + (isPinned ? ' pinned' : '');
      pinButton.type = 'button';
      pinButton.title = isPinned ? UI('unpin') : UI('pin');
      pinButton.setAttribute('aria-label', isPinned ? UI('unpin') : UI('pin'));
      pinButton.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><line x1="18" y1="8" x2="22" y2="12"></line><line x1="12" y1="2" x2="12" y2="6"></line><path d="M12 6H8a2 2 0 0 0-2 2v3.586a1 1 0 0 1-.293.707l-2.828 2.828a1 1 0 0 0 0 1.414L6 19.5a1 1 0 0 0 1.414 0l2.828-2.828a1 1 0 0 1 .707-.293H15a2 2 0 0 0 2-2V8"></path></svg>';
      pinButton.addEventListener('click', () => {
        if (isPinned) {
          vscode.postMessage({ command: 'unpinEntry', pinnedId: section.date + ':' + entry.index });
        } else {
          vscode.postMessage({ command: 'pinEntry', date: section.date, index: entry.index, text: entry.text, time: entry.time });
        }
      });
      actions.appendChild(pinButton);
      actions.appendChild(deleteButton);

      const headerLeading = document.createElement('div');
      headerLeading.className = 'entry-header-leading';
      headerLeading.appendChild(selectCb);
      headerLeading.appendChild(meta);

      header.appendChild(headerLeading);
      header.appendChild(actions);
      content.appendChild(header);
      content.appendChild(textSpan);
      div.appendChild(content);
      sectionEl.appendChild(div);
    });

      timeline.appendChild(sectionEl);
    });
  }

  function send() {
    const text = inputBox.value.trim();
    if (!text) return;
    pendingScrollMode = 'top';
    vscode.postMessage({ command: 'addMoment', text });
    inputBox.value = '';
    autoResize();
  }

  sendBtn.addEventListener('click', send);

  // Track IME composition to prevent sending on Japanese/CJK Enter confirmation
  inputBox.addEventListener('compositionstart', () => { isComposing = true; });
  inputBox.addEventListener('compositionend', () => { isComposing = false; });

  inputBox.addEventListener('keydown', (e) => {
    if (isComposing) { return; } // ignore Enter during IME composition
    if (sendOnEnter) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        send();
      }
    } else {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        send();
      }
    }
  });

  inputBox.addEventListener('input', autoResize);

  function autoResize() {
    autoResizeTextarea(inputBox);
  }

  openFileBtn.addEventListener('click', () => vscode.postMessage({ command: 'openFile' }));
  inboxBtn.addEventListener('click', () => vscode.postMessage({ command: 'openInbox' }));

  jumpDateBtn.addEventListener('click', () => {
    if (typeof jumpDateInput.showPicker === 'function') {
      jumpDateInput.showPicker();
    } else {
      jumpDateInput.click();
    }
  });
  jumpDateInput.addEventListener('change', () => {
    if (jumpDateInput.value) {
      vscode.postMessage({ command: 'jumpToDate', date: jumpDateInput.value });
    }
    jumpDateInput.value = '';
  });
  backToTodayBtn.addEventListener('click', () => {
    vscode.postMessage({ command: 'jumpToToday' });
  });

  timeline.addEventListener('scroll', () => {
    maybeLoadOlderEntries();
  }, { passive: true });
  allBtn.addEventListener('click', () => {
    renderTimeline(latestSections);
  });
  activeTagBtn.addEventListener('click', () => {
    activeTag = null;
    activeTagLabel = '';
    renderTimeline(latestSections);
  });

  let searchDebounceTimer = null;

  searchInput.addEventListener('input', () => {
    const query = searchInput.value;
    clearSearch.style.display = query ? '' : 'none';
    if (searchDebounceTimer) {
      clearTimeout(searchDebounceTimer);
    }
    searchDebounceTimer = setTimeout(() => {
      const trimmed = query.trim();
      if (trimmed) {
        currentSearchText = trimmed.toLowerCase();
        pendingScrollMode = 'top';
        vscode.postMessage({ command: 'searchMoments', query });
      } else {
        currentSearchText = '';
        vscode.postMessage({ command: 'refreshFeed' });
      }
    }, 250);
  });

  clearSearch.addEventListener('click', () => {
    if (searchDebounceTimer) {
      clearTimeout(searchDebounceTimer);
      searchDebounceTimer = null;
    }
    searchInput.value = '';
    currentSearchText = '';
    clearSearch.style.display = 'none';
    searchInput.focus();
    vscode.postMessage({ command: 'refreshFeed' });
  });

  function updateExportBar() {
    const count = selectedEntries.size;
    selectedCountLabel.textContent = UI('selectedCount', { count: count });
    exportNoteBtn.disabled = count === 0;
  }

  function enterSelectMode() {
    selectMode = true;
    document.body.classList.add('select-mode');
    exportBtn.classList.add('active');
    selectedEntries.clear();
    updateExportBar();
    renderTimeline(latestSections);
  }

  function exitSelectMode() {
    selectMode = false;
    document.body.classList.remove('select-mode');
    exportBtn.classList.remove('active');
    selectedEntries.clear();
    renderTimeline(latestSections);
  }

  exportBtn.addEventListener('click', () => {
    if (selectMode) {
      exitSelectMode();
    } else {
      enterSelectMode();
    }
  });

  exportCancelBtn.addEventListener('click', exitSelectMode);

  exportNoteBtn.addEventListener('click', () => {
    if (selectedEntries.size === 0) { return; }
    const entriesData = [];
    for (const key of selectedEntries) {
      const { date, index } = JSON.parse(key);
      const sectionData = latestSections.find(s => s.date === date);
      if (sectionData) {
        const entryData = sectionData.entries.find(e => e.index === index);
        if (entryData) {
          entriesData.push({ date, index, text: entryData.text });
        }
      }
    }
    if (entriesData.length > 0) {
      vscode.postMessage({ command: 'exportToNote', entries: entriesData });
    }
    exitSelectMode();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && selectMode && editingEntryKey === null) {
      exitSelectMode();
    }
  });
